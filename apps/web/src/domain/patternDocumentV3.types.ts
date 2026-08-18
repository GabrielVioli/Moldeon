import type { FabricSource } from "./fabric";
import type { MeasurementProfile, PatternGenerationRecord } from "./parametricMeasurements";
import type {
  AssemblyOutwardSide,
  AssemblyPieceRole,
  BodyAnchorId,
  BodyPlacementRegion,
  BodyPlacementRole,
  BodyPlacementSide,
  BodyPlacementSurface,
  BodyMeasurements,
  BodyType,
  EdgeFinish,
  EdgeRange,
  GarmentEase,
  GarmentDressingSetup,
  Guide,
  PatternContour,
  PatternDart,
  PatternInternalLine,
  PatternNode,
  PatternPoint,
  PatternPreviewPlacement,
  PatternSegment,
  PatternVector,
  PieceWorkspaceTransform,
  PreviewBodySide,
  PreviewRegion,
  PreviewSurface,
} from "./pattern";

export const PATTERN_DOCUMENT_FORMAT_VERSION = 3 as const;
export const PATTERN_DOCUMENT_UNITS = "mm" as const;

export interface ProjectMetadataV3 {
  projectId: string;
  name: string;
  description: string;
  sourceTemplateId?: string;
  sourceTemplateVersion?: string;
  createdAt?: string;
  updatedAt?: string;
  application?: {
    name: "Moldeon";
    version?: string;
  };
}

export interface MeasurementSetV3 {
  id: string;
  values: BodyMeasurements;
  estimatedKeys: string[];
  suppliedKeys?: string[];
  derivedKeys?: string[];
  formulaSetVersion?: string;
  profile?: MeasurementProfile;
  notes?: string;
}

export interface FormulaVariableV3 {
  id: string;
  name: string;
  expression: string;
  unit: "mm" | "ratio" | "degree" | "scalar";
  description?: string;
  formulaVersion?: string;
  dependencies?: string[];
}

export interface ConstructionGraphV3 {
  version: 1 | 2;
  nodes: ConstructionGraphNodeV3[];
}

export interface ConstructionGraphNodeV3 {
  id: string;
  kind: "measurement" | "variable" | "free-point" | "computed-point" | "line" | "arc" | "curve" | "transform" | "operation";
  dependencies: string[];
  payload: Record<string, unknown>;
}

export interface PatternGeometryV3 {
  geometryVersion: 2;
  points: PatternPoint[];
  nodes: PatternNode[];
  segments: PatternSegment[];
  contours: PatternContour[];
}

export type PatternSemanticRoleV3 =
  | "front"
  | "back"
  | "sleeve"
  | "waistband"
  | "leg-front"
  | "leg-back"
  | "collar"
  | "panel"
  | "custom";

export type PatternMirrorRuleV3 = "none" | "paired" | "cut-on-fold";

export type ConnectorRoleV3 =
  | "front-armhole"
  | "back-armhole"
  | "sleeve-cap-front"
  | "sleeve-cap-back"
  | "shoulder"
  | "side-seam"
  | "underarm"
  | "neckline"
  | "waist"
  | "waistband"
  | "inseam"
  | "outseam"
  | "front-rise"
  | "back-rise"
  | "crotch"
  | "hem"
  | "custom";

export interface ConnectorLandmarkV3 {
  id: string;
  kind: "start" | "end" | "notch" | "apex" | "balance" | "custom";
  rangeIndex: number;
  t: number;
  label?: string;
}

export interface PatternConnectorV3 {
  id: string;
  role: ConnectorRoleV3;
  ranges: EdgeRange[];
  landmarks: ConnectorLandmarkV3[];
  direction: "forward" | "reverse";
  metadata?: Record<string, string | number | boolean>;
}

export interface PatternDefinitionV3 {
  id: string;
  name: string;
  sourceTemplateId?: string;
  sourceTemplateVersion?: string;
  semanticRole: PatternSemanticRoleV3;
  bodyPlacement: PatternBodyPlacementV3;
  geometry: PatternGeometryV3;
  internalLines: PatternInternalLine[];
  darts: PatternDart[];
  grainline?: { start: PatternVector; end: PatternVector };
  annotations: Array<{
    id: string;
    label: string;
    xMm: number;
    yMm: number;
  }>;
  guides: Guide[];
  seamAllowanceMm: number;
  edgeFinishes: Record<string, EdgeFinish>;
  cutQuantity: number;
  cutOnFold: boolean;
  mirrorRule: PatternMirrorRuleV3;
  fabricId: string;
  connectors: PatternConnectorV3[];
  generation?: PatternGenerationRecord;
}

export interface PatternBodyPlacementV3 {
  version: 1;
  status: "unclassified" | "confirmed";
  includeIn3D: boolean;
  role?: BodyPlacementRole;
  region?: BodyPlacementRegion;
  surface?: BodyPlacementSurface;
  bodySide?: BodyPlacementSide;
  anchorId?: BodyAnchorId;
  outwardFace: "normal" | "flipped";
  offsetXMm: number;
  offsetYMm: number;
  offsetZMm: number;
  rotationXDeg: number;
  rotationYDeg: number;
  rotationZDeg: number;
  source: "manual" | "migration";
}

export interface PanelArrangementAnchorV3 {
  id: string;
  bodyAnchorId?: BodyAnchorId;
  region: PreviewRegion;
  surface: PreviewSurface;
  bodySide: PreviewBodySide;
  rotationDeg: number;
  offsetXMm: number;
  offsetYMm: number;
  offsetZMm: number;
  scale: number;
  positionMm?: [number, number, number];
  orientationDeg?: [number, number, number];
  outwardSide?: AssemblyOutwardSide;
  source: "template" | "inferred" | "manual" | "migration";
  legacyPreviewPlacementId?: string;
  legacyAssemblyRole?: AssemblyPieceRole;
}

export interface PanelInstanceV3 {
  id: string;
  sourcePatternId: string;
  copyIndex: number;
  placementStatus: "unclassified" | "confirmed";
  bodySide?: PreviewBodySide;
  surface?: PreviewSurface;
  mirrored: boolean;
  fabricId: string;
  arrangementAnchor?: PanelArrangementAnchorV3;
  includedIn3D: boolean;
  simulationEnabled: boolean;
  metadata: Record<string, string | number | boolean>;
}

export type SeamTreatmentV3 =
  | "standard"
  | "ease"
  | "gather"
  | "elastic"
  | "zipper"
  | "intentional-mismatch";

export type SeamDistributionV3 =
  | "uniform"
  | "proportional"
  | "center-biased"
  | "custom";

export interface SeamGroupCompatibilityV3 {
  legacyEaseRatio?: number;
  legacyType?: string;
  legacyTreatment?: string;
}

export interface SeamPhysicalInstanceReferenceV3 {
  patternId: string;
  panelInstanceId: string;
}

export interface SeamPhysicalBindingV3 {
  id: string;
  first: SeamPhysicalInstanceReferenceV3[];
  second: SeamPhysicalInstanceReferenceV3[];
}

export interface SeamGroupV3 {
  id: string;
  name: string;
  first: EdgeRange[];
  second: EdgeRange[];
  direction: "same" | "opposite";
  treatment: SeamTreatmentV3;
  distribution: SeamDistributionV3;
  targetRatio: number;
  slackMm: number;
  /** Physical realization only. Geometry remains owned by first/second EdgeRanges. */
  physicalBindings?: SeamPhysicalBindingV3[];
  /** @deprecated Accepted only for V3 migration and normalized to physicalBindings. */
  physicalPairing?: "paired-copies";
  active: boolean;
  compatibility?: SeamGroupCompatibilityV3;
}

export interface BodyDefinitionV3 {
  type: BodyType;
  measurementSetId: string;
  metadata: Record<string, string | number | boolean>;
}

export interface PatternWorkspaceEntryV3 {
  patternId: string;
  transform: PieceWorkspaceTransform;
  visible: boolean;
  locked: boolean;
}

export interface WorkspaceStateV3 {
  activePatternId?: string;
  patterns: PatternWorkspaceEntryV3[];
}

export interface SimulationSettingsV3 {
  enabled: boolean;
  quality: "draft" | "normal" | "fitting" | "high";
  gravityMmS2: [number, number, number];
  substeps: number;
  iterations: number;
  selfCollision: boolean;
}

export interface GarmentSettingsV3 {
  ease?: GarmentEase;
  dressing?: GarmentDressingSetup;
}

/**
 * Canonical persisted project document.
 *
 * Ownership invariants:
 * - PatternDefinitionV3 owns all authoritative 2D geometry in millimetres.
 * - PanelInstanceV3 references a definition and never duplicates its geometry.
 * - Connectors and SeamGroupV3 reference stable pattern/edge IDs.
 * - Workspace state is presentation state for the 2D bench, not simulation state.
 * - Particle positions, renderer objects and temporary solver state are never persisted here.
 */
export interface PatternDocumentV3 {
  formatVersion: 3;
  metadata: ProjectMetadataV3;
  units: "mm";
  measurements: MeasurementSetV3;
  variables: FormulaVariableV3[];
  constructionGraph: ConstructionGraphV3;
  patternDefinitions: PatternDefinitionV3[];
  panelInstances: PanelInstanceV3[];
  seamGroups: SeamGroupV3[];
  fabrics: FabricSource[];
  body: BodyDefinitionV3;
  workspace: WorkspaceStateV3;
  garmentSettings: GarmentSettingsV3;
  simulationSettings: SimulationSettingsV3;
}

export interface PatternProjectV2 {
  formatVersion: 2;
  garment: unknown;
  activePieceId?: string;
}

export type PatternProjectSourceVersion = "legacy" | 2 | 3;

export interface PatternDocumentMigrationWarning {
  code: string;
  message: string;
  entityId?: string;
}

export interface PatternDocumentMigrationResult {
  document: PatternDocumentV3;
  sourceVersion: PatternProjectSourceVersion;
  warnings: PatternDocumentMigrationWarning[];
}

export type PatternDocumentIssueSeverity = "error" | "warning";

export interface PatternDocumentValidationIssue {
  code:
    | "duplicate-id"
    | "missing-pattern"
    | "missing-edge"
    | "missing-fabric"
    | "invalid-range"
    | "empty-range"
    | "duplicate-seam-group"
    | "degenerate-self-seam"
    | "invalid-panel-instance"
    | "invalid-physical-binding"
    | "ambiguous-physical-binding"
    | "invalid-connector"
    | "invalid-workspace-reference";
  severity: PatternDocumentIssueSeverity;
  message: string;
  entityId?: string;
}

export interface LegacyPatternProjection {
  previewPlacements: PatternPreviewPlacement[];
}
