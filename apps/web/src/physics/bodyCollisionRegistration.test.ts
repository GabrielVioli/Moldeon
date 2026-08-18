import { describe, expect, it } from "vitest";
import pantsRaw from "../testFixtures/realDocuments/real-pants.v3.json";
import { parsePatternDocumentV3 } from "../domain/patternDocumentV3";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
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
