import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import {
  getPatternEdges,
  migrateLegacyPieceToSegments,
  type GarmentDraft,
  type PatternPiece,
  type PatternPoint,
  type Seam,
  type SegmentRole,
} from "../domain/pattern";
import { buildXpbdInitialization } from "../physics/GarmentXpbdAdapter";
import { createBaselineFixture } from "../testFixtures/baselineGarments";
import { auditAdapterSeamResiduals } from "./InitialSeamResidual";
import { buildResolvedAssemblyInput } from "./ResolvedAssemblyInput";
import { buildSemanticAvatarArrangement } from "./SemanticAvatarArrangement";

const REPORT = process.env.MOLDEON_10_5_BASELINE === "1";

describe("Prompt 10.5 general garment spatial assembly baseline", () => {
  it("reproduces a partially-open four-panel shell with materially distinct seams", () => {
    const garment = generalGarmentFixture();
    const input = buildResolvedAssemblyInput(garment);
    const avatar = buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
    const arrangement = buildSemanticAvatarArrangement(input, avatar);
    const initialization = buildXpbdInitialization(arrangement.state, arrangement.garment, "prompt-10.5-baseline");
    const adapter = auditAdapterSeamResiduals(
      arrangement.state,
      arrangement.garment,
      initialization.positions,
      initialization.seamIndices,
      initialization.seamWeights,
      initialization.seamRestDistances,
      initialization.seamGroupIds,
    );

    const assembly = arrangement.initialSeamResidualAudit.afterTubeAlignment;
    const mappings = arrangement.state.instances.map((instance) => ({
      id: instance.id,
      mapping: instance.arrangement?.mapping ?? "none",
      tubeGroupId: instance.arrangement?.tubeGroupId ?? null,
    }));
    const pairGroups = new Map<string, Set<string>>();
    for (const constraint of arrangement.state.stitchConstraints) {
      if (!constraint.instanceA || !constraint.instanceB || constraint.instanceA === constraint.instanceB) continue;
      const pair = [constraint.instanceA, constraint.instanceB].sort().join("<->");
      const groups = pairGroups.get(pair) ?? new Set<string>();
      groups.add(constraint.seamGroupId);
      pairGroups.set(pair, groups);
    }
    const multipleRelations = [...pairGroups.entries()]
      .filter(([, groups]) => groups.size > 1)
      .map(([pair, groups]) => ({ pair, seamGroups: [...groups].sort() }));

    const report = {
      assembly: {
        meanResidualMm: assembly.meanResidualMm,
        maxResidualMm: assembly.maxResidualMm,
        groups: assembly.groups.map((group) => ({
          seamGroupId: group.seamGroupId,
          classification: group.classification,
          instanceIds: group.instanceIds,
          rangesA: group.rangesA,
          rangesB: group.rangesB,
          meanResidualMm: group.meanResidualMm,
          maxResidualMm: group.maxResidualMm,
        })),
      },
      adapter: {
        meanResidualMm: adapter.meanResidualMm,
        maxResidualMm: adapter.maxResidualMm,
        maximumCorrespondenceJumpMm: adapter.maximumCorrespondenceJumpMm,
      },
      mappings,
      multipleRelations,
      seamPlacementDiagnostics: arrangement.seamPlacementDiagnostics.map((diagnostic) => ({
        seamGroupId: diagnostic.seamGroupId,
        parentInstanceId: diagnostic.parentInstanceId,
        childInstanceId: diagnostic.childInstanceId,
        parentRange: diagnostic.parentRange,
        childRange: diagnostic.childRange,
        developAngleRad: diagnostic.transform.developAngleRad,
      })),
      normalSpreadRad: panelNormalSpread(arrangement.state.positions, arrangement.state.instances),
    };

    if (REPORT) console.log(`MOLDEON_10_5_BASELINE ${JSON.stringify(report)}`);

    expect(arrangement.state.instances).toHaveLength(4);
    expect(multipleRelations.length).toBeGreaterThanOrEqual(2);
    expect(initialization.topologyDiagnostics.valid).toBe(true);
    expect(adapter.maximumCorrespondenceJumpMm).toBeLessThan(1e-3);
    expect(Number.isFinite(assembly.maxResidualMm)).toBe(true);
  });
});

function generalGarmentFixture(): GarmentDraft {
  const base = createBaselineFixture("free-simple-piece");
  const pieces = ["A", "B", "C", "D"].map((id, index) => ({
    ...neutralPanel(id, index % 2 === 0 ? "frontArmhole" : "backArmhole"),
    fabricId: base.fabrics[0].id,
  }));
  const edge = (pieceIndex: number, edgeIndex: number) => getPatternEdges(pieces[pieceIndex])[edgeIndex];
  const relation = (
    id: string,
    firstPiece: number,
    firstEdge: number,
    secondPiece: number,
    secondEdge: number,
    startT = 0,
    endT = 1,
  ): Seam => ({
    id,
    groupId: id,
    name: id,
    first: { pieceId: pieces[firstPiece].id, edgeId: edge(firstPiece, firstEdge).id, startT, endT },
    second: { pieceId: pieces[secondPiece].id, edgeId: edge(secondPiece, secondEdge).id, startT, endT },
    direction: "opposite",
    easeRatio: 0,
    type: "standard",
    treatment: "standard",
    active: true,
  });

  const seams: Seam[] = [
    relation("g-side-ab", 0, 2, 1, 4),
    relation("g-shoulder-ab", 0, 0, 1, 0),
    relation("g-shoulder-bc", 1, 0, 2, 0),
    relation("g-side-cd", 2, 2, 3, 4),
    relation("g-shoulder-cd", 2, 0, 3, 0),
    relation("g-shoulder-da", 3, 0, 0, 0),
  ];

  return {
    ...base,
    id: "fixture-general-garment-shell",
    templateId: "fixture-general-garment-shell",
    name: "Neutral four-panel garment shell",
    pieces,
    seams,
    assemblyPlacements: pieces.map((piece, index) => ({
      pieceId: piece.id,
      role: index % 2 === 0 ? "front" : "back",
      outwardSide: index % 2 === 0 ? "front" : "back",
      positionMm: [(index - 1.5) * 280, 0, 0],
      rotationDeg: [0, 0, 0],
      flipped: false,
      source: "manual",
    })),
    dressing: { region: "upper", frontReferencePieceId: pieces[0].id },
  };
}

function neutralPanel(id: string, armholeRole: "frontArmhole" | "backArmhole"): PatternPiece {
  const piece = migrateLegacyPieceToSegments({
    id,
    name: id,
    seamAllowanceMm: 10,
    cutQuantity: 1,
    points: [
      point(`${id}:neck-shoulder`, 36, 0, undefined, { xMm: -12, yMm: 18 }),
      point(`${id}:shoulder-arm`, 96, 18, { xMm: 18, yMm: 4 }),
      point(`${id}:underarm`, 120, 82, undefined, { xMm: -12, yMm: -28 }),
      point(`${id}:outer-hem`, 120, 300),
      point(`${id}:inner-hem`, 0, 300),
      point(`${id}:neck-center`, 0, 62, { xMm: 14, yMm: -34 }),
    ],
    grainline: { start: { xMm: 60, yMm: 70 }, end: { xMm: 60, yMm: 270 } },
  });
  const roles: SegmentRole[] = ["shoulder", armholeRole, "sideSeam", "hem", "sideSeam", "neckline"];
  return {
    ...piece,
    segments: piece.segments?.map((segment, index) => ({ ...segment, role: roles[index] ?? "other" })),
  };
}

function point(
  id: string,
  xMm: number,
  yMm: number,
  handleOut?: { xMm: number; yMm: number },
  handleIn?: { xMm: number; yMm: number },
): PatternPoint {
  return { id, xMm, yMm, ...(handleOut ? { handleOut } : {}), ...(handleIn ? { handleIn } : {}) };
}

function panelNormalSpread(
  positions: Float32Array,
  instances: readonly { particleStart: number; topology: { triangles: Uint32Array } }[],
): number {
  const normals = instances.map((instance) => {
    const triangle = instance.topology.triangles;
    if (triangle.length < 3) return [0, 0, 1] as const;
    const indices = [triangle[0], triangle[1], triangle[2]].map((local) => instance.particleStart + local);
    const a = indices[0] * 3, b = indices[1] * 3, c = indices[2] * 3;
    const ab = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const ac = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const length = Math.hypot(...n) || 1;
    return [n[0] / length, n[1] / length, n[2] / length] as const;
  });
  let spread = 0;
  for (let i = 0; i < normals.length; i += 1) for (let j = i + 1; j < normals.length; j += 1) {
    const dot = Math.max(-1, Math.min(1, Math.abs(normals[i][0] * normals[j][0] + normals[i][1] * normals[j][1] + normals[i][2] * normals[j][2])));
    spread = Math.max(spread, Math.acos(dot));
  }
  return spread;
}
