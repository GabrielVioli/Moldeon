import { describe, expect, it } from "vitest";
import { buildPanelTopology, getEdgeVertexRange, resampleEdgeVertices } from "./PanelTopology";
import { buildSelfSeamConstraints } from "./StitchConstraintBuilder";
import { initializePanelSimulation, simulatePanel } from "./PanelSimulation";
import { getPatternEdges, type PatternPoint, type GarmentDraft, type PatternPiece } from "../domain/pattern";

const rectanglePoints: PatternPoint[] = [
  { id: "a", xMm: 0, yMm: 0 },
  { id: "b", xMm: 100, yMm: 0 },
  { id: "c", xMm: 100, yMm: 200 },
  { id: "d", xMm: 0, yMm: 200 },
];

const rectanglePiece = {
  id: "rect",
  name: "Rect",
  seamAllowanceMm: 0,
  points: rectanglePoints,
} as PatternPiece;

const rectangleDraft = {
  id: "draft",
  templateId: "template",
  name: "Draft",
  description: "",
  bodyType: "feminine",
  measurements: {
    heightMm: 1680,
    bustMm: 920,
    waistMm: 760,
    hipMm: 1000,
    shoulderWidthMm: 400,
    torsoLengthMm: 440,
    armLengthMm: 590,
    inseamMm: 780,
  },
  fabrics: [],
  pieces: [rectanglePiece],
  seams: [],
} as GarmentDraft;

describe("PanelTopology and self seam simulation", () => {
  it("builds topology with edge vertex mappings preserved", () => {
    const topology = buildPanelTopology(rectanglePiece);
    expect(topology.pieceId).toBe("rect");
    expect(topology.positions2D.length).toBeGreaterThan(8);
    expect(topology.triangles.length).toBeGreaterThan(0);
    expect(topology.edgeVertices.size).toBe(4);

    const topEdge = [...topology.edgeVertices.values()][0];
    expect(topEdge.length).toBeGreaterThanOrEqual(2);
    expect(topology.boundaryVertices).toEqual(expect.arrayContaining(topEdge));
  });

  it("resamples edge vertices by arc length and preserves ordering", () => {
    const topology = buildPanelTopology(rectanglePiece);
    const edges = [...topology.edgeVertices.entries()];
    const [edgeId, edgeVertices] = edges[1];
    const sampled = resampleEdgeVertices(topology, edgeVertices, 5);
    expect(sampled).toHaveLength(5);
    expect(new Set(sampled).size).toBe(5);
    expect(sampled).toEqual([...sampled].sort((a, b) => a - b));

    const range = getEdgeVertexRange(topology, {
      pieceId: rectanglePiece.id,
      edgeId,
      startT: 0.2,
      endT: 0.8,
    });
    expect(range.length).toBeGreaterThanOrEqual(2);
  });

  it("creates self-seam constraints and relaxes a closed tube without NaNs", () => {
    const edges = getPatternEdges(rectanglePiece);
    const seam = {
      id: "seam-rect",
      first: { pieceId: rectanglePiece.id, edgeId: edges[1].id, startT: 0, endT: 1 },
      second: { pieceId: rectanglePiece.id, edgeId: edges[3].id, startT: 0, endT: 1 },
      direction: "opposite" as const,
      easeRatio: 0,
      type: "standard",
    };
    const draft: GarmentDraft = { ...rectangleDraft, seams: [seam] };
    const constraints = buildSelfSeamConstraints(draft);
    expect(constraints.length).toBeGreaterThanOrEqual(2);
    expect(constraints.every((item) => item.pieceA === item.pieceB)).toBe(true);

    const topology = buildPanelTopology(rectanglePiece);
    const state = initializePanelSimulation(topology, constraints);
    expect([...state.positions]).not.toContain(NaN);
    simulatePanel(state);
    expect([...state.positions]).not.toContain(NaN);
    expect(state.positions.length).toBe(state.previousPositions.length);
  });
});
