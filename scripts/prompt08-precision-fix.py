from pathlib import Path
import re

DOMAIN = Path("apps/web/src/domain/sleeveSystem.ts")
source = DOMAIN.read_text(encoding="utf-8")

old_inverse = '''function edgeTAtArcDistance(
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
'''
new_inverse = '''function edgeTAtArcDistance(
  piece: PatternPiece,
  edge: PatternEdge,
  requestedDistance: number,
  edgeLengthMm: number,
): number {
  if (requestedDistance <= 1e-9) return 0;
  if (requestedDistance >= edgeLengthMm - 1e-9) return 1;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 44; iteration += 1) {
    const middle = (low + high) / 2;
    const length = preciseEdgeArcLength(piece, edge, 0, middle, 128);
    if (length < requestedDistance) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
'''
if source.count(old_inverse) != 1:
    raise SystemExit("continuous inverse insertion point not found")
source = source.replace(old_inverse, new_inverse, 1)

old_length = '''function edgeLength(piece: PatternPiece, edge: PatternEdge): number {
  return edgeRangeLength(piece, fullRange(piece.id, edge.id));
}
'''
new_length = '''function edgeLength(piece: PatternPiece, edge: PatternEdge): number {
  return preciseEdgeArcLength(piece, edge, 0, 1, 192);
}

function preciseEdgeArcLength(
  piece: PatternPiece,
  edge: PatternEdge,
  startT: number,
  endT: number,
  samples: number,
): number {
  const start = clamp(startT, 0, 1);
  const end = clamp(endT, 0, 1);
  if (end <= start) return 0;
  let previous = preciseEdgePointAt(piece, edge, start);
  let length = 0;
  for (let index = 1; index <= samples; index += 1) {
    const t = start + (end - start) * (index / samples);
    const current = preciseEdgePointAt(piece, edge, t);
    length += distance(previous, current);
    previous = current;
  }
  return length;
}

function preciseEdgePointAt(
  piece: PatternPiece,
  edge: PatternEdge,
  t: number,
): PatternVector {
  const start = piece.points.find((pointValue) => pointValue.id === edge.startPointId);
  const end = piece.points.find((pointValue) => pointValue.id === edge.endPointId);
  if (!start || !end) {
    throw new RangeError(`A borda ${edge.id} referencia pontos ausentes.`);
  }
  const segment = piece.segments?.find((candidate) => candidate.id === edge.id);
  const cubic = segment?.kind === "cubic" || Boolean(start.handleOut || end.handleIn);
  if (!cubic) return lerp(start, end, t);
  const control1 = segment?.kind === "cubic" && segment.control1
    ? segment.control1
    : {
        xMm: start.xMm + (start.handleOut?.xMm ?? 0),
        yMm: start.yMm + (start.handleOut?.yMm ?? 0),
      };
  const control2 = segment?.kind === "cubic" && segment.control2
    ? segment.control2
    : {
        xMm: end.xMm + (end.handleIn?.xMm ?? 0),
        yMm: end.yMm + (end.handleIn?.yMm ?? 0),
      };
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    xMm: start.xMm * a + control1.xMm * b + control2.xMm * c + end.xMm * d,
    yMm: start.yMm * a + control1.yMm * b + control2.yMm * c + end.yMm * d,
  };
}
'''
if source.count(old_length) != 1:
    raise SystemExit("edge length replacement point not found")
source = source.replace(old_length, new_length, 1)
DOMAIN.write_text(source, encoding="utf-8")

TEST = Path("apps/web/src/domain/sleeveSystem.test.ts")
test = TEST.read_text(encoding="utf-8")
test = test.replace(
    'import { edgeRangeLength, getPatternEdges, type GarmentDraft, type PatternPiece } from "./pattern";\n',
    'import { getPatternEdges, type EdgeRange, type GarmentDraft, type PatternPiece } from "./pattern";\n',
    1,
)
pattern = r'  it\("covers every front and back armhole and cap interval exactly once", \(\) => \{.*?\n  \}\);\n\n'
replacement = '''  it("covers every front and back armhole and cap interval exactly once", () => {
    const garment = bodice();
    const [front, back] = bodyDefinitions(garment);
    const draft = draftGuidedSleeve(
      garment,
      front.id,
      back.id,
      createDefaultSleeveSettings(garment, front.id, back.id, "short"),
    );
    const groups = [
      {
        id: "guided-sleeve:front-armhole",
        body: front,
        bodyRole: "frontArmhole" as const,
        capRole: "sleeveCapFront" as const,
      },
      {
        id: "guided-sleeve:back-armhole",
        body: back,
        bodyRole: "backArmhole" as const,
        capRole: "sleeveCapBack" as const,
      },
    ];
    for (const group of groups) {
      const seams = draft.seams.filter((seam) => seam.groupId === group.id);
      expectConnectorCoverage(group.body, group.bodyRole, seams.map((seam) => seam.first));
      expectConnectorCoverage(draft.sleevePiece, group.capRole, seams.map((seam) => seam.second));
      expect(seams.every((seam) => seam.first.startT < seam.first.endT && seam.second.startT < seam.second.endT)).toBe(true);
    }
  });

'''
test, count = re.subn(pattern, replacement, test, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f"coverage test replacement failed: {count}")

# Remove the obsolete arc-sum helper and replace it with topological interval coverage.
test, count = re.subn(
    r'function roleArcLength\(.*?\n\}\n\nfunction bounds',
    '''function expectConnectorCoverage(
  piece: PatternPiece,
  role: "frontArmhole" | "backArmhole" | "sleeveCapFront" | "sleeveCapBack",
  ranges: readonly EdgeRange[],
): void {
  const edges = getPatternEdges(piece).filter((edge) => edge.role === role);
  expect(edges.length, `${piece.id}/${role}/edges`).toBeGreaterThan(0);
  for (const edge of edges) {
    const intervals = ranges
      .filter((range) => range.edgeId === edge.id)
      .sort((left, right) => left.startT - right.startT);
    expect(intervals.length, `${piece.id}/${edge.id}/intervals`).toBeGreaterThan(0);
    expect(intervals[0].startT, `${piece.id}/${edge.id}/start`).toBeCloseTo(0, 7);
    for (let index = 1; index < intervals.length; index += 1) {
      expect(intervals[index].startT, `${piece.id}/${edge.id}/gap-${index}`).toBeCloseTo(
        intervals[index - 1].endT,
        7,
      );
    }
    expect(intervals[intervals.length - 1].endT, `${piece.id}/${edge.id}/end`).toBeCloseTo(1, 7);
  }
}

function bounds''',
    test,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"coverage helper replacement failed: {count}")
TEST.write_text(test, encoding="utf-8")

print("Prompt 8 continuous arc precision and structural coverage applied")
