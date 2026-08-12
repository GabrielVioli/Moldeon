import { createPatternSnapshot } from "../core/fallbackPatternEngine";
import type { GarmentDraft } from "../domain/pattern";
import { deriveDressingPanelInstances } from "../domain/assembly";
import {
  garmentDraftToPatternDocumentV3,
  parsePatternDocumentV3,
  patternDocumentV3ToGarmentDraft,
  validatePatternDocumentV3,
} from "../domain/patternDocumentV3";
import type {
  PanelInstanceV3,
  PatternDefinitionV3,
  PatternDocumentV3,
  PatternDocumentValidationIssue,
  SeamGroupV3,
} from "../domain/patternDocumentV3.types";

export interface ResolvedAssemblyInput {
  /** Documento canônico completo da bancada no instante da resolução. */
  document: PatternDocumentV3;
  /** Recorte canônico contendo somente peças confirmadas e incluídas. */
  assemblyDocument: PatternDocumentV3;
  /** Projeção legada derivada do V3, nunca fonte autoritativa. */
  garmentProjection: GarmentDraft;
  definitions: PatternDefinitionV3[];
  panelInstances: PanelInstanceV3[];
  seamGroups: SeamGroupV3[];
  geometrySignatures: ReadonlyMap<string, string>;
  signature: string;
  diagnostics: PatternDocumentValidationIssue[];
  snapshots: ReturnType<typeof createPatternSnapshot>[];
}

export function buildResolvedAssemblyInput(garment: GarmentDraft): ResolvedAssemblyInput {
  const document = garmentDraftToPatternDocumentV3(garment);
  const resolvedInstances = deriveDressingPanelInstances(document, garment);
  const includedInstances = resolvedInstances.filter((instance) =>
    instance.includedIn3D
    && instance.placementStatus === "confirmed"
    && instance.arrangementAnchor !== undefined,
  );
  const includedPatternIds = new Set(includedInstances.map((instance) => instance.sourcePatternId));
  const definitions = document.patternDefinitions.filter((definition) => includedPatternIds.has(definition.id));
  const definitionIds = new Set(definitions.map((definition) => definition.id));
  const seamGroups = document.seamGroups.filter((group) =>
    group.active
    && [...group.first, ...group.second].every((range) => definitionIds.has(range.pieceId)),
  );
  const activePatternId = document.workspace.activePatternId;
  const assemblyDocument = parsePatternDocumentV3({
    ...document,
    patternDefinitions: definitions,
    panelInstances: includedInstances,
    seamGroups,
    workspace: {
      ...(activePatternId && definitionIds.has(activePatternId) ? { activePatternId } : {}),
      patterns: document.workspace.patterns.filter((entry) => definitionIds.has(entry.patternId)),
    },
  });
  const garmentProjection = patternDocumentV3ToGarmentDraft(assemblyDocument);
  const geometrySignatures = new Map(definitions.map((definition) => [
    definition.id,
    patternDefinitionGeometrySignature(definition),
  ]));
  const signature = stableHash(JSON.stringify({
    geometry: [...geometrySignatures.entries()],
    instances: includedInstances.map((instance) => ({
      id: instance.id,
      sourcePatternId: instance.sourcePatternId,
      copyIndex: instance.copyIndex,
      mirrored: instance.mirrored,
      bodySide: instance.bodySide,
      surface: instance.surface,
      anchor: instance.arrangementAnchor,
    })),
    seams: seamGroups,
    body: document.body,
    measurements: document.measurements.values,
  }));
  return {
    document,
    assemblyDocument,
    garmentProjection,
    definitions,
    panelInstances: includedInstances,
    seamGroups,
    geometrySignatures,
    signature,
    diagnostics: validatePatternDocumentV3(document),
    snapshots: garmentProjection.pieces.map(createPatternSnapshot),
  };
}

export function patternDefinitionGeometrySignature(definition: PatternDefinitionV3): string {
  return stableHash(JSON.stringify({
    id: definition.id,
    geometry: definition.geometry,
    internalLines: definition.internalLines,
    darts: definition.darts,
    grainline: definition.grainline,
  }));
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
