import { describe, expect, it } from "vitest";
import type { PatternPiece } from "../domain/pattern";
import { buildPanelTopology } from "./PanelTopology";
import { refinePanelTopology } from "./PanelRefinement";

/**
 * Regression for Prompt 10.7.1.
 *
 * `contour.segmentIds` defines connectivity/order, but a segment may be stored
 * with its canonical material parameter pointing against the contour walk.
 * The boundary identity must remain the authored edgeId/t, independently of
 * traversal direction used for triangulation.
 */
describe("Prompt 10.7.1 boundary identity", () => {
  it("keeps authored top/bottom edge identity when contour segments use mixed directions", () => {
    const piece = mixedDirectionCurvedPanel("mixed-panel");
    const base = buildPanelTopology(piece);
    const refined = refinePanelTopology(base, 1);

    assertBoundaryRegion(base, "mixed-panel:top", -25, 2);
    assertBoundaryRegion(base, "mixed-panel:bottom", 419, 421);
    assertBoundaryRegion(refined, "mixed-panel:top", -25, 2);
    assertBoundaryRegion(refined, "mixed-panel:bottom", 419, 421);

    const topSources = refined.vertexSources.filter((source) => source.edgeId === "mixed-panel:top");
    const bottomSources = refined.vertexSources.filter((source) => source.edgeId === "mixed-panel:bottom");
    expect(topSources.length).toBeGreaterThan(1);
    expect(bottomSources.length).toBeGreaterThan(1);
    expect(Math.min(...topSources.map((source) => source.restPosition2DMm.y))).toBeGreaterThan(-25);
    expect(Math.max(...topSources.map((source) => source.restPosition2DMm.y))).toBeLessThan(2);
    expect(Math.max(...bottomSources.map((source) => Math.abs(source.restPosition2DMm.y - 420)))).toBeLessThan(1e-3);
  });

  it("keeps canonical t increasing along the authored segment even when contour traversal is reversed", () => {
    const topology = buildPanelTopology(mixedDirectionCurvedPanel("t-panel"));
    const right = topology.edges.get("t-panel:right");
    const left = topology.edges.get("t-panel:left");
    expect(right).toBeDefined();
    expect(left).toBeDefined();

    // Right is authored bottom->top while the contour walks top->bottom.
    const rightStart = right!.vertexIndices[0];
    const rightEnd = right!.vertexIndices.at(-1)!;
    expect(topology.positions2DMm[rightStart * 2 + 1]).toBeCloseTo(420, 3);
    expect(topology.positions2DMm[rightEnd * 2 + 1]).toBeCloseTo(0, 3);

    // Left is authored top->bottom while the contour walks bottom->top.
    const leftStart = left!.vertexIndices[0];
    const leftEnd = left!.vertexIndices.at(-1)!;
    expect(topology.positions2DMm[leftStart * 2 + 1]).toBeCloseTo(0, 3);
    expect(topology.positions2DMm[leftEnd * 2 + 1]).toBeCloseTo(420, 3);
  });
});

function assertBoundaryRegion(
  topology: ReturnType<typeof buildPanelTopology>,
  edgeId: string,
  minimumY: number,
  maximumY: number,
): void {
  const path = topology.edges.get(edgeId);
  expect(path, `missing ${edgeId}`).toBeDefined();
  const ys = path!.vertexIndices.map((index) => topology.positions2DMm[index * 2 + 1]);
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(minimumY);
  expect(Math.max(...ys)).toBeLessThanOrEqual(maximumY);
}

function mixedDirectionCurvedPanel(id: string): PatternPiece {
  const points = [
    { id: `${id}:tl`, xMm: 0, yMm: 0, handleOut: { xMm: 34, yMm: -18 } },
    { id: `${id}:tr`, xMm: 112, yMm: 0, handleIn: { xMm: 78, yMm: -18 } },
    { id: `${id}:br`, xMm: 126, yMm: 420 },
    { id: `${id}:bl`, xMm: -14, yMm: 420 },
  ];
  return {
    id,
    name: id,
    seamAllowanceMm: 0,
    cutQuantity: 1,
    points,
    formatVersion: 2,
    nodes: points.map((point) => ({ id: point.id, xMm: point.xMm, yMm: point.yMm })),
    segments: [
      {
        id: `${id}:top`,
        startNodeId: `${id}:tl`,
        endNodeId: `${id}:tr`,
        kind: "cubic",
        control1: { xMm: 34, yMm: -18 },
        control2: { xMm: 78, yMm: -18 },
        role: "waist",
      },
      // Canonical material direction deliberately opposes contour traversal.
      { id: `${id}:right`, startNodeId: `${id}:br`, endNodeId: `${id}:tr`, kind: "line", role: "sideSeam" },
      { id: `${id}:bottom`, startNodeId: `${id}:br`, endNodeId: `${id}:bl`, kind: "line", role: "hem" },
      // Canonical material direction deliberately opposes contour traversal.
      { id: `${id}:left`, startNodeId: `${id}:tl`, endNodeId: `${id}:bl`, kind: "line", role: "sideSeam" },
    ],
    contours: [{
      id: `${id}:outline`,
      segmentIds: [`${id}:top`, `${id}:right`, `${id}:bottom`, `${id}:left`],
      closed: true,
    }],
  };
}
