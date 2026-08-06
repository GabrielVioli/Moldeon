from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}")
    target.write_text(source.replace(old, new, 1), encoding="utf-8")


replace_once(
    "apps/web/src/garment3d/PanelRefinement.ts",
    '''const DEFAULT_REFINEMENT_ITERATIONS = 2;
const MAX_REFINEMENT_ITERATIONS = 3;
''',
    '''const DEFAULT_REFINEMENT_ITERATIONS = 2;
const MAX_REFINEMENT_ITERATIONS = 5;
const TARGET_DISPLAY_EDGE_MM = 24;
''',
)

replace_once(
    "apps/web/src/garment3d/PanelRefinement.ts",
    '''export function recommendedPanelRefinement(
  topology: PanelTopology,
): number {
  const triangleCount = topology.triangles.length / 3;

  if (triangleCount <= 180) return 2;
  if (triangleCount <= 700) return 1;
  return 0;
}
''',
    '''export function recommendedPanelRefinement(
  topology: PanelTopology,
): number {
  const triangleCount = topology.triangles.length / 3;
  const maximumEdgeMm = maximumTriangleEdgeMm(topology);
  const edgeDrivenIterations = maximumEdgeMm <= TARGET_DISPLAY_EDGE_MM
    ? 0
    : clampInteger(
        Math.ceil(Math.log2(maximumEdgeMm / TARGET_DISPLAY_EDGE_MM)),
        0,
        MAX_REFINEMENT_ITERATIONS,
      );
  const budgetLimit = triangleCount <= 120
    ? 5
    : triangleCount <= 500
      ? 4
      : triangleCount <= 1800
        ? 3
        : triangleCount <= 5000
          ? 2
          : 1;

  return Math.min(edgeDrivenIterations, budgetLimit);
}

export function maximumTriangleEdgeMm(topology: PanelTopology): number {
  const positions = topology.positions2DMm;
  const triangles = topology.triangles;
  let maximum = 0;

  for (let offset = 0; offset < triangles.length; offset += 3) {
    const a = triangles[offset];
    const b = triangles[offset + 1];
    const c = triangles[offset + 2];
    maximum = Math.max(
      maximum,
      vertexDistanceMm(positions, a, b),
      vertexDistanceMm(positions, b, c),
      vertexDistanceMm(positions, c, a),
    );
  }

  return maximum;
}
''',
)

replace_once(
    "apps/web/src/garment3d/PanelRefinement.ts",
    '''function edgeKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}
''',
    '''function edgeKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}

function vertexDistanceMm(
  positions: Float32Array,
  first: number,
  second: number,
): number {
  return Math.hypot(
    positions[first * 2] - positions[second * 2],
    positions[first * 2 + 1] - positions[second * 2 + 1],
  );
}
''',
)

# Add a rendered-surface invariant to the semantic arrangement suite.
test_path = ROOT / "apps/web/src/garment3d/SemanticAvatarArrangement.test.ts"
test_source = test_path.read_text(encoding="utf-8")
insert = r'''

  it("keeps dressed display triangles small enough to follow curved body surfaces", () => {
    for (const templateId of ["tshirt", "straight-skirt", "straight-pants"] as const) {
      const result = arrange(templateId);
      const visible = result.state.instances.filter((instance) => result.visibleInstanceIds.has(instance.id));
      const maximumEdge = Math.max(...visible.map((instance) => maximumDressedTriangleEdge(result, instance.id)));
      expect(maximumEdge, `${templateId} has a chord too large for the avatar surface`).toBeLessThan(0.075);
      expect(visible.reduce((total, instance) => total + instance.topology.triangles.length / 3, 0)).toBeLessThan(120_000);
    }
  });
'''
marker = '\n});\n'
if insert.strip() not in test_source:
    index = test_source.rfind(marker)
    if index < 0:
        raise SystemExit("SemanticAvatarArrangement.test.ts: describe ending not found")
    test_source = test_source[:index] + insert + test_source[index:]

helper = r'''

function maximumDressedTriangleEdge(
  result: ReturnType<typeof arrange>,
  instanceId: string,
): number {
  const instance = result.state.instances.find((candidate) => candidate.id === instanceId);
  if (!instance) throw new Error(`Instância ausente: ${instanceId}`);
  let maximum = 0;
  for (let offset = 0; offset < instance.topology.triangles.length; offset += 3) {
    const a = instance.topology.triangles[offset];
    const b = instance.topology.triangles[offset + 1];
    const c = instance.topology.triangles[offset + 2];
    maximum = Math.max(
      maximum,
      dressedDistance(result, instance.particleStart + a, instance.particleStart + b),
      dressedDistance(result, instance.particleStart + b, instance.particleStart + c),
      dressedDistance(result, instance.particleStart + c, instance.particleStart + a),
    );
  }
  return maximum;
}

function dressedDistance(
  result: ReturnType<typeof arrange>,
  first: number,
  second: number,
): number {
  const firstOffset = first * 3;
  const secondOffset = second * 3;
  return Math.hypot(
    result.state.positions[firstOffset] - result.state.positions[secondOffset],
    result.state.positions[firstOffset + 1] - result.state.positions[secondOffset + 1],
    result.state.positions[firstOffset + 2] - result.state.positions[secondOffset + 2],
  );
}
'''
helper_marker = '\ndescribe("SemanticAvatarArrangement", () => {'
if helper.strip() not in test_source:
    index = test_source.find(helper_marker)
    if index < 0:
        raise SystemExit("SemanticAvatarArrangement.test.ts: describe marker not found")
    test_source = test_source[:index] + helper + test_source[index:]
test_path.write_text(test_source, encoding="utf-8")

# Add direct refinement tests.
refinement_test = ROOT / "apps/web/src/garment3d/PanelRefinement.test.ts"
refinement_test.write_text(r'''import { describe, expect, it } from "vitest";
import { createPatternSnapshot } from "../core/fallbackPatternEngine";
import { buildPanelTopology } from "./PanelTopology";
import {
  maximumTriangleEdgeMm,
  recommendedPanelRefinement,
  refinePanelTopology,
} from "./PanelRefinement";
import {
  createGarmentFromTemplate,
  DEFAULT_BODY_MEASUREMENTS,
} from "../patterns/templateCatalog";

describe("PanelRefinement", () => {
  it("chooses enough subdivisions to avoid long display chords", () => {
    const garment = createGarmentFromTemplate("tshirt", DEFAULT_BODY_MEASUREMENTS, "feminine");
    for (const piece of garment.pieces) {
      const snapshot = createPatternSnapshot(piece);
      const base = buildPanelTopology(snapshot.piece);
      const iterations = recommendedPanelRefinement(base);
      const refined = refinePanelTopology(base, iterations);
      expect(iterations).toBeGreaterThanOrEqual(3);
      expect(maximumTriangleEdgeMm(refined)).toBeLessThanOrEqual(25);
    }
  });
});
''', encoding="utf-8")

print("Prompt 9 adaptive surface tessellation applied")
