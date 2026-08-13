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
import { buildGarmentAssemblyMeshes } from "./GarmentThreeBridge";

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
        (instance) => instance.arrangement?.mapping === "body-surface",
      )).toBe(true);

      for (const instance of withSeams.state.instances) {
        const baseline = instanceStructuralLengths(withoutSeams, instance.id);
        const sewn = instanceStructuralLengths(withSeams, instance.id);
        expect(sewn).toHaveLength(baseline.length);
        expect(Math.min(...sewn)).toBeGreaterThan(0.0001);
        sewn.forEach((length, index) => {
          expect(Math.abs(length - baseline[index])).toBeLessThan(0.006);
        });
      }
    },
  );

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
    expect(visible.every((instance) => instance.arrangement?.mapping === "body-surface")).toBe(true);
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
    expect(visible.every((instance) => instance.arrangement?.mapping === "anatomical-half-tube")).toBe(true);
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
