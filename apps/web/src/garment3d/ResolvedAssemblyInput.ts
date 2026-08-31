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
  /** Recorte exclusivo da etapa Provar; Montar não depende deste filtro. */
  simulationDocument: PatternDocumentV3;
  /** Projeção legada derivada do V3, nunca fonte autoritativa. */
  garmentProjection: GarmentDraft;
  definitions: PatternDefinitionV3[];
  panelInstances: PanelInstanceV3[];
  simulationPanelInstances: PanelInstanceV3[];
  seamGroups: SeamGroupV3[];
  geometrySignatures: ReadonlyMap<string, string>;
  signature: string;
  geometryRevision: string;
  arrangementRevision: string;
  simulationRevision: string;
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
  const includedInstances = resolvedInstances.filter((instance) => instance.includedIn3D);
  const simulationInstances = includedInstances.filter((instance) => instance.simulationEnabled);
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
  const simulationPatternIds = new Set(simulationInstances.map((instance) => instance.sourcePatternId));
  const simulationDefinitions = definitions.filter((definition) => simulationPatternIds.has(definition.id));
  const simulationSeamGroups = seamGroups.filter((group) =>
    [...group.first, ...group.second].every((range) => simulationPatternIds.has(range.pieceId)),
  );
  const simulationDocument = parsePatternDocumentV3({
    ...document,
    patternDefinitions: simulationDefinitions,
    panelInstances: simulationInstances,
    seamGroups: simulationSeamGroups,
    workspace: {
      ...(activePatternId && simulationPatternIds.has(activePatternId) ? { activePatternId } : {}),
      patterns: document.workspace.patterns.filter((entry) => simulationPatternIds.has(entry.patternId)),
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
  const geometryRevision = stableHash(JSON.stringify({
    geometry: [...geometrySignatures.entries()],
    instances: includedInstances.map((instance) => ({
      id: instance.id,
      sourcePatternId: instance.sourcePatternId,
      copyIndex: instance.copyIndex,
      mirrored: instance.mirrored,
    })),
    seams: seamGroups,
    fabrics: document.fabrics.map((fabric) => ({ id: fabric.id })),
  }));
  const arrangementRevision = stableHash(JSON.stringify({
    geometryRevision,
    instances: includedInstances.map((instance) => ({
      id: instance.id,
      sourcePatternId: instance.sourcePatternId,
      copyIndex: instance.copyIndex,
      mirrored: instance.mirrored,
      bodySide: instance.bodySide,
      surface: instance.surface,
      anchor: instance.arrangementAnchor,
    })),
    body: document.body,
    measurements: document.measurements.values,
  }));
  const simulationRevision = stableHash(JSON.stringify({
    arrangementRevision,
    simulationInstances: simulationInstances.map((instance) => instance.id),
    seams: seamGroups,
    fabrics: document.fabrics.map((fabric) => ({ id: fabric.id, physics: fabric.physics })),
    simulationSettings: document.simulationSettings,
    body: document.body,
    measurements: document.measurements.values,
  }));
  const signature = simulationRevision;
  return {
    document,
    assemblyDocument,
    simulationDocument,
    garmentProjection,
    definitions,
    panelInstances: includedInstances.map((instance) => structuredClone(instance)),
    simulationPanelInstances: simulationInstances.map((instance) => structuredClone(instance)),
    seamGroups: seamGroups.map((group) => structuredClone(group)),
    geometrySignatures,
    signature,
    geometryRevision,
    arrangementRevision,
    simulationRevision,
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
      const orderedInstances = [...instances].sort((left, right) => left.id.localeCompare(right.id));
      const previewPlacements = physical.map((instance) => {
        const anchor = instance.arrangementAnchor;
        if (instance.placementStatus !== "confirmed" || !anchor) {
          return {
            id: instance.id,
            pieceId: piece.id,
            region: "custom" as const,
            surface: "custom" as const,
            bodySide: "center" as const,
            rotationDeg: 0,
            offsetXMm: 0,
            offsetYMm: 0,
            offsetZMm: 0,
            scale: 1,
            mirrorX: instance.mirrored,
            positionMm: deterministicStagingPositionMm(
              orderedInstances.findIndex((candidate) => candidate.id === instance.id),
            ),
            orientationDeg: [0, 0, 0] as [number, number, number],
            presentationMode: "staging" as const,
          };
        }
        return {
          id: instance.id,
          pieceId: piece.id,
          region: anchor.region,
          surface: anchor.surface,
          bodySide: anchor.bodySide,
          bodyAnchorId: anchor.bodyAnchorId,
          rotationDeg: anchor.rotationDeg,
          offsetXMm: anchor.offsetXMm,
          offsetYMm: anchor.offsetYMm,
          offsetZMm: anchor.offsetZMm,
          scale: 1,
          mirrorX: instance.mirrored,
          ...(anchor.positionMm ? { positionMm: structuredClone(anchor.positionMm) } : {}),
          ...(anchor.orientationDeg ? { orientationDeg: structuredClone(anchor.orientationDeg) } : {}),
          ...(anchor.surfaceAttachment ? { surfaceAttachment: structuredClone(anchor.surfaceAttachment) } : {}),
          presentationMode: "authored" as const,
        };
      });
      return {
        ...piece,
        ...(previewPlacements.length > 0
          ? { previewPlacements }
          : { previewPlacements: undefined }),
      };
    }),
  };
}

export function deterministicStagingPositionMm(index: number): [number, number, number] {
  const safeIndex = Math.max(0, index);
  const column = safeIndex % 3;
  const row = Math.floor(safeIndex / 3);
  return [-900 + column * 300, 1_350 - row * 360, 0];
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
