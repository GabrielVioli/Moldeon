import {
  FormulaError,
  FormulaGraphEngine,
  evaluateFormula,
  formulaQuantity,
  type FormulaQuantity,
  type FormulaUnit,
} from "./formulaEngine";
import {
  measurementProfileToBodyMeasurements,
  type BodyMeasurementKey,
  type MeasurementProfile,
  type ParametricConstructionGraphRecord,
  type ParametricConstructionNodeRecord,
  type ParametricVariableRecord,
} from "./parametricMeasurements";

export type ConstructionValue =
  | { kind: "number"; quantity: FormulaQuantity }
  | { kind: "point"; xMm: number; yMm: number }
  | { kind: "line"; start: ConstructionPoint; end: ConstructionPoint }
  | { kind: "arc"; center: ConstructionPoint; radiusMm: number; startDeg: number; endDeg: number }
  | { kind: "curve"; start: ConstructionPoint; control1: ConstructionPoint; control2: ConstructionPoint; end: ConstructionPoint };

export interface ConstructionPoint {
  xMm: number;
  yMm: number;
}

export interface ConstructionGraphIssue {
  nodeId: string;
  code: "missing-dependency" | "cycle" | "invalid-payload" | "formula-error" | "unsupported-node";
  message: string;
}

export interface ConstructionGraphEvaluation {
  values: Record<string, ConstructionValue>;
  issues: ConstructionGraphIssue[];
  order: string[];
}

export function evaluateConstructionGraph(
  graph: ParametricConstructionGraphRecord,
  measurements: MeasurementProfile,
  variables: readonly ParametricVariableRecord[] = [],
): ConstructionGraphEvaluation {
  const profileValues = measurementProfileToBodyMeasurements(measurements);
  const formulaInputs: Record<string, FormulaQuantity> = {};
  for (const [key, value] of Object.entries(profileValues)) {
    if (typeof value !== "number") continue;
    formulaInputs[key] = formulaQuantity(value, key.endsWith("Deg") ? "degree" : "mm");
  }

  const variableEngine = new FormulaGraphEngine(
    variables.map((variable) => ({
      id: variable.id,
      expression: variable.expression,
      unit: variable.unit,
      formulaVersion: variable.formulaVersion,
    })),
    formulaInputs,
  );
  const variableEvaluation = variableEngine.evaluateAll();
  const values: Record<string, ConstructionValue> = {};
  const issues: ConstructionGraphIssue[] = Object.entries(variableEvaluation.errors).map(([nodeId, error]) => ({
    nodeId,
    code: "formula-error",
    message: error.message,
  }));
  for (const [id, quantity] of Object.entries(variableEvaluation.values)) {
    values[id] = { kind: "number", quantity };
    formulaInputs[id] = quantity;
  }

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const state = new Map<string, "visiting" | "done">();
  const order: string[] = [];

  const evaluateNode = (id: string, stack: string[]): ConstructionValue | undefined => {
    if (values[id]) return values[id];
    const node = nodes.get(id);
    if (!node) return undefined;
    if (state.get(id) === "visiting") {
      const cycle = [...stack.slice(stack.indexOf(id)), id].join(" → ");
      issues.push({ nodeId: id, code: "cycle", message: `Dependência circular no grafo: ${cycle}.` });
      return undefined;
    }
    if (state.get(id) === "done") return values[id];
    state.set(id, "visiting");
    for (const dependency of node.dependencies) {
      if (formulaInputs[dependency] || values[dependency]) continue;
      if (!nodes.has(dependency)) {
        issues.push({ nodeId: id, code: "missing-dependency", message: `A dependência ${dependency} do nó ${id} não existe.` });
        state.set(id, "done");
        return undefined;
      }
      if (!evaluateNode(dependency, [...stack, id])) {
        state.set(id, "done");
        return undefined;
      }
    }
    try {
      const evaluated = evaluateConstructionNode(node, values, formulaInputs, profileValues);
      values[id] = evaluated;
      exposeValueToFormulaScope(id, evaluated, formulaInputs);
      order.push(id);
      state.set(id, "done");
      return evaluated;
    } catch (error) {
      issues.push({
        nodeId: id,
        code: error instanceof FormulaError ? "formula-error" : "invalid-payload",
        message: error instanceof Error ? error.message : `O nó ${id} é inválido.`,
      });
      state.set(id, "done");
      return undefined;
    }
  };

  for (const id of [...nodes.keys()].sort((a, b) => a.localeCompare(b))) evaluateNode(id, []);
  return { values, issues, order };
}

export function createInitialConstructionGraph(
  measurementKeys: readonly BodyMeasurementKey[],
): ParametricConstructionGraphRecord {
  return {
    version: 2,
    nodes: measurementKeys.map((key): ParametricConstructionNodeRecord => ({
      id: key,
      kind: "measurement",
      dependencies: [],
      payload: { measurementKey: key },
    })),
  };
}

function evaluateConstructionNode(
  node: ParametricConstructionNodeRecord,
  values: Readonly<Record<string, ConstructionValue>>,
  scope: Readonly<Record<string, FormulaQuantity>>,
  measurements: Readonly<Record<string, number | undefined>> | import("./pattern").BodyMeasurements,
): ConstructionValue {
  switch (node.kind) {
    case "measurement": {
      const key = readString(node.payload.measurementKey, `A medida do nó ${node.id}`);
      const value = (measurements as unknown as Record<string, number | undefined>)[key];
      if (typeof value !== "number") throw new TypeError(`A medida ${key} não está disponível.`);
      return { kind: "number", quantity: formulaQuantity(value, key.endsWith("Deg") ? "degree" : "mm") };
    }
    case "variable": {
      const expression = readString(node.payload.expression, `A fórmula do nó ${node.id}`);
      const unit = readFormulaUnit(node.payload.unit);
      return { kind: "number", quantity: evaluateFormula(expression, scope, unit) };
    }
    case "free-point":
      return {
        kind: "point",
        xMm: readFinite(node.payload.xMm, `O X do ponto ${node.id}`),
        yMm: readFinite(node.payload.yMm, `O Y do ponto ${node.id}`),
      };
    case "computed-point":
      return {
        kind: "point",
        xMm: evaluateFormula(readString(node.payload.xExpression, `O X calculado de ${node.id}`), scope, "mm").value,
        yMm: evaluateFormula(readString(node.payload.yExpression, `O Y calculado de ${node.id}`), scope, "mm").value,
      };
    case "line":
      return {
        kind: "line",
        start: requirePoint(values, readString(node.payload.startPointId, `O início da linha ${node.id}`)),
        end: requirePoint(values, readString(node.payload.endPointId, `O fim da linha ${node.id}`)),
      };
    case "arc":
      return {
        kind: "arc",
        center: requirePoint(values, readString(node.payload.centerPointId, `O centro do arco ${node.id}`)),
        radiusMm: evaluateFormula(readString(node.payload.radiusExpression, `O raio do arco ${node.id}`), scope, "mm").value,
        startDeg: evaluateFormula(readString(node.payload.startAngleExpression, `O início do arco ${node.id}`), scope, "degree").value,
        endDeg: evaluateFormula(readString(node.payload.endAngleExpression, `O fim do arco ${node.id}`), scope, "degree").value,
      };
    case "curve":
      return {
        kind: "curve",
        start: requirePoint(values, readString(node.payload.startPointId, `O início da curva ${node.id}`)),
        control1: requirePoint(values, readString(node.payload.control1PointId, `O primeiro controle da curva ${node.id}`)),
        control2: requirePoint(values, readString(node.payload.control2PointId, `O segundo controle da curva ${node.id}`)),
        end: requirePoint(values, readString(node.payload.endPointId, `O fim da curva ${node.id}`)),
      };
    case "transform": {
      const source = requirePoint(values, readString(node.payload.sourcePointId, `O ponto da transformação ${node.id}`));
      const translateX = optionalFormula(node.payload.translateXExpression, scope, "mm", 0);
      const translateY = optionalFormula(node.payload.translateYExpression, scope, "mm", 0);
      const rotationDeg = optionalFormula(node.payload.rotationExpression, scope, "degree", 0);
      const scale = optionalFormula(node.payload.scaleExpression, scope, "scalar", 1);
      const radians = rotationDeg * Math.PI / 180;
      return {
        kind: "point",
        xMm: (source.xMm * Math.cos(radians) - source.yMm * Math.sin(radians)) * scale + translateX,
        yMm: (source.xMm * Math.sin(radians) + source.yMm * Math.cos(radians)) * scale + translateY,
      };
    }
    case "operation": {
      const operation = readString(node.payload.operation, `A operação do nó ${node.id}`);
      if (operation === "midpoint") {
        const first = requirePoint(values, readString(node.payload.firstPointId, `O primeiro ponto de ${node.id}`));
        const second = requirePoint(values, readString(node.payload.secondPointId, `O segundo ponto de ${node.id}`));
        return { kind: "point", xMm: (first.xMm + second.xMm) / 2, yMm: (first.yMm + second.yMm) / 2 };
      }
      throw new TypeError(`A operação ${operation} ainda não é suportada.`);
    }
  }
}

function exposeValueToFormulaScope(
  id: string,
  value: ConstructionValue,
  scope: Record<string, FormulaQuantity>,
): void {
  if (value.kind === "number") scope[id] = value.quantity;
  if (value.kind === "point") {
    scope[`${id}.x`] = formulaQuantity(value.xMm, "mm");
    scope[`${id}.y`] = formulaQuantity(value.yMm, "mm");
  }
  if (value.kind === "line") {
    scope[`${id}.length`] = formulaQuantity(Math.hypot(value.end.xMm - value.start.xMm, value.end.yMm - value.start.yMm), "mm");
  }
}

function requirePoint(values: Readonly<Record<string, ConstructionValue>>, id: string): ConstructionPoint {
  const value = values[id];
  if (!value || value.kind !== "point") throw new TypeError(`${id} não é um ponto calculado.`);
  return { xMm: value.xMm, yMm: value.yMm };
}

function optionalFormula(
  value: unknown,
  scope: Readonly<Record<string, FormulaQuantity>>,
  unit: FormulaUnit,
  fallback: number,
): number {
  return value === undefined ? fallback : evaluateFormula(readString(value, "A expressão da transformação"), scope, unit).value;
}

function readFormulaUnit(value: unknown): FormulaUnit {
  if (value === "mm" || value === "ratio" || value === "degree" || value === "scalar") return value;
  throw new TypeError("A unidade da variável de construção é inválida.");
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} precisa ser texto.`);
  return value;
}

function readFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} precisa ser numérico.`);
  return value;
}
