import { describe, expect, it } from "vitest";
import { duplicatePatternPiece, getPatternEdges, type GarmentDraft, type PatternPiece } from "../domain/pattern";
import { createBlankGarment } from "../domain/blankGarment";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import {
  createGarmentFromTemplate,
  DEFAULT_BODY_MEASUREMENTS,
  type PatternTemplateId,
} from "../patterns/templateCatalog";
import { buildSemanticAvatarArrangement } from "./SemanticAvatarArrangement";
import { buildResolvedAssemblyInput } from "./ResolvedAssemblyInput";
import {
  buildGarmentAssemblyMeshes,
  canReuseGarmentAssemblyMesh,
  captureGarmentMeshDiagnostics,
  copyGarmentAssemblyGeometry,
} from "./GarmentThreeBridge";
import { measureIntrinsicDistortion } from "./GarmentAssembly";

function arrange(templateId: PatternTemplateId) {
  const garment = createGarmentFromTemplate(templateId, DEFAULT_BODY_MEASUREMENTS, "feminine");
  const avatar = buildAvatarParametricModel(garment.measurements, garment.bodyType);
  return buildSemanticAvatarArrangement(buildResolvedAssemblyInput(garment), avatar);
}

function instanceCenterX(result: ReturnType<typeof arrange>, instanceId: string): number {
  const instance = result.state.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) throw new Error(`Instância ausente: ${instanceId}`);
  let sum = 0;
  for (let local = 0; local < instance.vertexCount; local += 1) {
    sum += result.state.positions[(instance.particleStart + local) * 3];
  }
  return sum / instance.vertexCount;
}

function genericComponent(panelCount: 2 | 4, withSeams: boolean): GarmentDraft {
  const blank = createBlankGarment();
  const pieces: PatternPiece[] = Array.from({ length: panelCount }, (_, index) => ({
    id: `generic-${index}`,
    name: `Painel ${index + 1}`,
    seamAllowanceMm: 0,
    cutQuantity: 1,
    points: [
      { id: `generic-${index}:a`, xMm: 0, yMm: 0 },
      { id: `generic-${index}:b`, xMm: 80, yMm: 0 },
      { id: `generic-${index}:c`, xMm: 80, yMm: 140 },
      { id: `generic-${index}:d`, xMm: 0, yMm: 140 },
    ],
    bodyPlacement: {
      version: 1,
      status: "confirmed",
      includeIn3D: true,
      role: "custom",
      region: "torso",
      surface: index % 2 === 0 ? "front" : "back",
      bodySide: "center",
      anchorId: index % 2 === 0 ? "torso-front" : "torso-back",
      outwardFace: "normal",
      offsetXMm: (index - (panelCount - 1) / 2) * 95,
      offsetYMm: index * 8,
      offsetZMm: 25,
      rotationXDeg: 0,
      rotationYDeg: 0,
      rotationZDeg: 0,
      source: "manual",
    },
  }));
  const seams = withSeams
    ? pieces.slice(0, -1).map((piece, index) => ({
        id: `generic-seam-${index}`,
        groupId: `generic-group-${index}`,
        first: {
          pieceId: piece.id,
          edgeId: getPatternEdges(piece)[1].id,
          startT: 0,
          endT: 1,
        },
        second: {
          pieceId: pieces[index + 1].id,
          edgeId: getPatternEdges(pieces[index + 1])[3].id,
          startT: 0,
          endT: 1,
        },
        direction: "opposite" as const,
        easeRatio: 0,
        type: "standard" as const,
        active: true,
      }))
    : [];
  return { ...blank, pieces, seams };
}

function arrangedDraft(garment: GarmentDraft) {
  return buildSemanticAvatarArrangement(
    buildResolvedAssemblyInput(garment),
    buildAvatarParametricModel(garment.measurements, garment.bodyType),
  );
}

function instanceStructuralLengths(
  result: ReturnType<typeof arrangedDraft>,
  instanceId: string,
): number[] {
  const instance = result.state.instances.find((candidate) => candidate.id === instanceId)!;
  const start = instance.particleStart;
  const end = start + instance.vertexCount;
  return result.state.structuralConstraints
    .filter((constraint) =>
      constraint.a >= start && constraint.a < end
      && constraint.b >= start && constraint.b < end,
    )
    .map((constraint) => {
      const a = constraint.a * 3;
      const b = constraint.b * 3;
      return Math.hypot(
        result.state.positions[b] - result.state.positions[a],
        result.state.positions[b + 1] - result.state.positions[a + 1],
        result.state.positions[b + 2] - result.state.positions[a + 2],
      );
    });
}

function tubeWithAttachments(attachmentCount: 0 | 1 | 2, attach = true): GarmentDraft {
  const blank = createBlankGarment();
  const placement = (
    index: number,
    surface: "front" | "back",
  ): NonNullable<PatternPiece["bodyPlacement"]> => ({
    version: 1,
    status: "confirmed",
    includeIn3D: true,
    role: "custom",
    region: "torso",
    surface,
    bodySide: "center",
    anchorId: surface === "front" ? "torso-front" : "torso-back",
    outwardFace: "normal",
    offsetXMm: index * 25,
    offsetYMm: 0,
    offsetZMm: 25,
    rotationXDeg: 0,
    rotationYDeg: 0,
    rotationZDeg: 0,
    source: "manual",
  });
  const tubePanel = (id: string, surface: "front" | "back"): PatternPiece => ({
    id,
    name: id,
    seamAllowanceMm: 0,
    cutQuantity: 1,
    points: [
      { id: `${id}:a`, xMm: 0, yMm: 0 },
      { id: `${id}:b`, xMm: 260, yMm: 0 },
      { id: `${id}:c`, xMm: 260, yMm: 100 },
      { id: `${id}:d`, xMm: 0, yMm: 100 },
    ],
    bodyPlacement: placement(0, surface),
  });
  const front = tubePanel("stable-tube-front", "front");
  const back = tubePanel("stable-tube-back", "back");
  const attachments = Array.from({ length: attachmentCount }, (_, index): PatternPiece => ({
    id: `attachment-${index + 1}`,
    name: `Painel adicional ${index + 1}`,
    seamAllowanceMm: 0,
    cutQuantity: 1,
    points: [
      { id: `attachment-${index + 1}:a`, xMm: 0, yMm: 0 },
      { id: `attachment-${index + 1}:b`, xMm: 80, yMm: 0 },
      { id: `attachment-${index + 1}:c`, xMm: 80, yMm: 60 },
      { id: `attachment-${index + 1}:d`, xMm: 0, yMm: 60 },
    ],
    bodyPlacement: placement(index + 1, index % 2 === 0 ? "front" : "back"),
  }));
  const frontEdges = getPatternEdges(front);
  const backEdges = getPatternEdges(back);
  const seams: NonNullable<GarmentDraft["seams"]> = [
    {
      id: "stable-tube-top",
      first: { pieceId: front.id, edgeId: frontEdges[0].id, startT: 0, endT: 1 },
      second: { pieceId: back.id, edgeId: backEdges[0].id, startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      active: true,
    },
    {
      id: "stable-tube-bottom",
      first: { pieceId: front.id, edgeId: frontEdges[2].id, startT: 0, endT: 1 },
      second: { pieceId: back.id, edgeId: backEdges[2].id, startT: 0, endT: 1 },
      direction: "opposite",
      easeRatio: 0,
      type: "standard",
      active: true,
    },
  ];
  if (attach) {
    attachments.forEach((piece, index) => {
      const host = index % 2 === 0 ? front : back;
      const hostEdge = getPatternEdges(host)[1];
      const attachmentEdge = getPatternEdges(piece)[3];
      seams.push({
        id: `attachment-seam-${index + 1}`,
        first: { pieceId: host.id, edgeId: hostEdge.id, startT: 0.2, endT: 0.8 },
        second: { pieceId: piece.id, edgeId: attachmentEdge.id, startT: 0, endT: 1 },
        direction: "opposite",
        easeRatio: 0,
        type: "standard",
        active: true,
      });
    });
  }
  return { ...blank, pieces: [front, back, ...attachments], seams };
}

function tubeWithUpperCycle(closeCycle: boolean): GarmentDraft {
  const blank = createBlankGarment();
  const rectangle = (id: string, width: number, height: number): PatternPiece => ({
    id,
    name: id,
    seamAllowanceMm: 0,
    cutQuantity: 1,
    points: [
      { id: `${id}:a`, xMm: 0, yMm: 0 },
      { id: `${id}:b`, xMm: width, yMm: 0 },
      { id: `${id}:c`, xMm: width, yMm: height },
      { id: `${id}:d`, xMm: 0, yMm: height },
    ],
  });
  const front = rectangle("cycle-tube-front", 100, 260);
  const back = rectangle("cycle-tube-back", 100, 260);
  const upperA = rectangle("cycle-upper-a", 100, 60);
  const upperB = rectangle("cycle-upper-b", 100, 60);
  const frontEdges = getPatternEdges(front);
  const backEdges = getPatternEdges(back);
  const upperAEdges = getPatternEdges(upperA);
  const upperBEdges = getPatternEdges(upperB);
  const seams: NonNullable<GarmentDraft["seams"]> = [
    {
      id: "cycle-tube-right",
      first: { pieceId: front.id, edgeId: frontEdges[1].id, startT: 0, endT: 1 },
      second: { pieceId: back.id, edgeId: backEdges[1].id, startT: 0, endT: 1 },
      direction: "opposite", easeRatio: 0, type: "standard", active: true,
    },
    {
      id: "cycle-tube-left",
      first: { pieceId: front.id, edgeId: frontEdges[3].id, startT: 0, endT: 1 },
      second: { pieceId: back.id, edgeId: backEdges[3].id, startT: 0, endT: 1 },
      direction: "opposite", easeRatio: 0, type: "standard", active: true,
    },
    {
      id: "attach-upper-a",
      first: { pieceId: front.id, edgeId: frontEdges[0].id, startT: 0, endT: 1 },
      second: { pieceId: upperA.id, edgeId: upperAEdges[2].id, startT: 0, endT: 1 },
      direction: "opposite", easeRatio: 0, type: "standard", active: true,
    },
    {
      id: "attach-upper-b",
      first: { pieceId: back.id, edgeId: backEdges[2].id, startT: 0, endT: 1 },
      second: { pieceId: upperB.id, edgeId: upperBEdges[2].id, startT: 0, endT: 1 },
      direction: "opposite", easeRatio: 0, type: "standard", active: true,
    },
  ];
  if (closeCycle) {
    seams.push(
      {
        id: "upper-cycle:part:1", groupId: "upper-cycle",
        first: { pieceId: upperA.id, edgeId: upperAEdges[1].id, startT: 0, endT: 1 },
        second: { pieceId: upperB.id, edgeId: upperBEdges[1].id, startT: 0, endT: 1 },
        direction: "opposite", easeRatio: 0, type: "standard", active: true,
      },
      {
        id: "upper-cycle:part:2", groupId: "upper-cycle",
        first: { pieceId: upperA.id, edgeId: upperAEdges[3].id, startT: 0, endT: 1 },
        second: { pieceId: upperB.id, edgeId: upperBEdges[3].id, startT: 0, endT: 1 },
        direction: "opposite", easeRatio: 0, type: "standard", active: true,
      },
    );
  }
  return {
    ...blank,
    pieces: [front, back, upperA, upperB],
    seams,
    dressing: { region: "upper", frontReferencePieceId: front.id },
  };
}

function instancePositions(
  result: ReturnType<typeof arrangedDraft>,
  instanceId: string,
): number[] {
  const instance = result.state.instances.find((candidate) => candidate.id === instanceId)!;
  return Array.from(result.state.positions.slice(
    instance.particleStart * 3,
    (instance.particleStart + instance.vertexCount) * 3,
  ));
}

describe("SemanticAvatarArrangement", () => {
  it.each([2, 4] as const)(
    "keeps each of %i generic panels stable while preserving SeamGroups for future physics",
    (panelCount) => {
      const withoutSeams = arrangedDraft(genericComponent(panelCount, false));
      const withSeams = arrangedDraft(genericComponent(panelCount, true));

      expect(withSeams.state.instances).toHaveLength(panelCount);
      expect(withSeams.state.positions.every(Number.isFinite)).toBe(true);
      expect(new Set(withSeams.state.stitchConstraints.map((constraint) => constraint.seamGroupId)).size)
        .toBe(panelCount - 1);
      expect(withSeams.state.instances.every(
        (instance) => instance.arrangement?.mapping === "rigid-panel",
      )).toBe(true);
      expect(measureIntrinsicDistortion(withSeams.state).maxRelativeDistortion).toBeLessThan(5e-5);

      for (const instance of withSeams.state.instances) {
        const baseline = instanceStructuralLengths(withoutSeams, instance.id);
        const sewn = instanceStructuralLengths(withSeams, instance.id);
        expect(sewn).toHaveLength(baseline.length);
        expect(Math.min(...sewn)).toBeGreaterThan(0.0001);
        sewn.forEach((length, index) => {
          expect(Math.abs(length - baseline[index])).toBeLessThan(1e-7);
        });
      }
    },
  );

  it.each([1, 2] as const)(
    "keeps a validated tube unchanged after attaching %i additional panel(s)",
    (attachmentCount) => {
      const tubeOnly = arrangedDraft(tubeWithAttachments(0));
      const extended = arrangedDraft(tubeWithAttachments(attachmentCount));
      const tubeIds = ["stable-tube-front:panel:1", "stable-tube-back:panel:1"];

      for (const id of tubeIds) {
        expect(instancePositions(extended, id)).toEqual(instancePositions(tubeOnly, id));
        expect(extended.state.instances.find((instance) => instance.id === id)?.arrangement?.mapping)
          .toBe("seam-derived-tube");
      }
      const additions = extended.state.instances.filter((instance) => instance.pieceId.startsWith("attachment-"));
      expect(additions).toHaveLength(attachmentCount);
      expect(additions.every((instance) => instance.arrangement?.mapping === "rigid-panel")).toBe(true);
      expect(extended.state.positions.every(Number.isFinite)).toBe(true);
      const distortion = measureIntrinsicDistortion(extended.state);
      expect(distortion.maxRelativeDistortion).toBeLessThan(5e-5);
      for (const addition of additions) {
        expect(distortion.byInstance[addition.id].maxRelativeDistortion).toBeLessThan(5e-5);
      }
      const attachmentStitches = extended.state.stitchConstraints.filter(
        (constraint) => constraint.seamGroupId.startsWith("attachment-seam-"),
      );
      const averageResidual = attachmentStitches.reduce((sum, constraint) => {
        const point = (reference: typeof constraint.a) => reference.particleIndices.reduce(
          (result, particleIndex, index) => {
            const offset = particleIndex * 3;
            const weight = reference.weights[index];
            result[0] += extended.state.positions[offset] * weight;
            result[1] += extended.state.positions[offset + 1] * weight;
            result[2] += extended.state.positions[offset + 2] * weight;
            return result;
          },
          [0, 0, 0],
        );
        const first = point(constraint.a);
        const second = point(constraint.b);
        return sum + Math.hypot(
          second[0] - first[0],
          second[1] - first[1],
          second[2] - first[2],
        );
      }, 0) / Math.max(1, attachmentStitches.length);
      expect(averageResidual).toBeLessThan(0.01);
    },
  );

  it("keeps the original tube intact when Provar infers four-panel placement", () => {
    const asDressingDraft = (attachmentCount: 0 | 2) => {
      const draft = tubeWithAttachments(attachmentCount);
      return {
        ...draft,
        dressing: { region: "upper" as const, frontReferencePieceId: "stable-tube-front" },
        pieces: draft.pieces.map((piece) => ({ ...piece, bodyPlacement: undefined })),
      };
    };
    const tubeOnly = arrangedDraft(asDressingDraft(0));
    const extended = arrangedDraft(asDressingDraft(2));
    const tubeIds = ["stable-tube-front:panel:1", "stable-tube-back:panel:1"];

    for (const id of tubeIds) {
      expect(instancePositions(extended, id)).toEqual(instancePositions(tubeOnly, id));
      expect(extended.state.instances.find((instance) => instance.id === id)?.arrangement?.mapping)
        .toBe("seam-derived-tube");
    }

    const isolatedMeshes = buildGarmentAssemblyMeshes(tubeOnly.state, tubeOnly.garment, {
      castShadow: false,
      receiveShadow: false,
      visibleInstanceIds: tubeOnly.visibleInstanceIds,
    });
    const extendedMeshes = buildGarmentAssemblyMeshes(extended.state, extended.garment, {
      castShadow: false,
      receiveShadow: false,
      visibleInstanceIds: extended.visibleInstanceIds,
    });
    expect(isolatedMeshes).toHaveLength(2);
    expect(extendedMeshes).toHaveLength(4);

    const isolatedDiagnostics = new Map(
      captureGarmentMeshDiagnostics(isolatedMeshes).map((item) => [item.id, item]),
    );
    const extendedDiagnostics = new Map(
      captureGarmentMeshDiagnostics(extendedMeshes).map((item) => [item.id, item]),
    );
    for (const id of tubeIds) {
      const isolated = isolatedDiagnostics.get(id)!;
      const attached = extendedDiagnostics.get(id)!;
      expect(attached).toMatchObject({
        id,
        vertexCount: isolated.vertexCount,
        triangleCount: isolated.triangleCount,
        boundingBox: isolated.boundingBox,
        centroid: isolated.centroid,
        transform: isolated.transform,
        geometrySignature: isolated.geometrySignature,
        meshCount: 1,
        meanNormal: isolated.meanNormal,
        meanTriangleNormal: isolated.meanTriangleNormal,
      });

      const previous = isolatedMeshes.find((item) => item.key === id)!;
      const next = extendedMeshes.find((item) => item.key === id)!;
      expect(canReuseGarmentAssemblyMesh(previous, next)).toBe(true);
      copyGarmentAssemblyGeometry(previous.mesh.geometry, next.mesh.geometry);
      expect(Array.from(previous.mesh.geometry.getAttribute("normal").array))
        .toEqual(Array.from(next.mesh.geometry.getAttribute("normal").array));
    }
  });

  it("restores the exact deterministic initial state after an added SeamGroup is removed and on replay", () => {
    const before = arrangedDraft(tubeWithAttachments(1, false));
    const withAddedSeam = arrangedDraft(tubeWithAttachments(1, true));
    const afterRemoval = arrangedDraft(tubeWithAttachments(1, false));
    const replay = arrangedDraft(tubeWithAttachments(1, true));

    expect(Array.from(afterRemoval.state.positions)).toEqual(Array.from(before.state.positions));
    expect(Array.from(replay.state.positions)).toEqual(Array.from(withAddedSeam.state.positions));
    expect(measureIntrinsicDistortion(withAddedSeam.state).byInstance["attachment-1:panel:1"].maxRelativeDistortion)
      .toBeLessThan(5e-5);
  });

  it("preserves two stable upper panels when their new SeamGroup closes an assembly cycle", () => {
    const before = arrangedDraft(tubeWithUpperCycle(false));
    const closed = arrangedDraft(tubeWithUpperCycle(true));
    const removed = arrangedDraft(tubeWithUpperCycle(false));
    const tubeIds = ["cycle-tube-front:panel:1", "cycle-tube-back:panel:1"];
    const upperIds = ["cycle-upper-a:panel:1", "cycle-upper-b:panel:1"];

    for (const id of [...tubeIds, ...upperIds]) {
      expect(instancePositions(closed, id)).toEqual(instancePositions(before, id));
      expect(instancePositions(removed, id)).toEqual(instancePositions(before, id));
    }
    for (const id of upperIds) {
      expect(closed.state.instances.find((instance) => instance.id === id)?.arrangement?.mapping)
        .toBe("rigid-panel");
      expect(measureIntrinsicDistortion(closed.state).byInstance[id].maxRelativeDistortion)
        .toBeLessThan(5e-5);
    }
    expect(closed.state.stitchConstraints.some(
      (constraint) => constraint.seamGroupId === "upper-cycle",
    )).toBe(true);
    expect(instancePositions(closed, upperIds[0])).not.toEqual(instancePositions(closed, upperIds[1]));
  });

  it("derives a regular horizontal tube from horizontal seam edges", () => {
    const rectangle = (id: string): PatternPiece => ({
      id,
      name: id,
      seamAllowanceMm: 0,
      cutQuantity: 1,
      points: [
        { id: `${id}:a`, xMm: 0, yMm: 0 },
        { id: `${id}:b`, xMm: 260, yMm: 0 },
        { id: `${id}:c`, xMm: 260, yMm: 100 },
        { id: `${id}:d`, xMm: 0, yMm: 100 },
      ],
    });
    const front = rectangle("tube-front");
    const back = rectangle("tube-back");
    const frontEdges = getPatternEdges(front);
    const backEdges = getPatternEdges(back);
    const garment: GarmentDraft = {
      ...createBlankGarment(),
      pieces: [front, back],
      dressing: { region: "upper", frontReferencePieceId: front.id },
      seams: [
        {
          id: "tube-top",
          first: { pieceId: front.id, edgeId: frontEdges[0].id, startT: 0, endT: 1 },
          second: { pieceId: back.id, edgeId: backEdges[0].id, startT: 0, endT: 1 },
          direction: "opposite",
          easeRatio: 0,
          type: "standard",
          active: true,
        },
        {
          id: "tube-bottom",
          first: { pieceId: front.id, edgeId: frontEdges[2].id, startT: 0, endT: 1 },
          second: { pieceId: back.id, edgeId: backEdges[2].id, startT: 0, endT: 1 },
          direction: "opposite",
          easeRatio: 0,
          type: "standard",
          active: true,
        },
      ],
    };
    const result = buildSemanticAvatarArrangement(
      buildResolvedAssemblyInput(garment),
      buildAvatarParametricModel(garment.measurements, garment.bodyType),
    );
    const visible = result.state.instances.filter((instance) => result.visibleInstanceIds.has(instance.id));
    const positions = visible.flatMap((instance) => Array.from(
      { length: instance.vertexCount },
      (_, local) => {
        const offset = (instance.particleStart + local) * 3;
        return [
          result.state.positions[offset],
          result.state.positions[offset + 1],
          result.state.positions[offset + 2],
        ] as const;
      },
    ));
    const span = (axis: 0 | 1 | 2) => {
      const values = positions.map((position) => position[axis]);
      return Math.max(...values) - Math.min(...values);
    };
    const expectedDiameterM = 200 / Math.PI * 0.001;

    expect(visible).toHaveLength(2);
    expect(visible.every((instance) => instance.arrangement?.mapping === "seam-derived-tube")).toBe(true);
    expect(span(0)).toBeCloseTo(0.26, 3);
    expect(span(1)).toBeCloseTo(expectedDiameterM, 2);
    expect(span(2)).toBeCloseTo(expectedDiameterM, 2);
    expect(span(0) / Math.max(span(1), span(2))).toBeCloseTo(0.26 / expectedDiameterM, 1);
    expect(measureIntrinsicDistortion(result.state).maxRelativeDistortion).toBeLessThan(5e-5);

    const meshes = buildGarmentAssemblyMeshes(result.state, result.garment, {
      castShadow: false,
      receiveShadow: false,
      visibleInstanceIds: result.visibleInstanceIds,
    });
    for (const meshData of meshes) {
      const instance = visible.find((candidate) => candidate.id === meshData.key)!;
      const arrangement = instance.arrangement!;
      const center = arrangement.tubeCenter!;
      const axisLength = Math.hypot(...arrangement.axis);
      const axis = arrangement.axis.map((value) => value / axisLength);
      const normals = meshData.mesh.geometry.getAttribute("normal");

      for (let local = 0; local < instance.vertexCount; local += 1) {
        const offset = (instance.particleStart + local) * 3;
        const fromCenter = [
          result.state.positions[offset] - center[0],
          result.state.positions[offset + 1] - center[1],
          result.state.positions[offset + 2] - center[2],
        ];
        const alongAxis = fromCenter.reduce(
          (sum, value, index) => sum + value * axis[index],
          0,
        );
        const radial = fromCenter.map(
          (value, index) => value - axis[index] * alongAxis,
        );
        const radialLength = Math.hypot(...radial);
        const normal = [normals.getX(local), normals.getY(local), normals.getZ(local)];
        const alignment = normal.reduce(
          (sum, value, index) => sum + value * radial[index] / radialLength,
          0,
        );
        expect(alignment).toBeGreaterThan(0.9999);
      }
    }

    const largerAvatarResult = buildSemanticAvatarArrangement(
      buildResolvedAssemblyInput(garment),
      buildAvatarParametricModel({
        ...garment.measurements,
        bustMm: 1_600,
        waistMm: 1_400,
        hipMm: 1_700,
      }, garment.bodyType),
    );
    const largerPositions = largerAvatarResult.state.instances.flatMap((instance) => Array.from(
      { length: instance.vertexCount },
      (_, local) => {
        const offset = (instance.particleStart + local) * 3;
        return [
          largerAvatarResult.state.positions[offset],
          largerAvatarResult.state.positions[offset + 1],
          largerAvatarResult.state.positions[offset + 2],
        ] as const;
      },
    ));
    const largerSpan = (axis: 0 | 1 | 2) => {
      const values = largerPositions.map((position) => position[axis]);
      return Math.max(...values) - Math.min(...values);
    };
    expect(largerSpan(0)).toBeCloseTo(span(0), 5);
    expect(largerSpan(1)).toBeCloseTo(span(1), 5);
    expect(largerSpan(2)).toBeCloseTo(span(2), 5);
  });

  it("keeps the tube vertical when the sewn edges define a vertical axis", () => {
    const rectangle = (id: string): PatternPiece => ({
      id,
      name: id,
      seamAllowanceMm: 0,
      cutQuantity: 1,
      points: [
        { id: `${id}:a`, xMm: 0, yMm: 0 },
        { id: `${id}:b`, xMm: 100, yMm: 0 },
        { id: `${id}:c`, xMm: 100, yMm: 260 },
        { id: `${id}:d`, xMm: 0, yMm: 260 },
      ],
    });
    const front = rectangle("vertical-front");
    const back = rectangle("vertical-back");
    const frontEdges = getPatternEdges(front);
    const backEdges = getPatternEdges(back);
    const garment: GarmentDraft = {
      ...createBlankGarment(),
      pieces: [front, back],
      dressing: { region: "upper", frontReferencePieceId: front.id },
      seams: [
        {
          id: "tube-right",
          first: { pieceId: front.id, edgeId: frontEdges[1].id, startT: 0, endT: 1 },
          second: { pieceId: back.id, edgeId: backEdges[1].id, startT: 0, endT: 1 },
          direction: "opposite",
          easeRatio: 0,
          type: "standard",
          active: true,
        },
        {
          id: "tube-left",
          first: { pieceId: front.id, edgeId: frontEdges[3].id, startT: 0, endT: 1 },
          second: { pieceId: back.id, edgeId: backEdges[3].id, startT: 0, endT: 1 },
          direction: "opposite",
          easeRatio: 0,
          type: "standard",
          active: true,
        },
      ],
    };
    const result = buildSemanticAvatarArrangement(
      buildResolvedAssemblyInput(garment),
      buildAvatarParametricModel(garment.measurements, garment.bodyType),
    );
    const visible = result.state.instances.filter((instance) => result.visibleInstanceIds.has(instance.id));
    const positions = visible.flatMap((instance) => Array.from(
      { length: instance.vertexCount },
      (_, local) => {
        const offset = (instance.particleStart + local) * 3;
        return [result.state.positions[offset], result.state.positions[offset + 1], result.state.positions[offset + 2]] as const;
      },
    ));
    const span = (axis: 0 | 1 | 2) => {
      const values = positions.map((position) => position[axis]);
      return Math.max(...values) - Math.min(...values);
    };
    const expectedDiameterM = 200 / Math.PI * 0.001;

    expect(visible.every((instance) => instance.arrangement?.mapping === "seam-derived-tube")).toBe(true);
    expect(span(1)).toBeCloseTo(0.26, 3);
    expect(span(0)).toBeCloseTo(expectedDiameterM, 2);
    expect(span(2)).toBeCloseTo(expectedDiameterM, 2);
    expect(span(1) / Math.max(span(0), span(2))).toBeCloseTo(0.26 / expectedDiameterM, 1);
  });

  it("develops a shorter partial-range flap rigidly outside a seam-derived tube", () => {
    const rectangle = (id: string, width: number, height: number): PatternPiece => ({
      id,
      name: id,
      seamAllowanceMm: 0,
      cutQuantity: 1,
      points: [
        { id: `${id}:a`, xMm: 0, yMm: 0 },
        { id: `${id}:b`, xMm: width, yMm: 0 },
        { id: `${id}:c`, xMm: width, yMm: height },
        { id: `${id}:d`, xMm: 0, yMm: height },
      ],
    });
    const front = rectangle("range-tube-front", 100, 260);
    const back = rectangle("range-tube-back", 100, 260);
    const flap = rectangle("short-flap", 80, 60);
    const frontEdges = getPatternEdges(front);
    const backEdges = getPatternEdges(back);
    const flapEdges = getPatternEdges(flap);
    const garment: GarmentDraft = {
      ...createBlankGarment(),
      pieces: [front, back, flap],
      dressing: { region: "upper", frontReferencePieceId: front.id },
      seams: [
        {
          id: "range-tube-right",
          first: { pieceId: front.id, edgeId: frontEdges[1].id, startT: 0, endT: 1 },
          second: { pieceId: back.id, edgeId: backEdges[1].id, startT: 0, endT: 1 },
          direction: "opposite",
          easeRatio: 0,
          type: "standard",
          active: true,
        },
        {
          id: "range-tube-left",
          first: { pieceId: front.id, edgeId: frontEdges[3].id, startT: 0, endT: 1 },
          second: { pieceId: back.id, edgeId: backEdges[3].id, startT: 0, endT: 1 },
          direction: "opposite",
          easeRatio: 0,
          type: "standard",
          active: true,
        },
        {
          id: "partial-flap",
          groupId: "partial-flap-group",
          first: { pieceId: front.id, edgeId: frontEdges[3].id, startT: 0.2, endT: 0.8 },
          second: { pieceId: flap.id, edgeId: flapEdges[1].id, startT: 0, endT: 1 },
          direction: "same",
          easeRatio: 0,
          type: "intentional-mismatch",
          treatment: "intentional-mismatch",
          active: true,
        },
      ],
    };
    const result = arrangedDraft(garment);
    const diagnostic = result.seamPlacementDiagnostics.find(
      (item) => item.seamGroupId === "partial-flap-group",
    )!;
    const tube = result.state.instances.find((instance) => instance.id === "range-tube-front:panel:1")!;
    const child = result.state.instances.find((instance) => instance.id === "short-flap:panel:1")!;
    const center = tube.arrangement!.tubeCenter!;
    const axis = tube.arrangement!.axis;
    const axisLength = Math.hypot(...axis);
    const unitAxis = axis.map((value) => value / axisLength);
    const radialDistance = (point: readonly number[]) => {
      const relative = point.map((value, index) => value - center[index]);
      const along = relative.reduce((sum, value, index) => sum + value * unitAxis[index], 0);
      return Math.hypot(...relative.map((value, index) => value - unitAxis[index] * along));
    };
    const childRadialDistances = Array.from({ length: child.vertexCount }, (_, local) => {
      const offset = (child.particleStart + local) * 3;
      return radialDistance([
        result.state.positions[offset],
        result.state.positions[offset + 1],
        result.state.positions[offset + 2],
      ]);
    });

    expect(diagnostic).toMatchObject({
      parentRange: { startT: 0.2, endT: 0.8 },
      childRange: { startT: 0, endT: 1 },
    });
    expect(diagnostic.parentRangeLengthMm).toBeCloseTo(156, 8);
    expect(diagnostic.childRangeLengthMm).toBeCloseTo(60, 8);
    expect(Math.hypot(
      diagnostic.parentMidpoint[0] - diagnostic.childMidpoint[0],
      diagnostic.parentMidpoint[1] - diagnostic.childMidpoint[1],
      diagnostic.parentMidpoint[2] - diagnostic.childMidpoint[2],
    )).toBeLessThan(1e-6);
    expect(Math.min(...childRadialDistances)).toBeGreaterThanOrEqual(tube.arrangement!.tubeRadiusM! - 1e-6);
    expect(Math.max(...childRadialDistances)).toBeGreaterThan(tube.arrangement!.tubeRadiusM! + 0.07);
    expect(measureIntrinsicDistortion(result.state).byInstance[child.id].maxRelativeDistortion)
      .toBeLessThan(5e-5);
  });

  it("places a t-shirt and its sleeves on torso and correct arms", () => {
    const result = arrange("tshirt");
    const visible = result.state.instances.filter((instance) => result.visibleInstanceIds.has(instance.id));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(visible).toHaveLength(6);
    const arms = visible.filter((instance) => instance.placement.region === "arm");
    expect(arms.map((instance) => instance.placement.bodySide).sort()).toEqual(["left", "right"]);
    const left = arms.find((instance) => instance.placement.bodySide === "left")!;
    const right = arms.find((instance) => instance.placement.bodySide === "right")!;
    expect(instanceCenterX(result, left.id)).toBeLessThan(0);
    expect(instanceCenterX(result, right.id)).toBeGreaterThan(0);
    expect(visible.every((instance) => instance.arrangement?.anchorId)).toBe(true);
    const torso = visible.filter((instance) => instance.placement.region === "torso");
    const shoulderDepths: number[] = [];
    for (const instance of torso) {
      for (let local = 0; local < instance.vertexCount; local += 1) {
        const y = result.state.positions[(instance.particleStart + local) * 3 + 1];
        if (y < result.avatar.landmarks.bustY) continue;
        shoulderDepths.push(Math.abs(result.state.positions[(instance.particleStart + local) * 3 + 2]));
      }
    }
    expect(shoulderDepths.length).toBeGreaterThan(0);
    const averageShoulderDepth = shoulderDepths.reduce((sum, value) => sum + value, 0) / shoulderDepths.length;
    expect(averageShoulderDepth).toBeGreaterThan(0.04);
    expect(Math.max(...shoulderDepths)).toBeGreaterThan(0.08);
    expect(result.state.positions.every(Number.isFinite)).toBe(true);
  });

  it("wraps skirt front and back around waist and hip instead of floating", () => {
    const result = arrange("straight-skirt");
    const visible = result.state.instances.filter((instance) => result.visibleInstanceIds.has(instance.id));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(visible).toHaveLength(4);
    expect(visible.every((instance) => instance.arrangement?.mapping === "rigid-panel")).toBe(true);
    const yValues = visible.flatMap((instance) => Array.from({ length: instance.vertexCount }, (_, local) => result.state.positions[(instance.particleStart + local) * 3 + 1]));
    expect(Math.max(...yValues)).toBeLessThanOrEqual(result.avatar.landmarks.waistY + 0.04);
    expect(Math.min(...yValues)).toBeLessThan(result.avatar.landmarks.hipY);
  });

  it("places four trouser panels on the declared left and right legs", () => {
    const result = arrange("straight-pants");
    const visible = result.state.instances.filter((instance) => result.visibleInstanceIds.has(instance.id));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(visible).toHaveLength(4);
    const left = visible.filter((instance) => instance.placement.bodySide === "left");
    const right = visible.filter((instance) => instance.placement.bodySide === "right");
    expect(left).toHaveLength(2);
    expect(right).toHaveLength(2);
    expect(left.every((instance) => instanceCenterX(result, instance.id) < 0)).toBe(true);
    expect(right.every((instance) => instanceCenterX(result, instance.id) > 0)).toBe(true);
    expect(visible.every((instance) => instance.arrangement?.mapping === "rigid-panel")).toBe(true);
  });

  it("omits an unanchored panel and emits a named diagnostic", () => {
    const garment = createGarmentFromTemplate("straight-skirt", DEFAULT_BODY_MEASUREMENTS, "feminine");
    const invalidPieceId = garment.pieces[0].id;
    const invalid: GarmentDraft = {
      ...garment,
      pieces: garment.pieces.map((piece) => piece.id === invalidPieceId ? { ...piece, previewPlacements: undefined, bodyPlacement: undefined } : piece),
      assemblyPlacements: garment.assemblyPlacements?.filter((placement) => placement.pieceId !== invalidPieceId),
    };
    const result = buildSemanticAvatarArrangement(
      buildResolvedAssemblyInput(invalid),
      buildAvatarParametricModel(invalid.measurements, invalid.bodyType),
    );
    expect(result.state.instances.some((instance) => instance.pieceId === invalidPieceId)).toBe(false);
    expect(result.state.instances.filter((instance) => instance.pieceId === invalidPieceId && result.visibleInstanceIds.has(instance.id))).toHaveLength(0);
  });

  it("reports a disconnected but anchored component", () => {
    const garment = createGarmentFromTemplate("tshirt", DEFAULT_BODY_MEASUREMENTS, "feminine");
    const front = garment.pieces.find((piece) => piece.previewPlacements?.some((placement) => placement.region === "torso" && placement.surface === "front"))!;
    const frontClassification = buildResolvedAssemblyInput(garment).document.patternDefinitions.find((definition) => definition.id === front.id)!.bodyPlacement;
    const extra = duplicatePatternPiece(front, { newId: "detached-front", name: "Painel adicional" });
    extra.previewPlacements = [{
      ...front.previewPlacements![0],
      id: "detached-front-anchor",
      pieceId: extra.id,
      offsetZMm: 18,
    }];
    extra.bodyPlacement = {
      ...frontClassification,
      status: "confirmed",
      source: "manual",
    };
    const extended: GarmentDraft = { ...garment, pieces: [...garment.pieces, extra] };
    const result = buildSemanticAvatarArrangement(
      buildResolvedAssemblyInput(extended),
      buildAvatarParametricModel(extended.measurements, extended.bodyType),
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "disconnected-component" && diagnostic.pieceId === extra.id)).toBe(true);
  });


  it("masks only mannequin shells covered by each semantic garment", () => {
    const shirt = arrange("tshirt");
    expect([...shirt.coveredAvatarPartNames]).toEqual(expect.arrayContaining([
      "avatar:chest",
      "avatar:abdomen",
      "avatar:upper-arm-left",
      "avatar:upper-arm-right",
    ]));
    expect(shirt.coveredAvatarPartNames.has("avatar:head")).toBe(false);
    expect(shirt.coveredAvatarPartNames.has("avatar:hand-left")).toBe(false);

    const skirt = arrange("straight-skirt");
    expect([...skirt.coveredAvatarPartNames]).toEqual(expect.arrayContaining([
      "avatar:pelvis",
      "avatar:thigh-left",
      "avatar:thigh-right",
    ]));
    expect(skirt.coveredAvatarPartNames.has("avatar:foot-left")).toBe(false);

    const trousers = arrange("straight-pants");
    expect([...trousers.coveredAvatarPartNames]).toEqual(expect.arrayContaining([
      "avatar:pelvis",
      "avatar:thigh-left",
      "avatar:thigh-right",
      "avatar:calf-left",
      "avatar:calf-right",
    ]));
    expect(trousers.coveredAvatarPartNames.has("avatar:foot-left")).toBe(false);
  });

});
