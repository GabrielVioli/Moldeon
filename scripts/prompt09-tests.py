from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.strip() + "\n", encoding="utf-8")


# Fix precedence in the implementation script output before typecheck.
implementation = ROOT / "apps/web/src/garment3d/SemanticAvatarArrangement.ts"
source = implementation.read_text(encoding="utf-8")
source = source.replace(
    "Math.max(1, piece.cutQuantity ?? placements.length || 1)",
    "Math.max(1, piece.cutQuantity ?? (placements.length || 1))",
)
implementation.write_text(source, encoding="utf-8")

write(
    "apps/web/src/avatar/AvatarParametricModel.test.ts",
    r'''
import { describe, expect, it } from "vitest";
import { DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { buildAvatarCollisionModel } from "./AvatarCollisionModel";
import { buildAvatarParametricModel, sampleTorsoAxes } from "./AvatarParametricModel";

describe("AvatarParametricModel", () => {
  it("resolves independent regional measurements, neutral pose, anchors and collision proxies", () => {
    const model = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const collision = buildAvatarCollisionModel(model);

    expect(model.version).toBe("avatar-parametric@1");
    expect(model.anchors.map((anchor) => anchor.id)).toEqual(expect.arrayContaining([
      "torso-front",
      "torso-back",
      "arm-left",
      "arm-right",
      "waist-front",
      "hip-back",
      "leg-left",
      "leg-right",
      "neck",
      "head",
    ]));
    expect(model.joints.shoulderLeft[0]).toBeLessThan(0);
    expect(model.joints.shoulderRight[0]).toBeGreaterThan(0);
    expect(model.joints.wristLeft[0]).toBeLessThan(model.joints.shoulderLeft[0]);
    expect(model.joints.wristRight[0]).toBeGreaterThan(model.joints.shoulderRight[0]);
    expect(model.joints.ankleLeft[0]).toBeLessThan(0);
    expect(model.joints.ankleRight[0]).toBeGreaterThan(0);
    expect(model.armPoseAngleDeg).toBeGreaterThan(0);
    expect(model.legPoseAngleDeg).toBeGreaterThan(0);
    expect(collision.proxies.length).toBeGreaterThanOrEqual(12);
    expect(collision.proxies.every((proxy) => JSON.stringify(proxy).includes("NaN") === false)).toBe(true);
  });

  it("changes bust region without uniformly scaling stature or legs", () => {
    const baseline = buildAvatarParametricModel(DEFAULT_BODY_MEASUREMENTS, "feminine");
    const largerBust = buildAvatarParametricModel({
      ...DEFAULT_BODY_MEASUREMENTS,
      bustMm: DEFAULT_BODY_MEASUREMENTS.bustMm + 180,
    }, "feminine");

    const baselineBust = sampleTorsoAxes(baseline, baseline.landmarks.bustY);
    const largerBustAxes = sampleTorsoAxes(largerBust, largerBust.landmarks.bustY);
    expect(largerBustAxes.halfWidth).toBeGreaterThan(baselineBust.halfWidth);
    expect(largerBust.landmarks.headTopY).toBeCloseTo(baseline.landmarks.headTopY, 6);
    expect(largerBust.joints.ankleLeft[1]).toBeCloseTo(baseline.joints.ankleLeft[1], 6);
    expect(largerBust.measurements.inseamMm).toBe(baseline.measurements.inseamMm);
  });
});
''',
)

write(
    "apps/web/src/garment3d/SemanticAvatarArrangement.test.ts",
    r'''
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPatternSnapshot } from "../core/fallbackPatternEngine";
import { duplicatePatternPiece, type GarmentDraft } from "../domain/pattern";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import {
  createGarmentFromTemplate,
  DEFAULT_BODY_MEASUREMENTS,
  type PatternTemplateId,
} from "../patterns/templateCatalog";
import { buildSemanticAvatarArrangement } from "./SemanticAvatarArrangement";

function arrange(templateId: PatternTemplateId) {
  const garment = createGarmentFromTemplate(templateId, DEFAULT_BODY_MEASUREMENTS, "feminine");
  const avatar = buildAvatarParametricModel(garment.measurements, garment.bodyType);
  return buildSemanticAvatarArrangement(
    garment.pieces.map(createPatternSnapshot),
    garment,
    avatar,
  );
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

describe("SemanticAvatarArrangement", () => {
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
      pieces: garment.pieces.map((piece) => piece.id === invalidPieceId ? { ...piece, previewPlacements: [] } : piece),
      assemblyPlacements: garment.assemblyPlacements?.filter((placement) => placement.pieceId !== invalidPieceId),
    };
    const result = buildSemanticAvatarArrangement(
      invalid.pieces.map(createPatternSnapshot),
      invalid,
      buildAvatarParametricModel(invalid.measurements, invalid.bodyType),
    );
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-anchor", pieceId: invalidPieceId, severity: "error" }),
    ]));
    expect(result.state.instances.filter((instance) => instance.pieceId === invalidPieceId && result.visibleInstanceIds.has(instance.id))).toHaveLength(0);
  });

  it("reports a disconnected but anchored component", () => {
    const garment = createGarmentFromTemplate("tshirt", DEFAULT_BODY_MEASUREMENTS, "feminine");
    const front = garment.pieces.find((piece) => piece.previewPlacements?.some((placement) => placement.region === "torso" && placement.surface === "front"))!;
    const extra = duplicatePatternPiece(front, { newId: "detached-front", name: "Painel adicional" });
    extra.previewPlacements = [{
      ...front.previewPlacements![0],
      id: "detached-front-anchor",
      pieceId: extra.id,
      offsetZMm: 18,
    }];
    const extended: GarmentDraft = { ...garment, pieces: [...garment.pieces, extra] };
    const result = buildSemanticAvatarArrangement(
      extended.pieces.map(createPatternSnapshot),
      extended,
      buildAvatarParametricModel(extended.measurements, extended.bodyType),
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "disconnected-component" && diagnostic.pieceId === extra.id)).toBe(true);
  });

  it("keeps removed public and cylindrical paths out of the active pipeline", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const viewport = readFileSync(new URL("../viewport/GarmentViewport.tsx", import.meta.url), "utf8");
    const globalViewport = readFileSync(new URL("../viewport/GlobalThreeViewport.ts", import.meta.url), "utf8");
    const assembly = readFileSync(new URL("./GarmentAssembly.ts", import.meta.url), "utf8");
    const combined = [app, viewport, globalViewport].join("\n");
    expect(combined).not.toContain("showBody");
    expect(combined).not.toContain("setBodyVisible");
    expect(combined).not.toContain("setExploded");
    expect(combined).not.toContain("Explodida");
    expect(assembly).not.toContain("wrapAsTube");
    expect(assembly).not.toContain("placementBasePosition");
    expect(assembly).not.toContain("toLocaleLowerCase");
  });
});
''',
)

print("Prompt 9 tests written")
