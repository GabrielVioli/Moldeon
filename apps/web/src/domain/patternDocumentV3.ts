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
  type AssemblyPlacement,
  type GarmentDraft,
  type PatternPiece,
  type PatternPreviewPlacement,
  type SegmentRole,
} from "./pattern";
import {
  PATTERN_DOCUMENT_FORMAT_VERSION,
  PATTERN_DOCUMENT_UNITS,
  type ConnectorRoleV3,
  type PanelArrangementAnchorV3,
  type PanelInstanceV3,
  type PatternConnectorV3,
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
  type SeamTreatmentV3,
  type WorkspaceStateV3,
} from "./patternDocumentV3.types";

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
const PREVIEW_REGIONS = ["torso", "waist", "hip", "arm", "leg"] as const;
const PREVIEW_SURFACES = ["front", "back", "side"] as const;
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
  });
}

export function garmentDraftToPatternDocumentV3(
  garmentValue: GarmentDraft,
  options: {
    activePatternId?: string;
    warnings?: PatternDocumentMigrationWarning[];
  } = {},
): PatternDocumentV3 {
  const garment = parseGarmentDraft(garmentValue);
  const warnings = options.warnings ?? [];
  const patternDefinitions = garment.pieces.map((piece) =>
    patternPieceToDefinition(piece, garment, warnings),
  );
  const panelInstances = derivePanelInstances(patternDefinitions, garment);
  const seamGroups = legacySeamsToGroups(garment.seams ?? []);
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
      firstAssemblyPlacementForDefinition(definition.id, document.panelInstances),
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
  });
}

export function derivePanelInstances(
  definitions: readonly PatternDefinitionV3[],
  garment?: Pick<GarmentDraft, "pieces" | "assemblyPlacements">,
): PanelInstanceV3[] {
  const assemblyByPattern = new Map(
    (garment?.assemblyPlacements ?? []).map((placement) => [
      placement.pieceId,
      placement,
    ]),
  );
  const pieceById = new Map((garment?.pieces ?? []).map((piece) => [piece.id, piece]));
  const result: PanelInstanceV3[] = [];

  for (const definition of definitions) {
    const legacyPiece = pieceById.get(definition.id);
    const previewPlacements = legacyPiece?.previewPlacements ?? [];
    const assemblyPlacement = assemblyByPattern.get(definition.id);
    for (let copyIndex = 0; copyIndex < definition.cutQuantity; copyIndex += 1) {
      const preview = previewPlacements[copyIndex] ?? previewPlacements[0];
      const bodySide = resolveBodySide(preview, definition, copyIndex);
      const surface = preview?.surface ?? resolveSurface(assemblyPlacement);
      const mirrored =
        preview?.mirrorX ??
        assemblyPlacement?.flipped ??
        (definition.mirrorRule === "paired" && copyIndex % 2 === 1);
      const anchor = createArrangementAnchor(
        definition,
        copyIndex,
        bodySide,
        surface,
        preview,
        assemblyPlacement,
      );
      result.push({
        id: createPanelInstanceId(definition.id, copyIndex),
        sourcePatternId: definition.id,
        copyIndex,
        bodySide,
        surface,
        mirrored,
        fabricId: definition.fabricId,
        arrangementAnchor: anchor,
        simulationEnabled: true,
        metadata: {},
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
    if (instance.arrangementAnchor.bodySide !== instance.bodySide) {
      issues.push(issue("invalid-panel-instance", "error", `A instância ${instance.id} diverge do lado corporal do anchor.`, instance.id));
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
    if (rangesListsEqual(group.first, group.second)) {
      issues.push(issue("degenerate-self-seam", "error", `O grupo ${group.id} costura exatamente os mesmos intervalos.`, group.id));
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
    .filter((instance) => instance.sourcePatternId === definition.id)
    .sort((left, right) => left.copyIndex - right.copyIndex)
    .map((instance): PatternPreviewPlacement => ({
      id:
        instance.arrangementAnchor.legacyPreviewPlacementId ??
        `${instance.id}:preview`,
      pieceId: definition.id,
      region: instance.arrangementAnchor.region,
      surface: instance.arrangementAnchor.surface,
      bodySide: instance.bodySide,
      rotationDeg: instance.arrangementAnchor.rotationDeg,
      offsetXMm: instance.arrangementAnchor.offsetXMm,
      offsetYMm: instance.arrangementAnchor.offsetYMm,
      offsetZMm: instance.arrangementAnchor.offsetZMm,
      scale: instance.arrangementAnchor.scale,
      mirrorX: instance.mirrored,
    }));

  return parsePatternPiece({
    id: definition.id,
    name: definition.name,
    seamAllowanceMm: definition.seamAllowanceMm,
    cutQuantity: definition.cutQuantity,
    cutOnFold: definition.cutOnFold,
    fabricId: definition.fabricId,
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
  for (const segment of piece.segments ?? []) {
    const role = CONNECTOR_ROLE_BY_SEGMENT_ROLE[segment.role];
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
    landmarks: [],
    direction: "forward",
  }));
}

function inferSemanticRole(
  pieceId: string,
  garment: GarmentDraft,
): PatternSemanticRoleV3 {
  const placement = garment.assemblyPlacements?.find(
    (candidate) => candidate.pieceId === pieceId,
  );
  if (!placement) return "custom";
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

function mirrorRuleForPiece(piece: PatternPiece): PatternMirrorRuleV3 {
  if (piece.cutOnFold) return "cut-on-fold";
  if ((piece.cutQuantity ?? 1) > 1) return "paired";
  return "none";
}

function legacySeamsToGroups(seams: NonNullable<GarmentDraft["seams"]>): SeamGroupV3[] {
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
    return {
      ...base,
      id: groupId,
      name: first.name ?? groupId,
      first: parts.map((part) => structuredClone(part.first)),
      second: parts.map((part) => structuredClone(part.second)),
      active: parts.every((part) => part.active !== false),
    };
  });
}

function groupToLegacySeams(group: SeamGroupV3): NonNullable<GarmentDraft["seams"]> {
  if (group.first.length !== group.second.length) {
    throw new PatternDocumentCompatibilityError("A costura " + group.id + " possui múltiplos intervalos com quantidades diferentes entre os lados.", group.id);
  }
  return group.first.map((first, index) => ({
    id: group.first.length === 1 ? group.id : group.id + ":part:" + (index + 1),
    groupId: group.id,
    name: group.name,
    first: structuredClone(first),
    second: structuredClone(group.second[index]),
    direction: group.direction,
    easeRatio: group.compatibility?.legacyEaseRatio ?? Math.abs(group.targetRatio - 1),
    type: group.compatibility?.legacyType ?? group.treatment,
    treatment: legacyTreatment(group),
    active: group.active,
  }));
}

function legacySeamToGroup(seam: NonNullable<GarmentDraft["seams"]>[number]): SeamGroupV3 {
  const treatment = legacyTreatmentToV3(seam.treatment, seam.type);
  return {
    id: seam.id,
    name: seam.name ?? seam.id,
    first: [structuredClone(seam.first)],
    second: [structuredClone(seam.second)],
    direction: seam.direction,
    treatment,
    distribution: treatment === "ease" || treatment === "gather" ? "proportional" : "uniform",
    targetRatio: Math.max(0.000001, 1 + seam.easeRatio),
    slackMm: 0,
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
  surface: PanelInstanceV3["surface"],
  preview: PatternPreviewPlacement | undefined,
  assembly: AssemblyPlacement | undefined,
): PanelArrangementAnchorV3 {
  return {
    id: `${definition.id}:anchor:${copyIndex + 1}`,
    region: preview?.region ?? regionFromSemanticRole(definition.semanticRole),
    surface,
    bodySide,
    rotationDeg: preview?.rotationDeg ?? 0,
    offsetXMm: preview?.offsetXMm ?? 0,
    offsetYMm: preview?.offsetYMm ?? 0,
    offsetZMm: preview?.offsetZMm ?? 25,
    scale: preview?.scale ?? 1,
    ...(assembly === undefined
      ? {}
      : {
          positionMm: structuredClone(assembly.positionMm),
          orientationDeg: structuredClone(assembly.rotationDeg),
          outwardSide: assembly.outwardSide,
          legacyAssemblyRole: assembly.role,
        }),
    source: assembly?.source ?? "migration",
    ...(preview?.id === undefined
      ? {}
      : { legacyPreviewPlacementId: preview.id }),
  };
}

function resolveBodySide(
  preview: PatternPreviewPlacement | undefined,
  definition: PatternDefinitionV3,
  copyIndex: number,
): PanelInstanceV3["bodySide"] {
  if (preview?.bodySide && preview.bodySide !== "center") return preview.bodySide;
  if (definition.cutQuantity === 2 || definition.mirrorRule === "paired") {
    return copyIndex % 2 === 0 ? "left" : "right";
  }
  return preview?.bodySide ?? "center";
}

function resolveSurface(
  assembly: AssemblyPlacement | undefined,
): PanelInstanceV3["surface"] {
  if (!assembly) return "front";
  return assembly.outwardSide;
}

function regionFromSemanticRole(
  role: PatternSemanticRoleV3,
): PanelArrangementAnchorV3["region"] {
  switch (role) {
    case "sleeve":
      return "arm";
    case "leg-front":
    case "leg-back":
      return "leg";
    case "waistband":
      return "waist";
    default:
      return "torso";
  }
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
  for (const group of document.seamGroups) {
    if (group.first.length !== group.second.length) {
      throw new PatternDocumentCompatibilityError(
        `A costura ${group.id} possui múltiplos intervalos com quantidades diferentes entre os lados.`,
        group.id,
      );
    }
    if (group.slackMm !== 0) {
      throw new PatternDocumentCompatibilityError(
        `A costura ${group.id} possui slack e não pode ser projetada no runtime legado sem perda.`,
        group.id,
      );
    }
    if (
      group.distribution !== "uniform" &&
      group.distribution !== "proportional"
    ) {
      throw new PatternDocumentCompatibilityError(
        `A distribuição ${group.distribution} da costura ${group.id} ainda não é suportada pelo runtime legado.`,
        group.id,
      );
    }
    if (group.treatment === "zipper") {
      throw new PatternDocumentCompatibilityError(
        `A costura ${group.id} usa zíper, ainda não representável no runtime legado.`,
        group.id,
      );
    }
  }
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
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("O documento precisa ter ao menos uma definição de molde.");
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
    if (!isRecord(candidate) || !isRecord(candidate.arrangementAnchor)) {
      throw new TypeError(`A instância ${index + 1} é inválida.`);
    }
    const anchor = parseArrangementAnchor(candidate.arrangementAnchor, index);
    return {
      id: readString(candidate.id, `O id da instância ${index + 1}`),
      sourcePatternId: readString(candidate.sourcePatternId, `O molde da instância ${index + 1}`),
      copyIndex: readNonNegativeInteger(candidate.copyIndex, `O índice da instância ${index + 1}`),
      bodySide: readEnum(candidate.bodySide, BODY_SIDES, `O lado da instância ${index + 1}`),
      surface: readEnum(candidate.surface, PREVIEW_SURFACES, `A superfície da instância ${index + 1}`),
      mirrored: readBoolean(candidate.mirrored, `O espelhamento da instância ${index + 1}`),
      fabricId: readString(candidate.fabricId, `O tecido da instância ${index + 1}`),
      arrangementAnchor: anchor,
      simulationEnabled: readBoolean(candidate.simulationEnabled, `A simulação da instância ${index + 1}`),
      metadata: parsePrimitiveRecord(candidate.metadata, `Os metadados da instância ${index + 1}`),
    };
  });
}

function parseArrangementAnchor(value: Record<string, unknown>, index: number): PanelArrangementAnchorV3 {
  const positionMm = parseOptionalTuple(value.positionMm, `A posição do anchor ${index + 1}`);
  const orientationDeg = parseOptionalTuple(value.orientationDeg, `A orientação do anchor ${index + 1}`);
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
  return {
    id: readString(value.id, `O id do anchor ${index + 1}`),
    region: readEnum(value.region, PREVIEW_REGIONS, `A região do anchor ${index + 1}`),
    surface: readEnum(value.surface, PREVIEW_SURFACES, `A superfície do anchor ${index + 1}`),
    bodySide: readEnum(value.bodySide, BODY_SIDES, `O lado corporal do anchor ${index + 1}`),
    rotationDeg: readFiniteNumber(value.rotationDeg, `A rotação do anchor ${index + 1}`),
    offsetXMm: readFiniteNumber(value.offsetXMm, `O deslocamento X do anchor ${index + 1}`),
    offsetYMm: readFiniteNumber(value.offsetYMm, `O deslocamento Y do anchor ${index + 1}`),
    offsetZMm: readFiniteNumber(value.offsetZMm, `O deslocamento Z do anchor ${index + 1}`),
    scale: readPositiveNumber(value.scale, `A escala do anchor ${index + 1}`),
    ...(positionMm === undefined ? {} : { positionMm }),
    ...(orientationDeg === undefined ? {} : { orientationDeg }),
    ...(outwardSide === undefined ? {} : { outwardSide }),
    source: readEnum(value.source, ["template", "inferred", "manual", "migration"] as const, `A origem do anchor ${index + 1}`),
    ...(value.legacyPreviewPlacementId === undefined
      ? {}
      : { legacyPreviewPlacementId: readString(value.legacyPreviewPlacementId, `O placement legado do anchor ${index + 1}`) }),
    ...(legacyAssemblyRole === undefined ? {} : { legacyAssemblyRole }),
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
      active: readBoolean(candidate.active, `O estado da costura ${index + 1}`),
      ...(compatibility === undefined ? {} : { compatibility }),
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
  if (value.ease === undefined) return {};
  if (!isRecord(value.ease)) throw new TypeError("As folgas da roupa são inválidas.");
  return {
    ease: {
      bustMm: readFiniteNumber(value.ease.bustMm, "A folga de busto"),
      waistMm: readFiniteNumber(value.ease.waistMm, "A folga de cintura"),
      hipMm: readFiniteNumber(value.ease.hipMm, "A folga de quadril"),
      sleeveMm: readFiniteNumber(value.ease.sleeveMm, "A folga de manga"),
    },
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
  const first = group.first.map(rangeSignature).sort().join("|");
  const second = group.second.map(rangeSignature).sort().join("|");
  return [first, second].sort().join("<=>");
}

function rangeSignature(range: SeamGroupV3["first"][number]): string {
  return `${range.pieceId}:${range.edgeId}:${range.startT}:${range.endT}`;
}

function rangesListsEqual(
  first: SeamGroupV3["first"],
  second: SeamGroupV3["second"],
): boolean {
  if (first.length !== second.length) return false;
  const firstSignatures = first.map(rangeSignature).sort();
  const secondSignatures = second.map(rangeSignature).sort();
  return firstSignatures.every((signature, index) => signature === secondSignatures[index]);
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
