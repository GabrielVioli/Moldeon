from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)

# ---------------------------------------------------------------------------
# PanelRefinement: non-uniform structured grid whose material columns/rows are
# authored seam anchor positions. This is still a derived runtime mesh.
# ---------------------------------------------------------------------------
path = Path("apps/web/src/garment3d/PanelRefinement.ts")
text = path.read_text(encoding="utf-8")
anchor = '''function cloneEdgePaths(
  edges: ReadonlyMap<string, PanelEdgePath>,
): Map<string, PanelEdgePath> {'''
helper = r'''/**
 * Structured quadrilateral remesh with explicit material stops on one edge.
 *
 * The supplied stops are edge-local t values in canonical edge direction.
 * They are mirrored to the opposite edge, producing a nested developable
 * strip grid. This is used when an attachment seam owns exact material
 * correspondence anchors that must become coarse/fine hinge columns rather
 * than falling inside unrelated 80 mm cells.
 */
export function remeshStructuredQuadrilateralWithEdgeStops(
  topology: PanelTopology,
  edgeId: string,
  stopsT: readonly number[],
  transverseTargetCellMm = 80,
): PanelTopology | undefined {
  const piece = topology.sourcePiece;
  const edges = getPatternEdges(piece);
  if (piece.points.length !== 4
    || edges.length !== 4
    || (piece.segments?.length && piece.segments.some((segment) => segment.kind !== "line"))
    || piece.points.some((point) => point.handleIn || point.handleOut)
    || (piece.darts?.length ?? 0) > 0
    || !Number.isFinite(transverseTargetCellMm)
    || transverseTargetCellMm <= 0) return undefined;

  const edgeIndex = edges.findIndex((edge) => edge.id === edgeId);
  if (edgeIndex < 0) return undefined;
  const [p00, p10, p11, p01] = piece.points;
  const corners = [p00, p10, p11, p01];
  const turns = corners.map((point, index) => {
    const next = corners[(index + 1) % corners.length];
    const after = corners[(index + 2) % corners.length];
    return (next.xMm - point.xMm) * (after.yMm - next.yMm)
      - (next.yMm - point.yMm) * (after.xMm - next.xMm);
  });
  if (turns.some((turn) => Math.abs(turn) <= 1e-6)
    || (turns.some((turn) => turn > 0) && turns.some((turn) => turn < 0))) return undefined;

  const horizontalMm = Math.max(
    Math.hypot(p10.xMm - p00.xMm, p10.yMm - p00.yMm),
    Math.hypot(p11.xMm - p01.xMm, p11.yMm - p01.yMm),
  );
  const verticalMm = Math.max(
    Math.hypot(p11.xMm - p10.xMm, p11.yMm - p10.yMm),
    Math.hypot(p01.xMm - p00.xMm, p01.yMm - p00.yMm),
  );
  if (horizontalMm <= 1e-6 || verticalMm <= 1e-6) return undefined;

  const canonicalStops = normalizeStructuredStops(stopsT);
  if (canonicalStops.length < 3) return undefined;
  const edgeRunsAlongU = edgeIndex === 0 || edgeIndex === 2;
  const orientedStops = edgeIndex === 2 || edgeIndex === 3
    ? canonicalStops.map((value) => 1 - value).sort((a, b) => a - b)
    : canonicalStops;
  const uValues = edgeRunsAlongU
    ? orientedStops
    : uniformStructuredStops(horizontalMm, transverseTargetCellMm);
  const vValues = edgeRunsAlongU
    ? uniformStructuredStops(verticalMm, transverseTargetCellMm)
    : orientedStops;
  const columns = uValues.length - 1;
  const rows = vValues.length - 1;
  if (columns < 1 || rows < 1) return undefined;

  const positions: number[] = [];
  const vertexSources: PanelVertexSourceMapping[] = [];
  const sourcePointVertices = new Map<string, number[]>();
  const indexAt = (column: number, row: number) => row * (columns + 1) + column;

  for (let row = 0; row <= rows; row += 1) {
    const v = vValues[row];
    for (let column = 0; column <= columns; column += 1) {
      const u = uValues[column];
      const topX = p00.xMm + (p10.xMm - p00.xMm) * u;
      const topY = p00.yMm + (p10.yMm - p00.yMm) * u;
      const bottomX = p01.xMm + (p11.xMm - p01.xMm) * u;
      const bottomY = p01.yMm + (p11.yMm - p01.yMm) * u;
      const x = topX + (bottomX - topX) * v;
      const y = topY + (bottomY - topY) * v;
      const vertexIndex = indexAt(column, row);
      positions.push(x, y);

      let boundaryEdgeIndex = -1;
      let t = 0;
      if (row === 0) { boundaryEdgeIndex = 0; t = u; }
      else if (column === columns) { boundaryEdgeIndex = 1; t = v; }
      else if (row === rows) { boundaryEdgeIndex = 2; t = 1 - u; }
      else if (column === 0) { boundaryEdgeIndex = 3; t = 1 - v; }
      const cornerPoint = row === 0 && column === 0 ? p00
        : row === 0 && column === columns ? p10
          : row === rows && column === columns ? p11
            : row === rows && column === 0 ? p01
              : undefined;
      const edge = boundaryEdgeIndex >= 0 ? edges[boundaryEdgeIndex] : undefined;
      vertexSources.push({
        vertexIndex,
        sourcePatternId: topology.sourcePatternId,
        ...(cornerPoint ? { sourcePointId: cornerPoint.id } : {}),
        ...(edge ? { sourceSegmentId: edge.id, edgeId: edge.id, t } : {}),
        ...(edge ? { interpolation: { startPointId: edge.startPointId, endPointId: edge.endPointId, t } } : {}),
        restPosition2DMm: { x, y },
      });
      if (cornerPoint) sourcePointVertices.set(cornerPoint.id, [vertexIndex]);
    }
  }

  const triangles: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = indexAt(column, row);
      const b = indexAt(column + 1, row);
      const c = indexAt(column + 1, row + 1);
      const d = indexAt(column, row + 1);
      triangles.push(a, b, c, a, c, d);
    }
  }
  const edgeVertexIndices = [
    Array.from({ length: columns + 1 }, (_, column) => indexAt(column, 0)),
    Array.from({ length: rows + 1 }, (_, row) => indexAt(columns, row)),
    Array.from({ length: columns + 1 }, (_, offset) => indexAt(columns - offset, rows)),
    Array.from({ length: rows + 1 }, (_, offset) => indexAt(0, rows - offset)),
  ];
  const edgePaths = new Map(edges.map((edge, index) => [
    edge.id,
    createEdgePath(piece.id, edge.id, edgeVertexIndices[index], positions),
  ]));
  const boundaryVertices = [
    ...edgeVertexIndices[0].slice(0, -1),
    ...edgeVertexIndices[1].slice(0, -1),
    ...edgeVertexIndices[2].slice(0, -1),
    ...edgeVertexIndices[3].slice(0, -1),
  ];
  const positions2DMm = Float32Array.from(positions);
  const xCoordinates = positions.filter((_value, index) => index % 2 === 0);
  const yCoordinates = positions.filter((_value, index) => index % 2 === 1);
  const minX = Math.min(...xCoordinates);
  const minY = Math.min(...yCoordinates);
  const maxX = Math.max(...xCoordinates);
  const maxY = Math.max(...yCoordinates);
  return {
    ...topology,
    positions2DMm,
    positions2D: Float32Array.from(positions.map((value) => value * 0.001)),
    triangles: Uint32Array.from(triangles),
    boundaryVertices,
    edges: edgePaths,
    edgeVertices: new Map([...edgePaths].map(([id, path]) => [id, [...path.vertexIndices]])),
    sourcePointVertices,
    vertexSources,
    sourcePointToVertices: sourcePointVertices,
    boundsMm: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
  };
}

function normalizeStructuredStops(values: readonly number[]): number[] {
  const sorted = [0, 1, ...values]
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.min(1, Math.max(0, value)))
    .sort((a, b) => a - b);
  const result: number[] = [];
  for (const value of sorted) {
    if (result.length === 0 || Math.abs(value - result[result.length - 1]) > 1e-7) result.push(value);
  }
  return result;
}

function uniformStructuredStops(lengthMm: number, targetCellMm: number): number[] {
  const count = Math.max(2, Math.ceil(lengthMm / targetCellMm));
  return Array.from({ length: count + 1 }, (_, index) => index / count);
}

function cloneEdgePaths(
  edges: ReadonlyMap<string, PanelEdgePath>,
): Map<string, PanelEdgePath> {'''
text = replace_once(text, anchor, helper, "insert structured edge-stop remesh")
path.write_text(text, encoding="utf-8")
print(f"patched {path}")

# ---------------------------------------------------------------------------
# GarmentAssembly: derive strip anchor + hinge columns from canonical seam
# correspondence before fine topology is built, and retain the runtime plan on
# the physical PanelInstance so coarse topology can be exactly nested.
# ---------------------------------------------------------------------------
path = Path("apps/web/src/garment3d/GarmentAssembly.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
'''  recommendedPanelRefinement,
  remeshStructuredQuadrilateral,
  refinePanelTopology,''',
'''  recommendedPanelRefinement,
  remeshStructuredQuadrilateral,
  remeshStructuredQuadrilateralWithEdgeStops,
  refinePanelTopology,''',
    "import edge-stop remesh",
)
text = replace_once(
    text,
'''export interface AssemblyPanelInstance {
  id: string;''',
'''export interface AssemblyStructuredAttachmentPlan {
  seamGroupId: string;
  edgeId: string;
  /** Canonical edge-local t positions: seam anchors plus one hinge per interval. */
  stopsT: number[];
}

export interface AssemblyPanelInstance {
  id: string;''',
    "attachment plan interface",
)
text = replace_once(
    text,
'''  vertexSources: Array<PanelVertexSourceMapping & { panelInstanceId: string; meshVertexIndex: number }>;
  arrangement?: AssemblyInstanceArrangement;''',
'''  vertexSources: Array<PanelVertexSourceMapping & { panelInstanceId: string; meshVertexIndex: number }>;
  structuredAttachmentPlan?: AssemblyStructuredAttachmentPlan;
  arrangement?: AssemblyInstanceArrangement;''',
    "instance attachment plan field",
)
text = replace_once(
    text,
'''  const structuredSelfSeamPieces = findStructuredSelfSeamPieces(snapshots, garment);
  for (const snapshot of snapshots) {''',
'''  const structuredSelfSeamPieces = findStructuredSelfSeamPieces(snapshots, garment);
  const structuredAttachmentPlans = buildStructuredAttachmentPlans(
    snapshots,
    garment,
    structuredSelfSeamPieces,
  );
  for (const snapshot of snapshots) {''',
    "derive attachment plans",
)
text = replace_once(
    text,
'''      if (structuredSelfSeamPieces.has(snapshot.piece.id)) {
        const assemblyBase = remeshStructuredQuadrilateral(baseTopology, 80);
        topology = assemblyBase
          ? refinePanelTopology(assemblyBase, 2)
          : refinePanelTopology(
              baseTopology,
              recommendedPanelRefinement(baseTopology),
            );''',
'''      if (structuredSelfSeamPieces.has(snapshot.piece.id)) {
        const attachmentPlan = structuredAttachmentPlans.get(snapshot.piece.id);
        const assemblyBase = attachmentPlan
          ? remeshStructuredQuadrilateralWithEdgeStops(
              baseTopology,
              attachmentPlan.edgeId,
              attachmentPlan.stopsT,
              80,
            )
          : remeshStructuredQuadrilateral(baseTopology, 80);
        topology = assemblyBase
          ? refinePanelTopology(assemblyBase, 2)
          : refinePanelTopology(
              baseTopology,
              recommendedPanelRefinement(baseTopology),
            );''',
    "attachment-aware fine base topology",
)
text = replace_once(
    text,
'''        vertexSources: topology.vertexSources.map((source) => ({
          ...source,
          panelInstanceId: placement.id,
          meshVertexIndex: source.vertexIndex,
        })),
      };''',
'''        vertexSources: topology.vertexSources.map((source) => ({
          ...source,
          panelInstanceId: placement.id,
          meshVertexIndex: source.vertexIndex,
        })),
        ...(structuredAttachmentPlans.get(snapshot.piece.id)
          ? { structuredAttachmentPlan: structuredClone(structuredAttachmentPlans.get(snapshot.piece.id)!) }
          : {}),
      };''',
    "retain attachment plan on instance",
)
anchor = '''function findStructuredSelfSeamPieces(
  snapshots: readonly PatternSnapshot[],
  garment: GarmentDraft,
): Set<string> {'''
helper = r'''function buildStructuredAttachmentPlans(
  snapshots: readonly PatternSnapshot[],
  garment: GarmentDraft,
  structuredSelfSeamPieces: ReadonlySet<string>,
): Map<string, AssemblyStructuredAttachmentPlan> {
  const pieces = snapshots.map((snapshot) => snapshot.piece);
  const plans = new Map<string, AssemblyStructuredAttachmentPlan>();
  for (const seam of garment.seams ?? []) {
    if (seam.active === false) continue;
    const firstRanges = orderCompositeEdgeRangesByContinuity(pieces, seamSideRanges(seam, "first"));
    const secondRanges = orderCompositeEdgeRangesByContinuity(pieces, seamSideRanges(seam, "second"));
    const firstLength = edgeRangeSequenceLength(pieces, firstRanges);
    const secondLength = edgeRangeSequenceLength(pieces, secondRanges);
    if (firstLength <= DISTANCE_EPSILON || secondLength <= DISTANCE_EPSILON) continue;
    const mismatchMm = Math.abs(firstLength - secondLength);
    const targetRatio = Number.isFinite(seam.targetRatio) && (seam.targetRatio ?? 0) > 0
      ? seam.targetRatio! : Math.max(0.000001, 1 + seam.easeRatio);
    const slackMm = Number.isFinite(seam.slackMm) && (seam.slackMm ?? 0) >= 0 ? seam.slackMm! : 0;
    // Exact developable attachment planning is only valid for metric-compatible
    // closure. Ease/gather remain attachment relations but are not forced into
    // a zero-energy strip topology.
    if (mismatchMm > 0.5 || Math.abs(targetRatio - 1) > 1e-6 || slackMm > 1e-6) continue;
    const sampleCount = Math.min(MAX_SEAM_SAMPLES, Math.max(2,
      Math.ceil(Math.max(firstLength, secondLength) / SEAM_SAMPLE_SPACING_MM) + 1));

    for (const side of ["first", "second"] as const) {
      const localRanges = side === "first" ? firstRanges : secondRanges;
      const oppositeRanges = side === "first" ? secondRanges : firstRanges;
      if (localRanges.length !== 1) continue;
      const localRange = localRanges[0];
      if (!structuredSelfSeamPieces.has(localRange.pieceId)) continue;
      if (oppositeRanges.every((range) => range.pieceId === localRange.pieceId)) continue;
      const edgeId = localRange.edgeId;
      const anchors: number[] = [];
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const progress = sampleCount === 1 ? 0 : sampleIndex / (sampleCount - 1);
        const localProgress = side === "first"
          ? progress
          : seam.direction === "opposite" ? 1 - progress : progress;
        anchors.push(
          localRange.startT + (localRange.endT - localRange.startT) * localProgress,
        );
      }
      anchors.sort((a, b) => a - b);
      const stops = [...anchors];
      for (let index = 0; index + 1 < anchors.length; index += 1) {
        stops.push((anchors[index] + anchors[index + 1]) * 0.5);
      }
      const normalized = [...new Set(stops.map((value) => Math.round(value * 1e9) / 1e9))]
        .sort((a, b) => a - b);
      const existing = plans.get(localRange.pieceId);
      if (existing && existing.edgeId !== edgeId) {
        plans.delete(localRange.pieceId);
        continue;
      }
      plans.set(localRange.pieceId, {
        seamGroupId: seam.groupId ?? seam.id,
        edgeId,
        stopsT: existing
          ? [...new Set([...existing.stopsT, ...normalized])].sort((a, b) => a - b)
          : normalized,
      });
    }
  }
  return plans;
}

function findStructuredSelfSeamPieces(
  snapshots: readonly PatternSnapshot[],
  garment: GarmentDraft,
): Set<string> {'''
text = replace_once(text, anchor, helper, "attachment plan derivation")
path.write_text(text, encoding="utf-8")
print(f"patched {path}")

# ---------------------------------------------------------------------------
# CoarseAssemblyMesh: rebuild exactly the same unrefined attachment base.
# ---------------------------------------------------------------------------
path = Path("apps/web/src/garment3d/CoarseAssemblyMesh.ts")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
'''import { refinePanelTopology, remeshStructuredQuadrilateral } from "./PanelRefinement";''',
'''import {
  refinePanelTopology,
  remeshStructuredQuadrilateral,
  remeshStructuredQuadrilateralWithEdgeStops,
} from "./PanelRefinement";''',
    "coarse import edge-stop remesh",
)
text = replace_once(
    text,
'''  const topology = buildLocalCoarseTopology(baseTopology, hasStructuredSelfSeam);''',
'''  const topology = buildLocalCoarseTopology(
    baseTopology,
    hasStructuredSelfSeam,
    instance.structuredAttachmentPlan,
  );''',
    "pass attachment plan to coarse topology",
)
text = replace_once(
    text,
'''function buildLocalCoarseTopology(base: PanelTopology, hasStructuredSelfSeam: boolean): PanelTopology {
  // This is the exact parent topology used by buildGarmentAssembly before two
  // midpoint subdivisions. Fine vertices are therefore nested barycentric
  // points of coarse triangles, not samples of an unrelated triangulation.
  if (hasStructuredSelfSeam) {
    const structured = remeshStructuredQuadrilateral(base, 80);
    if (structured) return structured;
  }''',
'''function buildLocalCoarseTopology(
  base: PanelTopology,
  hasStructuredSelfSeam: boolean,
  attachmentPlan: AssemblyPanelInstance["structuredAttachmentPlan"],
): PanelTopology {
  // This is the exact parent topology used by buildGarmentAssembly before two
  // midpoint subdivisions. Fine vertices are therefore nested barycentric
  // points of coarse triangles, not samples of an unrelated triangulation.
  if (hasStructuredSelfSeam) {
    const structured = attachmentPlan
      ? remeshStructuredQuadrilateralWithEdgeStops(
          base,
          attachmentPlan.edgeId,
          attachmentPlan.stopsT,
          80,
        )
      : remeshStructuredQuadrilateral(base, 80);
    if (structured) return structured;
  }''',
    "attachment-aware coarse base",
)
path.write_text(text, encoding="utf-8")
print(f"patched {path}")
