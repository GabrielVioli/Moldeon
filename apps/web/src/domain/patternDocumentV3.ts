import { parseFabricSources } from "./fabric";
import {
  createMeasurementProfile,
  measurementProfileToBodyMeasurements,
  parseMeasurementProfile,
  parseParametricProjectMetadata,
  type MeasurementOrigin,
  type ParametricProjectMetadata,
  type PatternGenerationRecord,
} from "./parametricMeasurements";
import {
  migrateLegacyPieceToSegments,
  parseGarmentDraft,
  parsePatternPiece,
  seamSidesMateriallyOverlap,
  seamSideRanges,
  type AssemblyPlacement,
  type GarmentDraft,
  type PatternPiece,
  type PatternPreviewPlacement,
  type SegmentRole,
} from "./pattern";
import {
  PATTERN_DOCUMENT_FORMAT_VERSION,
  PATTERN_DOCUMENT_UNITS,
  type ConnectorLandmarkV3,
  type ConnectorRoleV3,
  type PanelArrangementAnchorV3,
  type PanelInstanceV3,
  type PatternConnectorV3,
  type PatternBodyPlacementV3,
  type PatternDefinitionV3,
  type PatternDocumentIssueSeverity,
  type PatternDocumentMigrationResult,
  type PatternDocumentMigrationWarning,
  type PatternDocumentV3,
  type PatternDocumentValidationIssue,
  type PatternMirrorRuleV3,
  type PatternProjectV2,
  type PatternSemanticRoleV3,
  type SeamGroupV3,
  type SeamPhysicalBindingV3,
  type SeamTreatmentV3,
  type WorkspaceStateV3,
} from "./patternDocumentV3.types";
import {
  bodyAnchorSpecification,
  pairedBodyAnchorId,
} from "./bodyArrangement";

const CONNECTOR_ROLE_BY_SEGMENT_ROLE: Partial<Record<SegmentRole, ConnectorRoleV3>> = {
  frontArmhole: "front-armhole",
  backArmhole: "back-armhole",
  sleeveCapFront: "sleeve-cap-front",
  sleeveCapBack: "sleeve-cap-back",
  shoulder: "shoulder",
  sideSeam: "side-seam",
  neckline: "neckline",
  waist: "waist",
  inseam: "inseam",
  outseam: "outseam",
  frontCrotch: "front-rise",
  backCrotch: "back-rise",
  hem: "hem",
};

const SEMANTIC_ROLES = [
  "front",
  "back",
  "sleeve",
  "waistband",
  "leg-front",
  "leg-back",
  "collar",
  "panel",
  "custom",
] as const;
const CONNECTOR_ROLES = [
  "front-armhole",
  "back-armhole",
  "sleeve-cap-front",
  "sleeve-cap-back",
  "shoulder",
  "side-seam",
  "underarm",
  "neckline",
  "waist",
  "waistband",
  "inseam",
  "outseam",
  "front-rise",
  "back-rise",
  "crotch",
  "hem",
  "custom",
] as const;
const MIRROR_RULES = ["none", "paired", "cut-on-fold"] as const;
const SEAM_TREATMENTS = [
  "standard",
  "ease",
  "gather",
  "elastic",
  "zipper",
  "intentional-mismatch",
] as const;
const SEAM_DISTRIBUTIONS = [
  "uniform",
  "proportional",
  "center-biased",
  "custom",
] as const;
const PREVIEW_REGIONS = ["torso", "waist", "hip", "arm", "leg", "neck", "custom"] as const;
const PREVIEW_SURFACES = ["front", "back", "side", "custom"] as const;
const BODY_SIDES = ["center", "left", "right"] as const;
const BODY_TYPES = ["feminine", "masculine"] as const;
const SIMULATION_QUALITIES = ["draft", "normal", "fitting", "high"] as const;
const VARIABLE_UNITS = ["mm", "ratio", "degree", "scalar"] as const;
const CONSTRUCTION_NODE_KINDS = [
  "measurement",
  "variable",
  "free-point",
  "computed-point",
  "line",
  "arc",
  "curve",
  "transform",
  "operation",
] as const;

export class PatternDocumentMigrationError extends Error {
  readonly stage: string;
  readonly causeValue: unknown;

  constructor(stage: string, message: string, causeValue?: unknown) {
    super(`${stage}: ${message}`);
    this.name = "PatternDocumentMigrationError";
    this.stage = stage;
    this.causeValue = causeValue;
  }
}

export class PatternDocumentCompatibilityError extends Error {
  readonly entityId?: string;

  constructor(message: string, entityId?: string) {
    super(message);
    this.name = "PatternDocumentCompatibilityError";
    this.entityId = entityId;
  }
}

export function serializePatternDocumentV3(document: PatternDocumentV3): string {
  const parsed = parsePatternDocumentV3(document);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function parsePatternDocumentV3(value: unknown): PatternDocumentV3 {
  if (!isRecord(value)) {
    throw new TypeError("O documento V3 precisa ser um objeto.");
  }
  if (value.formatVersion !== PATTERN_DOCUMENT_FORMAT_VERSION) {
    throw new TypeError("O documento não usa formatVersion 3.");
  }
  if (value.units !== PATTERN_DOCUMENT_UNITS) {
    throw new TypeError("A unidade autoritativa do documento precisa ser mm.");
  }

  const document: PatternDocumentV3 = {
    formatVersion: PATTERN_DOCUMENT_FORMAT_VERSION,
    metadata: parseMetadata(value.metadata),
    units: PATTERN_DOCUMENT_UNITS,
    measurements: parseMeasurementSet(value.measurements),
    variables: parseVariables(value.variables),
    constructionGraph: parseConstructionGraph(value.constructionGraph),
    patternDefinitions: parsePatternDefinitions(value.patternDefinitions),
    panelInstances: parsePanelInstances(value.panelInstances),
    seamGroups: parseSeamGroups(value.seamGroups),
    fabrics: parseFabricSources(value.fabrics),
    body: parseBody(value.body),
    workspace: parseWorkspace(value.workspace),
    garmentSettings: parseGarmentSettings(value.garmentSettings),
    simulationSettings: parseSimulationSettings(value.simulationSettings),
  };

  document.seamGroups = normalizeSeamPhysicalBindings(document.seamGroups, document.panelInstances);

  const errors = validatePatternDocumentV3(document).filter(
    (issue) => issue.severity === "error",
  );
  if (errors.length > 0) {
    throw new TypeError(
      `Documento V3 inválido: ${errors.map((issue) => issue.message).join(" ")}`,
    );
  }
  return document;
}

export function migratePatternProject(value: unknown): PatternDocumentMigrationResult {
  if (isRecord(value) && value.formatVersion === 3) {
    return {
      document: parsePatternDocumentV3(value),
      sourceVersion: 3,
      warnings: [],
    };
  }

  let v2: PatternProjectV2;
  let sourceVersion: "legacy" | 2;
  try {
    if (
      isRecord(value) &&
      ((value.formatVersion === 2 && "garment" in value) ||
        (value.version === 2 && "garment" in value))
    ) {
      v2 = migrateProjectV2(value);
      sourceVersion = 2;
    } else {
      v2 = migrateLegacyProjectToV2(value);
      sourceVersion = "legacy";
    }
  } catch (error) {
    throw new PatternDocumentMigrationError(
      "legacy-to-v2",
      readableError(error),
      value,
    );
  }

  try {
    const warnings: PatternDocumentMigrationWarning[] = [];
    const document = migrateProjectV2ToV3(v2, warnings);
    return { document, sourceVersion, warnings };
  } catch (error) {
    throw new PatternDocumentMigrationError(
      "v2-to-v3",
      readableError(error),
      v2,
    );
  }
}

export function migrateLegacyProjectToV2(value: unknown): PatternProjectV2 {
  return {
    formatVersion: 2,
    garment: parseGarmentDraft(value),
  };
}

export function migrateProjectV2(value: unknown): PatternProjectV2 {
  if (!isRecord(value)) {
    throw new TypeError("O projeto V2 precisa ser um objeto.");
  }
  if (value.formatVersion !== 2 && value.version !== 2) {
    throw new TypeError("O projeto não usa a versão 2.");
  }
  const activePieceId =
    value.activePieceId === undefined
      ? undefined
      : readString(value.activePieceId, "A peça ativa do projeto V2");
  return {
    formatVersion: 2,
    garment: parseGarmentDraft(value.garment),
    ...(activePieceId === undefined ? {} : { activePieceId }),
  };
}

export function migrateProjectV2ToV3(
  project: PatternProjectV2,
  warnings: PatternDocumentMigrationWarning[] = [],
): PatternDocumentV3 {
  const garment = parseGarmentDraft(project.garment);
  return garmentDraftToPatternDocumentV3(garment, {
    activePatternId: project.activePieceId,
    warnings,
    placementProvenance: "migration",
  });
}

export function garmentDraftToPatternDocumentV3(
  garmentValue: GarmentDraft,
  options: {
    activePatternId?: string;
    warnings?: PatternDocumentMigrationWarning[];
    placementProvenance?: "editor" | "migration";
  } = {},
): PatternDocumentV3 {
  const garment = parseGarmentDraft(garmentValue);
  const warnings = options.warnings ?? [];
  const placementProvenance = options.placementProvenance ?? "editor";
  const patternDefinitions = garment.pieces.map((piece) =>
    patternPieceToDefinition(piece, garment, warnings, placementProvenance),
  );
  const panelInstances = derivePanelInstances(patternDefinitions, garment);
  const seamGroups = legacySeamsToGroups(garment.seams ?? [], panelInstances);
  const workspace = createWorkspaceState(
    garment,
    options.activePatternId,
    patternDefinitions,
  );
  const profile = garment.measurementProfile
    ? createMeasurementProfile(garment.measurements, garment.bodyType, garment.measurementProfile)
    : undefined;
  const measurementEntries = profile
    ? Object.values(profile.entries).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : [];

  return parsePatternDocumentV3({
    formatVersion: PATTERN_DOCUMENT_FORMAT_VERSION,
    metadata: {
      projectId: garment.id,
      name: garment.name,
      description: garment.description,
      sourceTemplateId: garment.templateId,
      ...(garment.parametric?.templateVersion ? { sourceTemplateVersion: garment.parametric.templateVersion } : {}),
      application: { name: "Moldeon" },
    },
    units: PATTERN_DOCUMENT_UNITS,
    measurements: {
      id: "measurements-primary",
      values: profile ? measurementProfileToBodyMeasurements(profile) : garment.measurements,
      estimatedKeys: measurementEntries.filter((entry) => entry.origin === "estimated").map((entry) => entry.key),
      ...(profile
        ? {
            suppliedKeys: measurementEntries.filter((entry) => entry.origin === "supplied").map((entry) => entry.key),
            derivedKeys: measurementEntries.filter((entry) => entry.origin === "derived").map((entry) => entry.key),
            formulaSetVersion: profile.formulaSetVersion,
            profile,
          }
        : {}),
    },
    variables: garment.parametric?.variables ?? [],
    constructionGraph: garment.parametric?.constructionGraph ?? { version: 1, nodes: [] },
    patternDefinitions,
    panelInstances,
    seamGroups,
    fabrics: garment.fabrics,
    body: {
      type: garment.bodyType,
      measurementSetId: "measurements-primary",
      metadata: {},
    },
    workspace,
    garmentSettings: {
      ...(garment.ease === undefined ? {} : { ease: garment.ease }),
      ...(garment.dressing === undefined ? {} : { dressing: garment.dressing }),
    },
    simulationSettings: defaultSimulationSettings(),
  });
}

export function patternDocumentV3ToGarmentDraft(
  documentValue: PatternDocumentV3,
): GarmentDraft {
  const document = parsePatternDocumentV3(documentValue);
  ensureLegacyRuntimeCompatibility(document);

  const pieces = document.patternDefinitions.map((definition) =>
    definitionToPatternPiece(definition, document.panelInstances),
  );
  const seams = document.seamGroups.flatMap(groupToLegacySeams);

  const workspaceStates = document.workspace.patterns.map((entry) => ({
    pieceId: entry.patternId,
    transform: {
      pieceId: entry.patternId,
      xMm: entry.transform.xMm,
      yMm: entry.transform.yMm,
      rotationDeg: entry.transform.rotationDeg,
    },
    visible: entry.visible,
    locked: entry.locked,
  }));
  const workspaceTransforms = workspaceStates.map((entry) => ({
    ...entry.transform,
  }));
  const assemblyPlacements = document.patternDefinitions
    .map((definition) =>
      definition.bodyPlacement.status === "confirmed"
        ? firstAssemblyPlacementForDefinition(definition.id, document.panelInstances)
        : undefined,
    )
    .filter((placement): placement is AssemblyPlacement => placement !== undefined);

  const profile = document.measurements.profile
    ? parseMeasurementProfile(document.measurements.profile)
    : undefined;
  const generations = document.patternDefinitions.flatMap((definition) => definition.generation ? [definition.generation] : []);
  const hasParametricMetadata = Boolean(
    document.metadata.sourceTemplateVersion
    || document.variables.length > 0
    || document.constructionGraph.version === 2
    || document.constructionGraph.nodes.length > 0
    || generations.length > 0,
  );
  const parametric: ParametricProjectMetadata | undefined = hasParametricMetadata
    ? {
        schemaVersion: 1,
        ...(document.metadata.sourceTemplateId ? { templateId: document.metadata.sourceTemplateId } : {}),
        ...(document.metadata.sourceTemplateVersion ? { templateVersion: document.metadata.sourceTemplateVersion } : {}),
        variables: document.variables.map((variable) => ({
          ...variable,
          formulaVersion: variable.formulaVersion ?? "legacy-v3",
          dependencies: variable.dependencies ?? [],
        })),
        constructionGraph: document.constructionGraph,
        generations,
      }
    : undefined;

  return parseGarmentDraft({
    id: document.metadata.projectId,
    templateId: document.metadata.sourceTemplateId ?? "custom",
    name: document.metadata.name,
    description: document.metadata.description,
    bodyType: document.body.type,
    measurements: profile ? measurementProfileToBodyMeasurements(profile) : document.measurements.values,
    ...(profile ? { measurementProfile: profile } : {}),
    ...(parametric ? { parametric } : {}),
    fabrics: document.fabrics,
    pieces,
    ...(seams.length === 0 ? {} : { seams }),
    workspaceTransforms,
    workspaceStates,
    ...(assemblyPlacements.length === 0 ? {} : { assemblyPlacements }),
    ...(document.garmentSettings.ease === undefined
      ? {}
      : { ease: document.garmentSettings.ease }),
    ...(document.garmentSettings.dressing === undefined
      ? {}
      : { dressing: document.garmentSettings.dressing }),
  });
}

export function derivePanelInstances(
  definitions: readonly PatternDefinitionV3[],
  garment?: Pick<GarmentDraft, "pieces" | "assemblyPlacements">,
): PanelInstanceV3[] {
  const result: PanelInstanceV3[] = [];

  for (const definition of definitions) {
    const classification = definition.bodyPlacement;
    const definitionConfirmed = classification.status === "confirmed"
      && classification.anchorId !== undefined;
    const sourcePiece = garment?.pieces.find((piece) => piece.id === definition.id);
    for (let copyIndex = 0; copyIndex < definition.cutQuantity; copyIndex += 1) {
      const instanceId = createPanelInstanceId(definition.id, copyIndex);
      const explicitPlacement = sourcePiece?.previewPlacements?.find((placement) => placement.id === instanceId);
      const explicitAnchorId = explicitPlacement?.bodyAnchorId;
      const defaultSpecification = definitionConfirmed ? bodyAnchorSpecification(classification.anchorId!) : undefined;
      const configuredSide = classification.bodySide
        ?? ((definition.mirrorRule === "paired" || definition.cutQuantity === 2) ? "paired" : defaultSpecification?.bodySide);
      const defaultBodySide = definitionConfirmed && configuredSide
        ? resolveClassifiedBodySide(configuredSide, definition, copyIndex)
        : undefined;
      const bodySide = explicitPlacement?.bodySide ?? defaultBodySide;
      const surface = explicitPlacement?.surface ?? classification.surface ?? defaultSpecification?.surface;
      const region = explicitPlacement?.region ?? classification.region ?? defaultSpecification?.region;
      const mirrored = explicitPlacement?.mirrorX
        ?? (classification.outwardFace === "flipped"
          || (definition.mirrorRule === "paired" && copyIndex % 2 === 1));
      const hasExplicitArrangement = Boolean(
        explicitPlacement
        && (explicitAnchorId || explicitPlacement.positionMm || explicitPlacement.surfaceAttachment),
      );
      const anchor = explicitPlacement && hasExplicitArrangement
        ? createArrangementAnchorFromPreview(instanceId, explicitPlacement)
        : definitionConfirmed && bodySide && surface && region
          ? createArrangementAnchor(definition, copyIndex, bodySide, surface)
          : undefined;
      const placementSource = explicitPlacement && hasExplicitArrangement
        ? "panel-instance"
        : anchor
          ? "pattern-definition"
          : "unassigned";
      result.push({
        id: instanceId,
        sourcePatternId: definition.id,
        copyIndex,
        placementStatus: anchor ? "confirmed" : "unclassified",
        ...(bodySide === undefined ? {} : { bodySide }),
        ...(surface === undefined ? {} : { surface }),
        mirrored,
        fabricId: definition.fabricId,
        ...(anchor === undefined ? {} : { arrangementAnchor: anchor }),
        includedIn3D: classification.includeIn3D,
        simulationEnabled: true,
        metadata: { effectivePlacementSource: placementSource },
      });
    }
  }
  return result;
}

export function createPanelInstanceId(
  sourcePatternId: string,
  copyIndex: number,
): string {
  if (!Number.isInteger(copyIndex) || copyIndex < 0) {
    throw new TypeError("copyIndex precisa ser um inteiro não negativo.");
  }
  return `${sourcePatternId}:panel:${copyIndex + 1}`;
}

export function validatePatternDocumentV3(
  document: PatternDocumentV3,
): PatternDocumentValidationIssue[] {
  const issues: PatternDocumentValidationIssue[] = [];
  const patternIds = collectUniqueIds(
    document.patternDefinitions.map((definition) => definition.id),
    "definição de molde",
    issues,
  );
  const fabricIds = collectUniqueIds(
    document.fabrics.map((fabric) => fabric.id),
    "tecido",
    issues,
  );
  collectUniqueIds(
    document.panelInstances.map((instance) => instance.id),
    "instância física",
    issues,
  );
  collectUniqueIds(
    document.seamGroups.map((group) => group.id),
    "grupo de costura",
    issues,
  );

  const edgeIdsByPattern = new Map<string, Set<string>>();
  for (const definition of document.patternDefinitions) {
    const edgeIds = new Set(definition.geometry.segments.map((segment) => segment.id));
    edgeIdsByPattern.set(definition.id, edgeIds);
    if (!fabricIds.has(definition.fabricId)) {
      issues.push(issue("missing-fabric", "error", `O molde ${definition.id} referencia um tecido inexistente.`, definition.id));
    }
    const connectorIds = new Set<string>();
    for (const connector of definition.connectors) {
      if (connectorIds.has(connector.id)) {
        issues.push(issue("duplicate-id", "error", `O conector ${connector.id} está duplicado.`, connector.id));
      }
      connectorIds.add(connector.id);
      if (connector.ranges.length === 0) {
        issues.push(issue("invalid-connector", "error", `O conector ${connector.id} não possui intervalos.`, connector.id));
      }
      connector.ranges.forEach((range) => {
        validateRange(range, connector.id, patternIds, edgeIdsByPattern, issues);
        if (range.pieceId !== definition.id) {
          issues.push(issue("invalid-connector", "error", `O conector ${connector.id} referencia outro molde.`, connector.id));
        }
      });
      connector.landmarks.forEach((landmark) => {
        if (
          landmark.rangeIndex < 0 ||
          landmark.rangeIndex >= connector.ranges.length ||
          landmark.t < 0 ||
          landmark.t > 1
        ) {
          issues.push(issue("invalid-connector", "error", `O landmark ${landmark.id} é inválido.`, connector.id));
        }
      });
    }
  }

  const instanceKeys = new Set<string>();
  for (const instance of document.panelInstances) {
    const definition = document.patternDefinitions.find(
      (candidate) => candidate.id === instance.sourcePatternId,
    );
    if (!definition) {
      issues.push(issue("missing-pattern", "error", `A instância ${instance.id} referencia um molde inexistente.`, instance.id));
      continue;
    }
    const instanceKey = `${instance.sourcePatternId}:${instance.copyIndex}`;
    if (instanceKeys.has(instanceKey)) {
      issues.push(issue("invalid-panel-instance", "error", `A cópia física ${instanceKey} está duplicada.`, instance.id));
    }
    instanceKeys.add(instanceKey);
    if (!fabricIds.has(instance.fabricId)) {
      issues.push(issue("missing-fabric", "error", `A instância ${instance.id} referencia um tecido inexistente.`, instance.id));
    }
    if (
      instance.copyIndex < 0 ||
      !Number.isInteger(instance.copyIndex) ||
      instance.copyIndex >= definition.cutQuantity
    ) {
      issues.push(issue("invalid-panel-instance", "error", `A instância ${instance.id} possui copyIndex inválido.`, instance.id));
    }
    if (instance.placementStatus === "confirmed" && (!instance.arrangementAnchor || !instance.bodySide || !instance.surface)) {
      issues.push(issue("invalid-panel-instance", "error", `A instância ${instance.id} está confirmada sem posicionamento corporal completo.`, instance.id));
    }
    if (instance.arrangementAnchor && instance.arrangementAnchor.bodySide !== instance.bodySide) {
      issues.push(issue("invalid-panel-instance", "error", `A instância ${instance.id} diverge do lado corporal do anchor.`, instance.id));
    }
    if (instance.arrangementAnchor && Math.abs(instance.arrangementAnchor.scale - 1) > 1e-9) {
      issues.push(issue("invalid-panel-instance", "warning", `A instância ${instance.id} possui escala legada ${instance.arrangementAnchor.scale}; a montagem física usará escala 1.`, instance.id));
    }
  }

  for (const definition of document.patternDefinitions) {
    for (let copyIndex = 0; copyIndex < definition.cutQuantity; copyIndex += 1) {
      const key = `${definition.id}:${copyIndex}`;
      if (!instanceKeys.has(key)) {
        issues.push(issue("invalid-panel-instance", "error", `A instância física ${key} está ausente.`));
      }
    }
  }

  const seamSignatures = new Map<string, string>();
  for (const group of document.seamGroups) {
    group.first.forEach((range) =>
      validateRange(range, group.id, patternIds, edgeIdsByPattern, issues),
    );
    group.second.forEach((range) =>
      validateRange(range, group.id, patternIds, edgeIdsByPattern, issues),
    );
    if (group.first.length === 0 || group.second.length === 0) {
      issues.push(issue("empty-range", "error", `O grupo ${group.id} precisa ter intervalos nos dois lados.`, group.id));
    }
    validatePhysicalBindings(group, document.panelInstances, issues);
    const physicalDistinctCopy = (group.physicalBindings ?? []).some((binding) =>
      binding.first.some((first) => binding.second.some((second) =>
        first.patternId === second.patternId && first.panelInstanceId !== second.panelInstanceId,
      )),
    );
    if (seamSidesMateriallyOverlap(group.first, group.second) && !physicalDistinctCopy) {
      issues.push(issue("degenerate-self-seam", "error", `O grupo ${group.id} costura exatamente os mesmos intervalos sem cópias físicas distintas.`, group.id));
    }
    const signature = seamGroupSignature(group);
    const duplicateId = seamSignatures.get(signature);
    if (duplicateId) {
      issues.push(issue("duplicate-seam-group", "error", `Os grupos ${duplicateId} e ${group.id} descrevem a mesma costura.`, group.id));
    } else {
      seamSignatures.set(signature, group.id);
    }
  }

  for (const entry of document.workspace.patterns) {
    if (!patternIds.has(entry.patternId)) {
      issues.push(issue("invalid-workspace-reference", "error", `A bancada referencia o molde inexistente ${entry.patternId}.`, entry.patternId));
    }
  }
  if (
    document.workspace.activePatternId !== undefined &&
    !patternIds.has(document.workspace.activePatternId)
  ) {
    issues.push(issue("invalid-workspace-reference", "error", `A peça ativa ${document.workspace.activePatternId} não existe.`, document.workspace.activePatternId));
  }
  return issues;
}

function patternPieceToDefinition(
  pieceValue: PatternPiece,
  garment: GarmentDraft,
  warnings: PatternDocumentMigrationWarning[],
  placementProvenance: "editor" | "migration",
): PatternDefinitionV3 {
  const piece = migrateLegacyPieceToSegments(structuredClone(pieceValue));
  if (!piece.nodes || !piece.segments || !piece.contours) {
    throw new TypeError(`Não foi possível normalizar a topologia de ${piece.id}.`);
  }
  const connectors = migrateSemanticConnectors(piece);
  if (connectors.length === 0) {
    warnings.push({
      code: "no-semantic-connectors",
      message: `O molde ${piece.id} não possuía papéis semânticos inequívocos.`,
      entityId: piece.id,
    });
  }
  return {
    id: piece.id,
    name: piece.name,
    sourceTemplateId: garment.templateId,
    semanticRole: inferSemanticRole(piece.id, garment),
    bodyPlacement: bodyPlacementForPiece(piece, garment, placementProvenance),
    geometry: {
      geometryVersion: 2,
      points: structuredClone(piece.points),
      nodes: structuredClone(piece.nodes),
      segments: structuredClone(piece.segments),
      contours: structuredClone(piece.contours),
    },
    internalLines: structuredClone(piece.internalLines ?? []),
    darts: structuredClone(piece.darts ?? []),
    ...(piece.grainline === undefined ? {} : { grainline: structuredClone(piece.grainline) }),
    annotations: structuredClone(piece.annotations ?? []),
    guides: structuredClone(piece.guides ?? []),
    seamAllowanceMm: piece.seamAllowanceMm,
    edgeFinishes: structuredClone(piece.edgeFinishes ?? {}),
    cutQuantity: piece.cutQuantity ?? 1,
    cutOnFold: piece.cutOnFold === true,
    mirrorRule: mirrorRuleForPiece(piece),
    fabricId: piece.fabricId ?? garment.fabrics[0].id,
    connectors,
    ...(garment.parametric?.generations.find((generation) => generation.patternId === piece.id)
      ? { generation: structuredClone(garment.parametric.generations.find((generation) => generation.patternId === piece.id)!) }
      : {}),
  };
}

function definitionToPatternPiece(
  definition: PatternDefinitionV3,
  instances: readonly PanelInstanceV3[],
): PatternPiece {
  const previewPlacements = instances
    .filter((instance) => (
      instance.sourcePatternId === definition.id
      && instance.placementStatus === "confirmed"
      && instance.arrangementAnchor
      // A definition default remains a definition default after the V3 -> draft
      // compatibility projection. Only true instance overrides are materialized
      // as PatternPreviewPlacement. Documents predating this diagnostic field
      // keep their historical behavior instead of silently losing placement.
      && instance.metadata.effectivePlacementSource !== "pattern-definition"
    ))
    .sort((left, right) => left.copyIndex - right.copyIndex)
    .map((instance): PatternPreviewPlacement => {
      const anchor = instance.arrangementAnchor!;
      return ({
      id: instance.id,
      pieceId: definition.id,
      region: anchor.region,
      surface: anchor.surface,
      bodySide: instance.bodySide!,
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
      presentationMode: "authored",
    });
    });

  return parsePatternPiece({
    id: definition.id,
    name: definition.name,
    seamAllowanceMm: definition.seamAllowanceMm,
    cutQuantity: definition.cutQuantity,
    cutOnFold: definition.cutOnFold,
    fabricId: definition.fabricId,
    bodyPlacement: structuredClone(definition.bodyPlacement),
    ...(previewPlacements.length === 0 ? {} : { previewPlacements }),
    edgeFinishes: definition.edgeFinishes,
    points: definition.geometry.points,
    formatVersion: 2,
    nodes: definition.geometry.nodes,
    segments: definition.geometry.segments,
    contours: definition.geometry.contours,
    internalLines: definition.internalLines,
    darts: definition.darts,
    ...(definition.grainline === undefined ? {} : { grainline: definition.grainline }),
    annotations: definition.annotations,
    guides: definition.guides,
  });
}

function migrateSemanticConnectors(piece: PatternPiece): PatternConnectorV3[] {
  const grouped = new Map<ConnectorRoleV3, NonNullable<PatternPiece["segments"]>>();
  const sleeveDefinition = (piece.segments ?? []).some((segment) => segment.role === "sleeveCapFront")
    && (piece.segments ?? []).some((segment) => segment.role === "sleeveCapBack");
  for (const segment of piece.segments ?? []) {
    const role = sleeveDefinition && segment.role === "sideSeam"
      ? "underarm"
      : CONNECTOR_ROLE_BY_SEGMENT_ROLE[segment.role];
    if (!role) continue;
    const current = grouped.get(role) ?? [];
    current.push(segment);
    grouped.set(role, current);
  }
  return [...grouped.entries()].map(([role, segments]) => ({
    id: `${piece.id}:connector:${role}`,
    role,
    ranges: segments.map((segment) => ({
      pieceId: piece.id,
      edgeId: segment.id,
      startT: 0,
      endT: 1,
    })),
    landmarks: semanticConnectorLandmarks(piece.id, role, segments.length),
    direction: "forward",
    metadata: { landmarkSource: "semantic-role-v1" },
  }));
}

function semanticConnectorLandmarks(
  pieceId: string,
  role: ConnectorRoleV3,
  rangeCount: number,
): ConnectorLandmarkV3[] {
  const lastRange = Math.max(0, rangeCount - 1);
  const landmarks: ConnectorLandmarkV3[] = [
    { id: `${pieceId}:${role}:start`, kind: "start", rangeIndex: 0, t: 0 },
    { id: `${pieceId}:${role}:end`, kind: "end", rangeIndex: lastRange, t: 1 },
  ];
  if (role === "front-armhole" || role === "sleeve-cap-front") {
    landmarks.push({
      id: `${pieceId}:${role}:front-notch`,
      kind: "notch",
      rangeIndex: 0,
      t: rangeCount > 1 ? 1 : 0.62,
      label: "Pique frontal",
    });
  }
  if (role === "back-armhole" || role === "sleeve-cap-back") {
    landmarks.push(
      {
        id: `${pieceId}:${role}:back-notch-1`,
        kind: "notch",
        rangeIndex: 0,
        t: rangeCount > 1 ? 0.74 : 0.42,
        label: "Primeiro pique traseiro",
      },
      {
        id: `${pieceId}:${role}:back-notch-2`,
        kind: "notch",
        rangeIndex: lastRange,
        t: rangeCount > 1 ? 0.28 : 0.68,
        label: "Segundo pique traseiro",
      },
    );
  }
  if (role === "front-armhole" || role === "back-armhole") {
    landmarks.push({
      id: `${pieceId}:${role}:shoulder-balance`,
      kind: "balance",
      rangeIndex: 0,
      t: 0,
      label: "Marca de ombro",
    });
  }
  if (role === "sleeve-cap-front") {
    landmarks.push({
      id: `${pieceId}:${role}:apex`,
      kind: "apex",
      rangeIndex: lastRange,
      t: 1,
      label: "Ápice da manga",
    });
  }
  if (role === "sleeve-cap-back") {
    landmarks.push({
      id: `${pieceId}:${role}:apex`,
      kind: "apex",
      rangeIndex: 0,
      t: 0,
      label: "Ápice da manga",
    });
  }
  if (role === "shoulder") {
    landmarks.push({
      id: `${pieceId}:${role}:balance`,
      kind: "balance",
      rangeIndex: 0,
      t: 0.5,
      label: "Marca de ombro",
    });
  }
  return landmarks;
}

function inferSemanticRole(
  pieceId: string,
  garment: GarmentDraft,
): PatternSemanticRoleV3 {
  const explicitRole = garment.pieces.find((piece) => piece.id === pieceId)?.bodyPlacement?.role;
  if (explicitRole) return explicitRole;
  const placement = garment.assemblyPlacements?.find(
    (candidate) => candidate.pieceId === pieceId,
  );
  if (!placement || placement.source === "inferred") return "custom";
  switch (placement.role) {
    case "front":
      return "front";
    case "back":
      return "back";
    case "sleeve":
      return "sleeve";
    case "collar":
      return "collar";
    case "waist":
      return "waistband";
    case "leg":
      return placement.outwardSide === "front" ? "leg-front" : "leg-back";
    default:
      return "custom";
  }
}

function bodyPlacementForPiece(
  piece: PatternPiece,
  garment: GarmentDraft,
  placementProvenance: "editor" | "migration",
): PatternDefinitionV3["bodyPlacement"] {
  if (piece.bodyPlacement) return structuredClone(piece.bodyPlacement);
  const preview = piece.previewPlacements?.[0];
  const assembly = garment.assemblyPlacements?.find(
    (candidate) => candidate.pieceId === piece.id && candidate.source !== "inferred",
  );
  if (!preview && !assembly) {
    return {
      version: 1,
      status: "unclassified",
      includeIn3D: true,
      outwardFace: "normal",
      offsetXMm: 0,
      offsetYMm: 0,
      offsetZMm: 25,
      rotationXDeg: 0,
      rotationYDeg: 0,
      rotationZDeg: 0,
      source: placementProvenance === "migration" ? "migration" : "manual",
    };
  }
  const role = inferSemanticRole(piece.id, garment);
  const region = preview?.region ?? (assembly ? regionFromLegacyAssemblyRole(assembly.role) : undefined);
  const surface = preview?.surface ?? assembly?.outwardSide;
  const previewSides = new Set(piece.previewPlacements?.map((placement) => placement.bodySide) ?? []);
  const bodySide = previewSides.has("left") && previewSides.has("right")
    ? "paired"
    : preview?.bodySide ?? "center";
  return {
    version: 1,
    status: "confirmed",
    includeIn3D: true,
    role,
    ...(region === undefined ? {} : { region }),
    ...(surface === undefined ? {} : { surface }),
    bodySide,
    ...(anchorIdForPlacement(region, surface, preview?.bodySide ?? bodySide) === undefined ? {} : { anchorId: anchorIdForPlacement(region, surface, preview?.bodySide ?? bodySide) }),
    outwardFace: preview?.mirrorX || assembly?.flipped ? "flipped" : "normal",
    offsetXMm: preview?.offsetXMm ?? assembly?.positionMm[0] ?? 0,
    offsetYMm: preview?.offsetYMm ?? assembly?.positionMm[1] ?? 0,
    offsetZMm: preview?.offsetZMm ?? assembly?.positionMm[2] ?? 25,
    rotationXDeg: assembly?.rotationDeg[0] ?? 0,
    rotationYDeg: assembly?.rotationDeg[1] ?? 0,
    rotationZDeg: preview?.rotationDeg ?? assembly?.rotationDeg[2] ?? 0,
    source: placementProvenance === "migration" ? "migration" : "manual",
  };
}

function regionFromLegacyAssemblyRole(role: AssemblyPlacement["role"]): PatternDefinitionV3["bodyPlacement"]["region"] {
  if (role === "sleeve") return "arm";
  if (role === "leg") return "leg";
  if (role === "waist") return "waist";
  if (role === "collar") return "neck";
  return "torso";
}

function anchorIdForPlacement(
  region: PatternDefinitionV3["bodyPlacement"]["region"],
  surface: PatternDefinitionV3["bodyPlacement"]["surface"],
  side: PatternDefinitionV3["bodyPlacement"]["bodySide"],
): PatternDefinitionV3["bodyPlacement"]["anchorId"] {
  if (region === "torso") return surface === "back" ? "torso-back" : surface === "front" ? "torso-front" : undefined;
  if (region === "waist") return surface === "back" ? "waist-back" : surface === "front" ? "waist-front" : undefined;
  if (region === "hip") {
    if (side === "left") return "hip-left";
    if (side === "right") return "hip-right";
    return surface === "back" ? "hip-back" : surface === "front" ? "hip-front" : undefined;
  }
  if (region === "arm") return side === "left" ? "arm-left" : side === "right" ? "arm-right" : undefined;
  if (region === "leg") return side === "left" ? "leg-left" : side === "right" ? "leg-right" : undefined;
  if (region === "neck") return "neck";
  return undefined;
}

function mirrorRuleForPiece(piece: PatternPiece): PatternMirrorRuleV3 {
  if (piece.cutOnFold) return "cut-on-fold";
  if ((piece.cutQuantity ?? 1) > 1) return "paired";
  return "none";
}

function legacySeamsToGroups(
  seams: NonNullable<GarmentDraft["seams"]>,
  panelInstances: readonly PanelInstanceV3[],
): SeamGroupV3[] {
  const grouped = new Map<string, NonNullable<GarmentDraft["seams"]>>();
  for (const seam of seams) {
    const id = seam.groupId ?? seam.id;
    const current = grouped.get(id) ?? [];
    current.push(seam);
    grouped.set(id, current);
  }
  return [...grouped.entries()].map(([groupId, parts]) => {
    const first = parts[0];
    const base = legacySeamToGroup(first);
    const group: SeamGroupV3 = {
      ...base,
      id: groupId,
      name: first.name ?? groupId,
      first: parts.flatMap((part) => seamSideRanges(part, "first").map((range) => structuredClone(range))),
      second: parts.flatMap((part) => seamSideRanges(part, "second").map((range) => structuredClone(range))),
      active: parts.every((part) => part.active !== false),
    };
    const explicitBindings = parts.flatMap((part) => part.physicalBindings ?? []);
    if (explicitBindings.length > 0) group.physicalBindings = structuredClone(explicitBindings);
    return normalizeSeamPhysicalBinding(group, panelInstances);
  });
}

function groupToLegacySeams(group: SeamGroupV3): NonNullable<GarmentDraft["seams"]> {
  const first = structuredClone(group.first[0]);
  const second = structuredClone(group.second[0]);
  return [{
    id: group.id,
    groupId: group.id,
    name: group.name,
    first,
    second,
    ...(group.first.length > 1 ? { firstRanges: structuredClone(group.first) } : {}),
    ...(group.second.length > 1 ? { secondRanges: structuredClone(group.second) } : {}),
    direction: group.direction,
    easeRatio: group.compatibility?.legacyEaseRatio ?? Math.abs(group.targetRatio - 1),
    type: group.compatibility?.legacyType ?? group.treatment,
    treatment: legacyTreatment(group),
    canonicalTreatment: group.treatment,
    distribution: group.distribution,
    targetRatio: group.targetRatio,
    slackMm: group.slackMm,
    ...(group.physicalBindings === undefined ? {} : { physicalBindings: structuredClone(group.physicalBindings) }),
    active: group.active,
  }];
}

function legacySeamToGroup(seam: NonNullable<GarmentDraft["seams"]>[number]): SeamGroupV3 {
  const treatment = seam.canonicalTreatment === "stretch"
    ? "elastic"
    : seam.canonicalTreatment ?? legacyTreatmentToV3(seam.treatment, seam.type);
  return {
    id: seam.id,
    name: seam.name ?? seam.id,
    first: seamSideRanges(seam, "first").map((range) => structuredClone(range)),
    second: seamSideRanges(seam, "second").map((range) => structuredClone(range)),
    direction: seam.direction,
    treatment,
    distribution: seam.distribution ?? (treatment === "ease" || treatment === "gather" ? "proportional" : "uniform"),
    targetRatio: seam.targetRatio ?? Math.max(0.000001, 1 + seam.easeRatio),
    slackMm: seam.slackMm ?? 0,
    ...(seam.physicalBindings === undefined ? {} : { physicalBindings: structuredClone(seam.physicalBindings) }),
    ...(seam.physicalPairing === undefined ? {} : { physicalPairing: seam.physicalPairing }),
    active: seam.active !== false,
    compatibility: {
      legacyEaseRatio: seam.easeRatio,
      legacyType: seam.type,
      ...(seam.treatment === undefined ? {} : { legacyTreatment: seam.treatment }),
    },
  };
}

function legacyTreatmentToV3(
  treatment: NonNullable<GarmentDraft["seams"]>[number]["treatment"],
  type: string,
): SeamTreatmentV3 {
  if (treatment === "stretch") return "elastic";
  if (
    treatment === "standard" ||
    treatment === "ease" ||
    treatment === "gather" ||
    treatment === "intentional-mismatch"
  ) {
    return treatment;
  }
  return type === "intentional-mismatch" ? "intentional-mismatch" : "standard";
}

function legacyTreatment(group: SeamGroupV3): "standard" | "ease" | "gather" | "stretch" | "intentional-mismatch" {
  const legacy = group.compatibility?.legacyTreatment;
  if (
    legacy === "standard" ||
    legacy === "ease" ||
    legacy === "gather" ||
    legacy === "stretch" ||
    legacy === "intentional-mismatch"
  ) {
    return legacy;
  }
  return group.treatment === "elastic" ? "stretch" : group.treatment === "zipper" ? "standard" : group.treatment;
}

function normalizeSeamPhysicalBindings(
  groups: readonly SeamGroupV3[],
  panelInstances: readonly PanelInstanceV3[],
): SeamGroupV3[] {
  return groups.map((group) => normalizeSeamPhysicalBinding(group, panelInstances));
}

function normalizeSeamPhysicalBinding(
  group: SeamGroupV3,
  panelInstances: readonly PanelInstanceV3[],
): SeamGroupV3 {
  const { physicalPairing, ...canonical } = group;
  if ((group.physicalBindings?.length ?? 0) > 0) {
    return { ...canonical, physicalBindings: structuredClone(group.physicalBindings) };
  }
  const physicalBindings = physicalPairing === "paired-copies"
    ? buildPairedCopyBindings(group, panelInstances)
    : inferPhysicalBindings(group, panelInstances);
  return physicalBindings.length > 0 ? { ...canonical, physicalBindings } : canonical;
}

function inferPhysicalBindings(
  group: Pick<SeamGroupV3, "id" | "first" | "second">,
  panelInstances: readonly PanelInstanceV3[],
): SeamPhysicalBindingV3[] {
  const firstPatternIds = uniqueSorted(group.first.map((range) => range.pieceId));
  const secondPatternIds = uniqueSorted(group.second.map((range) => range.pieceId));
  const allPatternIds = uniqueSorted([...firstPatternIds, ...secondPatternIds]);
  const instancesByPattern = new Map<string, PanelInstanceV3[]>();
  for (const patternId of allPatternIds) {
    instancesByPattern.set(patternId, panelInstances
      .filter((instance) => instance.sourcePatternId === patternId)
      .sort((left, right) => left.copyIndex - right.copyIndex || left.id.localeCompare(right.id)));
  }
  if (allPatternIds.some((patternId) => (instancesByPattern.get(patternId)?.length ?? 0) === 0)) return [];
  const bindingCount = Math.max(1, ...allPatternIds.map((patternId) => instancesByPattern.get(patternId)?.length ?? 0));
  if (allPatternIds.some((patternId) => {
    const count = instancesByPattern.get(patternId)?.length ?? 0;
    return count !== 1 && count !== bindingCount;
  })) return [];

  const pick = (patternId: string, index: number): PanelInstanceV3 | undefined => {
    const list = instancesByPattern.get(patternId) ?? [];
    return list.length === 1 ? list[0] : list.find((instance) => instance.copyIndex === index) ?? list[index];
  };
  return Array.from({ length: bindingCount }, (_, index) => ({
    id: `${group.id}:physical:${index + 1}`,
    first: firstPatternIds.map((patternId) => pick(patternId, index)!)
      .map((instance) => ({ patternId: instance.sourcePatternId, panelInstanceId: instance.id })),
    second: secondPatternIds.map((patternId) => pick(patternId, index)!)
      .map((instance) => ({ patternId: instance.sourcePatternId, panelInstanceId: instance.id })),
  }));
}

function buildPairedCopyBindings(
  group: Pick<SeamGroupV3, "id" | "first" | "second">,
  panelInstances: readonly PanelInstanceV3[],
): SeamPhysicalBindingV3[] {
  const patternIds = uniqueSorted([...group.first, ...group.second].map((range) => range.pieceId));
  if (patternIds.length !== 1) return [];
  const patternId = patternIds[0];
  const instances = panelInstances
    .filter((instance) => instance.sourcePatternId === patternId)
    .sort((left, right) => left.copyIndex - right.copyIndex || left.id.localeCompare(right.id));
  if (instances.length < 2) return [];
  const result: SeamPhysicalBindingV3[] = [];
  for (let index = 0; index + 1 < instances.length; index += 2) {
    result.push({
      id: `${group.id}:physical:${result.length + 1}`,
      first: [{ patternId, panelInstanceId: instances[index].id }],
      second: [{ patternId, panelInstanceId: instances[index + 1].id }],
    });
  }
  return result;
}

function validatePhysicalBindings(
  group: SeamGroupV3,
  panelInstances: readonly PanelInstanceV3[],
  issues: PatternDocumentValidationIssue[],
): void {
  const instanceById = new Map(panelInstances.map((instance) => [instance.id, instance]));
  const firstPatterns = new Set(group.first.map((range) => range.pieceId));
  const secondPatterns = new Set(group.second.map((range) => range.pieceId));
  const bindings = group.physicalBindings ?? [];
  const ambiguous = [...firstPatterns, ...secondPatterns].some((patternId) =>
    panelInstances.filter((instance) => instance.sourcePatternId === patternId).length > 1,
  );
  if (bindings.length === 0) {
    if (ambiguous) {
      issues.push(issue("ambiguous-physical-binding", "error", `O grupo ${group.id} possui múltiplas cópias físicas sem binding explícito.`, group.id));
    }
    return;
  }
  const bindingIds = new Set<string>();
  for (const binding of bindings) {
    if (bindingIds.has(binding.id)) {
      issues.push(issue("invalid-physical-binding", "error", `O binding ${binding.id} está duplicado.`, group.id));
    }
    bindingIds.add(binding.id);
    const validateSide = (
      refs: readonly { patternId: string; panelInstanceId: string }[],
      patterns: ReadonlySet<string>,
      side: string,
    ) => {
      const covered = new Set<string>();
      for (const ref of refs) {
        const instance = instanceById.get(ref.panelInstanceId);
        if (!instance || instance.sourcePatternId !== ref.patternId || !patterns.has(ref.patternId)) {
          issues.push(issue("invalid-physical-binding", "error", `O binding ${binding.id} possui referência inválida ${ref.patternId}/${ref.panelInstanceId} no ${side}.`, group.id));
        }
        covered.add(ref.patternId);
      }
      for (const patternId of patterns) {
        if (!covered.has(patternId)) {
          issues.push(issue("invalid-physical-binding", "error", `O binding ${binding.id} não cobre ${patternId} no ${side}.`, group.id));
        }
      }
    };
    validateSide(binding.first, firstPatterns, "primeiro lado");
    validateSide(binding.second, secondPatterns, "segundo lado");
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function createWorkspaceState(
  garment: GarmentDraft,
  activePatternId: string | undefined,
  definitions: readonly PatternDefinitionV3[],
): WorkspaceStateV3 {
  const stateById = new Map(
    (garment.workspaceStates ?? []).map((state) => [state.pieceId, state]),
  );
  const transformById = new Map(
    (garment.workspaceTransforms ?? []).map((transform) => [
      transform.pieceId,
      transform,
    ]),
  );
  return {
    ...(activePatternId === undefined ? {} : { activePatternId }),
    patterns: definitions.map((definition) => {
      const state = stateById.get(definition.id);
      const transform = state?.transform ?? transformById.get(definition.id) ?? {
        pieceId: definition.id,
        xMm: 0,
        yMm: 0,
        rotationDeg: 0,
      };
      return {
        patternId: definition.id,
        transform: {
          pieceId: definition.id,
          xMm: transform.xMm,
          yMm: transform.yMm,
          rotationDeg: transform.rotationDeg,
        },
        visible: state?.visible ?? true,
        locked: state?.locked ?? false,
      };
    }),
  };
}

function createArrangementAnchor(
  definition: PatternDefinitionV3,
  copyIndex: number,
  bodySide: PanelInstanceV3["bodySide"],
  surface: NonNullable<PanelInstanceV3["surface"]>,
): PanelArrangementAnchorV3 {
  const placement = definition.bodyPlacement;
  if (!bodySide || !placement.anchorId) {
    throw new Error(`A classificação de ${definition.id} não possui anchor completo.`);
  }
  const bodyAnchorId = pairedBodyAnchorId(placement.anchorId, bodySide);
  const specification = bodyAnchorSpecification(bodyAnchorId);
  return {
    id: `${definition.id}:anchor:${copyIndex + 1}`,
    bodyAnchorId,
    region: placement.region ?? specification.region,
    surface,
    bodySide,
    rotationDeg: placement.rotationZDeg,
    offsetXMm: placement.offsetXMm,
    offsetYMm: placement.offsetYMm,
    offsetZMm: placement.offsetZMm,
    scale: 1,
    orientationDeg: [placement.rotationXDeg, placement.rotationYDeg, placement.rotationZDeg],
    outwardSide: surface === "back" ? "back" : "front",
    source: placement.source,
  };
}

function createArrangementAnchorFromPreview(
  instanceId: string,
  placement: PatternPreviewPlacement,
): PanelArrangementAnchorV3 {
  const specification = placement.bodyAnchorId
    ? bodyAnchorSpecification(placement.bodyAnchorId)
    : undefined;
  return {
    id: `${instanceId}:anchor`,
    ...(placement.bodyAnchorId ? { bodyAnchorId: placement.bodyAnchorId } : {}),
    region: placement.region ?? specification?.region ?? "custom",
    surface: placement.surface ?? specification?.surface ?? "custom",
    bodySide: placement.bodySide ?? specification?.bodySide ?? "center",
    rotationDeg: placement.rotationDeg,
    offsetXMm: placement.offsetXMm,
    offsetYMm: placement.offsetYMm,
    offsetZMm: placement.offsetZMm,
    scale: 1,
    ...(placement.positionMm ? { positionMm: structuredClone(placement.positionMm) } : {}),
    orientationDeg: placement.orientationDeg
      ? structuredClone(placement.orientationDeg)
      : [0, 0, placement.rotationDeg],
    ...(placement.surfaceAttachment
      ? { surfaceAttachment: structuredClone(placement.surfaceAttachment) }
      : {}),
    outwardSide: placement.surface === "back" ? "back" : "front",
    source: "manual",
  };
}

function resolveClassifiedBodySide(
  configured: NonNullable<PatternDefinitionV3["bodyPlacement"]["bodySide"]>,
  definition: PatternDefinitionV3,
  copyIndex: number,
): PanelInstanceV3["bodySide"] {
  if (configured === "paired") {
    return copyIndex % 2 === 0 ? "left" : "right";
  }
  if (configured === "not-applicable") return "center";
  if ((definition.mirrorRule === "paired" || definition.cutQuantity === 2) && configured === "center") {
    return copyIndex % 2 === 0 ? "left" : "right";
  }
  return configured;
}

function resolvePairedAnchorId(
  anchorId: NonNullable<PatternDefinitionV3["bodyPlacement"]["anchorId"]>,
  bodySide: NonNullable<PanelInstanceV3["bodySide"]>,
): NonNullable<PatternDefinitionV3["bodyPlacement"]["anchorId"]> {
  return pairedBodyAnchorId(anchorId, bodySide);
}

function firstAssemblyPlacementForDefinition(
  patternId: string,
  instances: readonly PanelInstanceV3[],
): AssemblyPlacement | undefined {
  const instance = instances
    .filter((candidate) => candidate.sourcePatternId === patternId)
    .sort((left, right) => left.copyIndex - right.copyIndex)[0];
  const anchor = instance?.arrangementAnchor;
  if (!instance || !anchor?.positionMm || !anchor.orientationDeg || !anchor.outwardSide) {
    return undefined;
  }
  return {
    pieceId: patternId,
    role: anchor.legacyAssemblyRole ?? assemblyRoleFromRegion(anchor.region),
    outwardSide: anchor.outwardSide,
    positionMm: structuredClone(anchor.positionMm),
    rotationDeg: structuredClone(anchor.orientationDeg),
    flipped: instance.mirrored,
    source:
      anchor.source === "migration" ? "inferred" : anchor.source,
  };
}

function assemblyRoleFromRegion(
  region: PanelArrangementAnchorV3["region"],
): AssemblyPlacement["role"] {
  switch (region) {
    case "arm":
      return "sleeve";
    case "leg":
      return "leg";
    case "waist":
      return "waist";
    default:
      return "custom";
  }
}

function ensureLegacyRuntimeCompatibility(document: PatternDocumentV3): void {
  // A projeção runtime preserva sequências compostas em firstRanges e
  // secondRanges; quantidades diferentes entre os lados não são mais lossy.
  void document;
}

function parseMetadata(value: unknown): PatternDocumentV3["metadata"] {
  if (!isRecord(value)) throw new TypeError("Os metadados do documento são inválidos.");
  const application =
    value.application === undefined
      ? undefined
      : parseApplicationMetadata(value.application);
  return {
    projectId: readString(value.projectId, "O identificador do projeto"),
    name: readString(value.name, "O nome do projeto"),
    description: readString(value.description, "A descrição do projeto"),
    ...(value.sourceTemplateId === undefined
      ? {}
      : { sourceTemplateId: readString(value.sourceTemplateId, "O template de origem") }),
    ...(value.sourceTemplateVersion === undefined
      ? {}
      : { sourceTemplateVersion: readString(value.sourceTemplateVersion, "A versão do template") }),
    ...(value.createdAt === undefined
      ? {}
      : { createdAt: readIsoDate(value.createdAt, "A data de criação") }),
    ...(value.updatedAt === undefined
      ? {}
      : { updatedAt: readIsoDate(value.updatedAt, "A data de atualização") }),
    ...(application === undefined ? {} : { application }),
  };
}

function parseApplicationMetadata(
  value: unknown,
): NonNullable<PatternDocumentV3["metadata"]["application"]> {
  if (!isRecord(value) || value.name !== "Moldeon") {
    throw new TypeError("Os metadados do aplicativo são inválidos.");
  }
  return {
    name: "Moldeon",
    ...(value.version === undefined
      ? {}
      : { version: readString(value.version, "A versão do aplicativo") }),
  };
}

function parsePatternGeneration(value: unknown): PatternGenerationRecord {
  if (!isRecord(value)) throw new TypeError("O registro de geração paramétrica é inválido.");
  const parsed = parseParametricProjectMetadata({
    schemaVersion: 1,
    variables: [],
    constructionGraph: { version: 1, nodes: [] },
    generations: [value],
  });
  return parsed.generations[0];
}

function parseMeasurementSet(value: unknown): PatternDocumentV3["measurements"] {
  if (!isRecord(value) || !Array.isArray(value.estimatedKeys)) {
    throw new TypeError("O conjunto de medidas é inválido.");
  }
  const garment = parseGarmentDraft({
    id: "measurement-parser",
    templateId: "measurement-parser",
    name: "Medições",
    description: "Validação de medidas",
    bodyType: "feminine",
    measurements: value.values,
    fabrics: undefined,
    pieces: [
      {
        id: "measurement-parser-piece",
        name: "Medições",
        seamAllowanceMm: 0,
        points: [
          { id: "a", xMm: 0, yMm: 0 },
          { id: "b", xMm: 10, yMm: 0 },
          { id: "c", xMm: 0, yMm: 10 },
        ],
      },
    ],
  });
  const profile = value.profile === undefined ? undefined : parseMeasurementProfile(value.profile);
  const parseKeyList = (candidate: unknown, label: string): string[] | undefined =>
    candidate === undefined
      ? undefined
      : Array.isArray(candidate)
        ? candidate.map((item, index) => readString(item, `${label} ${index + 1}`))
        : (() => { throw new TypeError(`${label} é inválida.`); })();
  return {
    id: readString(value.id, "O identificador das medidas"),
    values: profile ? measurementProfileToBodyMeasurements(profile) : garment.measurements,
    estimatedKeys: value.estimatedKeys.map((candidate, index) =>
      readString(candidate, `A medida estimada ${index + 1}`),
    ),
    ...(parseKeyList(value.suppliedKeys, "A medida informada") ? { suppliedKeys: parseKeyList(value.suppliedKeys, "A medida informada") } : {}),
    ...(parseKeyList(value.derivedKeys, "A medida derivada") ? { derivedKeys: parseKeyList(value.derivedKeys, "A medida derivada") } : {}),
    ...(value.formulaSetVersion === undefined ? {} : { formulaSetVersion: readString(value.formulaSetVersion, "A versão das fórmulas de medidas") }),
    ...(profile === undefined ? {} : { profile }),
    ...(value.notes === undefined
      ? {}
      : { notes: readString(value.notes, "As observações das medidas") }),
  };
}

function parseVariables(value: unknown): PatternDocumentV3["variables"] {
  if (!Array.isArray(value)) throw new TypeError("As variáveis do documento são inválidas.");
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) throw new TypeError(`A variável ${index + 1} é inválida.`);
    return {
      id: readString(candidate.id, `O id da variável ${index + 1}`),
      name: readString(candidate.name, `O nome da variável ${index + 1}`),
      expression: readString(candidate.expression, `A expressão da variável ${index + 1}`),
      unit: readEnum(candidate.unit, VARIABLE_UNITS, `A unidade da variável ${index + 1}`),
      ...(candidate.description === undefined
        ? {}
        : { description: readString(candidate.description, `A descrição da variável ${index + 1}`) }),
      ...(candidate.formulaVersion === undefined
        ? {}
        : { formulaVersion: readString(candidate.formulaVersion, `A versão da variável ${index + 1}`) }),
      ...(candidate.dependencies === undefined
        ? {}
        : {
            dependencies: Array.isArray(candidate.dependencies)
              ? candidate.dependencies.map((dependency, dependencyIndex) => readString(dependency, `A dependência ${dependencyIndex + 1} da variável ${index + 1}`))
              : (() => { throw new TypeError(`As dependências da variável ${index + 1} são inválidas.`); })(),
          }),
    };
  });
}

function parseConstructionGraph(value: unknown): PatternDocumentV3["constructionGraph"] {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || !Array.isArray(value.nodes)) {
    throw new TypeError("O grafo de construção é inválido.");
  }
  return {
    version: value.version,
    nodes: value.nodes.map((candidate, index) => {
      if (!isRecord(candidate) || !Array.isArray(candidate.dependencies) || !isRecord(candidate.payload)) {
        throw new TypeError(`O nó de construção ${index + 1} é inválido.`);
      }
      return {
        id: readString(candidate.id, `O id do nó ${index + 1}`),
        kind: readEnum(candidate.kind, CONSTRUCTION_NODE_KINDS, `O tipo do nó ${index + 1}`),
        dependencies: candidate.dependencies.map((dependency, dependencyIndex) =>
          readString(dependency, `A dependência ${dependencyIndex + 1} do nó ${index + 1}`),
        ),
        payload: structuredClone(candidate.payload),
      };
    }),
  };
}

function parsePatternDefinitions(value: unknown): PatternDefinitionV3[] {
  if (!Array.isArray(value)) {
    throw new TypeError("As definições de molde do documento são inválidas.");
  }
  return value.map(parsePatternDefinition);
}

function parsePatternDefinition(value: unknown, index: number): PatternDefinitionV3 {
  if (!isRecord(value) || !isRecord(value.geometry)) {
    throw new TypeError(`A definição ${index + 1} é inválida.`);
  }
  const geometry = value.geometry;
  if (geometry.geometryVersion !== 2) {
    throw new TypeError(`A geometria da definição ${index + 1} precisa usar a versão 2.`);
  }
  const connectors = parseConnectors(value.connectors, index);
  const piece = parsePatternPiece({
    id: value.id,
    name: value.name,
    seamAllowanceMm: value.seamAllowanceMm,
    cutQuantity: value.cutQuantity,
    cutOnFold: value.cutOnFold,
    fabricId: value.fabricId,
    edgeFinishes: value.edgeFinishes,
    points: geometry.points,
    formatVersion: 2,
    nodes: geometry.nodes,
    segments: geometry.segments,
    contours: geometry.contours,
    internalLines: value.internalLines,
    darts: value.darts,
    grainline: value.grainline,
    annotations: value.annotations,
    guides: value.guides,
  });
  if (!piece.nodes || !piece.segments || !piece.contours) {
    throw new TypeError(`A definição ${piece.id} não possui topologia V2 completa.`);
  }
  return {
    id: piece.id,
    name: piece.name,
    ...(value.sourceTemplateId === undefined
      ? {}
      : { sourceTemplateId: readString(value.sourceTemplateId, "O template da definição") }),
    ...(value.sourceTemplateVersion === undefined
      ? {}
      : { sourceTemplateVersion: readString(value.sourceTemplateVersion, "A versão do template da definição") }),
    semanticRole: readEnum(value.semanticRole, SEMANTIC_ROLES, "O papel semântico da definição"),
    bodyPlacement: parseBodyPlacementV3(value.bodyPlacement),
    geometry: {
      geometryVersion: 2,
      points: structuredClone(piece.points),
      nodes: structuredClone(piece.nodes),
      segments: structuredClone(piece.segments),
      contours: structuredClone(piece.contours),
    },
    internalLines: structuredClone(piece.internalLines ?? []),
    darts: structuredClone(piece.darts ?? []),
    ...(piece.grainline === undefined ? {} : { grainline: structuredClone(piece.grainline) }),
    annotations: structuredClone(piece.annotations ?? []),
    guides: structuredClone(piece.guides ?? []),
    seamAllowanceMm: piece.seamAllowanceMm,
    edgeFinishes: structuredClone(piece.edgeFinishes ?? {}),
    cutQuantity: piece.cutQuantity ?? 1,
    cutOnFold: piece.cutOnFold === true,
    mirrorRule: readEnum(value.mirrorRule, MIRROR_RULES, "A regra de espelhamento"),
    fabricId: readString(value.fabricId, "O tecido da definição"),
    connectors,
    ...(value.generation === undefined ? {} : { generation: parsePatternGeneration(value.generation) }),
  };
}

function parseBodyPlacementV3(value: unknown): PatternBodyPlacementV3 {
  if (value === undefined) {
    return {
      version: 1,
      status: "unclassified",
      includeIn3D: true,
      outwardFace: "normal",
      offsetXMm: 0,
      offsetYMm: 0,
      offsetZMm: 25,
      rotationXDeg: 0,
      rotationYDeg: 0,
      rotationZDeg: 0,
      source: "migration",
    };
  }
  if (!isRecord(value)) throw new TypeError("A classificação corporal da definição é inválida.");
  const optionalEnum = <T extends string>(raw: unknown, values: readonly T[], label: string): T | undefined =>
    raw === undefined ? undefined : readEnum(raw, values, label);
  const role = optionalEnum(value.role, ["front", "back", "sleeve", "waistband", "leg-front", "leg-back", "collar", "panel", "custom"] as const, "A função corporal");
  const region = optionalEnum(value.region, PREVIEW_REGIONS, "A região corporal");
  const surface = optionalEnum(value.surface, PREVIEW_SURFACES, "A superfície corporal");
  const bodySide = optionalEnum(value.bodySide, ["center", "left", "right", "paired", "not-applicable"] as const, "O lado corporal");
  const anchorId = optionalEnum(value.anchorId, ["torso-front", "torso-back", "shoulder-left", "shoulder-right", "arm-left", "arm-right", "waist-front", "waist-back", "hip-front", "hip-back", "hip-left", "hip-right", "leg-left", "leg-right", "neck"] as const, "O anchor corporal");
  return {
    version: 1,
    status: readEnum(value.status ?? "unclassified", ["unclassified", "confirmed"] as const, "O estado da classificação corporal"),
    includeIn3D: value.includeIn3D === undefined ? true : readBoolean(value.includeIn3D, "A inclusão da peça no 3D"),
    ...(role === undefined ? {} : { role }),
    ...(region === undefined ? {} : { region }),
    ...(surface === undefined ? {} : { surface }),
    ...(bodySide === undefined ? {} : { bodySide }),
    ...(anchorId === undefined ? {} : { anchorId }),
    outwardFace: readEnum(value.outwardFace ?? "normal", ["normal", "flipped"] as const, "A face externa"),
    offsetXMm: readFiniteNumber(value.offsetXMm ?? 0, "O deslocamento lateral"),
    offsetYMm: readFiniteNumber(value.offsetYMm ?? 0, "O deslocamento vertical"),
    offsetZMm: readFiniteNumber(value.offsetZMm ?? 25, "O afastamento da superfície"),
    rotationXDeg: readFiniteNumber(value.rotationXDeg ?? 0, "A rotação X"),
    rotationYDeg: readFiniteNumber(value.rotationYDeg ?? 0, "A rotação Y"),
    rotationZDeg: readFiniteNumber(value.rotationZDeg ?? 0, "A rotação Z"),
    source: readEnum(value.source ?? "migration", ["manual", "migration"] as const, "A origem da classificação corporal"),
  };
}

function parseConnectors(value: unknown, definitionIndex: number): PatternConnectorV3[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Os conectores da definição ${definitionIndex + 1} são inválidos.`);
  }
  return value.map((candidate, index) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.ranges) || !Array.isArray(candidate.landmarks)) {
      throw new TypeError(`O conector ${index + 1} é inválido.`);
    }
    return {
      id: readString(candidate.id, `O id do conector ${index + 1}`),
      role: readEnum(candidate.role, CONNECTOR_ROLES, `O papel do conector ${index + 1}`),
      ranges: candidate.ranges.map((range, rangeIndex) =>
        parseEdgeRange(range, `O intervalo ${rangeIndex + 1} do conector ${index + 1}`),
      ),
      landmarks: candidate.landmarks.map((landmark, landmarkIndex) => {
        if (!isRecord(landmark)) throw new TypeError(`O landmark ${landmarkIndex + 1} é inválido.`);
        return {
          id: readString(landmark.id, `O id do landmark ${landmarkIndex + 1}`),
          kind: readEnum(
            landmark.kind,
            ["start", "end", "notch", "apex", "balance", "custom"] as const,
            `O tipo do landmark ${landmarkIndex + 1}`,
          ),
          rangeIndex: readNonNegativeInteger(landmark.rangeIndex, `O intervalo do landmark ${landmarkIndex + 1}`),
          t: readUnitInterval(landmark.t, `O parâmetro do landmark ${landmarkIndex + 1}`),
          ...(landmark.label === undefined
            ? {}
            : { label: readString(landmark.label, `O nome do landmark ${landmarkIndex + 1}`) }),
        };
      }),
      direction: readEnum(candidate.direction, ["forward", "reverse"] as const, `A direção do conector ${index + 1}`),
      ...(candidate.metadata === undefined
        ? {}
        : { metadata: parsePrimitiveRecord(candidate.metadata, `Os metadados do conector ${index + 1}`) }),
    };
  });
}

function parsePanelInstances(value: unknown): PanelInstanceV3[] {
  if (!Array.isArray(value)) throw new TypeError("As instâncias físicas são inválidas.");
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new TypeError(`A instância ${index + 1} é inválida.`);
    }
    const anchor = candidate.arrangementAnchor === undefined
      ? undefined
      : isRecord(candidate.arrangementAnchor)
        ? parseArrangementAnchor(candidate.arrangementAnchor, index)
        : (() => { throw new TypeError(`O anchor da instância ${index + 1} é inválido.`); })();
    const placementStatus = candidate.placementStatus === undefined
      ? (anchor?.source === "manual" || anchor?.source === "template") && anchor.bodyAnchorId ? "confirmed" : "unclassified"
      : readEnum(candidate.placementStatus, ["unclassified", "confirmed"] as const, `O estado da instância ${index + 1}`);
    return {
      id: readString(candidate.id, `O id da instância ${index + 1}`),
      sourcePatternId: readString(candidate.sourcePatternId, `O molde da instância ${index + 1}`),
      copyIndex: readNonNegativeInteger(candidate.copyIndex, `O índice da instância ${index + 1}`),
      placementStatus,
      ...(candidate.bodySide === undefined ? {} : { bodySide: readEnum(candidate.bodySide, BODY_SIDES, `O lado da instância ${index + 1}`) }),
      ...(candidate.surface === undefined ? {} : { surface: readEnum(candidate.surface, PREVIEW_SURFACES, `A superfície da instância ${index + 1}`) }),
      mirrored: readBoolean(candidate.mirrored, `O espelhamento da instância ${index + 1}`),
      fabricId: readString(candidate.fabricId, `O tecido da instância ${index + 1}`),
      ...(anchor === undefined ? {} : { arrangementAnchor: anchor }),
      includedIn3D: candidate.includedIn3D === undefined ? true : readBoolean(candidate.includedIn3D, `A inclusão da instância ${index + 1}`),
      simulationEnabled: readBoolean(candidate.simulationEnabled, `A simulação da instância ${index + 1}`),
      metadata: parsePrimitiveRecord(candidate.metadata, `Os metadados da instância ${index + 1}`),
    };
  });
}

function parseArrangementAnchor(value: Record<string, unknown>, index: number): PanelArrangementAnchorV3 {
  const positionMm = parseOptionalTuple(value.positionMm, `A posição do anchor ${index + 1}`);
  const orientationDeg = parseOptionalTuple(value.orientationDeg, `A orientação do anchor ${index + 1}`);
  const surfaceAttachment = value.surfaceAttachment === undefined
    ? undefined
    : parsePanelSurfaceAttachment(value.surfaceAttachment, index);
  const outwardSide =
    value.outwardSide === undefined
      ? undefined
      : readEnum(value.outwardSide, ["front", "back"] as const, `O lado externo do anchor ${index + 1}`);
  const legacyAssemblyRole =
    value.legacyAssemblyRole === undefined
      ? undefined
      : readEnum(
          value.legacyAssemblyRole,
          ["front", "back", "sleeve", "waist", "leg", "collar", "custom"] as const,
          `O papel legado do anchor ${index + 1}`,
        );
  const region = readEnum(value.region, PREVIEW_REGIONS, `A região do anchor ${index + 1}`);
  const surface = readEnum(value.surface, PREVIEW_SURFACES, `A superfície do anchor ${index + 1}`);
  const bodySide = readEnum(value.bodySide, BODY_SIDES, `O lado corporal do anchor ${index + 1}`);
  const inferredAnchorId = anchorIdForPlacement(region, surface, bodySide);
  return {
    id: readString(value.id, `O id do anchor ${index + 1}`),
    ...(value.bodyAnchorId === undefined && inferredAnchorId === undefined
      ? {}
      : { bodyAnchorId: value.bodyAnchorId === undefined
        ? inferredAnchorId!
        : readEnum(value.bodyAnchorId, ["torso-front", "torso-back", "shoulder-left", "shoulder-right", "arm-left", "arm-right", "waist-front", "waist-back", "hip-front", "hip-back", "hip-left", "hip-right", "leg-left", "leg-right", "neck"] as const, `O anchor corporal ${index + 1}`) }),
    region,
    surface,
    bodySide,
    rotationDeg: readFiniteNumber(value.rotationDeg, `A rotação do anchor ${index + 1}`),
    offsetXMm: readFiniteNumber(value.offsetXMm, `O deslocamento X do anchor ${index + 1}`),
    offsetYMm: readFiniteNumber(value.offsetYMm, `O deslocamento Y do anchor ${index + 1}`),
    offsetZMm: readFiniteNumber(value.offsetZMm, `O deslocamento Z do anchor ${index + 1}`),
    scale: readPositiveNumber(value.scale, `A escala do anchor ${index + 1}`),
    ...(positionMm === undefined ? {} : { positionMm }),
    ...(orientationDeg === undefined ? {} : { orientationDeg }),
    ...(surfaceAttachment === undefined ? {} : { surfaceAttachment }),
    ...(outwardSide === undefined ? {} : { outwardSide }),
    source: readEnum(value.source, ["template", "inferred", "manual", "migration"] as const, `A origem do anchor ${index + 1}`),
    ...(value.legacyPreviewPlacementId === undefined
      ? {}
      : { legacyPreviewPlacementId: readString(value.legacyPreviewPlacementId, `O placement legado do anchor ${index + 1}`) }),
    ...(legacyAssemblyRole === undefined ? {} : { legacyAssemblyRole }),
  };
}

function parsePanelSurfaceAttachment(
  value: unknown,
  index: number,
): NonNullable<PanelArrangementAnchorV3["surfaceAttachment"]> {
  if (!isRecord(value)) throw new TypeError(`O attachment de superfície ${index + 1} é inválido.`);
  const barycentric = parseOptionalTuple(
    value.barycentric,
    `As coordenadas baricêntricas do attachment ${index + 1}`,
  );
  if (!barycentric) throw new TypeError(`O attachment de superfície ${index + 1} não possui coordenadas baricêntricas.`);
  if (barycentric.some((coordinate) => coordinate < -1e-9)) {
    throw new TypeError(`As coordenadas baricêntricas do attachment ${index + 1} não podem ser negativas.`);
  }
  const sum = barycentric[0] + barycentric[1] + barycentric[2];
  if (Math.abs(sum - 1) > 1e-6) {
    throw new TypeError(`As coordenadas baricêntricas do attachment ${index + 1} precisam somar 1.`);
  }
  return {
    version: readEnum(value.version, [1] as const, `A versão do attachment ${index + 1}`),
    topologySignature: readString(value.topologySignature, `A topologia do attachment ${index + 1}`),
    triangleIndex: readNonNegativeInteger(value.triangleIndex, `O triângulo do attachment ${index + 1}`),
    barycentric,
    normalOffsetMm: readFiniteNumber(value.normalOffsetMm, `O afastamento normal do attachment ${index + 1}`),
  };
}

function parseSeamGroups(value: unknown): SeamGroupV3[] {
  if (!Array.isArray(value)) throw new TypeError("Os grupos de costura são inválidos.");
  return value.map((candidate, index) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.first) || !Array.isArray(candidate.second)) {
      throw new TypeError(`O grupo de costura ${index + 1} é inválido.`);
    }
    const compatibility =
      candidate.compatibility === undefined
        ? undefined
        : parseSeamCompatibility(candidate.compatibility, index);
    return {
      id: readString(candidate.id, `O id da costura ${index + 1}`),
      name: readString(candidate.name, `O nome da costura ${index + 1}`),
      first: candidate.first.map((range, rangeIndex) =>
        parseEdgeRange(range, `O primeiro lado ${rangeIndex + 1} da costura ${index + 1}`),
      ),
      second: candidate.second.map((range, rangeIndex) =>
        parseEdgeRange(range, `O segundo lado ${rangeIndex + 1} da costura ${index + 1}`),
      ),
      direction: readEnum(candidate.direction, ["same", "opposite"] as const, `A direção da costura ${index + 1}`),
      treatment: readEnum(candidate.treatment, SEAM_TREATMENTS, `O tratamento da costura ${index + 1}`),
      distribution: readEnum(candidate.distribution, SEAM_DISTRIBUTIONS, `A distribuição da costura ${index + 1}`),
      targetRatio: readPositiveNumber(candidate.targetRatio, `A proporção da costura ${index + 1}`),
      slackMm: readNonNegativeNumber(candidate.slackMm, `A folga da costura ${index + 1}`),
      ...(candidate.physicalBindings === undefined ? {} : {
        physicalBindings: parsePhysicalBindings(candidate.physicalBindings, index),
      }),
      ...(candidate.physicalPairing === undefined ? {} : {
        physicalPairing: readEnum(candidate.physicalPairing, ["paired-copies"] as const, `O pareamento físico legado da costura ${index + 1}`),
      }),
      active: readBoolean(candidate.active, `O estado da costura ${index + 1}`),
      ...(compatibility === undefined ? {} : { compatibility }),
    };
  });
}

function parsePhysicalBindings(value: unknown, seamIndex: number): SeamPhysicalBindingV3[] {
  if (!Array.isArray(value)) throw new TypeError(`As vinculações físicas da costura ${seamIndex + 1} são inválidas.`);
  return value.map((binding, bindingIndex) => {
    if (!isRecord(binding) || !Array.isArray(binding.first) || !Array.isArray(binding.second)) {
      throw new TypeError(`A vinculação física ${bindingIndex + 1} da costura ${seamIndex + 1} é inválida.`);
    }
    const parseSide = (entries: unknown[], side: string) => entries.map((entry, entryIndex) => {
      if (!isRecord(entry)) throw new TypeError(`A referência ${entryIndex + 1} do ${side} é inválida.`);
      return {
        patternId: readString(entry.patternId, `O molde da referência física ${entryIndex + 1}`),
        panelInstanceId: readString(entry.panelInstanceId, `A instância da referência física ${entryIndex + 1}`),
      };
    });
    return {
      id: readString(binding.id, `O id da vinculação física ${bindingIndex + 1}`),
      first: parseSide(binding.first, "primeiro lado"),
      second: parseSide(binding.second, "segundo lado"),
    };
  });
}

function parseSeamCompatibility(value: unknown, index: number): NonNullable<SeamGroupV3["compatibility"]> {
  if (!isRecord(value)) throw new TypeError(`A compatibilidade da costura ${index + 1} é inválida.`);
  return {
    ...(value.legacyEaseRatio === undefined
      ? {}
      : { legacyEaseRatio: readNonNegativeNumber(value.legacyEaseRatio, `O ease legado da costura ${index + 1}`) }),
    ...(value.legacyType === undefined
      ? {}
      : { legacyType: readString(value.legacyType, `O tipo legado da costura ${index + 1}`) }),
    ...(value.legacyTreatment === undefined
      ? {}
      : { legacyTreatment: readString(value.legacyTreatment, `O tratamento legado da costura ${index + 1}`) }),
  };
}

function parseBody(value: unknown): PatternDocumentV3["body"] {
  if (!isRecord(value)) throw new TypeError("A definição corporal é inválida.");
  return {
    type: readEnum(value.type, BODY_TYPES, "O tipo corporal"),
    measurementSetId: readString(value.measurementSetId, "O conjunto de medidas do corpo"),
    metadata: parsePrimitiveRecord(value.metadata, "Os metadados do corpo"),
  };
}

function parseWorkspace(value: unknown): WorkspaceStateV3 {
  if (!isRecord(value) || !Array.isArray(value.patterns)) {
    throw new TypeError("O estado da bancada é inválido.");
  }
  return {
    ...(value.activePatternId === undefined
      ? {}
      : { activePatternId: readString(value.activePatternId, "O molde ativo") }),
    patterns: value.patterns.map((candidate, index) => {
      if (!isRecord(candidate) || !isRecord(candidate.transform)) {
        throw new TypeError(`O estado de bancada ${index + 1} é inválido.`);
      }
      const patternId = readString(candidate.patternId, `O molde do estado ${index + 1}`);
      return {
        patternId,
        transform: {
          pieceId: patternId,
          xMm: readFiniteNumber(candidate.transform.xMm, `O X do estado ${index + 1}`),
          yMm: readFiniteNumber(candidate.transform.yMm, `O Y do estado ${index + 1}`),
          rotationDeg: readFiniteNumber(candidate.transform.rotationDeg, `A rotação do estado ${index + 1}`),
        },
        visible: readBoolean(candidate.visible, `A visibilidade do estado ${index + 1}`),
        locked: readBoolean(candidate.locked, `O bloqueio do estado ${index + 1}`),
      };
    }),
  };
}

function parseGarmentSettings(value: unknown): PatternDocumentV3["garmentSettings"] {
  if (!isRecord(value)) throw new TypeError("As configurações da roupa são inválidas.");
  const dressing = value.dressing === undefined
    ? undefined
    : (() => {
        if (!isRecord(value.dressing)) throw new TypeError("A configuração de prova da roupa é inválida.");
        const region = value.dressing.region === undefined
          ? undefined
          : readEnum(value.dressing.region, ["upper", "lower", "full", "arm", "neck", "custom"] as const, "A região de prova da roupa");
        const frontReferencePieceId = value.dressing.frontReferencePieceId === undefined
          ? undefined
          : readString(value.dressing.frontReferencePieceId, "A peça de referência frontal");
        return {
          ...(region === undefined ? {} : { region }),
          ...(frontReferencePieceId === undefined ? {} : { frontReferencePieceId }),
        };
      })();
  if (value.ease === undefined) return dressing === undefined ? {} : { dressing };
  if (!isRecord(value.ease)) throw new TypeError("As folgas da roupa são inválidas.");
  return {
    ease: {
      bustMm: readFiniteNumber(value.ease.bustMm, "A folga de busto"),
      waistMm: readFiniteNumber(value.ease.waistMm, "A folga de cintura"),
      hipMm: readFiniteNumber(value.ease.hipMm, "A folga de quadril"),
      sleeveMm: readFiniteNumber(value.ease.sleeveMm, "A folga de manga"),
    },
    ...(dressing === undefined ? {} : { dressing }),
  };
}

function parseSimulationSettings(value: unknown): PatternDocumentV3["simulationSettings"] {
  if (!isRecord(value) || !Array.isArray(value.gravityMmS2) || value.gravityMmS2.length !== 3) {
    throw new TypeError("As configurações de simulação são inválidas.");
  }
  return {
    enabled: readBoolean(value.enabled, "O estado da simulação"),
    quality: readEnum(value.quality, SIMULATION_QUALITIES, "A qualidade da simulação"),
    gravityMmS2: value.gravityMmS2.map((component, index) =>
      readFiniteNumber(component, `A gravidade ${index + 1}`),
    ) as [number, number, number],
    substeps: readPositiveInteger(value.substeps, "Os subpassos da simulação"),
    iterations: readPositiveInteger(value.iterations, "As iterações da simulação"),
    selfCollision: readBoolean(value.selfCollision, "A autocolisão"),
  };
}

function defaultSimulationSettings(): PatternDocumentV3["simulationSettings"] {
  return {
    enabled: false,
    quality: "draft",
    gravityMmS2: [0, -9810, 0],
    substeps: 2,
    iterations: 5,
    selfCollision: false,
  };
}

function parseEdgeRange(value: unknown, label: string) {
  if (!isRecord(value)) throw new TypeError(`${label} é inválido.`);
  return {
    pieceId: readString(value.pieceId, `${label}: molde`),
    edgeId: readString(value.edgeId, `${label}: borda`),
    startT: readUnitInterval(value.startT, `${label}: início`),
    endT: readUnitInterval(value.endT, `${label}: fim`),
  };
}

function validateRange(
  range: { pieceId: string; edgeId: string; startT: number; endT: number },
  entityId: string,
  patternIds: Set<string>,
  edgeIdsByPattern: Map<string, Set<string>>,
  issues: PatternDocumentValidationIssue[],
): void {
  if (!patternIds.has(range.pieceId)) {
    issues.push(issue("missing-pattern", "error", `A referência ${entityId} aponta para o molde inexistente ${range.pieceId}.`, entityId));
    return;
  }
  if (!edgeIdsByPattern.get(range.pieceId)?.has(range.edgeId)) {
    issues.push(issue("missing-edge", "error", `A referência ${entityId} aponta para a borda inexistente ${range.edgeId}.`, entityId));
  }
  if (
    !Number.isFinite(range.startT) ||
    !Number.isFinite(range.endT) ||
    range.startT < 0 ||
    range.endT > 1 ||
    range.startT > range.endT
  ) {
    issues.push(issue("invalid-range", "error", `A referência ${entityId} possui intervalo inválido.`, entityId));
  } else if (range.endT - range.startT <= 1e-9) {
    issues.push(issue("empty-range", "error", `A referência ${entityId} possui intervalo vazio.`, entityId));
  }
}

function collectUniqueIds(
  ids: readonly string[],
  label: string,
  issues: PatternDocumentValidationIssue[],
): Set<string> {
  const unique = new Set<string>();
  for (const id of ids) {
    if (unique.has(id)) {
      issues.push(issue("duplicate-id", "error", `O id ${id} de ${label} está duplicado.`, id));
    }
    unique.add(id);
  }
  return unique;
}

function issue(
  code: PatternDocumentValidationIssue["code"],
  severity: PatternDocumentIssueSeverity,
  message: string,
  entityId?: string,
): PatternDocumentValidationIssue {
  return { code, severity, message, ...(entityId === undefined ? {} : { entityId }) };
}

function seamGroupSignature(group: SeamGroupV3): string {
  const first = group.first.map(rangeSignature).join("|");
  const second = group.second.map(rangeSignature).join("|");
  return [first, second].sort().join("<=>");
}

function rangeSignature(range: SeamGroupV3["first"][number]): string {
  return `${range.pieceId}:${range.edgeId}:${range.startT}:${range.endT}`;
}

function parseOptionalTuple(
  value: unknown,
  label: string,
): [number, number, number] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${label} precisa ter três números.`);
  }
  return value.map((candidate, index) =>
    readFiniteNumber(candidate, `${label}[${index}]`),
  ) as [number, number, number];
}

function parsePrimitiveRecord(
  value: unknown,
  label: string,
): Record<string, string | number | boolean> {
  if (!isRecord(value)) throw new TypeError(`${label} precisa ser um objeto.`);
  const result: Record<string, string | number | boolean> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (
      typeof candidate !== "string" &&
      typeof candidate !== "number" &&
      typeof candidate !== "boolean"
    ) {
      throw new TypeError(`${label}: ${key} precisa ser primitivo.`);
    }
    if (typeof candidate === "number" && !Number.isFinite(candidate)) {
      throw new TypeError(`${label}: ${key} precisa ser finito.`);
    }
    result[key] = candidate;
  }
  return result;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} precisa ser um texto não vazio.`);
  }
  return value;
}

function readIsoDate(value: unknown, label: string): string {
  const date = readString(value, label);
  if (!Number.isFinite(Date.parse(date))) {
    throw new TypeError(`${label} precisa estar em formato ISO válido.`);
  }
  return date;
}

function readFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} precisa ser um número finito.`);
  }
  return value;
}

function readPositiveNumber(value: unknown, label: string): number {
  const parsed = readFiniteNumber(value, label);
  if (parsed <= 0) throw new TypeError(`${label} precisa ser maior que zero.`);
  return parsed;
}

function readNonNegativeNumber(value: unknown, label: string): number {
  const parsed = readFiniteNumber(value, label);
  if (parsed < 0) throw new TypeError(`${label} não pode ser negativo.`);
  return parsed;
}

function readPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new TypeError(`${label} precisa ser um inteiro positivo.`);
  }
  return value;
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} precisa ser um inteiro não negativo.`);
  }
  return value;
}

function readUnitInterval(value: unknown, label: string): number {
  const parsed = readFiniteNumber(value, label);
  if (parsed < 0 || parsed > 1) {
    throw new TypeError(`${label} precisa estar entre zero e um.`);
  }
  return parsed;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} precisa ser verdadeiro ou falso.`);
  }
  return value;
}

function readEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${label} é inválido.`);
  }
  return value as T[number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
