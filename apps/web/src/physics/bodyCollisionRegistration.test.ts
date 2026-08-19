import { describe, expect, it } from "vitest";
import pantsRaw from "../testFixtures/realDocuments/real-pants.v3.json";
import { parsePatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { buildAvatarCollisionModel } from "../avatar/AvatarCollisionModel";
import { createGarmentFromTemplate, DEFAULT_BODY_MEASUREMENTS } from "../patterns/templateCatalog";
import { resolveTemplateAssemblyGarment } from "../domain/templateAssemblySeams";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { packAvatarCollisionModel } from "./bodyCollision";
import { buildXpbdInitialization } from "./GarmentXpbdAdapter";
import { createXpbdWorkerState } from "./XpbdWorkerState";
import { advanceXpbd } from "./xpbd";
import { resolveSimulationBodyRegistration } from "./BodyCollisionRegistration";

describe("Prompt 11 body registration", () => {
  it("reports body-placement-required for the unclassified real pants instead of guessing", () => {
    const document = parsePatternDocumentV3(pantsRaw);
    const result = buildCoarseIsometricAssembly(document);
    const avatar = buildAvatarParametricModel(document.measurements.values, document.body.type);
    const registration = resolveSimulationBodyRegistration(result.state, avatar);
    expect(registration.status).toBe("body-placement-required");
    expect(registration.registeredInstanceIds).toHaveLength(0);
    expect(registration.transform.translation).toEqual([0, 0, 0]);
  }, 60_000);

  it("keeps a lower garment near the hip under gravity with body collision", () => {
    const garment = {
      ...resolveTemplateAssemblyGarment(createGarmentFromTemplate("straight-skirt", DEFAULT_BODY_MEASUREMENTS, "feminine")),
      dressing: { region: "lower" as const },
    };
    const input = buildResolvedAssemblyInput(garment);
    const result = buildCoarseIsometricAssembly(input.assemblyDocument);
    const avatar = buildAvatarParametricModel(input.assemblyDocument.measurements.values, input.assemblyDocument.body.type);
    const registration = resolveSimulationBodyRegistration(result.state, avatar);

    expect(input.assemblyDocument.panelInstances.every((instance) => instance.placementStatus === "confirmed")).toBe(true);
    expect(registration.status).toBe("registered");
    expect(registration.registeredInstanceIds.length).toBeGreaterThan(0);

    const bodyColliders = packAvatarCollisionModel(buildAvatarCollisionModel(avatar), registration.transform);
    expect(bodyColliders.kinds.length).toBeGreaterThan(0);

    const initialBounds = yBounds(result.state.positions);
    const xpbd = createXpbdWorkerState(buildXpbdInitialization(result.state, input.garmentProjection, result.revision, {
      bodyColliders,
      bodyCollisionEnabled: true,
      pinAssemblyAnchors: true,
      config: { gravity: [0, -9.81, 0], iterations: 24, maximumSubsteps: 6, maximumVelocity: 1 },
    }));

    let contactCount = 0;
    let colliderCount = 0;
    for (let step = 0; step < 120; step += 1) {
      const diagnostics = advanceXpbd(xpbd, 1 / 60);
      contactCount = Math.max(contactCount, diagnostics.bodyContactCount ?? 0);
      colliderCount = diagnostics.bodyColliderCount ?? 0;
    }

    const finalBounds = yBounds(xpbd.positions);
    expect(allFinite(xpbd.positions)).toBe(true);
    expect(colliderCount).toBe(bodyColliders.kinds.length);
    expect(contactCount).toBeGreaterThan(0);
    const registeredKneeY = avatar.landmarks.kneeY + registration.transform.translation[1];
    const registeredAnkleY = avatar.landmarks.ankleY + registration.transform.translation[1];
    const registeredHipY = avatar.landmarks.hipY + registration.transform.translation[1];
    expect(finalBounds.center).toBeGreaterThan(registeredKneeY);
    expect(finalBounds.min).toBeGreaterThan(registeredAnkleY + 0.12);
    expect(finalBounds.max).toBeGreaterThan(registeredHipY - 0.08);
    expect(finalBounds.center).toBeGreaterThan(initialBounds.center - 0.25);
  }, 120_000);

  it("uses existing placement metadata without garment-name logic", () => {
    const document = parsePatternDocumentV3(pantsRaw);
    const result = buildCoarseIsometricAssembly(document);
    const avatar = buildAvatarParametricModel(document.measurements.values, document.body.type);
    const first = result.state.instances[0];
    first.placement.region = "hip";
    first.placement.surface = "front";
    first.placement.bodySide = "center";
    const registration = resolveSimulationBodyRegistration(result.state, avatar);
    expect(registration.status).toBe("registered");
    expect(registration.source).toBe("placement-anchors");
    expect(registration.registeredInstanceIds).toContain(first.id);
    expect(registration.transform.translation.every(Number.isFinite)).toBe(true);
  }, 60_000);
});

function yBounds(positions: Float32Array): { min: number; max: number; center: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let offset = 1; offset < positions.length; offset += 3) {
    min = Math.min(min, positions[offset]);
    max = Math.max(max, positions[offset]);
  }
  return { min, max, center: (min + max) * 0.5 };
}

function allFinite(values: Float32Array): boolean {
  for (const value of values) if (!Number.isFinite(value)) return false;
  return true;
}