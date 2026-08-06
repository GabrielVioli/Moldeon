from pathlib import Path
import re

path = Path("apps/web/src/domain/sleeveSystem.ts")
source = path.read_text(encoding="utf-8")
pattern = r'function buildGuidedSleeveSeams\(.*?\nfunction buildLandmarkPairs'
replacement = r'''function buildGuidedSleeveSeams(
  body: ResolvedSleeveBody,
  sleeve: PatternPiece,
  compatibility: SleeveCompatibility,
): Seam[] {
  const seams: Seam[] = [];
  appendMappedConnectorSeams(
    seams,
    body.front,
    "frontArmhole",
    [body.frontNotchPosition],
    sleeve,
    "sleeveCapFront",
    [connectorBoundaryPosition(sleeve, "sleeveCapFront", 0.60)],
    "guided-sleeve:front-armhole",
    "Cava frontal",
    "opposite",
    true,
  );
  appendMappedConnectorSeams(
    seams,
    body.back,
    "backArmhole",
    body.backNotchPositions,
    sleeve,
    "sleeveCapBack",
    connectorInternalBoundaryPositions(sleeve, "sleeveCapBack"),
    "guided-sleeve:back-armhole",
    "Cava traseira",
    "same",
    false,
  );

  const sideEdges = edgesWithRole(sleeve, "sideSeam");
  if (sideEdges.length >= 2) {
    seams.push(seam(
      "guided-sleeve:underarm",
      "guided-sleeve:underarm",
      "Costura inferior das mangas",
      fullRange(sleeve.id, sideEdges[0].id),
      fullRange(sleeve.id, sideEdges[1].id),
      "opposite",
      "standard",
    ));
  }

  const frontShoulder = firstEdge(body.front, "shoulder");
  const backShoulder = firstEdge(body.back, "shoulder");
  if (frontShoulder && backShoulder) {
    seams.push(seam(
      "guided-sleeve:body-shoulder",
      "guided-sleeve:body-shoulder",
      "Ombros do corpo",
      fullRange(body.front.id, frontShoulder.id),
      fullRange(body.back.id, backShoulder.id),
      "same",
      "standard",
    ));
  }
  const frontSide = firstEdge(body.front, "sideSeam");
  const backSide = firstEdge(body.back, "sideSeam");
  if (frontSide && backSide) {
    seams.push(seam(
      "guided-sleeve:body-side",
      "guided-sleeve:body-side",
      "Laterais do corpo",
      fullRange(body.front.id, frontSide.id),
      fullRange(body.back.id, backSide.id),
      "same",
      "standard",
    ));
  }

  return seams.map((current) => ({
    ...current,
    easeRatio: current.treatment === "ease"
      ? Math.abs(compatibility.totalDifferenceMm) / Math.max(compatibility.totalArmholeMm, 1)
      : 0,
  }));
}

function appendMappedConnectorSeams(
  target: Seam[],
  firstPiece: PatternPiece,
  firstRole: SegmentRole,
  firstLandmarks: readonly number[],
  secondPiece: PatternPiece,
  secondRole: SegmentRole,
  secondLandmarks: readonly number[],
  groupId: string,
  label: string,
  direction: Seam["direction"],
  reverseSecondIntervals: boolean,
): void {
  const firstBoundaries = connectorLandmarkBoundaries(firstLandmarks);
  const secondBoundaries = connectorLandmarkBoundaries(secondLandmarks);
  const intervalCount = Math.min(firstBoundaries.length, secondBoundaries.length) - 1;
  const firstEdgeBoundaries = connectorEdgeBoundaryPositions(firstPiece, firstRole);
  const secondEdgeBoundaries = connectorEdgeBoundaryPositions(secondPiece, secondRole);
  let sequence = 0;

  for (let intervalIndex = 0; intervalIndex < intervalCount; intervalIndex += 1) {
    const secondIntervalIndex = reverseSecondIntervals
      ? intervalCount - intervalIndex - 1
      : intervalIndex;
    const firstStart = firstBoundaries[intervalIndex];
    const firstEnd = firstBoundaries[intervalIndex + 1];
    const secondStart = secondBoundaries[secondIntervalIndex];
    const secondEnd = secondBoundaries[secondIntervalIndex + 1];
    const firstSpan = firstEnd - firstStart;
    const secondSpan = secondEnd - secondStart;
    if (firstSpan <= 1e-9 || secondSpan <= 1e-9) continue;

    const localBoundaries = new Set<number>([0, 1]);
    for (const boundary of firstEdgeBoundaries) {
      if (boundary > firstStart + 1e-9 && boundary < firstEnd - 1e-9) {
        localBoundaries.add(roundArcT((boundary - firstStart) / firstSpan));
      }
    }
    for (const boundary of secondEdgeBoundaries) {
      if (boundary > secondStart + 1e-9 && boundary < secondEnd - 1e-9) {
        const local = (boundary - secondStart) / secondSpan;
        localBoundaries.add(roundArcT(direction === "opposite" ? 1 - local : local));
      }
    }

    const ordered = [...localBoundaries].sort((left, right) => left - right);
    for (let localIndex = 0; localIndex < ordered.length - 1; localIndex += 1) {
      const localStart = ordered[localIndex];
      const localEnd = ordered[localIndex + 1];
      if (localEnd - localStart <= 1e-9) continue;
      const firstGlobalStart = firstStart + firstSpan * localStart;
      const firstGlobalEnd = firstStart + firstSpan * localEnd;
      const secondGlobalStart = direction === "opposite"
        ? secondStart + secondSpan * (1 - localEnd)
        : secondStart + secondSpan * localStart;
      const secondGlobalEnd = direction === "opposite"
        ? secondStart + secondSpan * (1 - localStart)
        : secondStart + secondSpan * localEnd;
      const first = connectorRangeAt(
        firstPiece,
        firstRole,
        firstGlobalStart,
        firstGlobalEnd,
      );
      const second = connectorRangeAt(
        secondPiece,
        secondRole,
        secondGlobalStart,
        secondGlobalEnd,
      );
      if (!first || !second) continue;
      sequence += 1;
      target.push(seam(
        `${groupId}:${sequence}`,
        groupId,
        `${label} · trecho ${sequence}`,
        first,
        second,
        direction,
        "ease",
      ));
    }
  }
}

function connectorLandmarkBoundaries(values: readonly number[]): number[] {
  return [...new Set([
    0,
    ...values.map((value) => roundArcT(clamp(value, 0.001, 0.999))),
    1,
  ])].sort((left, right) => left - right);
}

function connectorEdgeBoundaryPositions(
  piece: PatternPiece,
  role: SegmentRole,
): number[] {
  const edges = edgesWithRole(piece, role);
  const lengths = edges.map((edge) => edgeLength(piece, edge));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || edges.length < 2) return [];
  let cursor = 0;
  return lengths.slice(0, -1).map((length) => {
    cursor += length;
    return roundArcT(cursor / total);
  });
}

function connectorRangeAt(
  piece: PatternPiece,
  role: SegmentRole,
  normalizedStart: number,
  normalizedEnd: number,
): EdgeRange | undefined {
  const edges = edgesWithRole(piece, role);
  const lengths = edges.map((edge) => edgeLength(piece, edge));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || edges.length === 0) return undefined;
  const startDistance = clamp(normalizedStart, 0, 1) * total;
  const endDistance = clamp(normalizedEnd, 0, 1) * total;
  const midpoint = (startDistance + endDistance) / 2;
  let cursor = 0;
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const length = lengths[index];
    const next = cursor + length;
    if (midpoint <= next + 1e-7 || index === edges.length - 1) {
      const localStart = clamp(startDistance - cursor, 0, length);
      const localEnd = clamp(endDistance - cursor, 0, length);
      const startT = edgeTAtArcDistance(piece, edge, localStart, length);
      const endT = edgeTAtArcDistance(piece, edge, localEnd, length);
      if (endT - startT <= 1e-9) return undefined;
      return {
        pieceId: piece.id,
        edgeId: edge.id,
        startT: roundArcT(startT),
        endT: roundArcT(endT),
      };
    }
    cursor = next;
  }
  return undefined;
}

function edgeTAtArcDistance(
  piece: PatternPiece,
  edge: PatternEdge,
  requestedDistance: number,
  edgeLengthMm: number,
): number {
  if (requestedDistance <= 1e-9) return 0;
  if (requestedDistance >= edgeLengthMm - 1e-9) return 1;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const middle = (low + high) / 2;
    const length = edgeRangeLength(piece, {
      pieceId: piece.id,
      edgeId: edge.id,
      startT: 0,
      endT: middle,
    });
    if (length < requestedDistance) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function roundArcT(value: number): number {
  return Math.round(clamp(value, 0, 1) * 1_000_000_000) / 1_000_000_000;
}

function buildLandmarkPairs'''
updated, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f"guided seam block replacement failed: {count}")

# Remove the superseded approximate partition helper.
updated, count = re.subn(
    r'function partitionRoleIntervals\(.*?\nfunction connectorBoundaryPosition',
    'function connectorBoundaryPosition',
    updated,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"old partition helper removal failed: {count}")

path.write_text(updated, encoding="utf-8")
print("Prompt 8 exact arc seam mapping applied")
