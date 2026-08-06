import { describe, expect, it } from "vitest";
import { createMeasurementProfile } from "./parametricMeasurements";
import { evaluateConstructionGraph } from "./constructionGraph";

const PROFILE = createMeasurementProfile(
  {
    heightMm: 1680,
    bustMm: 920,
    waistMm: 760,
    hipMm: 1000,
    shoulderWidthMm: 400,
    torsoLengthMm: 440,
    armLengthMm: 590,
    inseamMm: 780,
  },
  "feminine",
);

describe("constructionGraph", () => {
  it("evaluates points, lines, arcs, curves and transforms deterministically without DOM", () => {
    const graph = {
      version: 2 as const,
      nodes: [
        { id: "origin", kind: "free-point" as const, dependencies: [], payload: { xMm: 0, yMm: 0 } },
        { id: "quarterBust", kind: "variable" as const, dependencies: ["bustMm"], payload: { expression: "bustMm / 4", unit: "mm" } },
        { id: "side", kind: "computed-point" as const, dependencies: ["quarterBust"], payload: { xExpression: "quarterBust", yExpression: "torsoLengthMm" } },
        { id: "mid", kind: "operation" as const, dependencies: ["origin", "side"], payload: { operation: "midpoint", firstPointId: "origin", secondPointId: "side" } },
        { id: "edge", kind: "line" as const, dependencies: ["origin", "side"], payload: { startPointId: "origin", endPointId: "side" } },
        { id: "control1", kind: "free-point" as const, dependencies: [], payload: { xMm: 40, yMm: 20 } },
        { id: "control2", kind: "free-point" as const, dependencies: [], payload: { xMm: 180, yMm: 400 } },
        { id: "curve", kind: "curve" as const, dependencies: ["origin", "control1", "control2", "side"], payload: { startPointId: "origin", control1PointId: "control1", control2PointId: "control2", endPointId: "side" } },
        { id: "arc", kind: "arc" as const, dependencies: ["mid"], payload: { centerPointId: "mid", radiusExpression: "50mm", startAngleExpression: "0deg", endAngleExpression: "90deg" } },
        { id: "moved", kind: "transform" as const, dependencies: ["mid"], payload: { sourcePointId: "mid", translateXExpression: "10mm", translateYExpression: "20mm", rotationExpression: "0deg", scaleExpression: "1" } },
      ],
    };
    const first = evaluateConstructionGraph(graph, PROFILE);
    const second = evaluateConstructionGraph(structuredClone(graph), PROFILE);
    expect(first.issues).toEqual([]);
    expect(first).toEqual(second);
    expect(first.values.quarterBust).toEqual({ kind: "number", quantity: { value: 230, dimension: "length" } });
    expect(first.values.side).toEqual({ kind: "point", xMm: 230, yMm: 440 });
    expect(first.values.mid).toEqual({ kind: "point", xMm: 115, yMm: 220 });
    expect(first.values.moved).toEqual({ kind: "point", xMm: 125, yMm: 240 });
  });

  it("reports missing dependencies and cycles", () => {
    const missing = evaluateConstructionGraph(
      { version: 2, nodes: [{ id: "p", kind: "line", dependencies: ["absent"], payload: { startPointId: "absent", endPointId: "absent" } }] },
      PROFILE,
    );
    expect(missing.issues[0].code).toBe("missing-dependency");

    const cyclic = evaluateConstructionGraph(
      {
        version: 2,
        nodes: [
          { id: "a", kind: "operation", dependencies: ["b"], payload: { operation: "midpoint", firstPointId: "b", secondPointId: "b" } },
          { id: "b", kind: "operation", dependencies: ["a"], payload: { operation: "midpoint", firstPointId: "a", secondPointId: "a" } },
        ],
      },
      PROFILE,
    );
    expect(cyclic.issues.some((issue) => issue.code === "cycle")).toBe(true);
  });
});
