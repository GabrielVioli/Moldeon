import {
  getPatternEdges,
  edgeRangeLength,
  sampleEdgeRange,
  type GarmentDraft,
  type EdgeRange,
  type PatternPiece,
  type PatternPreviewPlacement,
  type PreviewBodySide,
  type Seam,
} from "../domain/pattern";
import { buildAssemblyGraph, validateSeamForAssembly } from "../domain/assembly";
import {
  addScaled3,
  cross3,
  normalize3,
  resolveAvatarAnchor,
  sampleArmRadius,
  sampleLegRadius,
  sampleTorsoAxes,
  type AvatarArrangementAnchor,
  type AvatarParametricModel,
  type AvatarVector3,
} from "../avatar/AvatarParametricModel";
import { buildAvatarCollisionModel, type AvatarCollisionModel } from "../avatar/AvatarCollisionModel";
import type { AssemblyPanelInstance, GarmentAssemblyState, GlobalPointReference } from "./GarmentAssembly";
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

    arrangeInstance(state, instance, piece, avatar, anchor, seamDerivedTubeFrames.get(instance.id));
    visibleInstanceIds.add(instance.id);
  }

  applyMinimalSeamStabilization(state, visibleInstanceIds, 1, 0.0015);
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
  piece: PatternPiece,
  avatar: AvatarParametricModel,
  anchor: AvatarArrangementAnchor,
  tubeFrame?: SeamDerivedTubeFrame,
): void {
  if (tubeFrame) {
    mapSeamDerivedTube(state.positions, instance, tubeFrame);
  } else if (instance.placement.region === "arm") {
    mapArm(state.positions, instance, avatar, anchor);
  } else if (instance.placement.region === "leg") {
    mapLeg(state.positions, instance, avatar, anchor);
  } else {
    mapTorsoSurface(state.positions, instance, piece, avatar, anchor);
  }

  instance.arrangement = {
    anchorId: anchor.id,
    outwardNormal: [...anchor.outwardNormal],
    axis: [...(tubeFrame?.worldAxis ?? anchor.axis)],
    ...(tubeFrame ? { tubeCenter: [...tubeFrame.center] as AvatarVector3 } : {}),
    bodySide: instance.placement.bodySide,
    marginM: anchor.initialMarginM,
    mapping: tubeFrame
      ? "seam-derived-tube"
      : instance.placement.region === "arm"
        ? "local-tube"
        : instance.placement.region === "leg"
          ? "anatomical-half-tube"
          : "body-surface",
    flipWinding: shouldFlipWinding(state.positions, instance, anchor.outwardNormal),
  };
}

/**
 * Detecta somente loops inequÃ­vocos de dois painÃ©is. O eixo longitudinal vem
 * das bordas costuradas; a bounding box nunca decide sozinha a orientaÃ§Ã£o.
 */
function buildSeamDerivedTubeFrames(
  state: GarmentAssemblyState,
  garment: GarmentDraft,
  avatar: AvatarParametricModel,
): Map<string, SeamDerivedTubeFrame> {
  const result = new Map<string, SeamDerivedTubeFrame>();
  const pieceById = new Map(garment.pieces.map((piece) => [piece.id, piece]));
  const instanceByPieceId = new Map<string, AssemblyPanelInstance[]>();
  for (const instance of state.instances) {
    const current = instanceByPieceId.get(instance.pieceId) ?? [];
    current.push(instance);
    instanceByPieceId.set(instance.pieceId, current);
  }

  const graph = buildAssemblyGraph(garment);
  for (const component of graph.connectedComponents) {
    if (component.length !== 2) continue;
    const [firstPieceId, secondPieceId] = component;
    const firstInstances = instanceByPieceId.get(firstPieceId) ?? [];
    const secondInstances = instanceByPieceId.get(secondPieceId) ?? [];
    if (firstInstances.length !== 1 || secondInstances.length !== 1) continue;

    const seams = (garment.seams ?? []).filter((seam) => {
      if (seam.active === false) return false;
      const ids = new Set([seam.first.pieceId, seam.second.pieceId]);
      return ids.size === 2 && ids.has(firstPieceId) && ids.has(secondPieceId);
    });
    if (seams.length < 2) continue;

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
    const center = resolveTubeCenter(
      [rootInstance, otherInstance],
      avatar,
      worldAxis,
      Math.max(
        rootFrame.axialMaxMm - rootFrame.axialMinMm,
        otherFrame.axialMaxMm - otherFrame.axialMinMm,
      ) * METERS_PER_MM,
    );

    result.set(rootInstance.id, {
      ...rootFrame,
      worldAxis,
      worldAcross,
      center,
      radiusM,
      angularSpanRad: (rootFrame.acrossMaxMm - rootFrame.acrossMinMm) * METERS_PER_MM / radiusM,
    });
    result.set(otherInstance.id, {
      ...otherFrame,
      worldAxis,
      worldAcross,
      center,
      radiusM,
      angularSpanRad: (otherFrame.acrossMaxMm - otherFrame.acrossMinMm) * METERS_PER_MM / radiusM,
    });
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

function mapTorsoSurface(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  piece: PatternPiece,
  avatar: AvatarParametricModel,
  anchor: AvatarArrangementAnchor,
): void {
  const bounds = instance.topology.boundsMm;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const foldX = findFoldCoordinate(piece, instance);
  const sideSign = instance.placement.bodySide === "left" ? -1 : 1;
  const surfaceSign = instance.placement.surface === "back" ? -1 : 1;
  const topY = instance.placement.region === "torso"
    ? avatar.landmarks.shoulderY + 0.012
    : avatar.landmarks.waistY + 0.008;
  const rotation = instance.placement.rotationDeg * Math.PI / 180;
  const patternHalfWidth = Math.max(
    1,
    ...Array.from({ length: instance.vertexCount }, (_, local) => {
      const x = instance.topology.positions2DMm[local * 2];
      return Math.abs(x - (piece.cutOnFold ? foldX : centerX));
    }),
  );
  for (let local = 0; local < instance.vertexCount; local += 1) {
    const xMm = instance.topology.positions2DMm[local * 2];
    const yMm = instance.topology.positions2DMm[local * 2 + 1];
    const sourceX = piece.cutOnFold && instance.placement.bodySide !== "center"
      ? sideSign * Math.abs(xMm - foldX)
      : xMm - centerX;
    const sourceY = yMm - bounds.minY;
    const rotatedX = sourceX * Math.cos(rotation) - sourceY * Math.sin(rotation);
    const rotatedY = sourceX * Math.sin(rotation) + sourceY * Math.cos(rotation);
    const worldY = topY - rotatedY * METERS_PER_MM - instance.placement.offsetYMm * METERS_PER_MM;
    const axes = sampleTorsoAxes(avatar, worldY);
    const normalizedAcross = clamp01(Math.abs(rotatedX) / patternHalfWidth);
    const angle = normalizedAcross * Math.PI * 0.5;
    const xDirection = rotatedX < 0 ? -1 : rotatedX > 0 ? 1 : instance.placement.bodySide === "left" ? -1 : 1;
    const radialWidth = axes.halfWidth + anchor.initialMarginM * 0.62;
    const radialDepth = axes.halfDepth + anchor.initialMarginM;
    const offset = (instance.particleStart + local) * 3;
    positions[offset] = xDirection * Math.sin(angle) * radialWidth + instance.placement.offsetXMm * METERS_PER_MM;
    positions[offset + 1] = worldY;
    positions[offset + 2] = surfaceSign * Math.cos(angle) * radialDepth + instance.placement.offsetZMm * METERS_PER_MM;
  }
}

function mapArm(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  avatar: AvatarParametricModel,
  anchor: AvatarArrangementAnchor,
): void {
  const bounds = instance.topology.boundsMm;
  const width = Math.max(1, bounds.width);
  const sideSign = instance.placement.bodySide === "left" ? -1 : 1;
  const frontAxis: AvatarVector3 = [0, 0, 1];
  const radialOut = normalize3([
    sideSign * (frontAxis[1] * anchor.axis[2] - frontAxis[2] * anchor.axis[1]),
    sideSign * (frontAxis[2] * anchor.axis[0] - frontAxis[0] * anchor.axis[2]),
    sideSign * (frontAxis[0] * anchor.axis[1] - frontAxis[1] * anchor.axis[0]),
  ]);
  const patternRadius = width * METERS_PER_MM / (Math.PI * 2);
  const rotation = instance.placement.rotationDeg * Math.PI / 180;

  for (let local = 0; local < instance.vertexCount; local += 1) {
    const xMm = instance.topology.positions2DMm[local * 2];
    const yMm = instance.topology.positions2DMm[local * 2 + 1];
    let u = clamp01((xMm - bounds.minX) / width);
    if (instance.placement.mirrorX) u = 1 - u;
    const distance = Math.max(0, (yMm - bounds.minY) * METERS_PER_MM - instance.placement.offsetYMm * METERS_PER_MM);
    const center = addScaled3(anchor.position, anchor.axis, distance);
    const radius = Math.max(sampleArmRadius(avatar, distance) + anchor.initialMarginM, patternRadius * 0.9);
    const angle = (u - 0.5) * Math.PI * 2 + rotation;
    const aroundOut = Math.cos(angle) * radius;
    const aroundFront = Math.sin(angle) * radius;
    const offset = (instance.particleStart + local) * 3;
    positions[offset] = center[0] + radialOut[0] * aroundOut + frontAxis[0] * aroundFront + instance.placement.offsetXMm * METERS_PER_MM;
    positions[offset + 1] = center[1] + radialOut[1] * aroundOut + frontAxis[1] * aroundFront;
    positions[offset + 2] = center[2] + radialOut[2] * aroundOut + frontAxis[2] * aroundFront + instance.placement.offsetZMm * METERS_PER_MM;
  }
}

function mapLeg(
  positions: Float32Array,
  instance: AssemblyPanelInstance,
  avatar: AvatarParametricModel,
  anchor: AvatarArrangementAnchor,
): void {
  const bounds = instance.topology.boundsMm;
  const width = Math.max(1, bounds.width);
  const sideSign = instance.placement.bodySide === "left" ? -1 : 1;
  const baseLegX = anchor.position[0];
  const surfaceFront = instance.placement.surface !== "back";

  for (let local = 0; local < instance.vertexCount; local += 1) {
    const xMm = instance.topology.positions2DMm[local * 2];
    const yMm = instance.topology.positions2DMm[local * 2 + 1];
    let u = clamp01((xMm - bounds.minX) / width);
    if (instance.placement.mirrorX) u = 1 - u;
    const worldY = avatar.landmarks.waistY - (yMm - bounds.minY) * METERS_PER_MM - instance.placement.offsetYMm * METERS_PER_MM;
    const aboveCrotch = worldY > avatar.landmarks.crotchY;
    const pelvisAxes = sampleTorsoAxes(avatar, worldY);
    const blend = aboveCrotch
      ? clamp01((worldY - avatar.landmarks.crotchY) / Math.max(0.001, avatar.landmarks.waistY - avatar.landmarks.crotchY))
      : 0;
    const centerX = aboveCrotch
      ? sideSign * lerp(Math.abs(baseLegX), pelvisAxes.halfWidth * 0.34, blend)
      : baseLegX;
    const legRadius = sampleLegRadius(avatar, worldY);
    const halfPanelRadius = Math.max(legRadius + anchor.initialMarginM, width * METERS_PER_MM / Math.PI * 0.44);
    const radiusX = aboveCrotch ? lerp(halfPanelRadius, pelvisAxes.halfWidth * 0.62, blend) : halfPanelRadius;
    const radiusZ = aboveCrotch ? lerp(halfPanelRadius, pelvisAxes.halfDepth, blend) : halfPanelRadius * 0.9;
    const angle = surfaceFront ? Math.PI * (1 - u) : Math.PI + Math.PI * u;
    const offset = (instance.particleStart + local) * 3;
    positions[offset] = centerX + Math.cos(angle) * radiusX + instance.placement.offsetXMm * METERS_PER_MM;
    positions[offset + 1] = worldY;
    positions[offset + 2] = Math.sin(angle) * radiusZ + instance.placement.offsetZMm * METERS_PER_MM;
  }
}

function findFoldCoordinate(piece: PatternPiece, instance: AssemblyPanelInstance): number {
  const foldEdge = getPatternEdges(piece).find((edge) => edge.role === "fold");
  const path = foldEdge ? instance.topology.edges.get(foldEdge.id) : undefined;
  if (!path || path.vertexIndices.length === 0) return instance.topology.boundsMm.minX;
  return path.vertexIndices.reduce((sum, vertex) => sum + instance.topology.positions2DMm[vertex * 2], 0) / path.vertexIndices.length;
}

function applyMinimalSeamStabilization(
  state: GarmentAssemblyState,
  visible: ReadonlySet<string>,
  passes: number,
  maximumCorrection: number,
): void {
  for (let pass = 0; pass < passes; pass += 1) {
    for (const stitch of state.stitchConstraints) {
      if (!stitch.instanceA || !stitch.instanceB) continue;
      if (!visible.has(stitch.instanceA) || !visible.has(stitch.instanceB)) continue;
      const a = evaluateReference(state.positions, stitch.a);
      const b = evaluateReference(state.positions, stitch.b);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const length = Math.hypot(dx, dy, dz);
      if (length <= stitch.restDistance + 1e-6) continue;
      const correction = Math.min(maximumCorrection, (length - stitch.restDistance) * 0.18);
      const scale = correction / Math.max(length, 1e-9);
      applyReferenceDelta(state.positions, stitch.a, dx * scale, dy * scale, dz * scale);
      applyReferenceDelta(state.positions, stitch.b, -dx * scale, -dy * scale, -dz * scale);
    }
  }
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

function applyReferenceDelta(
  positions: Float32Array,
  reference: GlobalPointReference,
  dx: number,
  dy: number,
  dz: number,
): void {
  for (let index = 0; index < reference.particleIndices.length; index += 1) {
    const offset = reference.particleIndices[index] * 3;
    const weight = reference.weights[index];
    positions[offset] += dx * weight;
    positions[offset + 1] += dy * weight;
    positions[offset + 2] += dz * weight;
  }
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

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function smoothstep(t: number): number {
  const clamped = clamp01(t);
  return clamped * clamped * (3 - 2 * clamped);
}

function uniqueDiagnostics(diagnostics: readonly ArrangementDiagnostic[]): ArrangementDiagnostic[] {
  const byKey = new Map<string, ArrangementDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}/${diagnostic.pieceId ?? ""}/${diagnostic.instanceId ?? ""}/${diagnostic.connectorId ?? ""}/${diagnostic.message}`;
    byKey.set(key, diagnostic);
  }
  return [...byKey.values()];
}
