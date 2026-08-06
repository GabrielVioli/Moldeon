import {
  getPatternEdges,
  type PatternPiece,
  type PatternPreviewPlacement,
  type PreviewBodySide,
  type PreviewSurface,
  type SegmentRole,
} from "./pattern";

export type TrouserDefinitionRole = "front" | "back";
export type TrouserConnectorRole =
  | "waist"
  | "hem"
  | "outseam"
  | "inseam"
  | "frontCrotch"
  | "backCrotch";

export interface TrouserPanelInstance {
  id: string;
  sourcePatternId: string;
  sourceDefinitionRole: TrouserDefinitionRole;
  copyIndex: number;
  bodySide: "left" | "right";
  surface: "front" | "back";
  mirrored: boolean;
  sourceGeometrySignature: string;
  placementId: string;
}

export interface TrouserInstanceConnector {
  id: string;
  instanceId: string;
  sourcePatternId: string;
  role: TrouserConnectorRole;
  edgeIds: string[];
  open: boolean;
}

export type TrouserLogicalSeamRole =
  | "left-outseam"
  | "right-outseam"
  | "left-inseam"
  | "right-inseam"
  | "front-rise"
  | "back-rise";

export interface TrouserLogicalSeam {
  id: string;
  role: TrouserLogicalSeamRole;
  first: { instanceId: string; connectorRole: TrouserConnectorRole };
  second: { instanceId: string; connectorRole: TrouserConnectorRole };
}

export interface TrouserLegComponent {
  side: "left" | "right";
  instanceIds: [string, string];
  seamIds: [string, string];
  tubular: boolean;
}

export interface TrouserCrotchContinuity {
  continuous: boolean;
  frontRiseSeamId?: string;
  backRiseSeamId?: string;
  lowerJunctions: Array<{
    side: "left" | "right";
    frontInstanceId: string;
    backInstanceId: string;
    inseamId: string;
  }>;
  orderedInstancePath: string[];
}

export type TrouserAssemblyDiagnosticCode =
  | "missing-definition"
  | "invalid-cut-quantity"
  | "missing-placement"
  | "duplicate-instance-id"
  | "four-panels-one-side"
  | "incorrect-mirroring"
  | "missing-connector"
  | "crossed-leg-seam"
  | "twisted-rise"
  | "incomplete-leg"
  | "incomplete-crotch";

export interface TrouserAssemblyDiagnostic {
  code: TrouserAssemblyDiagnosticCode;
  severity: "warning" | "error";
  message: string;
  instanceId?: string;
  connectorRole?: TrouserConnectorRole;
  seamId?: string;
}

export interface TrouserLogicalAssembly {
  sourcePatternIds: { front?: string; back?: string };
  instances: TrouserPanelInstance[];
  connectors: TrouserInstanceConnector[];
  seams: TrouserLogicalSeam[];
  legs: TrouserLegComponent[];
  crotch: TrouserCrotchContinuity;
  openConnectorIds: string[];
  diagnostics: TrouserAssemblyDiagnostic[];
  valid: boolean;
}

export function buildTrouserLogicalAssembly(
  pieces: readonly PatternPiece[],
): TrouserLogicalAssembly {
  const diagnostics: TrouserAssemblyDiagnostic[] = [];
  const front = findDefinition(pieces, "front");
  const back = findDefinition(pieces, "back");

  if (!front) {
    diagnostics.push({
      code: "missing-definition",
      severity: "error",
      message: "A definição frontal da calça não foi encontrada pelo conector frontCrotch.",
      connectorRole: "frontCrotch",
    });
  }
  if (!back) {
    diagnostics.push({
      code: "missing-definition",
      severity: "error",
      message: "A definição traseira da calça não foi encontrada pelo conector backCrotch.",
      connectorRole: "backCrotch",
    });
  }

  const instances = [
    ...(front ? expandDefinition(front, "front", diagnostics) : []),
    ...(back ? expandDefinition(back, "back", diagnostics) : []),
  ];
  validateStableInstanceIds(instances, diagnostics);
  validateSidesAndMirroring(instances, diagnostics);

  const connectors = instances.flatMap((instance) => {
    const source = pieces.find((piece) => piece.id === instance.sourcePatternId);
    return source ? buildInstanceConnectors(instance, source, diagnostics) : [];
  });
  const seams = buildLogicalSeams(instances, connectors, diagnostics);
  validateSeams(seams, instances, diagnostics);
  const legs = buildLegComponents(instances, seams, diagnostics);
  const crotch = buildCrotchContinuity(instances, seams, diagnostics);
  const openConnectorIds = connectors
    .filter((connector) => connector.open)
    .map((connector) => connector.id)
    .sort();

  return {
    sourcePatternIds: { front: front?.id, back: back?.id },
    instances,
    connectors,
    seams,
    legs,
    crotch,
    openConnectorIds,
    diagnostics,
    valid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
  };
}

export function locateTrouserSourcePattern(
  assembly: TrouserLogicalAssembly,
  instanceId: string,
): string | undefined {
  return assembly.instances.find((instance) => instance.id === instanceId)?.sourcePatternId;
}

export function instanceIdsForSourcePattern(
  assembly: TrouserLogicalAssembly,
  sourcePatternId: string,
): string[] {
  return assembly.instances
    .filter((instance) => instance.sourcePatternId === sourcePatternId)
    .map((instance) => instance.id)
    .sort();
}

export function trouserSourceGeometrySignatures(
  assembly: TrouserLogicalAssembly,
): Record<string, string> {
  return Object.fromEntries(
    assembly.instances.map((instance) => [instance.id, instance.sourceGeometrySignature]),
  );
}

function findDefinition(
  pieces: readonly PatternPiece[],
  role: TrouserDefinitionRole,
): PatternPiece | undefined {
  const requiredRole: SegmentRole = role === "front" ? "frontCrotch" : "backCrotch";
  const forbiddenRole: SegmentRole = role === "front" ? "backCrotch" : "frontCrotch";
  return pieces.find((piece) => hasRole(piece, requiredRole) && !hasRole(piece, forbiddenRole));
}

function expandDefinition(
  piece: PatternPiece,
  role: TrouserDefinitionRole,
  diagnostics: TrouserAssemblyDiagnostic[],
): TrouserPanelInstance[] {
  const cutQuantity = piece.cutQuantity ?? 1;
  if (cutQuantity !== 2) {
    diagnostics.push({
      code: "invalid-cut-quantity",
      severity: "error",
      message: `${piece.name}: cutQuantity ${cutQuantity} não forma as cópias esquerda e direita exigidas pela calça.`,
    });
  }

  const placements = resolvePlacements(piece, role, diagnostics);
  return placements.slice(0, 2).map((placement, copyIndex) => ({
    id: `${piece.id}:panel:${copyIndex + 1}`,
    sourcePatternId: piece.id,
    sourceDefinitionRole: role,
    copyIndex,
    bodySide: placement.bodySide as "left" | "right",
    surface: role,
    mirrored: placement.mirrorX === true,
    sourceGeometrySignature: geometrySignature(piece),
    placementId: placement.id,
  }));
}

function resolvePlacements(
  piece: PatternPiece,
  role: TrouserDefinitionRole,
  diagnostics: TrouserAssemblyDiagnostic[],
): PatternPreviewPlacement[] {
  const declared = (piece.previewPlacements ?? [])
    .filter((placement) => placement.bodySide === "left" || placement.bodySide === "right")
    .sort((left, right) => sideOrder(left.bodySide) - sideOrder(right.bodySide));

  if (declared.length >= 2) return declared;

  diagnostics.push({
    code: "missing-placement",
    severity: "error",
    message: `${piece.name}: faltam placements explícitos para as instâncias esquerda e direita.`,
  });

  return [
    fallbackPlacement(piece.id, role, "left", false),
    fallbackPlacement(piece.id, role, "right", true),
  ];
}

function fallbackPlacement(
  pieceId: string,
  surface: PreviewSurface,
  bodySide: Exclude<PreviewBodySide, "center">,
  mirrorX: boolean,
): PatternPreviewPlacement {
  return {
    id: `${pieceId}:fallback:${bodySide}`,
    pieceId,
    region: "leg",
    surface,
    bodySide,
    rotationDeg: 0,
    offsetXMm: 0,
    offsetYMm: 0,
    offsetZMm: 0,
    scale: 1,
    mirrorX,
  };
}

function buildInstanceConnectors(
  instance: TrouserPanelInstance,
  piece: PatternPiece,
  diagnostics: TrouserAssemblyDiagnostic[],
): TrouserInstanceConnector[] {
  const expected: TrouserConnectorRole[] = [
    "waist",
    "hem",
    "outseam",
    "inseam",
    instance.sourceDefinitionRole === "front" ? "frontCrotch" : "backCrotch",
  ];
  return expected.flatMap((role) => {
    const edgeIds = getPatternEdges(piece)
      .filter((edge) => edge.role === role)
      .map((edge) => edge.id);
    if (edgeIds.length === 0) {
      diagnostics.push({
        code: "missing-connector",
        severity: "error",
        message: `${instance.id}: o conector ${role} não existe na definição ${piece.id}.`,
        instanceId: instance.id,
        connectorRole: role,
      });
      return [];
    }
    return [{
      id: connectorId(instance.id, role),
      instanceId: instance.id,
      sourcePatternId: piece.id,
      role,
      edgeIds,
      open: role === "waist" || role === "hem",
    }];
  });
}

function buildLogicalSeams(
  instances: readonly TrouserPanelInstance[],
  connectors: readonly TrouserInstanceConnector[],
  diagnostics: TrouserAssemblyDiagnostic[],
): TrouserLogicalSeam[] {
  const result: TrouserLogicalSeam[] = [];
  for (const side of ["left", "right"] as const) {
    const front = instanceBy(instances, "front", side);
    const back = instanceBy(instances, "back", side);
    if (!front || !back) continue;
    addSeam(result, connectors, diagnostics, `${side}-outseam`, front, "outseam", back, "outseam");
    addSeam(result, connectors, diagnostics, `${side}-inseam`, front, "inseam", back, "inseam");
  }
  const frontLeft = instanceBy(instances, "front", "left");
  const frontRight = instanceBy(instances, "front", "right");
  const backLeft = instanceBy(instances, "back", "left");
  const backRight = instanceBy(instances, "back", "right");
  if (frontLeft && frontRight) {
    addSeam(result, connectors, diagnostics, "front-rise", frontLeft, "frontCrotch", frontRight, "frontCrotch");
  }
  if (backLeft && backRight) {
    addSeam(result, connectors, diagnostics, "back-rise", backLeft, "backCrotch", backRight, "backCrotch");
  }
  return result;
}

function addSeam(
  target: TrouserLogicalSeam[],
  connectors: readonly TrouserInstanceConnector[],
  diagnostics: TrouserAssemblyDiagnostic[],
  role: TrouserLogicalSeamRole,
  first: TrouserPanelInstance,
  firstRole: TrouserConnectorRole,
  second: TrouserPanelInstance,
  secondRole: TrouserConnectorRole,
): void {
  const firstConnector = connectors.find((connector) => connector.id === connectorId(first.id, firstRole));
  const secondConnector = connectors.find((connector) => connector.id === connectorId(second.id, secondRole));
  if (!firstConnector || !secondConnector) {
    diagnostics.push({
      code: "missing-connector",
      severity: "error",
      message: `${role}: não foi possível ligar ${first.id}/${firstRole} a ${second.id}/${secondRole}.`,
      instanceId: !firstConnector ? first.id : second.id,
      connectorRole: !firstConnector ? firstRole : secondRole,
      seamId: `trouser-seam:${role}`,
    });
    return;
  }
  target.push({
    id: `trouser-seam:${role}`,
    role,
    first: { instanceId: first.id, connectorRole: firstRole },
    second: { instanceId: second.id, connectorRole: secondRole },
  });
}

function validateStableInstanceIds(
  instances: readonly TrouserPanelInstance[],
  diagnostics: TrouserAssemblyDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const instance of instances) {
    if (seen.has(instance.id)) {
      diagnostics.push({
        code: "duplicate-instance-id",
        severity: "error",
        message: `O ID de painel ${instance.id} foi gerado mais de uma vez.`,
        instanceId: instance.id,
      });
    }
    seen.add(instance.id);
  }
}

function validateSidesAndMirroring(
  instances: readonly TrouserPanelInstance[],
  diagnostics: TrouserAssemblyDiagnostic[],
): void {
  const left = instances.filter((instance) => instance.bodySide === "left");
  const right = instances.filter((instance) => instance.bodySide === "right");
  if (instances.length === 4 && (left.length === 4 || right.length === 4)) {
    diagnostics.push({
      code: "four-panels-one-side",
      severity: "error",
      message: `As quatro instâncias foram posicionadas no lado ${left.length === 4 ? "esquerdo" : "direito"}.`,
    });
  }
  for (const role of ["front", "back"] as const) {
    const roleInstances = instances.filter((instance) => instance.sourceDefinitionRole === role);
    const roleLeft = roleInstances.find((instance) => instance.bodySide === "left");
    const roleRight = roleInstances.find((instance) => instance.bodySide === "right");
    if (!roleLeft || !roleRight || roleLeft.mirrored === roleRight.mirrored) {
      diagnostics.push({
        code: "incorrect-mirroring",
        severity: "error",
        message: `${role}: as cópias esquerda e direita precisam ter espelhamentos opostos.`,
        instanceId: roleRight?.id ?? roleLeft?.id,
      });
    }
  }
}

function validateSeams(
  seams: readonly TrouserLogicalSeam[],
  instances: readonly TrouserPanelInstance[],
  diagnostics: TrouserAssemblyDiagnostic[],
): void {
  const byId = new Map(instances.map((instance) => [instance.id, instance]));
  for (const seam of seams) {
    const first = byId.get(seam.first.instanceId);
    const second = byId.get(seam.second.instanceId);
    if (!first || !second) continue;
    if (seam.role.endsWith("outseam") || seam.role.endsWith("inseam")) {
      if (first.bodySide !== second.bodySide) {
        diagnostics.push({
          code: "crossed-leg-seam",
          severity: "error",
          message: `${seam.id}: ${first.id} foi cruzado com ${second.id} em lados corporais diferentes.`,
          seamId: seam.id,
          instanceId: first.id,
          connectorRole: seam.first.connectorRole,
        });
      }
      if (first.sourceDefinitionRole === second.sourceDefinitionRole) {
        diagnostics.push({
          code: "crossed-leg-seam",
          severity: "error",
          message: `${seam.id}: uma perna deve ligar frente e costas, não duas instâncias ${first.sourceDefinitionRole}.`,
          seamId: seam.id,
        });
      }
    } else {
      const expectedRole = seam.role === "front-rise" ? "front" : "back";
      if (
        first.sourceDefinitionRole !== expectedRole ||
        second.sourceDefinitionRole !== expectedRole ||
        first.bodySide === second.bodySide ||
        first.mirrored === second.mirrored
      ) {
        diagnostics.push({
          code: "twisted-rise",
          severity: "error",
          message: `${seam.id}: o gancho está torcido entre ${first.id}/${seam.first.connectorRole} e ${second.id}/${seam.second.connectorRole}.`,
          seamId: seam.id,
          instanceId: first.id,
          connectorRole: seam.first.connectorRole,
        });
      }
    }
  }
}

function buildLegComponents(
  instances: readonly TrouserPanelInstance[],
  seams: readonly TrouserLogicalSeam[],
  diagnostics: TrouserAssemblyDiagnostic[],
): TrouserLegComponent[] {
  return (["left", "right"] as const).flatMap((side) => {
    const front = instanceBy(instances, "front", side);
    const back = instanceBy(instances, "back", side);
    const outseam = seams.find((seam) => seam.role === `${side}-outseam`);
    const inseam = seams.find((seam) => seam.role === `${side}-inseam`);
    const tubular = Boolean(front && back && outseam && inseam);
    if (!tubular) {
      diagnostics.push({
        code: "incomplete-leg",
        severity: "error",
        message: `A perna ${side === "left" ? "esquerda" : "direita"} não possui frente, costas, lateral e entreperna completas.`,
        instanceId: front?.id ?? back?.id,
      });
      return [];
    }
    return [{
      side,
      instanceIds: [front!.id, back!.id],
      seamIds: [outseam!.id, inseam!.id],
      tubular: true,
    }];
  });
}

function buildCrotchContinuity(
  instances: readonly TrouserPanelInstance[],
  seams: readonly TrouserLogicalSeam[],
  diagnostics: TrouserAssemblyDiagnostic[],
): TrouserCrotchContinuity {
  const frontRise = seams.find((seam) => seam.role === "front-rise");
  const backRise = seams.find((seam) => seam.role === "back-rise");
  const lowerJunctions = (["left", "right"] as const).flatMap((side) => {
    const front = instanceBy(instances, "front", side);
    const back = instanceBy(instances, "back", side);
    const inseam = seams.find((seam) => seam.role === `${side}-inseam`);
    return front && back && inseam
      ? [{ side, frontInstanceId: front.id, backInstanceId: back.id, inseamId: inseam.id }]
      : [];
  });
  const ordered = [
    instanceBy(instances, "back", "left")?.id,
    instanceBy(instances, "back", "right")?.id,
    instanceBy(instances, "front", "right")?.id,
    instanceBy(instances, "front", "left")?.id,
  ].filter((value): value is string => Boolean(value));
  const continuous = Boolean(frontRise && backRise && lowerJunctions.length === 2 && ordered.length === 4);
  if (!continuous) {
    diagnostics.push({
      code: "incomplete-crotch",
      severity: "error",
      message: "A continuidade do gancho exige gancho frontal, gancho traseiro e as duas junções inferiores nas entrepernas.",
      seamId: !frontRise ? "trouser-seam:front-rise" : !backRise ? "trouser-seam:back-rise" : undefined,
    });
  }
  return {
    continuous,
    frontRiseSeamId: frontRise?.id,
    backRiseSeamId: backRise?.id,
    lowerJunctions,
    orderedInstancePath: ordered,
  };
}

function instanceBy(
  instances: readonly TrouserPanelInstance[],
  role: TrouserDefinitionRole,
  side: "left" | "right",
): TrouserPanelInstance | undefined {
  return instances.find(
    (instance) => instance.sourceDefinitionRole === role && instance.bodySide === side,
  );
}

function connectorId(instanceId: string, role: TrouserConnectorRole): string {
  return `${instanceId}:connector:${role}`;
}

function hasRole(piece: PatternPiece, role: SegmentRole): boolean {
  return getPatternEdges(piece).some((edge) => edge.role === role);
}

function geometrySignature(piece: PatternPiece): string {
  const points = piece.points
    .map((point) => [point.id, round(point.xMm), round(point.yMm)].join(":"))
    .join("|");
  const segments = (piece.segments ?? [])
    .map((segment) => [segment.id, segment.role, segment.kind].join(":"))
    .join("|");
  const darts = (piece.darts ?? [])
    .map((dart) => [dart.id, round(dart.widthMm), round(dart.lengthMm), dart.closed].join(":"))
    .join("|");
  return `${points}#${segments}#${darts}`;
}

function sideOrder(side: PreviewBodySide): number {
  if (side === "left") return 0;
  if (side === "right") return 1;
  return 2;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
