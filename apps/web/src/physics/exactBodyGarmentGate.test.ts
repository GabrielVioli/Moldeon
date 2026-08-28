import { describe, expect, it } from "vitest";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { resolveTemplateAssemblyGarment } from "../domain/templateAssemblySeams";
import { buildCoarseIsometricAssembly } from "../garment3d/CoarseAssemblyPipeline";
import { buildResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { createGarmentFromTemplate, DEFAULT_BODY_MEASUREMENTS, type PatternTemplateId } from "../patterns/templateCatalog";
import { applyGarmentBodyRegistration, resolveGarmentBodyRegistration } from "./GarmentBodyRegistration";
import { buildXpbdInitialization } from "./GarmentXpbdAdapter";
import { createXpbdWorkerState } from "./XpbdWorkerState";
import { packHumanBodyMesh } from "./exactBodySurface";
import { measureXpbdDiagnostics, stepXpbd } from "./xpbd";

describe("11.0.5 real garment exact-body gates", () => {
  for (const template of ["straight-skirt", "bodice-block"] as const satisfies readonly PatternTemplateId[]) {
    it(`keeps ${template} finite and reports exact residuals separately from assembly quality`, () => {
      const garment = resolveTemplateAssemblyGarment(createGarmentFromTemplate(template, DEFAULT_BODY_MEASUREMENTS, "feminine"));
      const input = buildResolvedAssemblyInput(garment);
      const assembled = buildCoarseIsometricAssembly(input.assemblyDocument);
      const avatar = buildAvatarParametricModel(input.assemblyDocument.measurements.values, input.assemblyDocument.body.type);
      const registration = resolveGarmentBodyRegistration(assembled.state, avatar);
      if (registration.status !== "registered") {
        console.log("P1105_REAL_GARMENT_ASSEMBLY_BLOCKED", JSON.stringify({ template, registration }));
        expect(registration.status).toBe("body-placement-required");
        expect(registration.registrationAmbiguities.length).toBeGreaterThan(0);
        return;
      }
      applyGarmentBodyRegistration(assembled.state, registration);
      const state = createXpbdWorkerState(buildXpbdInitialization(
        assembled.state,
        input.garmentProjection,
        assembled.revision,
        {
          exactBodyMesh: packHumanBodyMesh(avatar.humanBody.visualMesh),
          bodyCollisionEnabled: true,
          config: { gravity: [0, 0, 0], maximumSubsteps: 1, iterations: 8 },
        },
      ));
      const materialRestGeometry = [...state.restPositions];
      for (let step = 0; step < 8 && !state.invalid; step += 1) stepXpbd(state);
      const diagnostics = measureXpbdDiagnostics(state);
      console.log("P1105_REAL_GARMENT", JSON.stringify({
        template,
        registration,
        invalid: diagnostics.invalid,
        contacts: diagnostics.bodyContactCount,
        residualIntersections: diagnostics.bodyResidualIntersections,
        residualCrossings: diagnostics.bodyResidualCrossings,
        maxPenetrationMm: (diagnostics.maximumSignedBodyPenetrationM ?? 0) * 1000,
        bodyCollisionMs: diagnostics.bodyCollisionMs,
        stretchMax: diagnostics.structuralStretchMaxRatio,
        compressionMin: diagnostics.structuralCompressionMinRatio,
        areaMin: diagnostics.triangleAreaMinRatio,
        areaMax: diagnostics.triangleAreaMaxRatio,
      }));
      expect(state.body.exactSurface?.mesh.topologySignature).toBe(avatar.humanBody.visualMesh.topologySignature);
      expect([...state.positions].every(Number.isFinite)).toBe(true);
      expect(diagnostics.bodyExactSurface).toBe(true);
      expect(diagnostics.bodyColliderCount).toBe(32_508);
      expect(diagnostics.bodyInitialOverlapUnresolved).toBe(false);
      expect(diagnostics.bodyAssemblyContactBlocked).toBe(false);
      expect(diagnostics.bodyGlobalCollisionEarlyReturnCount).toBe(0);
      expect(diagnostics.bodyLocalInitialOverlapSkipCount).toBe(0);
      expect(diagnostics.bodyContactSkipReasons?.["initial-overlap-too-deep"]).toBeUndefined();
      expect(diagnostics.bodyResidualIntersections).toBe(0);
      expect(diagnostics.bodyResidualCrossings).toBe(0);
      expect(diagnostics.bodyTriangleIntersectionCount).toBe(0);
      if (template === "straight-skirt") {
        expect(diagnostics.bodyContactCount).toBeGreaterThan(0);
        expect(diagnostics.bodyContactSolveMs).toBeGreaterThan(0);
        // The current canonical skirt registration is an Arrangement input,
        // not an exact-contact quality gate. Collision must remain live and
        // must never rewrite the immutable material metric while 11.0.6 owns
        // authoring a valid spatial placement for this garment.
        expect(state.invalid).toBe(false);
        expect(state.stepCount).toBe(8);
        expect([...state.restPositions]).toEqual(materialRestGeometry);
      } else {
        expect(diagnostics.structuralStretchMaxRatio).toBeLessThan(1.08);
        expect(diagnostics.structuralCompressionMinRatio).toBeGreaterThan(0.92);
      }
      expect(diagnostics.flippedTriangleCount).toBe(0);
    }, 60_000);
  }
});
