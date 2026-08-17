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
import {
  alignSecondaryTubeGroups,
  auditAssemblySeamResiduals,
  type InitialSeamResidualAudit,
  type TubeGroupAlignmentCorrection,
} from "./InitialSeamResidual";
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
  initialSeamResidualAudit: {
    beforeTubeAlignment: InitialSeamResidualAudit;
    afterTubeAlignment: InitialSeamResidualAudit;
    tubeGroupCorrections: TubeGroupAlignmentCorrection[];
  };
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
  /** Normal radial no centro angular deste painel. */
  worldNormal?: AvatarVector3;
  center: AvatarVector3;
  radiusM: number;
  angularSpanRad: number;
  tubeGroupId?: string;
  tubeScoreMm2?: number;
}

interface SeamDerivedTubeCandidate {
  pairKey: string;
  componentKey: string;
  scoreMm2: number;
  frames: Array<readonly [string, SeamDerivedTubeFrame]>;
}

interface TubeCycleConnection {
  key: string;
  direction: Seam["direction"];
  firstInstanceId: string;
  secondInstanceId: string;
  firstRange: EdgeRange;
  secondRange: EdgeRange;
}

interface TubeCycle {
  nodes: string[];
  edges: TubeCycleConnection[];
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
  const beforeTubeAlignment = auditAssemblySeamResiduals(state, resolvedGarment);
  const tubeAlignment = alignSecondaryTubeGroups(state);
  const afterTubeAlignment = auditAssemblySeamResiduals(state, resolvedGarment);
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
    initialSeamResidualAudit: {
      beforeTubeAlignment,
      afterTubeAlignment,
      tubeGroupCorrections: tubeAlignment.corrections,
    },
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
    outwardNormal: [...(tubeFrame?.worldNormal ?? anchor.outwardNormal)],
    axis: [...(tubeFrame?.worldAxis ?? anchor.axis)],
    ...(tubeFrame ? { tubeCenter: [...tubeFrame.center] as AvatarVector3 } : {}),
    ...(tubeFrame ? { tubeRadiusM: tubeFrame.radiusM } : {}),
    ...(tubeFrame?.tubeGroupId ? { tubeGroupId: tubeFrame.tubeGroupId } : {}),
    ...(tubeFrame?.tubeScoreMm2 !== undefined ? { tubeScoreMm2: tubeFrame.tubeScoreMm2 } : {}),
    bodySide: instance.placement.bodySide,
    marginM: anchor.initialMarginM,
    mapping: tubeFrame
      ? "seam-derived-tube"
      : "rigid-panel",
    flipWinding: shouldFlipWinding(state.positions, instance, anchor.outwardNormal),
  };
}

/**
 * Detecta cascas tubulares materialmente disjuntas. Candidatos que disputam as
 * mesmas PanelInstances continuam exclusivos; loops auxiliares disjuntos são
 * preservados e depois alinhados rigidamente à casca global do componente.
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
  const selfTubeSeams: Seam[] = [];
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
    if (firstRanges.length !== 1 || secondRanges.length !== 1) continue;
    if (firstRanges[0].pieceId === secondRanges[0].pieceId) {
      selfTubeSeams.push(seam);
      continue;
    }
    const ids = [seam.first.pieceId, seam.second.pieceId].sort();
    const key = `${ids[0]}\u0000${ids[1]}`;
    const current = seamsByPair.get(key) ?? [];
    current.push(seam);
    seamsByPair.set(key, current);
  }
  const componentByPieceId = connectedComponentKeys(pieceAdjacency);

  for (const seam of selfTubeSeams) {
    const firstRange = seamSideRanges(seam, "first")[0];
    const secondRange = seamSideRanges(seam, "second")[0];
    if (!firstRange || !secondRange || firstRange.pieceId !== secondRange.pieceId) continue;
    const piece = pieceById.get(firstRange.pieceId);
    const instances = instanceByPieceId.get(firstRange.pieceId) ?? [];
    if (!piece || instances.length === 0) continue;
    const baseAxis = dominantSeamAxis(piece, [seam]);
    if (!baseAxis) continue;

    for (const instance of instances) {
      const frame = projectedPatternFrame(instance, baseAxis, 1, 1);
      const firstSide = seamRangeSide(piece, firstRange, frame);
      const secondSide = seamRangeSide(piece, secondRange, frame);
      const firstVector = edgeRangeVector(piece, firstRange);
      const rawSecondVector = edgeRangeVector(piece, secondRange);
      if (!firstVector || !rawSecondVector || firstSide === 0 || secondSide === 0 || firstSide === secondSide) continue;
      const secondVector = seam.direction === "opposite"
        ? [-rawSecondVector[0], -rawSecondVector[1]] as const
        : rawSecondVector;
      if (dot2(firstVector, frame.axis) * dot2(secondVector, frame.axis) <= 0) continue;

      const circumferenceM = (frame.acrossMaxMm - frame.acrossMinMm) * METERS_PER_MM;
      const radiusM = circumferenceM / (Math.PI * 2);
      if (!Number.isFinite(radiusM) || radiusM <= 1e-6) continue;
      const axialSpanMm = frame.axialMaxMm - frame.axialMinMm;
      const worldAxis = normalize3([frame.axis[0], -frame.axis[1], 0]);
      const worldAcross = cross3([0, 0, 1], worldAxis);
      const center = resolveTubeCenter([instance], avatar, worldAxis, axialSpanMm * METERS_PER_MM);
      candidates.push({
        pairKey: `self:${piece.id}:${seam.id}:${instance.id}`,
        componentKey: componentByPieceId.get(piece.id) ?? piece.id,
        scoreMm2: axialSpanMm * (frame.acrossMaxMm - frame.acrossMinMm),
        frames: [[instance.id, {
          ...frame,
          worldAxis,
          worldAcross,
          center,
          radiusM,
          angularSpanRad: Math.PI * 2,
        }]],
      });
    }
  }

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

  candidates.push(...buildMultipanelTubeCandidates(state, garment, avatar, componentByPieceId));

  /*
   * Candidatos que disputam as mesmas PanelInstances continuam mutuamente
   * exclusivos: vence a maior casca coerente. Subestruturas fechadas e
   * materialmente disjuntas, como corpo + faixa superior, podem coexistir no
   * mesmo connected component. A SeamGroup entre elas preserva o residual para
   * o XPBD sem obrigar uma delas a virar uma faixa plana ou abas radiais.
   */
  const assignedInstances = new Set<string>();
  for (const candidate of [...candidates].sort(
    (left, right) => right.scoreMm2 - left.scoreMm2 || left.pairKey.localeCompare(right.pairKey),
  )) {
    if (candidate.frames.some(([instanceId]) => assignedInstances.has(instanceId))) continue;
    for (const [instanceId, frame] of candidate.frames) {
      result.set(instanceId, {
        ...frame,
        tubeGroupId: candidate.pairKey,
        tubeScoreMm2: candidate.scoreMm2,
      });
      assignedInstances.add(instanceId);
    }
  }
  return result;
}

/**
 * Reconhece ciclos simples no multigrafo de costuras entre PanelInstances.
 * Cada painel do ciclo precisa oferecer duas bordas longitudinais em lados
 * opostos. A largura material acumulada define a circunferência; nenhuma
 * coordenada 2D é escalada para fechar o ciclo.
 */
function buildMultipanelTubeCandidates(
  state: GarmentAssemblyState,
  garment: GarmentDraft,
  avatar: AvatarParametricModel,
  componentByPieceId: ReadonlyMap<string, string>,
): SeamDerivedTubeCandidate[] {
  const seamById = new Map((garment.seams ?? []).map((seam) => [seam.id, seam]));
  const instanceById = new Map(state.instances.map((instance) => [instance.id, instance]));
  const pieceById = new Map(garment.pieces.map((piece) => [piece.id, piece]));
  const connectionByKey = new Map<string, TubeCycleConnection>();

  for (const constraint of state.stitchConstraints) {
    if (!constraint.instanceA || !constraint.instanceB || constraint.instanceA === constraint.instanceB) continue;
    const seam = seamById.get(constraint.seamId);
    const instanceA = instanceById.get(constraint.instanceA);
    const instanceB = instanceById.get(constraint.instanceB);
    if (!instanceA || !instanceB) continue;

    let firstInstanceId: string;
    let secondInstanceId: string;
    let firstRange: EdgeRange;
    let secondRange: EdgeRange;
    let direction: Seam["direction"];
    if (seam && seam.active !== false) {
      const firstRanges = seamSideRanges(seam, "first");
      const secondRanges = seamSideRanges(seam, "second");
      if (firstRanges.length !== 1 || secondRanges.length !== 1) continue;
      const firstIsA = instanceA.pieceId === firstRanges[0].pieceId
        && instanceB.pieceId === secondRanges[0].pieceId;
      const firstIsB = instanceB.pieceId === firstRanges[0].pieceId
        && instanceA.pieceId === secondRanges[0].pieceId;
      if (!firstIsA && !firstIsB) continue;
      firstInstanceId = firstIsA ? instanceA.id : instanceB.id;
      secondInstanceId = firstIsA ? instanceB.id : instanceA.id;
      firstRange = { ...firstRanges[0] };
      secondRange = { ...secondRanges[0] };
      direction = seam.direction;
    } else if (constraint.seamId.startsWith("fold:")) {
      const firstFold = getPatternEdges(instanceA.topology.sourcePiece).find((edge) => edge.role === "fold");
      const secondFold = getPatternEdges(instanceB.topology.sourcePiece).find((edge) => edge.role === "fold");
      if (!firstFold || !secondFold) continue;
      firstInstanceId = instanceA.id;
      secondInstanceId = instanceB.id;
      firstRange = { pieceId: instanceA.pieceId, edgeId: firstFold.id, startT: 0, endT: 1 };
      secondRange = { pieceId: instanceB.pieceId, edgeId: secondFold.id, startT: 0, endT: 1 };
      direction = "same";
    } else continue;
    const pair = instancePairKey(firstInstanceId, secondInstanceId);
    const key = `${constraint.seamId}\u0000${pair}`;
    if (!connectionByKey.has(key)) {
      connectionByKey.set(key, {
        key,
        direction,
        firstInstanceId,
        secondInstanceId,
        firstRange,
        secondRange,
      });
    }
  }

  const adjacency = new Map<string, TubeCycleConnection[]>();
  for (const connection of connectionByKey.values()) {
    const first = adjacency.get(connection.firstInstanceId) ?? [];
    first.push(connection);
    adjacency.set(connection.firstInstanceId, first);
    const second = adjacency.get(connection.secondInstanceId) ?? [];
    second.push(connection);
    adjacency.set(connection.secondInstanceId, second);
  }
  for (const connections of adjacency.values()) connections.sort((left, right) => left.key.localeCompare(right.key));

  const candidates: SeamDerivedTubeCandidate[] = [];
  const visited = new Set<string>();
  for (const start of [...adjacency.keys()].sort()) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const connection of adjacency.get(current) ?? []) {
        const neighbor = otherCycleInstance(connection, current);
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    component.sort();
    for (const cycle of selectShellCycles(component, adjacency, instanceById, pieceById)) {
      const candidate = buildMultipanelTubeCandidate(
        cycle,
        instanceById,
        pieceById,
        avatar,
        componentByPieceId,
      );
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function selectShellCycles(
  component: readonly string[],
  adjacency: ReadonlyMap<string, readonly TubeCycleConnection[]>,
  instanceById: ReadonlyMap<string, AssemblyPanelInstance>,
  pieceById: ReadonlyMap<string, PatternPiece>,
): TubeCycle[] {
  const selectedByInstance = new Map<string, ReadonlySet<string>>();
  for (const instanceId of component) {
    const instance = instanceById.get(instanceId);
    const piece = instance ? pieceById.get(instance.pieceId) : undefined;
    const connections = adjacency.get(instanceId) ?? [];
    if (!instance || !piece || connections.length < 2) continue;
    let best: { keys: ReadonlySet<string>; score: number; tie: string } | undefined;
    for (let firstIndex = 0; firstIndex < connections.length - 1; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < connections.length; secondIndex += 1) {
        const first = connections[firstIndex];
        const second = connections[secondIndex];
        const firstRange = cycleRangeFor(first, instanceId);
        const secondRange = cycleRangeFor(second, instanceId);
        const axis = dominantRangeAxis(piece, [firstRange, secondRange]);
        if (!axis) continue;
        const frame = projectedPatternFrame(instance, axis, 1, 1);
        const firstSide = seamRangeSide(piece, firstRange, frame);
        const secondSide = seamRangeSide(piece, secondRange, frame);
        if (firstSide === 0 || secondSide === 0 || firstSide === secondSide) continue;
        const firstLength = edgeRangeLength(piece, firstRange);
        const secondLength = edgeRangeLength(piece, secondRange);
        const score = firstLength + secondLength + Math.min(firstLength, secondLength);
        const tie = [first.key, second.key].sort().join("|");
        if (!best || score > best.score + 1e-6 || (Math.abs(score - best.score) <= 1e-6 && tie < best.tie)) {
          best = { keys: new Set([first.key, second.key]), score, tie };
        }
      }
    }
    if (best) selectedByInstance.set(instanceId, best.keys);
  }

  const shellAdjacency = new Map<string, TubeCycleConnection[]>();
  const seenConnections = new Set<string>();
  for (const instanceId of component) {
    for (const connection of adjacency.get(instanceId) ?? []) {
      if (seenConnections.has(connection.key)) continue;
      seenConnections.add(connection.key);
      if (!selectedByInstance.get(connection.firstInstanceId)?.has(connection.key)
        || !selectedByInstance.get(connection.secondInstanceId)?.has(connection.key)) continue;
      const first = shellAdjacency.get(connection.firstInstanceId) ?? [];
      first.push(connection);
      shellAdjacency.set(connection.firstInstanceId, first);
      const second = shellAdjacency.get(connection.secondInstanceId) ?? [];
      second.push(connection);
      shellAdjacency.set(connection.secondInstanceId, second);
    }
  }
  for (const connections of shellAdjacency.values()) connections.sort((left, right) => left.key.localeCompare(right.key));

  const cycles: TubeCycle[] = [];
  const visited = new Set<string>();
  for (const start of [...shellAdjacency.keys()].sort()) {
    if (visited.has(start)) continue;
    const nodes: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!;
      nodes.push(current);
      for (const connection of shellAdjacency.get(current) ?? []) {
        const neighbor = otherCycleInstance(connection, current);
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    nodes.sort();
    if (nodes.length < 3 || nodes.some((id) => (shellAdjacency.get(id)?.length ?? 0) !== 2)) continue;
    const edgeCount = new Set(nodes.flatMap((id) => (shellAdjacency.get(id) ?? []).map((edge) => edge.key))).size;
    if (edgeCount !== nodes.length) continue;
    const cycle = traceTubeCycle(nodes[0], shellAdjacency);
    if (cycle?.nodes.length === nodes.length) cycles.push(cycle);
  }
  return cycles;
}

function buildMultipanelTubeCandidate(
  cycle: TubeCycle,
  instanceById: ReadonlyMap<string, AssemblyPanelInstance>,
  pieceById: ReadonlyMap<string, PatternPiece>,
  avatar: AvatarParametricModel,
  componentByPieceId: ReadonlyMap<string, string>,
): SeamDerivedTubeCandidate | undefined {
  const baseAxisById = new Map<string, readonly [number, number]>();
  for (let index = 0; index < cycle.nodes.length; index += 1) {
    const instanceId = cycle.nodes[index];
    const instance = instanceById.get(instanceId);
    const piece = instance ? pieceById.get(instance.pieceId) : undefined;
    if (!instance || !piece) return undefined;
    const ranges = [
      cycleRangeFor(cycle.edges[(index - 1 + cycle.edges.length) % cycle.edges.length], instanceId),
      cycleRangeFor(cycle.edges[index], instanceId),
    ];
    const axis = dominantRangeAxis(piece, ranges);
    if (!axis) return undefined;
    baseAxisById.set(instanceId, axis);
  }

  const axialSignById = new Map<string, 1 | -1>([[cycle.nodes[0], 1]]);
  for (let index = 0; index < cycle.nodes.length; index += 1) {
    const currentId = cycle.nodes[index];
    const nextId = cycle.nodes[(index + 1) % cycle.nodes.length];
    const connection = cycle.edges[index];
    const currentInstance = instanceById.get(currentId)!;
    const nextInstance = instanceById.get(nextId)!;
    const currentPiece = pieceById.get(currentInstance.pieceId)!;
    const nextPiece = pieceById.get(nextInstance.pieceId)!;
    const currentVector = edgeRangeVector(currentPiece, cycleRangeFor(connection, currentId));
    const nextVector = edgeRangeVector(nextPiece, cycleRangeFor(connection, nextId));
    const currentSign = axialSignById.get(currentId);
    const currentAxis = baseAxisById.get(currentId)!;
    const nextAxis = baseAxisById.get(nextId)!;
    if (!currentVector || !nextVector || !currentSign) return undefined;
    const currentAlong = dot2(currentVector, currentAxis) * currentSign;
    const nextAlong = dot2(nextVector, nextAxis) * (connection.direction === "opposite" ? -1 : 1);
    if (Math.abs(currentAlong) <= 1e-6 || Math.abs(nextAlong) <= 1e-6) return undefined;
    const propagated: 1 | -1 = currentAlong * nextAlong >= 0 ? 1 : -1;
    const existing = axialSignById.get(nextId);
    if (existing && existing !== propagated) return undefined;
    axialSignById.set(nextId, propagated);
  }

  const patternFrames = new Map<string, PatternFrame2D>();
  let circumferenceMm = 0;
  let axialSpanMm = 0;
  for (let index = 0; index < cycle.nodes.length; index += 1) {
    const instanceId = cycle.nodes[index];
    const instance = instanceById.get(instanceId)!;
    const piece = pieceById.get(instance.pieceId)!;
    const incoming = cycleRangeFor(cycle.edges[(index - 1 + cycle.edges.length) % cycle.edges.length], instanceId);
    const outgoing = cycleRangeFor(cycle.edges[index], instanceId);
    const provisional = projectedPatternFrame(instance, baseAxisById.get(instanceId)!, axialSignById.get(instanceId)!, 1);
    const incomingSide = seamRangeSide(piece, incoming, provisional);
    const outgoingSide = seamRangeSide(piece, outgoing, provisional);
    if (incomingSide === 0 || outgoingSide === 0 || incomingSide === outgoingSide) return undefined;
    const acrossSign: 1 | -1 = incomingSide < outgoingSide ? 1 : -1;
    const frame = projectedPatternFrame(instance, baseAxisById.get(instanceId)!, axialSignById.get(instanceId)!, acrossSign);
    patternFrames.set(instanceId, frame);
    circumferenceMm += frame.acrossMaxMm - frame.acrossMinMm;
    axialSpanMm = Math.max(axialSpanMm, frame.axialMaxMm - frame.axialMinMm);
  }
  if (circumferenceMm <= 1e-6) return undefined;

  const radiusM = circumferenceMm * METERS_PER_MM / (Math.PI * 2);
  const rootFrame = patternFrames.get(cycle.nodes[0])!;
  const worldAxis = normalize3([rootFrame.axis[0], -rootFrame.axis[1], 0]);
  const baseNormal: AvatarVector3 = [0, 0, 1];
  const baseAcross = normalize3(cross3(baseNormal, worldAxis));
  const instances = cycle.nodes.map((id) => instanceById.get(id)!);
  const center = resolveTubeCenter(instances, avatar, worldAxis, axialSpanMm * METERS_PER_MM);
  const frames: Array<readonly [string, SeamDerivedTubeFrame]> = [];
  let angularCursor = -Math.PI;
  for (const instanceId of cycle.nodes) {
    const frame = patternFrames.get(instanceId)!;
    const angularSpanRad = (frame.acrossMaxMm - frame.acrossMinMm) * METERS_PER_MM / radiusM;
    const centerAngle = angularCursor + angularSpanRad * 0.5;
    const worldNormal = addScaled3(baseNormal, baseAcross, Math.cos(centerAngle), Math.sin(centerAngle));
    const worldAcross = addScaled3(baseNormal, baseAcross, -Math.sin(centerAngle), Math.cos(centerAngle));
    frames.push([instanceId, {
      ...frame,
      worldAxis,
      worldAcross,
      worldNormal,
      center,
      radiusM,
      angularSpanRad,
    }]);
    angularCursor += angularSpanRad;
  }
  return {
    pairKey: `cycle:${cycle.edges.map((edge) => edge.key).sort().join("|")}`,
    componentKey: componentByPieceId.get(instances[0].pieceId) ?? instances[0].pieceId,
    scoreMm2: axialSpanMm * circumferenceMm * 2,
    frames,
  };
}

function traceTubeCycle(
  root: string,
  adjacency: ReadonlyMap<string, readonly TubeCycleConnection[]>,
): TubeCycle | undefined {
  const firstEdge = adjacency.get(root)?.[0];
  if (!firstEdge) return undefined;
  const nodes = [root];
  const edges: TubeCycleConnection[] = [];
  let current = root;
  let edge = firstEdge;
  while (edges.length <= adjacency.size) {
    edges.push(edge);
    const next = otherCycleInstance(edge, current);
    if (next === root) return edges.length === nodes.length ? { nodes, edges } : undefined;
    if (nodes.includes(next)) return undefined;
    nodes.push(next);
    const nextEdges = adjacency.get(next) ?? [];
    const following = nextEdges.find((candidate) => candidate.key !== edge.key);
    if (!following) return undefined;
    current = next;
    edge = following;
  }
  return undefined;
}

function otherCycleInstance(connection: TubeCycleConnection, instanceId: string): string {
  return connection.firstInstanceId === instanceId ? connection.secondInstanceId : connection.firstInstanceId;
}

function cycleRangeFor(connection: TubeCycleConnection, instanceId: string): EdgeRange {
  return connection.firstInstanceId === instanceId ? connection.firstRange : connection.secondRange;
}

function dominantRangeAxis(piece: PatternPiece, ranges: readonly EdgeRange[]): readonly [number, number] | undefined {
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const range of ranges) {
    const vector = edgeRangeVector(piece, range);
    const length = edgeRangeLength(piece, range);
    if (!vector || length <= 1e-6) continue;
    const magnitude = Math.hypot(vector[0], vector[1]);
    if (magnitude <= 1e-6) continue;
    const x = vector[0] / magnitude;
    const y = vector[1] / magnitude;
    xx += length * x * x;
    xy += length * x * y;
    yy += length * y * y;
  }
  const total = xx + yy;
  if (total <= 1e-6) return undefined;
  const discriminant = Math.hypot(xx - yy, 2 * xy);
  const dominant = (total + discriminant) * 0.5;
  if (dominant / total < 0.82) return undefined;
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let axis: [number, number] = [Math.cos(angle), Math.sin(angle)];
  if ((Math.abs(axis[0]) >= Math.abs(axis[1]) ? axis[0] : axis[1]) < 0) axis = [-axis[0], -axis[1]];
  return axis;
}

function addScaled3(
  first: AvatarVector3,
  second: AvatarVector3,
  firstScale: number,
  secondScale: number,
): AvatarVector3 {
  return [
    first[0] * firstScale + second[0] * secondScale,
    first[1] * firstScale + second[1] * secondScale,
    first[2] * firstScale + second[2] * secondScale,
  ];
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
  const surfaceNormal: AvatarVector3 = frame.worldNormal
    ?? (instance.placement.surface === "back" ? [0, 0, -1] : [0, 0, 1]);
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
  for (const firstInstance of [...instanceById.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    if (componentVisited.has(firstInstance.id)) continue;
    const component: string[] = [];
    const discoveryQueue = [firstInstance.id];
    componentVisited.add(firstInstance.id);
    while (discoveryQueue.length > 0) {
      const current = discoveryQueue.shift()!;
      component.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (componentVisited.has(neighbor)) continue;
        componentVisited.add(neighbor);
        discoveryQueue.push(neighbor);
      }
    }

    component.sort();
    const tubeGroups = new Map<string, string[]>();
    for (const id of component) {
      const arrangement = instanceById.get(id)?.arrangement;
      if (arrangement?.mapping !== "seam-derived-tube") continue;
      const groupId = arrangement.tubeGroupId ?? `tube:${id}`;
      const group = tubeGroups.get(groupId) ?? [];
      group.push(id);
      tubeGroups.set(groupId, group);
    }
    for (const group of tubeGroups.values()) group.sort();
    const primaryTubeGroup = [...tubeGroups.entries()].sort((left, right) => {
      const leftScore = instanceById.get(left[1][0])?.arrangement?.tubeScoreMm2 ?? 0;
      const rightScore = instanceById.get(right[1][0])?.arrangement?.tubeScoreMm2 ?? 0;
      return rightScore - leftScore || left[0].localeCompare(right[0]);
    })[0];
    const roots = primaryTubeGroup?.[1] ?? component.slice(0, 1);
    const placed = new Set(roots);
    const queue = [...roots];
    while (queue.length > 0) {
      const fixedId = queue.shift()!;
      for (const movingId of [...(adjacency.get(fixedId) ?? [])].sort()) {
        if (placed.has(movingId)) continue;
        const fixed = instanceById.get(fixedId);
        const moving = instanceById.get(movingId);
        if (!fixed || !moving) continue;
        const movingTubeGroupId = moving.arrangement?.mapping === "seam-derived-tube"
          ? moving.arrangement.tubeGroupId ?? `tube:${moving.id}`
          : undefined;
        const movingTubeGroup = movingTubeGroupId ? tubeGroups.get(movingTubeGroupId) : undefined;
        if (movingTubeGroup && movingTubeGroup.some((id) => !placed.has(id))) {
          const translation = averageTubeGroupTranslation(
            state.positions,
            state.stitchConstraints,
            placed,
            new Set(movingTubeGroup),
          );
          for (const memberId of movingTubeGroup) {
            const member = instanceById.get(memberId);
            if (!member) continue;
            translateRigidPanel(state.positions, member, translation);
            const center = member.arrangement?.tubeCenter;
            if (center) member.arrangement!.tubeCenter = add3(center, translation);
            placed.add(memberId);
            queue.push(memberId);
          }
          continue;
        }
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

function averageTubeGroupTranslation(
  positions: Float32Array,
  constraints: GarmentAssemblyState["stitchConstraints"],
  fixedIds: ReadonlySet<string>,
  movingIds: ReadonlySet<string>,
): AvatarVector3 {
  const translation: AvatarVector3 = [0, 0, 0];
  let count = 0;
  for (const constraint of constraints) {
    if (!constraint.instanceA || !constraint.instanceB) continue;
    const firstIsFixed = fixedIds.has(constraint.instanceA) && movingIds.has(constraint.instanceB);
    const secondIsFixed = fixedIds.has(constraint.instanceB) && movingIds.has(constraint.instanceA);
    if (!firstIsFixed && !secondIsFixed) continue;
    const first = evaluateReference(positions, constraint.a);
    const second = evaluateReference(positions, constraint.b);
    const delta = firstIsFixed ? subtract3(first, second) : subtract3(second, first);
    translation[0] += delta[0];
    translation[1] += delta[1];
    translation[2] += delta[2];
    count += 1;
  }
  return count === 0
    ? [0, 0, 0]
    : translation.map((value) => value / count) as AvatarVector3;
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

  if (fixedInstance.arrangement?.mapping === "rigid-panel"
    && movingInstance.arrangement?.mapping === "rigid-panel") {
    const fixedInterior = normalize3(perpendicularToAxis(
      subtract3(panelCenter(positions, fixedInstance), fixedMidpoint),
      seamDirection,
    ));
    const movingInterior = normalize3(perpendicularToAxis(
      subtract3(panelCenter(positions, movingInstance), fixedMidpoint),
      seamDirection,
    ));
    const targetDirection = fixedInterior.map((value) => -value) as AvatarVector3;
    const unfoldAngle = signedAngleAroundAxis(movingInterior, targetDirection, seamDirection);
    if (Math.abs(unfoldAngle) > 1e-8) {
      rotateRigidPanelAroundLine(
        positions,
        movingInstance,
        fixedMidpoint,
        seamDirection,
        unfoldAngle,
      );
    }
    developAngleRad = unfoldAngle;
    developDirection = targetDirection;
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

function add3(first: AvatarVector3, second: AvatarVector3): AvatarVector3 {
  return [first[0] + second[0], first[1] + second[1], first[2] + second[2]];
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
