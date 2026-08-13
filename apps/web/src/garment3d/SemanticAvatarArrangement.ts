import {
  getPatternEdges,
  edgeRangeLength,
  sampleEdgeRange,
  seamSideRanges,
  type GarmentDraft,
  type EdgeRange,
  type PatternPiece,
  type PatternPreviewPlacement,
  type PreviewBodySide,
  type Seam,
} from "../domain/pattern";
import { buildAssemblyGraph, validateSeamForAssembly } from "../domain/assembly";
import {
  cross3,
  normalize3,
  resolveAvatarAnchor,
  type AvatarArrangementAnchor,
  type AvatarParametricModel,
  type AvatarVector3,
} from "../avatar/AvatarParametricModel";
import { buildAvatarCollisionModel, type AvatarCollisionModel } from "../avatar/AvatarCollisionModel";
import type {
  AssemblyPanelInstance,
  AssemblyStitchConstraint,
  GarmentAssemblyState,
  GlobalPointReference,
} from "./GarmentAssembly";
import { buildPhysicalGarmentAssembly } from "./PhysicalGarmentAssembly";
import type { ResolvedAssemblyInput } from "./ResolvedAssemblyInput";

export type ArrangementDiagnosticCode =
  | "missing-anchor"
  | "missing-connector"
  | "incompatible-seam"
  | "ambiguous-instance"
  | "disconnected-component";

export interface ArrangementDiagnostic {
  code: ArrangementDiagnosticCode;
  severity: "warning" | "error";
  message: string;
  pieceId?: string;
  instanceId?: string;
  connectorId?: string;
}

export interface SemanticAvatarArrangementResult {
  garment: GarmentDraft;
  state: GarmentAssemblyState;
  avatar: AvatarParametricModel;
  collision: AvatarCollisionModel;
  diagnostics: ArrangementDiagnostic[];
  visibleInstanceIds: Set<string>;
  coveredAvatarPartNames: Set<string>;
  seamPlacementDiagnostics: SeamPlacementDiagnostic[];
}

export interface SeamPlacementDiagnostic {
  seamGroupId: string;
  parentInstanceId: string;
  childInstanceId: string;
  parentRange: EdgeRange;
  childRange: EdgeRange;
  parentRangeLengthMm: number;
  childRangeLengthMm: number;
  parentStart: AvatarVector3;
  parentEnd: AvatarVector3;
  parentMidpoint: AvatarVector3;
  childStart: AvatarVector3;
  childEnd: AvatarVector3;
  childMidpoint: AvatarVector3;
  seamTangent: AvatarVector3;
  parentNormal: AvatarVector3;
  developDirection: AvatarVector3;
  transform: {
    alignAxis: AvatarVector3;
    alignAngleRad: number;
    translation: AvatarVector3;
    developAngleRad: number;
  };
}

const METERS_PER_MM = 0.001;

interface PatternFrame2D {
  axis: readonly [number, number];
  across: readonly [number, number];
  axialMinMm: number;
  axialMaxMm: number;
  acrossMinMm: number;
  acrossMaxMm: number;
}

interface SeamDerivedTubeFrame extends PatternFrame2D {
  worldAxis: AvatarVector3;
  worldAcross: AvatarVector3;
  center: AvatarVector3;
  radiusM: number;
  angularSpanRad: number;
}

interface SeamDerivedTubeCandidate {
  pairKey: string;
  componentKey: string;
  scoreMm2: number;
  frames: Array<readonly [string, SeamDerivedTubeFrame]>;
}

export function buildSemanticAvatarArrangement(
  input: ResolvedAssemblyInput,
  avatar: AvatarParametricModel,
): SemanticAvatarArrangementResult {
  const resolvedGarment = input.garmentProjection;
  const diagnostics: ArrangementDiagnostic[] = [];
  const invalidPieceIds = validateSemanticMetadata(resolvedGarment, diagnostics);
  validateSeams(resolvedGarment, diagnostics);
  validateComponents(resolvedGarment, diagnostics);

  const state = buildPhysicalGarmentAssembly(
    input.snapshots,
    resolvedGarment,
    input.geometrySignatures,
  );
  const pieceById = new Map(resolvedGarment.pieces.map((piece) => [piece.id, piece]));
  const visibleInstanceIds = new Set<string>();
  const seamDerivedTubeFrames = buildSeamDerivedTubeFrames(state, resolvedGarment, avatar);

  for (const instance of state.instances) {
    const piece = pieceById.get(instance.pieceId);
    if (!piece || invalidPieceIds.has(instance.pieceId)) continue;
    const anchor = resolveAvatarAnchor(avatar, instance.placement);
    if (!anchor) {
      diagnostics.push({
        code: "missing-anchor",
        severity: "error",
        pieceId: piece.id,
        instanceId: instance.id,
        message: `${piece.name} · ${instance.id}: nenhum anchor corporal corresponde a ${placementLabel(instance.placement)}.`,
      });
      continue;
    }

    arrangeInstance(state, instance, anchor, seamDerivedTubeFrames.get(instance.id));
    visibleInstanceIds.add(instance.id);
  }

  const seamPlacementDiagnostics = placeConnectedPanelsRigidly(state, visibleInstanceIds);
  state.initialPositions.set(state.positions);
  state.previousPositions.set(state.positions);
  const coveredAvatarPartNames = resolveCoveredAvatarParts(state, visibleInstanceIds, avatar);

  return {
    garment: resolvedGarment,
    state,
    avatar,
    collision: buildAvatarCollisionModel(avatar),
    diagnostics: uniqueDiagnostics(diagnostics),
    visibleInstanceIds,
    coveredAvatarPartNames,
    seamPlacementDiagnostics,
  };
}

function validateSemanticMetadata(
  garment: GarmentDraft,
  diagnostics: ArrangementDiagnostic[],
): Set<string> {
  const invalid = new Set<string>();

  for (const piece of garment.pieces) {
    const placements = explicitPlacements(piece, garment);
    const expected = piece.cutOnFold ? 1 : Math.max(1, piece.cutQuantity ?? (placements.length || 1));
    if (placements.length === 0) {
      diagnostics.push({
        code: "missing-anchor",
        severity: "error",
        pieceId: piece.id,
        message: `${piece.name}: nenhuma instância possui anchor de arranjo explícito. A peça não será exibida solta.`,
      });
      invalid.add(piece.id);
      continue;
    }
    if (placements.length !== expected) {
      diagnostics.push({
        code: "ambiguous-instance",
        severity: "error",
        pieceId: piece.id,
        message: `${piece.name}: cutQuantity=${piece.cutQuantity ?? 1}, mas foram encontrados ${placements.length} placements explícitos; esperado ${expected}.`,
      });
      invalid.add(piece.id);
    }

    const sideKeys = new Set<string>();
    for (const placement of placements) {
      const key = `${placement.region}/${placement.surface}/${placement.bodySide}`;
      if (sideKeys.has(key)) {
        diagnostics.push({
          code: "ambiguous-instance",
          severity: "error",
          pieceId: piece.id,
          instanceId: placement.id,
          message: `${piece.name} · ${placement.id}: placement duplicado em ${key}.`,
        });
        invalid.add(piece.id);
      }
      sideKeys.add(key);
      if ((placement.region === "arm" || placement.region === "leg") && placement.bodySide === "center") {
        diagnostics.push({
          code: "ambiguous-instance",
          severity: "error",
          pieceId: piece.id,
          instanceId: placement.id,
          message: `${piece.name} · ${placement.id}: ${placement.region === "arm" ? "manga" : "perna"} precisa declarar lado esquerdo ou direito.`,
        });
        invalid.add(piece.id);
      }
    }

  }

  return invalid;
}

function validateSeams(garment: GarmentDraft, diagnostics: ArrangementDiagnostic[]): void {
  for (const seam of garment.seams ?? []) {
    if (seam.active === false) continue;
    for (const issue of validateSeamForAssembly(seam, garment)) {
      diagnostics.push({
        code: "incompatible-seam",
        severity: "error",
        pieceId: seam.first.pieceId,
        connectorId: `${seam.first.edgeId} ↔ ${seam.second.edgeId}`,
        message: `${seam.name ?? seam.id}: ${issue.message}`,
      });
    }
  }
}

function validateComponents(garment: GarmentDraft, diagnostics: ArrangementDiagnostic[]): void {
  const graph = buildAssemblyGraph(garment);
  if (graph.connectedComponents.length <= 1) return;
  for (const component of graph.connectedComponents.slice(1)) {
    diagnostics.push({
      code: "disconnected-component",
      severity: "warning",
      pieceId: component[0],
      message: `Componente desconectado: ${component.join(", ")}. Ele permanece ancorado ao corpo, mas não possui ligação semântica com o componente principal.`,
    });
  }
}

function explicitPlacements(piece: PatternPiece, garment: GarmentDraft): PatternPreviewPlacement[] {
  if (piece.previewPlacements?.length) return piece.previewPlacements;
  const legacy = garment.assemblyPlacements?.filter((placement) => placement.pieceId === piece.id) ?? [];
  return legacy.flatMap((placement) => {
    const region: PatternPreviewPlacement["region"] = placement.role === "sleeve"
      ? "arm"
      : placement.role === "leg"
        ? "leg"
        : placement.role === "waist"
          ? "hip"
          : "torso";
    const sides: PreviewBodySide[] = (placement.role === "sleeve" || placement.role === "leg") && (piece.cutQuantity ?? 1) > 1
      ? ["left", "right"]
      : ["center"];
    return sides.map((bodySide, index) => ({
      id: `legacy-anchor:${piece.id}:${bodySide}`,
      pieceId: piece.id,
      region,
      surface: placement.outwardSide,
      bodySide,
      rotationDeg: placement.rotationDeg[2],
      offsetXMm: placement.positionMm[0],
      offsetYMm: placement.positionMm[1],
      offsetZMm: placement.positionMm[2],
      scale: 1,
      mirrorX: Boolean(placement.flipped) !== (index === 1),
    }));
  });
}

function resolveCoveredAvatarParts(
  state: GarmentAssemblyState,
  visibleInstanceIds: ReadonlySet<string>,
  avatar: AvatarParametricModel,
): Set<string> {
  const covered = new Set<string>();
  const upperArmLength = Math.hypot(
    avatar.joints.elbowLeft[0] - avatar.joints.shoulderLeft[0],
    avatar.joints.elbowLeft[1] - avatar.joints.shoulderLeft[1],
    avatar.joints.elbowLeft[2] - avatar.joints.shoulderLeft[2],
  );
  const thighLength = Math.max(0.1, avatar.landmarks.crotchY - avatar.landmarks.kneeY);

  for (const instance of state.instances) {
    if (!visibleInstanceIds.has(instance.id)) continue;
    const region = instance.placement.region;
    const side = instance.placement.bodySide;
    const panelLength = instance.topology.boundsMm.height * METERS_PER_MM;

    if (region === "torso") {
      covered.add("avatar:chest");
      covered.add("avatar:abdomen");
      continue;
    }

    if (region === "waist" || region === "hip") {
      covered.add("avatar:abdomen");
      covered.add("avatar:pelvis");
      const bodySides = side === "center" ? (["left", "right"] as const) : ([side] as const);
      for (const bodySide of bodySides) {
        if (bodySide !== "left" && bodySide !== "right") continue;
        covered.add(`avatar:hip-${bodySide}`);
        covered.add(`avatar:thigh-${bodySide}`);
        if (panelLength >= thighLength * 0.82) covered.add(`avatar:knee-${bodySide}`);
        if (panelLength >= thighLength * 1.55) covered.add(`avatar:calf-${bodySide}`);
      }
      continue;
    }

    if (region === "arm" && (side === "left" || side === "right")) {
      covered.add(`avatar:shoulder-${side}`);
      covered.add(`avatar:upper-arm-${side}`);
      if (panelLength >= upperArmLength * 0.78) {
        covered.add(`avatar:elbow-${side}`);
        covered.add(`avatar:forearm-${side}`);
      }
      continue;
    }

    if (region === "leg" && (side === "left" || side === "right")) {
      covered.add("avatar:pelvis");
      covered.add(`avatar:hip-${side}`);
      covered.add(`avatar:thigh-${side}`);
      covered.add(`avatar:knee-${side}`);
      covered.add(`avatar:calf-${side}`);
    }
  }

  return covered;
}

function arrangeInstance(
  state: GarmentAssemblyState,
  instance: AssemblyPanelInstance,
  anchor: AvatarArrangementAnchor,
  tubeFrame?: SeamDerivedTubeFrame,
): void {
  if (tubeFrame) {
    mapSeamDerivedTube(state.positions, instance, tubeFrame);
  } else {
    mapRigidPanel(state.positions, state.initialPositions, instance, anchor);
  }

  instance.arrangement = {
    anchorId: anchor.id,
    outwardNormal: [...anchor.outwardNormal],
    axis: [...(tubeFrame?.worldAxis ?? anchor.axis)],
    ...(tubeFrame ? { tubeCenter: [...tubeFrame.center] as AvatarVector3 } : {}),
    ...(tubeFrame ? { tubeRadiusM: tubeFrame.radiusM } : {}),
    bodySide: instance.placement.bodySide,
    marginM: anchor.initialMarginM,
    mapping: tubeFrame
      ? "seam-derived-tube"
      : "rigid-panel",
    flipWinding: shouldFlipWinding(state.positions, instance, anchor.outwardNormal),
  };
}

/**
 * Detecta a subestrutura tubular primária de cada connected component.
 * Painéis anexados não invalidam o tubo já resolvido, mas um ciclo secundário
 * também não pode promovê-los a outro tubo e substituir suas poses rígidas.
 */
function buildSeamDerivedTubeFrames(
  state: GarmentAssemblyState,
  garment: GarmentDraft,
  avatar: AvatarParametricModel,
): Map<string, SeamDerivedTubeFrame> {
  const result = new Map<string, SeamDerivedTubeFrame>();
  const candidates: SeamDerivedTubeCandidate[] = [];
  const pieceById = new Map(garment.pieces.map((piece) => [piece.id, piece]));
  const instanceByPieceId = new Map<string, AssemblyPanelInstance[]>();
  for (const instance of state.instances) {
    const current = instanceByPieceId.get(instance.pieceId) ?? [];
    current.push(instance);
    instanceByPieceId.set(instance.pieceId, current);
  }

  const seamsByPair = new Map<string, Seam[]>();
  const pieceAdjacency = new Map<string, Set<string>>(
    garment.pieces.map((piece) => [piece.id, new Set<string>()]),
  );
  for (const seam of garment.seams ?? []) {
    if (seam.active === false) continue;
    const firstRanges = seamSideRanges(seam, "first");
    const secondRanges = seamSideRanges(seam, "second");
    for (const first of firstRanges) {
      for (const second of secondRanges) {
        if (first.pieceId === second.pieceId) continue;
        pieceAdjacency.get(first.pieceId)?.add(second.pieceId);
        pieceAdjacency.get(second.pieceId)?.add(first.pieceId);
      }
    }
    // A detecção analítica de tubo é deliberadamente restrita a
    // costuras simples; sequências compostas seguem pelo placement rígido.
    if (firstRanges.length !== 1 || secondRanges.length !== 1 || seam.first.pieceId === seam.second.pieceId) continue;
    const ids = [seam.first.pieceId, seam.second.pieceId].sort();
    const key = `${ids[0]}\u0000${ids[1]}`;
    const current = seamsByPair.get(key) ?? [];
    current.push(seam);
    seamsByPair.set(key, current);
  }
  const componentByPieceId = connectedComponentKeys(pieceAdjacency);

  for (const [key, seams] of [...seamsByPair].sort(([left], [right]) => left.localeCompare(right))) {
    if (seams.length < 2) continue;
    const [firstPieceId, secondPieceId] = key.split("\u0000");
    const firstInstances = instanceByPieceId.get(firstPieceId) ?? [];
    const secondInstances = instanceByPieceId.get(secondPieceId) ?? [];
    if (firstInstances.length !== 1 || secondInstances.length !== 1) continue;

    const firstPiece = pieceById.get(firstPieceId);
    const secondPiece = pieceById.get(secondPieceId);
    if (!firstPiece || !secondPiece) continue;
    const firstBaseAxis = dominantSeamAxis(firstPiece, seams);
    const secondBaseAxis = dominantSeamAxis(secondPiece, seams);
    if (!firstBaseAxis || !secondBaseAxis) continue;

    const rootIsFirst = firstInstances[0].placement.surface !== "back"
      || secondInstances[0].placement.surface === "back";
    const rootPiece = rootIsFirst ? firstPiece : secondPiece;
    const otherPiece = rootIsFirst ? secondPiece : firstPiece;
    const rootInstance = rootIsFirst ? firstInstances[0] : secondInstances[0];
    const otherInstance = rootIsFirst ? secondInstances[0] : firstInstances[0];
    const rootBaseAxis = rootIsFirst ? firstBaseAxis : secondBaseAxis;
    const otherBaseAxis = rootIsFirst ? secondBaseAxis : firstBaseAxis;
    const relation = resolveFrameRelation(
      seams,
      rootPiece,
      otherPiece,
      rootInstance,
      otherInstance,
      rootBaseAxis,
      otherBaseAxis,
    );
    if (!relation) continue;

    const rootFrame = projectedPatternFrame(rootInstance, rootBaseAxis, 1, 1);
    const otherFrame = projectedPatternFrame(
      otherInstance,
      otherBaseAxis,
      relation.axialSign,
      relation.acrossSign,
    );
    if (!tubeSeamsCloseOppositeSides(seams, rootPiece, otherPiece, rootFrame, otherFrame)) continue;

    const rootAxisSigned: readonly [number, number] = [rootFrame.axis[0], rootFrame.axis[1]];
    const worldAxis = normalize3([rootAxisSigned[0], -rootAxisSigned[1], 0]);
    const worldAcross = cross3([0, 0, 1], worldAxis);
    const circumferenceM = (
      rootFrame.acrossMaxMm - rootFrame.acrossMinMm
      + otherFrame.acrossMaxMm - otherFrame.acrossMinMm
    ) * METERS_PER_MM;
    const radiusM = circumferenceM / (Math.PI * 2);
    if (!Number.isFinite(radiusM) || radiusM <= 1e-6) continue;
    const axialSpanMm = Math.max(
      rootFrame.axialMaxMm - rootFrame.axialMinMm,
      otherFrame.axialMaxMm - otherFrame.axialMinMm,
    );
    const center = resolveTubeCenter(
      [rootInstance, otherInstance],
      avatar,
      worldAxis,
      axialSpanMm * METERS_PER_MM,
    );

    const rootTubeFrame: SeamDerivedTubeFrame = {
      ...rootFrame,
      worldAxis,
      worldAcross,
      center,
      radiusM,
      angularSpanRad: (rootFrame.acrossMaxMm - rootFrame.acrossMinMm) * METERS_PER_MM / radiusM,
    };
    const otherTubeFrame: SeamDerivedTubeFrame = {
      ...otherFrame,
      worldAxis,
      worldAcross,
      center,
      radiusM,
      angularSpanRad: (otherFrame.acrossMaxMm - otherFrame.acrossMinMm) * METERS_PER_MM / radiusM,
    };
    candidates.push({
      pairKey: key,
      componentKey: componentByPieceId.get(firstPieceId) ?? firstPieceId,
      scoreMm2: axialSpanMm * circumferenceM / METERS_PER_MM,
      frames: [
        [rootInstance.id, rootTubeFrame],
        [otherInstance.id, otherTubeFrame],
      ],
    });
  }

  /*
   * Um segundo par tubular dentro do mesmo connected component normalmente
   * aparece quando uma SeamGroup nova fecha um ciclo entre painéis já presos.
   * Remapeá-lo como outro cilindro destruiria a pose estável anterior. Mantemos
   * somente a maior subestrutura tubular como raiz analítica e deixamos as
   * demais costuras como constraints com residual para o futuro XPBD.
   */
  const acceptedComponents = new Set<string>();
  const assignedInstances = new Set<string>();
  for (const candidate of [...candidates].sort(
    (left, right) => right.scoreMm2 - left.scoreMm2 || left.pairKey.localeCompare(right.pairKey),
  )) {
    if (acceptedComponents.has(candidate.componentKey)) continue;
    if (candidate.frames.some(([instanceId]) => assignedInstances.has(instanceId))) continue;
    acceptedComponents.add(candidate.componentKey);
    for (const [instanceId, frame] of candidate.frames) {
      result.set(instanceId, frame);
      assignedInstances.add(instanceId);
    }
  }
  return result;
}

function connectedComponentKeys(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const start of [...adjacency.keys()].sort()) {
    if (result.has(start)) continue;
    const members: string[] = [];
    const queue = [start];
    result.set(start, start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      members.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (result.has(neighbor)) continue;
        result.set(neighbor, start);
        queue.push(neighbor);
      }
    }
    const key = [...members].sort()[0];
    for (const member of members) result.set(member, key);
  }
  return result;
}

function dominantSeamAxis(
  piece: PatternPiece,
  seams: readonly Seam[],
): readonly [number, number] | undefined {
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const seam of seams) {
    for (const range of [seam.first, seam.second]) {
      if (range.pieceId !== piece.id) continue;
      const vector = edgeRangeVector(piece, range);
      const length = edgeRangeLength(piece, range);
      if (!vector || length <= 1e-6) continue;
      const unitX = vector[0] / Math.hypot(vector[0], vector[1]);
      const unitY = vector[1] / Math.hypot(vector[0], vector[1]);
      xx += length * unitX * unitX;
      xy += length * unitX * unitY;
      yy += length * unitY * unitY;
    }
  }
  const total = xx + yy;
  if (total <= 1e-6) return undefined;
  const discriminant = Math.hypot(xx - yy, 2 * xy);
  const dominant = (total + discriminant) * 0.5;
  if (dominant / total < 0.82) return undefined;
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let axis: [number, number] = [Math.cos(angle), Math.sin(angle)];
  const canonicalComponent = Math.abs(axis[0]) >= Math.abs(axis[1]) ? axis[0] : axis[1];
  if (canonicalComponent < 0) axis = [-axis[0], -axis[1]];
  return axis;
}

function resolveFrameRelation(
  seams: readonly Seam[],
  rootPiece: PatternPiece,
  otherPiece: PatternPiece,
  rootInstance: AssemblyPanelInstance,
  otherInstance: AssemblyPanelInstance,
  rootAxis: readonly [number, number],
  otherAxis: readonly [number, number],
): { axialSign: 1 | -1; acrossSign: 1 | -1 } | undefined {
  const seam = seams[0];
  const rootIsFirst = seam.first.pieceId === rootPiece.id;
  const rootRange = rootIsFirst ? seam.first : seam.second;
  const otherRange = rootIsFirst ? seam.second : seam.first;
  const rootVector = edgeRangeVector(rootPiece, rootRange);
  const otherVector = edgeRangeVector(otherPiece, otherRange);
  if (!rootVector || !otherVector) return undefined;
  const rootSequence = rootIsFirst && seam.direction === "opposite"
    ? rootVector
    : !rootIsFirst && seam.direction === "opposite"
      ? [-rootVector[0], -rootVector[1]] as const
      : rootVector;
  const otherSequence = rootIsFirst && seam.direction === "opposite"
    ? [-otherVector[0], -otherVector[1]] as const
    : otherVector;
  const rootAlong = dot2(rootSequence, rootAxis);
  const otherAlong = dot2(otherSequence, otherAxis);
  if (Math.abs(rootAlong) <= 1e-6 || Math.abs(otherAlong) <= 1e-6) return undefined;
  const axialSign: 1 | -1 = rootAlong * otherAlong >= 0 ? 1 : -1;

  const rootBaseFrame = projectedPatternFrame(rootInstance, rootAxis, 1, 1);
  const otherBaseFrame = projectedPatternFrame(otherInstance, otherAxis, axialSign, 1);
  const rootSide = seamRangeSide(rootPiece, rootRange, rootBaseFrame);
  const otherSide = seamRangeSide(otherPiece, otherRange, otherBaseFrame);
  if (rootSide === 0 || otherSide === 0) return undefined;
  return { axialSign, acrossSign: rootSide === otherSide ? 1 : -1 };
}

function projectedPatternFrame(
  instance: AssemblyPanelInstance,
  baseAxis: readonly [number, number],
  axialSign: 1 | -1,
  acrossSign: 1 | -1,
): PatternFrame2D {
  const axis: readonly [number, number] = [baseAxis[0] * axialSign, baseAxis[1] * axialSign];
  const baseAcross: readonly [number, number] = [-baseAxis[1], baseAxis[0]];
  const across: readonly [number, number] = [baseAcross[0] * acrossSign, baseAcross[1] * acrossSign];
  let axialMinMm = Number.POSITIVE_INFINITY;
  let axialMaxMm = Number.NEGATIVE_INFINITY;
  let acrossMinMm = Number.POSITIVE_INFINITY;
  let acrossMaxMm = Number.NEGATIVE_INFINITY;
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const point: readonly [number, number] = [
      instance.topology.positions2DMm[local * 2],
      instance.topology.positions2DMm[local * 2 + 1],
    ];
    const axial = dot2(point, axis);
    const transverse = dot2(point, across);
    axialMinMm = Math.min(axialMinMm, axial);
    axialMaxMm = Math.max(axialMaxMm, axial);
    acrossMinMm = Math.min(acrossMinMm, transverse);
    acrossMaxMm = Math.max(acrossMaxMm, transverse);
  }
  return { axis, across, axialMinMm, axialMaxMm, acrossMinMm, acrossMaxMm };
}

function tubeSeamsCloseOppositeSides(
  seams: readonly Seam[],
  firstPiece: PatternPiece,
  secondPiece: PatternPiece,
  firstFrame: PatternFrame2D,
  secondFrame: PatternFrame2D,
): boolean {
  const firstSides = new Set<number>();
  const secondSides = new Set<number>();
  for (const seam of seams) {
    const firstRange = seam.first.pieceId === firstPiece.id ? seam.first : seam.second;
    const secondRange = seam.first.pieceId === secondPiece.id ? seam.first : seam.second;
    const firstSide = seamRangeSide(firstPiece, firstRange, firstFrame);
    const secondSide = seamRangeSide(secondPiece, secondRange, secondFrame);
    if (firstSide === 0 || secondSide === 0 || firstSide !== secondSide) return false;
    const canonicalFirstVector = edgeRangeVector(
      seam.first.pieceId === firstPiece.id ? firstPiece : secondPiece,
      seam.first,
    );
    const canonicalSecondVector = edgeRangeVector(
      seam.second.pieceId === firstPiece.id ? firstPiece : secondPiece,
      seam.second,
    );
    if (!canonicalFirstVector || !canonicalSecondVector) return false;
    const firstSequence = seam.first.pieceId === firstPiece.id
      ? canonicalFirstVector
      : seam.direction === "opposite"
        ? [-canonicalSecondVector[0], -canonicalSecondVector[1]] as const
        : canonicalSecondVector;
    const secondSequence = seam.first.pieceId === secondPiece.id
      ? canonicalFirstVector
      : seam.direction === "opposite"
        ? [-canonicalSecondVector[0], -canonicalSecondVector[1]] as const
        : canonicalSecondVector;
    if (dot2(firstSequence, firstFrame.axis) * dot2(secondSequence, secondFrame.axis) <= 0) return false;
    firstSides.add(firstSide);
    secondSides.add(secondSide);
  }
  return firstSides.has(-1) && firstSides.has(1) && secondSides.has(-1) && secondSides.has(1);
}

function seamRangeSide(piece: PatternPiece, range: EdgeRange, frame: PatternFrame2D): -1 | 0 | 1 {
  const samples = sampleEdgeRange(piece, range);
  if (samples.length === 0) return 0;
  const mean = samples.reduce((sum, point) => sum + dot2([point.xMm, point.yMm], frame.across), 0) / samples.length;
  const middle = (frame.acrossMinMm + frame.acrossMaxMm) * 0.5;
  const half = (frame.acrossMaxMm - frame.acrossMinMm) * 0.5;
  if (half <= 1e-6 || Math.abs(mean - middle) < half * 0.55) return 0;
  return mean < middle ? -1 : 1;
}

function edgeRangeVector(piece: PatternPiece, range: EdgeRange): readonly [number, number] | undefined {
  const samples = sampleEdgeRange(piece, range);
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return undefined;
  const vector: readonly [number, number] = [last.xMm - first.xMm, last.yMm - first.yMm];
  return Math.hypot(vector[0], vector[1]) <= 1e-6 ? undefined : vector;
}

function resolveTubeCenter(
  instances: readonly AssemblyPanelInstance[],
  avatar: AvatarParametricModel,
  worldAxis: AvatarVector3,
  axialLengthM: number,
): AvatarVector3 {
  const anchors = instances
    .map((instance) => resolveAvatarAnchor(avatar, instance.placement))
    .filter((anchor): anchor is AvatarArrangementAnchor => anchor !== undefined);
  const count = Math.max(1, anchors.length);
  const center: AvatarVector3 = anchors.reduce<AvatarVector3>(
    (sum, anchor) => [sum[0] + anchor.position[0], sum[1] + anchor.position[1], sum[2] + anchor.position[2]],
    [0, 0, 0],
  ).map((value) => value / count) as AvatarVector3;
  center[0] += instances.reduce((sum, instance) => sum + instance.placement.offsetXMm, 0) / instances.length * METERS_PER_MM;
  center[1] -= instances.reduce((sum, instance) => sum + instance.placement.offsetYMm, 0) / instances.length * METERS_PER_MM;
  center[2] += instances.reduce((sum, instance) => sum + instance.placement.offsetZMm, 0) / instances.length * METERS_PER_MM;

  if (Math.abs(worldAxis[1]) > 0.82) {
    const region = instances[0].placement.region;
    const topY = region === "torso" ? avatar.landmarks.shoulderY + 0.012 : avatar.landmarks.waistY + 0.008;
    center[1] = topY - axialLengthM * 0.5;
  }
  return center;
}

function mapSeamDerivedTube(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  frame: SeamDerivedTubeFrame,
): void {
  const axialCenter = (frame.axialMinMm + frame.axialMaxMm) * 0.5;
  const acrossSpan = Math.max(1e-6, frame.acrossMaxMm - frame.acrossMinMm);
  const surfaceNormal: AvatarVector3 = instance.placement.surface === "back" ? [0, 0, -1] : [0, 0, 1];
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const point: readonly [number, number] = [
      instance.topology.positions2DMm[local * 2],
      instance.topology.positions2DMm[local * 2 + 1],
    ];
    const axialM = (dot2(point, frame.axis) - axialCenter) * METERS_PER_MM;
    const across = (dot2(point, frame.across) - frame.acrossMinMm) / acrossSpan;
    const angle = (clamp01(across) - 0.5) * frame.angularSpanRad;
    const radialNormal = Math.cos(angle) * frame.radiusM;
    const radialAcross = Math.sin(angle) * frame.radiusM;
    const offset = (instance.particleStart + local) * 3;
    positions[offset] = frame.center[0]
      + frame.worldAxis[0] * axialM
      + surfaceNormal[0] * radialNormal
      + frame.worldAcross[0] * radialAcross;
    positions[offset + 1] = frame.center[1]
      + frame.worldAxis[1] * axialM
      + surfaceNormal[1] * radialNormal
      + frame.worldAcross[1] * radialAcross;
    positions[offset + 2] = frame.center[2]
      + frame.worldAxis[2] * axialM
      + surfaceNormal[2] * radialNormal
      + frame.worldAcross[2] * radialAcross;
  }
}

function dot2(first: readonly [number, number], second: readonly [number, number]): number {
  return first[0] * second[0] + first[1] * second[1];
}

/**
 * Embedding plano e isométrico para o estado inicial genérico. O painel usa
 * somente uma base ortonormal do anchor; nenhuma coordenada local é escalada.
 */
function mapRigidPanel(
  positions: Float32Array,
  planarSource: Float32Array,
  instance: AssemblyPanelInstance,
  anchor: AvatarArrangementAnchor,
): void {
  let centerX = 0;
  let topY = Number.NEGATIVE_INFINITY;
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    centerX += planarSource[offset];
    topY = Math.max(topY, planarSource[offset + 1]);
  }
  centerX /= Math.max(1, instance.vertexCount);

  const rotation = instance.placement.rotationDeg * Math.PI / 180;
  const tangent = normalize3(anchor.tangent);
  const longitudinal = normalize3(anchor.axis);
  const normal = normalize3(anchor.outwardNormal);
  const origin = [
    anchor.position[0]
      + tangent[0] * instance.placement.offsetXMm * METERS_PER_MM
      + longitudinal[0] * instance.placement.offsetYMm * METERS_PER_MM
      + normal[0] * (anchor.initialMarginM + instance.placement.offsetZMm * METERS_PER_MM),
    anchor.position[1]
      + tangent[1] * instance.placement.offsetXMm * METERS_PER_MM
      + longitudinal[1] * instance.placement.offsetYMm * METERS_PER_MM
      + normal[1] * (anchor.initialMarginM + instance.placement.offsetZMm * METERS_PER_MM),
    anchor.position[2]
      + tangent[2] * instance.placement.offsetXMm * METERS_PER_MM
      + longitudinal[2] * instance.placement.offsetYMm * METERS_PER_MM
      + normal[2] * (anchor.initialMarginM + instance.placement.offsetZMm * METERS_PER_MM),
  ] as const;

  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    const across = planarSource[offset] - centerX;
    const down = topY - planarSource[offset + 1];
    const rotatedAcross = across * Math.cos(rotation) - down * Math.sin(rotation);
    const rotatedDown = across * Math.sin(rotation) + down * Math.cos(rotation);
    positions[offset] = origin[0] + tangent[0] * rotatedAcross + longitudinal[0] * rotatedDown;
    positions[offset + 1] = origin[1] + tangent[1] * rotatedAcross + longitudinal[1] * rotatedDown;
    positions[offset + 2] = origin[2] + tangent[2] * rotatedAcross + longitudinal[2] * rotatedDown;
  }
}

/**
 * Propaga somente translações por painel. Costuras adicionais podem mudar a
 * pose de um painel ainda não posicionado, mas nunca suas coordenadas locais.
 * Subestruturas tubulares já resolvidas são raízes imóveis do componente.
 */
function placeConnectedPanelsRigidly(
  state: GarmentAssemblyState,
  visible: ReadonlySet<string>,
): SeamPlacementDiagnostic[] {
  const diagnostics: SeamPlacementDiagnostic[] = [];
  const instanceById = new Map(
    state.instances.filter((instance) => visible.has(instance.id)).map((instance) => [instance.id, instance]),
  );
  const adjacency = new Map<string, Set<string>>(
    [...instanceById.keys()].map((id) => [id, new Set<string>()]),
  );
  const constraintsByPair = new Map<string, typeof state.stitchConstraints>();

  for (const stitch of state.stitchConstraints) {
    const first = stitch.instanceA;
    const second = stitch.instanceB;
    if (!first || !second || first === second || !instanceById.has(first) || !instanceById.has(second)) continue;
    const key = instancePairKey(first, second);
    const current = constraintsByPair.get(key) ?? [];
    current.push(stitch);
    constraintsByPair.set(key, current);
    adjacency.get(first)?.add(second);
    adjacency.get(second)?.add(first);
  }

  const componentVisited = new Set<string>();
  for (const firstInstance of instanceById.values()) {
    if (componentVisited.has(firstInstance.id)) continue;
    const component: string[] = [];
    const discoveryQueue = [firstInstance.id];
    componentVisited.add(firstInstance.id);
    while (discoveryQueue.length > 0) {
      const current = discoveryQueue.shift()!;
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (componentVisited.has(neighbor)) continue;
        componentVisited.add(neighbor);
        discoveryQueue.push(neighbor);
      }
    }

    const tubeRoots = component.filter(
      (id) => instanceById.get(id)?.arrangement?.mapping === "seam-derived-tube",
    );
    const roots = tubeRoots.length > 0 ? tubeRoots : component.slice(0, 1);
    const placed = new Set(roots);
    const queue = [...roots];
    while (queue.length > 0) {
      const fixedId = queue.shift()!;
      for (const movingId of adjacency.get(fixedId) ?? []) {
        if (placed.has(movingId)) continue;
        const fixed = instanceById.get(fixedId);
        const moving = instanceById.get(movingId);
        if (!fixed || !moving) continue;
        const constraints = constraintsByPair.get(instancePairKey(fixedId, movingId)) ?? [];
        const diagnostic = alignRigidPanelToSeam(
          state.positions,
          constraints,
          fixedId,
          movingId,
          fixed,
          moving,
        );
        if (diagnostic) diagnostics.push(diagnostic);
        placed.add(movingId);
        queue.push(movingId);
      }
    }
  }
  return diagnostics;
}

function alignRigidPanelToSeam(
  positions: Float32Array,
  constraints: GarmentAssemblyState["stitchConstraints"],
  fixedId: string,
  movingId: string,
  fixedInstance: AssemblyPanelInstance,
  movingInstance: AssemblyPanelInstance,
): SeamPlacementDiagnostic | undefined {
  const fixedPoints: AvatarVector3[] = [];
  const movingPoints: AvatarVector3[] = [];
  for (const constraint of constraints) {
    const first = evaluateReference(positions, constraint.a);
    const second = evaluateReference(positions, constraint.b);
    fixedPoints.push(constraint.instanceA === fixedId ? first : second);
    movingPoints.push(constraint.instanceA === movingId ? first : second);
  }
  if (fixedPoints.length === 0) return undefined;

  const fixedMidpoint = midpointOfCorrespondence(fixedPoints);
  const movingMidpoint = midpointOfCorrespondence(movingPoints);
  const fixedDirection = seamTangentAtMidpoint(fixedPoints);
  const movingDirection = seamTangentAtMidpoint(movingPoints);
  const alignment = rotateRigidPanelBetweenDirections(
    positions,
    movingInstance,
    movingMidpoint,
    movingDirection,
    fixedDirection,
  );
  const translation = subtract3(fixedMidpoint, movingMidpoint);
  translateRigidPanel(positions, movingInstance, translation);

  const seamDirection = normalize3(fixedDirection);
  const parentNormal = parentNormalAtSeam(fixedInstance, fixedMidpoint, seamDirection);
  let developDirection = normalize3(perpendicularToAxis(
    subtract3(panelCenter(positions, movingInstance), fixedMidpoint),
    seamDirection,
  ));
  let developAngleRad = 0;

  if (fixedInstance.arrangement?.mapping === "seam-derived-tube") {
    const targetDirection = normalize3(perpendicularToAxis(parentNormal, seamDirection));
    developAngleRad = signedAngleAroundAxis(developDirection, targetDirection, seamDirection);
    rotateRigidPanelAroundLine(
      positions,
      movingInstance,
      fixedMidpoint,
      seamDirection,
      developAngleRad,
    );
    developDirection = targetDirection;
  }

  if (
    fixedInstance.arrangement?.mapping === "rigid-panel"
    && movingInstance.arrangement?.mapping === "rigid-panel"
    && fixedPoints.length > 1
  ) {
    const fixedInterior = perpendicularToAxis(
      subtract3(panelCenter(positions, fixedInstance), fixedMidpoint),
      seamDirection,
    );
    const movingInterior = perpendicularToAxis(
      subtract3(panelCenter(positions, movingInstance), fixedMidpoint),
      seamDirection,
    );
    if (dot3(fixedInterior, movingInterior) > 0) {
      rotateRigidPanelAroundLine(
        positions,
        movingInstance,
        fixedMidpoint,
        seamDirection,
        Math.PI,
      );
      developAngleRad = Math.PI;
      developDirection = normalize3(perpendicularToAxis(
        subtract3(panelCenter(positions, movingInstance), fixedMidpoint),
        seamDirection,
      ));
    }
  }

  const representative = constraints.find((constraint) => constraint.rangeA && constraint.rangeB);
  if (!representative?.rangeA || !representative.rangeB) return undefined;
  const parentIsA = representative.instanceA === fixedId;
  const finalChildPoints = constraints.map((constraint) => {
    const first = evaluateReference(positions, constraint.a);
    const second = evaluateReference(positions, constraint.b);
    return constraint.instanceA === movingId ? first : second;
  });
  return {
    seamGroupId: representative.seamGroupId,
    parentInstanceId: fixedId,
    childInstanceId: movingId,
    parentRange: { ...(parentIsA ? representative.rangeA : representative.rangeB) },
    childRange: { ...(parentIsA ? representative.rangeB : representative.rangeA) },
    parentRangeLengthMm: parentIsA
      ? representative.rangeLengthAMm ?? 0
      : representative.rangeLengthBMm ?? 0,
    childRangeLengthMm: parentIsA
      ? representative.rangeLengthBMm ?? 0
      : representative.rangeLengthAMm ?? 0,
    parentStart: fixedPoints[0],
    parentEnd: fixedPoints[fixedPoints.length - 1],
    parentMidpoint: fixedMidpoint,
    childStart: finalChildPoints[0],
    childEnd: finalChildPoints[finalChildPoints.length - 1],
    childMidpoint: midpointOfCorrespondence(finalChildPoints),
    seamTangent: seamDirection,
    parentNormal,
    developDirection,
    transform: {
      alignAxis: alignment.axis,
      alignAngleRad: alignment.angle,
      translation,
      developAngleRad,
    },
  };
}

function panelCenter(positions: Float32Array, instance: AssemblyPanelInstance): AvatarVector3 {
  const center: AvatarVector3 = [0, 0, 0];
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    center[0] += positions[offset];
    center[1] += positions[offset + 1];
    center[2] += positions[offset + 2];
  }
  return center.map((value) => value / Math.max(1, instance.vertexCount)) as AvatarVector3;
}

function perpendicularToAxis(vector: AvatarVector3, axis: AvatarVector3): AvatarVector3 {
  const along = dot3(vector, axis);
  return vector.map((value, index) => value - axis[index] * along) as AvatarVector3;
}

function rotateRigidPanelAroundLine(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  origin: AvatarVector3,
  axis: AvatarVector3,
  angle: number,
): void {
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    const relative: AvatarVector3 = [
      positions[offset] - origin[0],
      positions[offset + 1] - origin[1],
      positions[offset + 2] - origin[2],
    ];
    const rotated = rotateAroundAxis(relative, axis, angle);
    positions[offset] = origin[0] + rotated[0];
    positions[offset + 1] = origin[1] + rotated[1];
    positions[offset + 2] = origin[2] + rotated[2];
  }
}

function rotateRigidPanelBetweenDirections(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  center: AvatarVector3,
  sourceDirection: AvatarVector3,
  targetDirection: AvatarVector3,
): { axis: AvatarVector3; angle: number } {
  const sourceLength = Math.hypot(...sourceDirection);
  const targetLength = Math.hypot(...targetDirection);
  if (sourceLength <= 1e-8 || targetLength <= 1e-8) return { axis: [0, 1, 0], angle: 0 };
  const source = sourceDirection.map((value) => value / sourceLength) as AvatarVector3;
  const target = targetDirection.map((value) => value / targetLength) as AvatarVector3;
  const cosine = Math.min(1, Math.max(-1, dot3(source, target)));
  if (cosine >= 1 - 1e-8) return { axis: [0, 1, 0], angle: 0 };
  let axis = crossRaw3(source, target);
  let sine = Math.hypot(...axis);
  if (sine <= 1e-8) {
    const fallback: AvatarVector3 = Math.abs(source[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
    axis = crossRaw3(source, fallback);
    sine = Math.hypot(...axis);
  }
  axis = axis.map((value) => value / Math.max(sine, 1e-8)) as AvatarVector3;
  const angle = Math.acos(cosine);
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    const relative: AvatarVector3 = [
      positions[offset] - center[0],
      positions[offset + 1] - center[1],
      positions[offset + 2] - center[2],
    ];
    const rotated = rotateAroundAxis(relative, axis, angle);
    positions[offset] = center[0] + rotated[0];
    positions[offset + 1] = center[1] + rotated[1];
    positions[offset + 2] = center[2] + rotated[2];
  }
  return { axis, angle };
}

function rotateAroundAxis(vector: AvatarVector3, axis: AvatarVector3, angle: number): AvatarVector3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const cross = crossRaw3(axis, vector);
  const along = dot3(axis, vector) * (1 - cosine);
  return [
    vector[0] * cosine + cross[0] * sine + axis[0] * along,
    vector[1] * cosine + cross[1] * sine + axis[1] * along,
    vector[2] * cosine + cross[2] * sine + axis[2] * along,
  ];
}

function midpointOfCorrespondence(points: readonly AvatarVector3[]): AvatarVector3 {
  const middle = (points.length - 1) / 2;
  const lower = points[Math.floor(middle)];
  const upper = points[Math.ceil(middle)];
  return [
    (lower[0] + upper[0]) * 0.5,
    (lower[1] + upper[1]) * 0.5,
    (lower[2] + upper[2]) * 0.5,
  ];
}

function seamTangentAtMidpoint(points: readonly AvatarVector3[]): AvatarVector3 {
  if (points.length < 2) return [0, 1, 0];
  const middle = (points.length - 1) / 2;
  const lower = Math.max(0, Math.floor(middle) - 1);
  const upper = Math.min(points.length - 1, Math.ceil(middle) + 1);
  return subtract3(points[upper], points[lower]);
}

function parentNormalAtSeam(
  instance: AssemblyPanelInstance,
  seamMidpoint: AvatarVector3,
  seamTangent: AvatarVector3,
): AvatarVector3 {
  const center = instance.arrangement?.tubeCenter;
  if (instance.arrangement?.mapping === "seam-derived-tube" && center) {
    return normalize3(perpendicularToAxis(subtract3(seamMidpoint, center), seamTangent));
  }
  return normalize3(instance.arrangement?.outwardNormal ?? [0, 0, 1]);
}

function signedAngleAroundAxis(
  from: AvatarVector3,
  to: AvatarVector3,
  axis: AvatarVector3,
): number {
  const cosine = Math.min(1, Math.max(-1, dot3(from, to)));
  const sine = dot3(axis, crossRaw3(from, to));
  return Math.atan2(sine, cosine);
}

function subtract3(first: AvatarVector3, second: AvatarVector3): AvatarVector3 {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function dot3(first: AvatarVector3, second: AvatarVector3): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function crossRaw3(first: AvatarVector3, second: AvatarVector3): AvatarVector3 {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function translateRigidPanel(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  delta: AvatarVector3,
): void {
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const offset = (instance.particleStart + local) * 3;
    positions[offset] += delta[0];
    positions[offset + 1] += delta[1];
    positions[offset + 2] += delta[2];
  }
}

function instancePairKey(first: string, second: string): string {
  return first < second ? `${first}\u0000${second}` : `${second}\u0000${first}`;
}

function evaluateReference(positions: Float32Array, reference: GlobalPointReference): AvatarVector3 {
  const result: AvatarVector3 = [0, 0, 0];
  for (let index = 0; index < reference.particleIndices.length; index += 1) {
    const offset = reference.particleIndices[index] * 3;
    const weight = reference.weights[index];
    result[0] += positions[offset] * weight;
    result[1] += positions[offset + 1] * weight;
    result[2] += positions[offset + 2] * weight;
  }
  return result;
}

function shouldFlipWinding(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  outward: AvatarVector3,
): boolean {
  const triangles = instance.topology.triangles;
  for (let index = 0; index < triangles.length; index += 3) {
    const a = vertex(positions, instance, triangles[index]);
    const b = vertex(positions, instance, triangles[index + 1]);
    const c = vertex(positions, instance, triangles[index + 2]);
    const ab: AvatarVector3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: AvatarVector3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = cross3(ab, ac);
    if (Math.hypot(normal[0], normal[1], normal[2]) <= 1e-8) continue;
    return normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] < 0;
  }
  return false;
}

function vertex(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  localIndex: number,
): AvatarVector3 {
  const offset = (instance.particleStart + localIndex) * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function placementLabel(placement: PatternPreviewPlacement): string {
  return `${placement.region}/${placement.surface}/${placement.bodySide}`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function uniqueDiagnostics(diagnostics: readonly ArrangementDiagnostic[]): ArrangementDiagnostic[] {
  const byKey = new Map<string, ArrangementDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}/${diagnostic.pieceId ?? ""}/${diagnostic.instanceId ?? ""}/${diagnostic.connectorId ?? ""}/${diagnostic.message}`;
    byKey.set(key, diagnostic);
  }
  return [...byKey.values()];
}
