import {
  getPatternEdges,
  type GarmentDraft,
  type PatternPiece,
  type PatternPreviewPlacement,
  type PreviewBodySide,
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

    arrangeInstance(state, instance, piece, avatar, anchor);
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
): void {
  if (instance.placement.region === "arm") {
    mapArm(state.positions, instance, avatar, anchor);
  } else if (instance.placement.region === "leg") {
    mapLeg(state.positions, instance, avatar, anchor);
  } else {
    mapTorsoSurface(state.positions, instance, piece, avatar, anchor);
  }

  instance.arrangement = {
    anchorId: anchor.id,
    outwardNormal: [...anchor.outwardNormal],
    axis: [...anchor.axis],
    bodySide: instance.placement.bodySide,
    marginM: anchor.initialMarginM,
    mapping: instance.placement.region === "arm" ? "local-tube" : instance.placement.region === "leg" ? "anatomical-half-tube" : "body-surface",
    flipWinding: shouldFlipWinding(state.positions, instance, anchor.outwardNormal),
  };
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
