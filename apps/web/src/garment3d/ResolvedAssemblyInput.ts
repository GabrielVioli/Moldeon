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
  /** Recorte canônico contendo todas as peças físicas incluídas no 3D. */
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
  return finalizeResolvedAssemblyInput(document, resolvedInstances);
}

/**
 * Worker/canonical path. It consumes the persisted PanelInstanceV3 identities
 * directly rather than asking a legacy GarmentDraft projection to infer them
 * again. This is the path used by Prompt 10.7 fixture imports and Assembly
 * Worker solves.
 */
export function buildResolvedAssemblyInputFromDocument(
  documentValue: PatternDocumentV3,
): ResolvedAssemblyInput {
  const document = parsePatternDocumentV3(documentValue);
  return finalizeResolvedAssemblyInput(document, document.panelInstances);
}

function finalizeResolvedAssemblyInput(
  document: PatternDocumentV3,
  resolvedInstances: readonly PanelInstanceV3[],
): ResolvedAssemblyInput {
  const includedInstances = resolvedInstances.filter((instance) =>
    instance.includedIn3D && instance.simulationEnabled,
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
  const garmentProjection = projectPhysicalInstancesForAssembly(
    patternDocumentV3ToGarmentDraft(assemblyDocument),
    includedInstances,
  );
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
    fabrics: document.fabrics.map((fabric) => ({ id: fabric.id, physics: fabric.physics })),
    simulationSettings: document.simulationSettings,
    body: document.body,
    measurements: document.measurements.values,
  }));
  return {
    document,
    assemblyDocument,
    garmentProjection,
    definitions,
    panelInstances: includedInstances.map((instance) => structuredClone(instance)),
    seamGroups: seamGroups.map((group) => structuredClone(group)),
    geometrySignatures,
    signature,
    diagnostics: validatePatternDocumentV3(document),
    snapshots: garmentProjection.pieces.map(createPatternSnapshot),
  };
}

function projectPhysicalInstancesForAssembly(
  garment: GarmentDraft,
  instances: readonly PanelInstanceV3[],
): GarmentDraft {
  return {
    ...garment,
    pieces: garment.pieces.map((piece) => {
      const physical = instances
        .filter((instance) => instance.sourcePatternId === piece.id)
        .sort((left, right) => left.copyIndex - right.copyIndex || left.id.localeCompare(right.id));
      if (physical.length === 0) return piece;
      return {
        ...piece,
        previewPlacements: physical.map((instance) => {
          const anchor = instance.arrangementAnchor;
          return {
            id: instance.id,
            pieceId: piece.id,
            region: anchor?.region ?? "custom",
            surface: anchor?.surface ?? instance.surface ?? "custom",
            bodySide: anchor?.bodySide ?? instance.bodySide ?? "center",
            ...(anchor?.bodyAnchorId ? { bodyAnchorId: anchor.bodyAnchorId } : {}),
            rotationDeg: anchor?.rotationDeg ?? 0,
            offsetXMm: anchor?.offsetXMm ?? 0,
            offsetYMm: anchor?.offsetYMm ?? 0,
            offsetZMm: anchor?.offsetZMm ?? 0,
            scale: 1,
            mirrorX: instance.mirrored,
          };
        }),
      };
    }),
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
