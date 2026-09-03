import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel, resolveAvatarAnchor } from "../avatar/AvatarParametricModel";
import { createBlankGarment } from "../domain/blankGarment";
import { createDefaultFabricSource } from "../domain/fabric";
import { getPatternEdges, type BodyAnchorId, type GarmentDraft, type PatternBodyPlacement, type PatternPiece } from "../domain/pattern";
import { buildGarmentAssemblyMeshes } from "./GarmentThreeBridge";
import { buildResolvedGarmentAssembly } from "./ResolvedGarmentAssembly";
import { buildResolvedAssemblyInput, buildResolvedAssemblyInputFromDocument, updateResolvedAssemblyArrangements } from "./ResolvedAssemblyInput";
import { buildSemanticAvatarArrangement } from "./SemanticAvatarArrangement";

function placement(
  region: NonNullable<PatternBodyPlacement["region"]>,
  surface: NonNullable<PatternBodyPlacement["surface"]>,
  bodySide: NonNullable<PatternBodyPlacement["bodySide"]>,
  anchorId: BodyAnchorId,
) {
  return {
    version: 1 as const,
    status: "confirmed" as const,
    includeIn3D: true,
    role: "custom" as const,
    region,
    surface,
    bodySide,
    anchorId,
    outwardFace: "normal" as const,
    offsetXMm: 0,
    offsetYMm: 0,
    offsetZMm: 25,
    rotationXDeg: 0,
    rotationYDeg: 0,
    rotationZDeg: 0,
    source: "manual" as const,
  };
}

function square(id: string, bodyPlacement: PatternPiece["bodyPlacement"]): PatternPiece {
  return {
    id,
    name: id,
    seamAllowanceMm: 0,
    cutQuantity: 1,
    bodyPlacement,
    points: [
      { id: `${id}:a`, xMm: 0, yMm: 0 },
      { id: `${id}:b`, xMm: 100, yMm: 0 },
      { id: `${id}:c`, xMm: 100, yMm: 160 },
      { id: `${id}:d`, xMm: 0, yMm: 160 },
    ],
  };
}

function draft(pieces: PatternPiece[]): GarmentDraft {
  const blank = createBlankGarment();
  const fabric = createDefaultFabricSource();
  return {
    ...blank,
    templateId: "source-a",
    fabrics: [fabric],
    pieces: pieces.map((piece) => ({ ...piece, fabricId: fabric.id })),
  };
}

describe("ResolvedAssemblyInput canonical contract", () => {
  it("updates only arrangement state without rebuilding canonical geometry artifacts", () => {
    const input = buildResolvedAssemblyInput(draft([square("fast", undefined)]));
    const instance = input.panelInstances[0];
    const next = updateResolvedAssemblyArrangements(input, [{
      instanceId: instance.id,
      positionMm: [120, 980, 40],
      orientationDeg: [15, -20, 35],
    }]);
    expect(next).not.toBe(input);
    expect(next.geometryRevision).toBe(input.geometryRevision);
    expect(next.geometrySignatures).toBe(input.geometrySignatures);
    expect(next.snapshots).toBe(input.snapshots);
    expect(next.diagnostics).toBe(input.diagnostics);
    expect(next.arrangementRevision).not.toBe(input.arrangementRevision);
    expect(next.panelInstances[0].arrangementAnchor).toMatchObject({
      positionMm: [120, 980, 40],
      orientationDeg: [15, -20, 35],
      scale: 1,
      source: "manual",
    });
    expect(next.garmentProjection.pieces[0].previewPlacements?.[0]).toMatchObject({
      positionMm: [120, 980, 40],
      orientationDeg: [15, -20, 35],
      presentationMode: "authored",
    });
  });

  it("does not let Provar promote fresh unassigned panels into body placements", () => {
    const first = square("banana", undefined);
    const second = square("panel-123", undefined);
    const garment = draft([first, second]);
    garment.dressing = { region: "upper", frontReferencePieceId: first.id };
    garment.seams = [{
      id: "side",
      name: "Lateral",
      first: { pieceId: first.id, edgeId: getPatternEdges(first)[0].id, startT: 0, endT: 1 },
      second: { pieceId: second.id, edgeId: getPatternEdges(second)[0].id, startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      active: true,
    }];

    const input = buildResolvedAssemblyInput(garment);
    const state = buildResolvedGarmentAssembly(input);

    expect(input.document.patternDefinitions.map((definition) => definition.bodyPlacement.status)).toEqual([
      "unclassified",
      "unclassified",
    ]);
    expect(input.panelInstances).toHaveLength(2);
    expect(input.panelInstances.every((instance) =>
      instance.placementStatus === "unclassified"
      && instance.arrangementAnchor === undefined
      && instance.metadata.effectivePlacementSource === "unassigned",
    )).toBe(true);
    expect(input.garmentProjection.pieces.every((piece) =>
      piece.previewPlacements?.every((preview) => preview.presentationMode === "staging"),
    )).toBe(true);
    expect(input.garmentProjection.pieces.every((piece) =>
      piece.previewPlacements?.every((preview) => preview.positionMm === undefined),
    )).toBe(true);
    expect(state.instances).toHaveLength(2);
    expect(state.instances.map((instance) => instance.id).sort()).toEqual(input.panelInstances.map((instance) => instance.id).sort());
  });

  it("produces no panel instances or garment meshes for an empty project", () => {
    const garment = createBlankGarment();
    const input = buildResolvedAssemblyInput(garment);
    const state = buildResolvedGarmentAssembly(input);
    const meshes = buildGarmentAssemblyMeshes(state, input.garmentProjection, {
      castShadow: false,
      receiveShadow: false,
    });
    expect(input.panelInstances).toEqual([]);
    expect(state.instances).toEqual([]);
    expect(meshes).toEqual([]);
  });

  it("keeps included instances visible in Montar even when simulation is disabled", () => {
    const garment = draft([square("visual-only", undefined)]);
    const document = buildResolvedAssemblyInput(garment).document;
    document.panelInstances[0].simulationEnabled = false;

    const input = buildResolvedAssemblyInputFromDocument(document);
    const state = buildResolvedGarmentAssembly(input);

    expect(input.panelInstances.map((instance) => instance.id)).toEqual(["visual-only:panel:1"]);
    expect(input.simulationPanelInstances).toEqual([]);
    expect(input.assemblyDocument.panelInstances).toHaveLength(1);
    expect(input.simulationDocument.panelInstances).toHaveLength(0);
    expect(state.instances).toHaveLength(1);
    expect(input.garmentProjection.pieces[0].previewPlacements?.[0]).toMatchObject({
      id: "visual-only:panel:1",
      presentationMode: "staging",
    });
    expect(input.garmentProjection.pieces[0].previewPlacements?.[0]?.positionMm).toBeUndefined();
  });

  it("does not let templateId or a legacy arrangement scale alter physical assembly", () => {
    const piece = square("free", placement("torso", "front", "center", "torso-front"));
    piece.previewPlacements = [{
      id: "legacy-scaled",
      pieceId: piece.id,
      region: "torso",
      surface: "front",
      bodySide: "center",
      bodyAnchorId: "torso-front",
      rotationDeg: 0,
      offsetXMm: 0,
      offsetYMm: 0,
      offsetZMm: 25,
      scale: 8,
    }];
    const first = draft([piece]);
    const second = { ...structuredClone(first), templateId: "completely-different-template" };
    const firstInput = buildResolvedAssemblyInput(first);
    const secondInput = buildResolvedAssemblyInput(second);
    const state = buildResolvedGarmentAssembly(firstInput);

    expect(firstInput.signature).toBe(secondInput.signature);
    expect(firstInput.panelInstances[0].arrangementAnchor?.scale).toBe(1);
    expect(state.instances[0].topology.boundsMm.width).toBeCloseTo(100, 5);
    expect(state.instances[0].placement.scale).toBe(1);
  });

  it("places identical geometry differently when explicit semantics differ", () => {
    const first = square("same-a", placement("torso", "front", "center", "torso-front"));
    const second = {
      ...square("same-b", placement("leg", "front", "right", "leg-right")),
      points: first.points.map((point, index) => ({ ...point, id: `same-b:${index}` })),
    };
    const garment = draft([first, second]);
    const input = buildResolvedAssemblyInput(garment);
    const avatar = buildAvatarParametricModel(garment.measurements, garment.bodyType);
    const result = buildSemanticAvatarArrangement(input, avatar);
    const instanceA = result.state.instances.find((instance) => instance.pieceId === first.id)!;
    const instanceB = result.state.instances.find((instance) => instance.pieceId === second.id)!;
    const firstPosition = Array.from(result.state.positions.slice(instanceA.particleStart * 3, instanceA.particleStart * 3 + 3));
    const secondPosition = Array.from(result.state.positions.slice(instanceB.particleStart * 3, instanceB.particleStart * 3 + 3));

    expect(instanceA.topology.positions2DMm).toEqual(instanceB.topology.positions2DMm);
    expect(instanceA.arrangement?.anchorId).toBe("torso-front");
    expect(instanceB.arrangement?.anchorId).toBe("leg-right");
    expect(firstPosition).not.toEqual(secondPosition);
  });

  it("places the canonical P0 body anchors without scaling or swapping left/right", () => {
    const pieces = [
      square("torso-a", placement("torso", "front", "center", "torso-front")),
      square("torso-b", placement("torso", "back", "center", "torso-back")),
      square("sleeve-a", placement("arm", "side", "left", "arm-left")),
      square("sleeve-b", placement("arm", "side", "right", "arm-right")),
      square("pelvis-a", placement("hip", "front", "center", "hip-front")),
    ];
    const garment = draft(pieces);
    const result = buildSemanticAvatarArrangement(
      buildResolvedAssemblyInput(garment),
      buildAvatarParametricModel(garment.measurements, garment.bodyType),
    );
    const centroid = (pieceId: string) => {
      const instance = result.state.instances.find((candidate) => candidate.pieceId === pieceId)!;
      const center = [0, 0, 0];
      for (let local = 0; local < instance.vertexCount; local += 1) {
        const offset = (instance.particleStart + local) * 3;
        center[0] += result.state.positions[offset];
        center[1] += result.state.positions[offset + 1];
        center[2] += result.state.positions[offset + 2];
      }
      return center.map((value) => value / instance.vertexCount);
    };

    expect(centroid("torso-a")[2]).toBeGreaterThan(centroid("torso-b")[2]);
    expect(centroid("sleeve-a")[0]).toBeLessThan(0);
    expect(centroid("sleeve-b")[0]).toBeGreaterThan(0);
    expect(centroid("pelvis-a")[2]).toBeGreaterThan(0);

    for (const instance of result.state.instances) {
      expect(instance.placement.scale).toBe(1);
      const first = instance.particleStart * 3;
      const planar = instance.topology.positions2DMm;
      let verified100MmEdge = false;
      for (let a = 0; a < instance.vertexCount; a += 1) {
        for (let b = a + 1; b < instance.vertexCount; b += 1) {
          const planarDistanceMm = Math.hypot(planar[a * 2] - planar[b * 2], planar[a * 2 + 1] - planar[b * 2 + 1]);
          if (Math.abs(planarDistanceMm - 100) > 1e-4) continue;
          const offsetA = first + a * 3;
          const offsetB = first + b * 3;
          const spatialDistanceM = Math.hypot(
            result.state.positions[offsetA] - result.state.positions[offsetB],
            result.state.positions[offsetA + 1] - result.state.positions[offsetB + 1],
            result.state.positions[offsetA + 2] - result.state.positions[offsetB + 2],
          );
          expect(spatialDistanceM).toBeCloseTo(0.1, 6);
          verified100MmEdge = true;
          break;
        }
        if (verified100MmEdge) break;
      }
      expect(verified100MmEdge).toBe(true);
    }
  });

  it("returns no avatar anchor for custom or insufficient placement", () => {
    const garment = draft([square("free-custom", undefined)]);
    const avatar = buildAvatarParametricModel(garment.measurements, garment.bodyType);
    expect(resolveAvatarAnchor(avatar, {
      region: "custom",
      surface: "custom",
      bodySide: "center",
    })).toBeUndefined();
    expect(resolveAvatarAnchor(avatar, {
      region: "torso",
      surface: "side",
      bodySide: "center",
    })).toBeUndefined();
  });

  it("keeps a seam-free explicit hip-front rectangle open and rigid", () => {
    const piece = square("open-hip-front", placement("hip", "front", "center", "hip-front"));
    piece.cutOnFold = false;
    piece.cutQuantity = 1;
    piece.darts = [];
    const garment = draft([piece]);
    garment.seams = [];
    const result = buildSemanticAvatarArrangement(
      buildResolvedAssemblyInput(garment),
      buildAvatarParametricModel(garment.measurements, garment.bodyType),
    );
    const instance = result.state.instances[0];

    expect(result.state.instances).toHaveLength(1);
    expect(instance.placement.bodyAnchorId).toBe("hip-front");
    expect(instance.arrangement?.mapping).toBe("rigid-panel");
    expect(instance.arrangement?.tubeGroupId).toBeUndefined();
    expect(result.state.stitchConstraints).toHaveLength(0);
    expect(instance.topology.boundsMm.width).toBeCloseTo(100, 6);
    const first = instance.particleStart * 3;
    const positions = result.state.positions;
    let found100Mm = false;
    for (let a = 0; a < instance.vertexCount; a += 1) {
      for (let b = a + 1; b < instance.vertexCount; b += 1) {
        const planar = instance.topology.positions2DMm;
        const planarMm = Math.hypot(
          planar[a * 2] - planar[b * 2],
          planar[a * 2 + 1] - planar[b * 2 + 1],
        );
        if (Math.abs(planarMm - 100) > 1e-4) continue;
        const distanceM = Math.hypot(
          positions[first + a * 3] - positions[first + b * 3],
          positions[first + a * 3 + 1] - positions[first + b * 3 + 1],
          positions[first + a * 3 + 2] - positions[first + b * 3 + 2],
        );
        expect(distanceM).toBeCloseTo(0.1, 6);
        found100Mm = true;
        break;
      }
      if (found100Mm) break;
    }
    expect(found100Mm).toBe(true);
  });

  it("keeps two seam-free rectangles independent and never creates a tube", () => {
    const front = square("independent-front", placement("hip", "front", "center", "hip-front"));
    const back = square("independent-back", placement("hip", "back", "center", "hip-back"));
    const garment = draft([front, back]);
    garment.seams = [];
    const result = buildSemanticAvatarArrangement(
      buildResolvedAssemblyInput(garment),
      buildAvatarParametricModel(garment.measurements, garment.bodyType),
    );

    expect(result.state.instances).toHaveLength(2);
    expect(result.state.stitchConstraints).toHaveLength(0);
    expect(result.state.instances.every((instance) =>
      instance.arrangement?.mapping === "rigid-panel"
      && instance.arrangement.tubeGroupId === undefined,
    )).toBe(true);
    expect(new Set(result.state.instances.map((instance) => instance.id)).size).toBe(2);
  });

  it("consumes canonical SeamGroup treatment, distribution, ratio and slack in constraints", () => {
    const first = square("seam-a", placement("torso", "front", "center", "torso-front"));
    const second = square("seam-b", placement("torso", "back", "center", "torso-back"));
    const garment = draft([first, second]);
    garment.seams = [{
      id: "group-part-1",
      groupId: "canonical-group",
      name: "Costura canônica",
      first: { pieceId: first.id, edgeId: getPatternEdges(first)[0].id, startT: 0.1, endT: 0.9 },
      second: { pieceId: second.id, edgeId: getPatternEdges(second)[0].id, startT: 0.2, endT: 0.8 },
      direction: "opposite",
      easeRatio: 0.08,
      type: "ease",
      treatment: "ease",
      canonicalTreatment: "ease",
      distribution: "center-biased",
      targetRatio: 1.08,
      slackMm: 6,
      active: true,
    }];
    const input = buildResolvedAssemblyInput(garment);
    const state = buildResolvedGarmentAssembly(input);

    expect(input.seamGroups[0]).toMatchObject({
      id: "canonical-group",
      distribution: "center-biased",
      targetRatio: 1.08,
      slackMm: 6,
    });
    expect(state.stitchConstraints.length).toBeGreaterThan(0);
    expect(state.stitchConstraints.every((constraint) =>
      constraint.seamGroupId === "canonical-group"
      && constraint.treatment === "ease"
      && constraint.distribution === "center-biased"
      && constraint.targetRatio === 1.08
      && constraint.slackMm === 6
      && constraint.restDistance > 0.0015,
    )).toBe(true);
  });

  it.each(["same", "opposite"] as const)("generates ConstraintPoints over a composed side in %s direction", (direction) => {
    const first = square("long-edge", placement("torso", "front", "center", "torso-front"));
    const second: PatternPiece = {
      ...square("split-edge", placement("torso", "back", "center", "torso-back")),
      points: [
        { id: "split-edge:a", xMm: 0, yMm: 0 },
        { id: "split-edge:mid", xMm: 40, yMm: 0 },
        { id: "split-edge:b", xMm: 100, yMm: 0 },
        { id: "split-edge:c", xMm: 100, yMm: 160 },
        { id: "split-edge:d", xMm: 0, yMm: 160 },
      ],
    };
    const firstEdge = getPatternEdges(first)[0];
    const secondEdges = getPatternEdges(second);
    const firstRange = { pieceId: first.id, edgeId: firstEdge.id, startT: 0, endT: 1 };
    const secondRanges = [0, 1].map((index) => ({ pieceId: second.id, edgeId: secondEdges[index].id, startT: 0, endT: 1 }));
    const garment = draft([first, second]);
    garment.seams = [{
      id: "one-to-two",
      name: "Uma para duas",
      first: firstRange,
      second: secondRanges[0],
      secondRanges,
      direction,
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      active: true,
    }];

    const state = buildResolvedGarmentAssembly(buildResolvedAssemblyInput(garment));
    const constraints = state.stitchConstraints.filter((constraint) => constraint.seamGroupId === "one-to-two");
    expect(constraints.length).toBeGreaterThan(2);
    expect(new Set(constraints.map((constraint) => constraint.rangeB?.edgeId))).toEqual(
      new Set(secondRanges.map((range) => range.edgeId)),
    );
    expect(constraints[0].rangeB?.edgeId).toBe(direction === "same" ? secondRanges[0].edgeId : secondRanges[1].edgeId);
    expect(constraints.at(-1)?.rangeB?.edgeId).toBe(direction === "same" ? secondRanges[1].edgeId : secondRanges[0].edgeId);
  });
});


describe("11.0.8 sewing revision isolation", () => {
  it("changes sewing and simulation revisions without invalidating geometry or arrangement", () => {
    const first = square("sew-a", placement("torso", "front", "center", "torso-front"));
    const second = square("sew-b", placement("torso", "back", "center", "torso-back"));
    const garment = draft([first, second]);
    garment.seams = [{
      id: "sew-revision",
      name: "Revision seam",
      first: { pieceId: first.id, edgeId: getPatternEdges(first)[0].id, startT: 0, endT: 1 },
      second: { pieceId: second.id, edgeId: getPatternEdges(second)[0].id, startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      treatment: "standard",
      distribution: "uniform",
      targetRatio: 1,
      slackMm: 0,
      active: true,
    }];

    const original = buildResolvedAssemblyInput(garment);
    const reversedGarment = structuredClone(garment);
    reversedGarment.seams![0].direction = "same";
    const reversed = buildResolvedAssemblyInput(reversedGarment);

    expect(reversed.geometryRevision).toBe(original.geometryRevision);
    expect(reversed.arrangementRevision).toBe(original.arrangementRevision);
    expect(reversed.sewingRevision).not.toBe(original.sewingRevision);
    expect(reversed.simulationRevision).not.toBe(original.simulationRevision);

    const inactiveGarment = structuredClone(reversedGarment);
    inactiveGarment.seams![0].active = false;
    const inactive = buildResolvedAssemblyInput(inactiveGarment);
    expect(inactive.geometryRevision).toBe(original.geometryRevision);
    expect(inactive.arrangementRevision).toBe(original.arrangementRevision);
    expect(inactive.sewingRevision).not.toBe(reversed.sewingRevision);
    expect(inactive.seamGroups).toHaveLength(1);
    expect(inactive.seamGroups[0].active).toBe(false);
    expect(inactive.assemblyDocument.seamGroups[0].active).toBe(false);
    const inactiveAssembly = buildResolvedGarmentAssembly(inactive);
    expect(inactiveAssembly.stitchConstraints.filter((constraint) =>
      !constraint.seamGroupId.startsWith("dart:"),
    )).toHaveLength(0);
  });
});
