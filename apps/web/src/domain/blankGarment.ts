import { createDefaultFabricSource } from "./fabric";
import type { BodyType, GarmentDraft } from "./pattern";
import {
  createDefaultMeasurementProfile,
  measurementProfileToBodyMeasurements,
  type MeasurementProfile,
} from "./parametricMeasurements";

export function createBlankGarment(
  profile: MeasurementProfile = createDefaultMeasurementProfile("feminine"),
): GarmentDraft {
  const fabric = createDefaultFabricSource();
  return {
    id: `garment-empty-${Date.now().toString(36)}`,
    templateId: "blank",
    name: "Projeto vazio",
    description: "Bancada vazia pronta para desenhar.",
    bodyType: profile.bodyType as BodyType,
    measurements: measurementProfileToBodyMeasurements(profile),
    measurementProfile: structuredClone(profile),
    fabrics: [fabric],
    pieces: [],
    seams: [],
    workspaceTransforms: [],
    workspaceStates: [],
    assemblyPlacements: [],
  };
}
