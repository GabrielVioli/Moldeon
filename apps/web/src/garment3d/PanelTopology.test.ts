import { describe, expect, it } from "vitest";
import { buildPanelTopology, getEdgeVertexRange, resampleEdgeVertices } from "./PanelTopology";
import { buildSelfSeamConstraints } from "./StitchConstraintBuilder";
import { initializePanelSimulation, simulatePanel } from "./PanelSimulation";
import { getPatternEdges, type PatternPoint, type GarmentDraft, type PatternPiece } from "../domain/pattern";
import { createPatternSnapshot } from "../core/fallbackPatternEngine";
import { buildGarmentAssembly } from "./GarmentAssembly";
import { createBaselineFixture } from "../testFixtures/baselineGarments";

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
    expect(topology.vertexSources).toHaveLength(topology.positions2DMm.length / 2);
    expect(topology.vertexSources.every((source, index) =>
      source.vertexIndex === index
      && source.sourcePatternId === rectanglePiece.id
      && Number.isFinite(source.restPosition2DMm.x)
      && Number.isFinite(source.restPosition2DMm.y),
    )).toBe(true);
  });

  it("invalidates topology for point and curve-handle edits", () => {
    const straight = buildPanelTopology(rectanglePiece);
    const movedPoint = buildPanelTopology({
      ...rectanglePiece,
      points: rectanglePiece.points.map((point) =>
        point.id === "b" ? { ...point, xMm: point.xMm + 15 } : { ...point },
      ),
    });
    const curved = buildPanelTopology({
      ...rectanglePiece,
      points: rectanglePiece.points.map((point) => {
        if (point.id === "a") return { ...point, handleOut: { xMm: 30, yMm: -25 } };
        if (point.id === "b") return { ...point, handleIn: { xMm: -30, yMm: -25 } };
        return { ...point };
      }),
    });

    expect(movedPoint.geometrySignature).not.toBe(straight.geometrySignature);
    expect(curved.geometrySignature).not.toBe(straight.geometrySignature);
    expect([...movedPoint.positions2DMm]).not.toEqual([...straight.positions2DMm]);
    expect([...curved.positions2DMm]).not.toEqual([...straight.positions2DMm]);
  });

  it("preserves source identity through a deterministic panel instance", () => {
    const placement = {
      id: "panel-instance:rect:0",
      pieceId: rectanglePiece.id,
      region: "torso" as const,
      surface: "front" as const,
      bodySide: "center" as const,
      rotationDeg: 0,
      offsetXMm: 0,
      offsetYMm: 0,
      offsetZMm: 25,
      scale: 1,
    };
    const piece = { ...rectanglePiece, previewPlacements: [placement] };
    const state = buildGarmentAssembly(
      [createPatternSnapshot(piece)],
      { ...rectangleDraft, pieces: [piece] },
      new Map([[piece.id, "canonical-signature"]]),
    );
    const instance = state.instances[0];

    expect(instance.id).toBe(placement.id);
    expect(instance.sourcePatternId).toBe(piece.id);
    expect(instance.geometrySignature).toBe("canonical-signature");
    expect(instance.vertexSources).toHaveLength(instance.vertexCount);
    expect(instance.vertexSources.every((source, index) =>
      source.panelInstanceId === placement.id
      && source.meshVertexIndex === index
      && source.sourcePatternId === piece.id,
    )).toBe(true);
  });

  it("uses a structured material mesh for a quadrilateral self-seam tube", () => {
    const garment = createBaselineFixture("self-seam-tube");
    const state = buildGarmentAssembly(
      garment.pieces.map((piece) => createPatternSnapshot(piece)),
      garment,
    );
    const topology = state.instances[0].topology;
    let maximumTriangleSpanMm = 0;
    for (let offset = 0; offset < topology.triangles.length; offset += 3) {
      const xCoordinates = [0, 1, 2].map(
        (index) => topology.positions2DMm[topology.triangles[offset + index] * 2],
      );
      maximumTriangleSpanMm = Math.max(
        maximumTriangleSpanMm,
        Math.max(...xCoordinates) - Math.min(...xCoordinates),
      );
    }

    // The nested coarse→fine hierarchy may add a few cells so every physics
    // vertex remains a true subdivision of the assembly surface. Preserve the
    // material resolution contract instead of an incidental exact count.
    expect(state.instances[0].vertexCount).toBeGreaterThanOrEqual(266);
    expect(maximumTriangleSpanMm).toBeLessThanOrEqual(20.001);
    expect(topology.edges.size).toBe(4);
    expect(topology.vertexSources).toHaveLength(state.instances[0].vertexCount);
    expect(topology.vertexSources.every((source, index) =>
      source.vertexIndex === index && source.sourcePatternId === garment.pieces[0].id,
    )).toBe(true);
  });

  it("materializes the sloped-waist darts of the canonical skirt", () => {
    const garment = createBaselineFixture("straight-skirt-standard");

    for (const piece of garment.pieces) {
      const topology = buildPanelTopology(piece);
      expect(topology.darts).toHaveLength(1);
      expect(topology.darts[0].apexVertex).not.toBeNull();
      expect(topology.darts[0].legAVertices.length).toBeGreaterThanOrEqual(2);
      expect(topology.darts[0].legBVertices.length).toBeGreaterThanOrEqual(2);
      expect(topology.boundaryVertices).toContain(topology.darts[0].legAVertices[0]);
      expect(topology.boundaryVertices).toContain(topology.darts[0].legBVertices[0]);
    }
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
