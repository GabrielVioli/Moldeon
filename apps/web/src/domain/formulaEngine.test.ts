import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FormulaError,
  FormulaGraphEngine,
  deserializeFormulaV1,
  evaluateFormula,
  formulaQuantity,
  parseFormula,
  serializeFormulaV1,
} from "./formulaEngine";

describe("formulaEngine", () => {
  it("respects precedence, parentheses and right-associative powers", () => {
    expect(evaluateFormula("2 + 3 * 4", {}, "scalar").value).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4", {}, "scalar").value).toBe(20);
    expect(evaluateFormula("2 ^ 3 ^ 2", {}, "scalar").value).toBe(512);
  });

  it("supports audited functions and explicit units", () => {
    expect(evaluateFormula("max(10mm, 2cm) + 5mm", {}, "mm").value).toBe(25);
    expect(evaluateFormula("clamp(120%, 0, 1)", {}, "scalar").value).toBe(1);
    expect(evaluateFormula("sin(30deg)", {}, "scalar").value).toBeCloseTo(0.5, 10);
    expect(evaluateFormula("atan2(10mm, 10mm)", {}, "degree").value).toBeCloseTo(45, 10);
  });

  it("reports missing variables, division by zero, domain and unit errors", () => {
    expectFormulaError(() => evaluateFormula("missing + 1", {}), "missing-dependency");
    expectFormulaError(() => evaluateFormula("10mm / 0", {}), "division-by-zero");
    expectFormulaError(() => evaluateFormula("sqrt(-1)", {}), "domain");
    expectFormulaError(() => evaluateFormula("10mm + 2deg", {}), "unit-mismatch");
    expectFormulaError(() => evaluateFormula("fetch(1)", {}), "unknown-function");
  });

  it("detects cycles with an explanatory path", () => {
    const engine = new FormulaGraphEngine([
      { id: "a", expression: "b + 1", unit: "scalar" },
      { id: "b", expression: "c + 1", unit: "scalar" },
      { id: "c", expression: "a + 1", unit: "scalar" },
    ]);
    const result = engine.evaluateAll();
    expect(result.errors.a?.code).toBe("cycle");
    expect(result.errors.a?.message).toContain("a");
  });

  it("recomputes only transitive dependents of changed inputs", () => {
    const engine = new FormulaGraphEngine(
      [
        { id: "halfBust", expression: "bust / 2", unit: "mm" },
        { id: "quarterBust", expression: "halfBust / 2", unit: "mm" },
        { id: "halfHeight", expression: "height / 2", unit: "mm" },
      ],
      {
        bust: formulaQuantity(900, "mm"),
        height: formulaQuantity(1700, "mm"),
      },
    );
    engine.evaluateAll();
    const result = engine.updateInputs({ bust: formulaQuantity(1000, "mm") });
    expect(result.recomputed.sort()).toEqual(["halfBust", "quarterBust"]);
    expect(result.values.quarterBust.value).toBe(250);
    expect(result.values.halfHeight.value).toBe(850);
  });

  it("rejects an invalid definition transaction without replacing the previous cache", () => {
    const engine = new FormulaGraphEngine(
      [{ id: "width", expression: "bust / 4", unit: "mm" }],
      { bust: formulaQuantity(920, "mm") },
    );
    expect(engine.evaluateAll().values.width.value).toBe(230);
    const update = engine.tryUpdateDefinition({ id: "width", expression: "bust / 0", unit: "mm" });
    expect(update.accepted).toBe(false);
    expect(engine.evaluateAll().values.width.value).toBe(230);
  });

  it("serializes formulas with a stable versioned round trip", () => {
    const serialized = serializeFormulaV1("bust / 4 + 10mm", "mm");
    const restored = deserializeFormulaV1(serialized);
    expect(restored.version).toBe(1);
    expect(restored.source).toBe("bust / 4 + 10mm");
    expect(restored.ast).toEqual(parseFormula(restored.source).ast);
    expect(serializeFormulaV1(restored.source, restored.expectedUnit)).toBe(serialized);
  });

  it("contains no eval or Function constructor", () => {
    const source = readFileSync(new URL("./formulaEngine.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/\bnew\s+Function\b/);
    expect(source).not.toMatch(/\bFunction\s*\(/);
  });
});

function expectFormulaError(action: () => unknown, code: FormulaError["code"]): void {
  try {
    action();
    throw new Error("A fórmula deveria falhar.");
  } catch (error) {
    expect(error).toBeInstanceOf(FormulaError);
    expect((error as FormulaError).code).toBe(code);
  }
}
