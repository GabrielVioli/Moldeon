export type FormulaDimension = "scalar" | "length" | "angle";
export type FormulaUnit = "mm" | "ratio" | "degree" | "scalar";

export interface FormulaQuantity {
  value: number;
  dimension: FormulaDimension;
}

export type FormulaAstNode =
  | { type: "literal"; value: number; dimension: FormulaDimension; sourceUnit?: string }
  | { type: "identifier"; name: string }
  | { type: "unary"; operator: "+" | "-"; argument: FormulaAstNode }
  | { type: "binary"; operator: "+" | "-" | "*" | "/" | "^"; left: FormulaAstNode; right: FormulaAstNode }
  | { type: "call"; name: string; arguments: FormulaAstNode[] };

export interface ParsedFormulaV1 {
  version: 1;
  source: string;
  ast: FormulaAstNode;
  dependencies: string[];
}

export interface SerializedFormulaV1 {
  version: 1;
  source: string;
  expectedUnit: FormulaUnit;
  ast: FormulaAstNode;
}

export type FormulaErrorCode =
  | "syntax"
  | "unknown-function"
  | "missing-dependency"
  | "cycle"
  | "division-by-zero"
  | "domain"
  | "unit-mismatch"
  | "non-finite";

export class FormulaError extends Error {
  readonly code: FormulaErrorCode;
  readonly position?: number;
  readonly symbol?: string;

  constructor(code: FormulaErrorCode, message: string, options: { position?: number; symbol?: string } = {}) {
    super(message);
    this.name = "FormulaError";
    this.code = code;
    this.position = options.position;
    this.symbol = options.symbol;
  }
}

interface Token {
  type: "number" | "identifier" | "operator" | "left-paren" | "right-paren" | "comma" | "eof";
  text: string;
  position: number;
  value?: number;
  dimension?: FormulaDimension;
  sourceUnit?: string;
}

const FUNCTIONS = new Set([
  "min",
  "max",
  "abs",
  "sqrt",
  "clamp",
  "round",
  "floor",
  "ceil",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "hypot",
]);

export function parseFormula(source: string): ParsedFormulaV1 {
  const normalized = source.trim();
  if (!normalized) throw new FormulaError("syntax", "A fórmula não pode ficar vazia.", { position: 0 });
  const parser = new FormulaParser(tokenize(normalized));
  const ast = parser.parse();
  const dependencies = [...collectFormulaDependencies(ast)].sort((a, b) => a.localeCompare(b));
  return { version: 1, source: normalized, ast, dependencies };
}

export function evaluateFormula(
  formula: string | ParsedFormulaV1,
  scope: Readonly<Record<string, FormulaQuantity | number>>,
  expectedUnit?: FormulaUnit,
): FormulaQuantity {
  const parsed = typeof formula === "string" ? parseFormula(formula) : formula;
  const result = evaluateNode(parsed.ast, scope);
  ensureFinite(result.value);
  if (expectedUnit) assertExpectedUnit(result, expectedUnit);
  return result;
}

export function formulaQuantity(value: number, unit: FormulaUnit): FormulaQuantity {
  ensureFinite(value);
  return {
    value,
    dimension: dimensionForUnit(unit),
  };
}

export function serializeFormulaV1(source: string, expectedUnit: FormulaUnit): string {
  const parsed = parseFormula(source);
  const serialized: SerializedFormulaV1 = {
    version: 1,
    source: parsed.source,
    expectedUnit,
    ast: parsed.ast,
  };
  return `${JSON.stringify(serialized, null, 2)}\n`;
}

export function deserializeFormulaV1(serialized: string): SerializedFormulaV1 {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new FormulaError("syntax", "A fórmula serializada não contém JSON válido.");
  }
  if (!isRecord(value) || value.version !== 1 || typeof value.source !== "string" || !isFormulaUnit(value.expectedUnit)) {
    throw new FormulaError("syntax", "A fórmula serializada não usa o formato versionado esperado.");
  }
  const parsed = parseFormula(value.source);
  return {
    version: 1,
    source: parsed.source,
    expectedUnit: value.expectedUnit,
    ast: parsed.ast,
  };
}

export interface FormulaDefinition {
  id: string;
  expression: string;
  unit: FormulaUnit;
  formulaVersion?: string;
}

export interface FormulaGraphEvaluation {
  values: Record<string, FormulaQuantity>;
  errors: Record<string, FormulaError>;
  recomputed: string[];
}

export interface FormulaDefinitionUpdate {
  accepted: boolean;
  evaluation: FormulaGraphEvaluation;
  error?: FormulaError;
}

export class FormulaGraphEngine {
  private definitions = new Map<string, FormulaDefinition>();
  private parsed = new Map<string, ParsedFormulaV1>();
  private inputs = new Map<string, FormulaQuantity>();
  private reverseDependencies = new Map<string, Set<string>>();
  private cache = new Map<string, FormulaQuantity>();
  private errors = new Map<string, FormulaError>();

  constructor(
    definitions: readonly FormulaDefinition[] = [],
    inputs: Readonly<Record<string, FormulaQuantity | number>> = {},
  ) {
    this.replaceDefinitions(definitions);
    this.replaceInputs(inputs);
  }

  replaceDefinitions(definitions: readonly FormulaDefinition[]): void {
    const nextDefinitions = new Map<string, FormulaDefinition>();
    const nextParsed = new Map<string, ParsedFormulaV1>();
    for (const definition of definitions) {
      if (!definition.id.trim()) throw new FormulaError("syntax", "Toda fórmula precisa de um identificador.");
      if (nextDefinitions.has(definition.id)) {
        throw new FormulaError("syntax", `A fórmula ${definition.id} está duplicada.`, { symbol: definition.id });
      }
      const parsed = parseFormula(definition.expression);
      nextDefinitions.set(definition.id, { ...definition, expression: parsed.source });
      nextParsed.set(definition.id, parsed);
    }
    this.definitions = nextDefinitions;
    this.parsed = nextParsed;
    this.rebuildReverseDependencies();
    this.cache.clear();
    this.errors.clear();
  }

  replaceInputs(inputs: Readonly<Record<string, FormulaQuantity | number>>): void {
    this.inputs.clear();
    for (const [name, value] of Object.entries(inputs)) {
      const quantity = typeof value === "number" ? formulaQuantity(value, "scalar") : value;
      ensureFinite(quantity.value);
      this.inputs.set(name, { ...quantity });
    }
    this.cache.clear();
    this.errors.clear();
  }

  evaluateAll(): FormulaGraphEvaluation {
    const recomputed: string[] = [];
    for (const id of [...this.definitions.keys()].sort((a, b) => a.localeCompare(b))) {
      this.evaluateDefinition(id, [], recomputed);
    }
    return this.snapshot(recomputed);
  }

  updateInputs(changes: Readonly<Record<string, FormulaQuantity | number>>): FormulaGraphEvaluation {
    const changedNames: string[] = [];
    for (const [name, value] of Object.entries(changes)) {
      const quantity = typeof value === "number" ? formulaQuantity(value, "scalar") : value;
      ensureFinite(quantity.value);
      const current = this.inputs.get(name);
      if (!current || current.value !== quantity.value || current.dimension !== quantity.dimension) {
        this.inputs.set(name, { ...quantity });
        changedNames.push(name);
      }
    }
    if (changedNames.length === 0) return this.snapshot([]);
    const affected = this.collectDependents(changedNames);
    for (const id of affected) {
      this.cache.delete(id);
      this.errors.delete(id);
    }
    const recomputed: string[] = [];
    for (const id of [...affected].sort((a, b) => a.localeCompare(b))) {
      this.evaluateDefinition(id, [], recomputed);
    }
    return this.snapshot(recomputed);
  }

  tryUpdateDefinition(definition: FormulaDefinition): FormulaDefinitionUpdate {
    const definitions = [...this.definitions.values()].filter((candidate) => candidate.id !== definition.id);
    definitions.push(definition);
    let candidate: FormulaGraphEngine;
    try {
      candidate = new FormulaGraphEngine(definitions, Object.fromEntries(this.inputs));
    } catch (error) {
      const formulaError = toFormulaError(error);
      return { accepted: false, evaluation: this.snapshot([]), error: formulaError };
    }
    const evaluation = candidate.evaluateAll();
    const error = evaluation.errors[definition.id] ?? Object.values(evaluation.errors)[0];
    if (error) return { accepted: false, evaluation: this.snapshot([]), error };
    this.definitions = candidate.definitions;
    this.parsed = candidate.parsed;
    this.inputs = candidate.inputs;
    this.reverseDependencies = candidate.reverseDependencies;
    this.cache = candidate.cache;
    this.errors = candidate.errors;
    return { accepted: true, evaluation };
  }

  definitionsSnapshot(): FormulaDefinition[] {
    return [...this.definitions.values()]
      .map((definition) => ({ ...definition }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private evaluateDefinition(id: string, stack: string[], recomputed: string[]): FormulaQuantity | undefined {
    const cached = this.cache.get(id);
    if (cached) return cached;
    if (this.errors.has(id)) return undefined;
    if (stack.includes(id)) {
      const cycle = [...stack.slice(stack.indexOf(id)), id].join(" → ");
      const error = new FormulaError("cycle", `Dependência circular detectada: ${cycle}.`, { symbol: id });
      for (const cycleId of stack.slice(stack.indexOf(id))) this.errors.set(cycleId, error);
      this.errors.set(id, error);
      return undefined;
    }
    const definition = this.definitions.get(id);
    const parsed = this.parsed.get(id);
    if (!definition || !parsed) return undefined;
    const scope: Record<string, FormulaQuantity> = {};
    for (const dependency of parsed.dependencies) {
      if (this.definitions.has(dependency)) {
        const value = this.evaluateDefinition(dependency, [...stack, id], recomputed);
        if (!value) {
          const dependencyError = this.errors.get(dependency);
          this.errors.set(
            id,
            dependencyError ?? new FormulaError("missing-dependency", `A dependência ${dependency} não pôde ser calculada.`, { symbol: dependency }),
          );
          return undefined;
        }
        scope[dependency] = value;
      } else {
        const input = this.inputs.get(dependency);
        if (!input) {
          this.errors.set(
            id,
            new FormulaError("missing-dependency", `A dependência ${dependency} não existe.`, { symbol: dependency }),
          );
          return undefined;
        }
        scope[dependency] = input;
      }
    }
    try {
      const value = evaluateFormula(parsed, scope, definition.unit);
      this.cache.set(id, value);
      recomputed.push(id);
      return value;
    } catch (error) {
      this.errors.set(id, toFormulaError(error));
      return undefined;
    }
  }

  private rebuildReverseDependencies(): void {
    this.reverseDependencies.clear();
    for (const [id, parsed] of this.parsed) {
      for (const dependency of parsed.dependencies) {
        const dependents = this.reverseDependencies.get(dependency) ?? new Set<string>();
        dependents.add(id);
        this.reverseDependencies.set(dependency, dependents);
      }
    }
  }

  private collectDependents(seeds: readonly string[]): Set<string> {
    const affected = new Set<string>();
    const queue = [...seeds];
    while (queue.length > 0) {
      const dependency = queue.shift()!;
      for (const dependent of this.reverseDependencies.get(dependency) ?? []) {
        if (affected.has(dependent)) continue;
        affected.add(dependent);
        queue.push(dependent);
      }
    }
    return affected;
  }

  private snapshot(recomputed: string[]): FormulaGraphEvaluation {
    return {
      values: Object.fromEntries([...this.cache.entries()].map(([id, value]) => [id, { ...value }])),
      errors: Object.fromEntries(this.errors),
      recomputed: [...new Set(recomputed)],
    };
  }
}

export function collectFormulaDependencies(ast: FormulaAstNode): Set<string> {
  const dependencies = new Set<string>();
  visitAst(ast, (node) => {
    if (node.type === "identifier") dependencies.add(node.name);
  });
  return dependencies;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(character)) {
      const start = index;
      let sawDigit = false;
      while (/[0-9]/.test(source[index] ?? "")) {
        sawDigit = true;
        index += 1;
      }
      if (source[index] === ".") {
        index += 1;
        while (/[0-9]/.test(source[index] ?? "")) {
          sawDigit = true;
          index += 1;
        }
      }
      if (!sawDigit) throw new FormulaError("syntax", "Número inválido.", { position: start });
      if (/[eE]/.test(source[index] ?? "")) {
        index += 1;
        if (/[+-]/.test(source[index] ?? "")) index += 1;
        const exponentStart = index;
        while (/[0-9]/.test(source[index] ?? "")) index += 1;
        if (index === exponentStart) throw new FormulaError("syntax", "Expoente numérico inválido.", { position: start });
      }
      const numericText = source.slice(start, index);
      const unitStart = index;
      while (/[A-Za-z%]/.test(source[index] ?? "")) index += 1;
      const unit = source.slice(unitStart, index);
      const literal = parseLiteral(Number(numericText), unit, start);
      tokens.push({ type: "number", text: source.slice(start, index), position: start, ...literal });
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const start = index;
      index += 1;
      while (/[A-Za-z0-9_.]/.test(source[index] ?? "")) index += 1;
      tokens.push({ type: "identifier", text: source.slice(start, index), position: start });
      continue;
    }
    if ("+-*/^".includes(character)) {
      tokens.push({ type: "operator", text: character, position: index });
      index += 1;
      continue;
    }
    if (character === "(") tokens.push({ type: "left-paren", text: character, position: index });
    else if (character === ")") tokens.push({ type: "right-paren", text: character, position: index });
    else if (character === ",") tokens.push({ type: "comma", text: character, position: index });
    else throw new FormulaError("syntax", `Caractere inesperado: ${character}.`, { position: index });
    index += 1;
  }
  tokens.push({ type: "eof", text: "", position: source.length });
  return tokens;
}

function parseLiteral(value: number, unit: string, position: number): Pick<Token, "value" | "dimension" | "sourceUnit"> {
  ensureFinite(value);
  switch (unit) {
    case "":
      return { value, dimension: "scalar" };
    case "%":
      return { value: value / 100, dimension: "scalar", sourceUnit: unit };
    case "mm":
      return { value, dimension: "length", sourceUnit: unit };
    case "cm":
      return { value: value * 10, dimension: "length", sourceUnit: unit };
    case "m":
      return { value: value * 1000, dimension: "length", sourceUnit: unit };
    case "deg":
      return { value, dimension: "angle", sourceUnit: unit };
    case "rad":
      return { value: value * 180 / Math.PI, dimension: "angle", sourceUnit: unit };
    default:
      throw new FormulaError("unit-mismatch", `Unidade desconhecida: ${unit}.`, { position, symbol: unit });
  }
}

class FormulaParser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): FormulaAstNode {
    const expression = this.parseAdditive();
    this.expect("eof");
    return expression;
  }

  private parseAdditive(): FormulaAstNode {
    let left = this.parseMultiplicative();
    while (this.matchesOperator("+") || this.matchesOperator("-")) {
      const operator = this.consume().text as "+" | "-";
      left = { type: "binary", operator, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): FormulaAstNode {
    let left = this.parsePower();
    while (this.matchesOperator("*") || this.matchesOperator("/")) {
      const operator = this.consume().text as "*" | "/";
      left = { type: "binary", operator, left, right: this.parsePower() };
    }
    return left;
  }

  private parsePower(): FormulaAstNode {
    const left = this.parseUnary();
    if (!this.matchesOperator("^")) return left;
    this.consume();
    return { type: "binary", operator: "^", left, right: this.parsePower() };
  }

  private parseUnary(): FormulaAstNode {
    if (this.matchesOperator("+") || this.matchesOperator("-")) {
      const operator = this.consume().text as "+" | "-";
      return { type: "unary", operator, argument: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaAstNode {
    const token = this.current();
    if (token.type === "number") {
      this.consume();
      return {
        type: "literal",
        value: token.value!,
        dimension: token.dimension!,
        ...(token.sourceUnit ? { sourceUnit: token.sourceUnit } : {}),
      };
    }
    if (token.type === "identifier") {
      this.consume();
      if (this.current().type !== "left-paren") return { type: "identifier", name: token.text };
      if (!FUNCTIONS.has(token.text)) {
        throw new FormulaError("unknown-function", `A função ${token.text} não é permitida.`, { position: token.position, symbol: token.text });
      }
      this.consume();
      const args: FormulaAstNode[] = [];
      if (this.current().type !== "right-paren") {
        do {
          args.push(this.parseAdditive());
          if (this.current().type !== "comma") break;
          this.consume();
        } while (true);
      }
      this.expect("right-paren");
      return { type: "call", name: token.text, arguments: args };
    }
    if (token.type === "left-paren") {
      this.consume();
      const expression = this.parseAdditive();
      this.expect("right-paren");
      return expression;
    }
    throw new FormulaError("syntax", `Token inesperado próximo de “${token.text}”.`, { position: token.position });
  }

  private matchesOperator(operator: string): boolean {
    return this.current().type === "operator" && this.current().text === operator;
  }

  private current(): Token {
    return this.tokens[this.index];
  }

  private consume(): Token {
    return this.tokens[this.index++];
  }

  private expect(type: Token["type"]): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new FormulaError("syntax", `Era esperado ${type}, mas foi encontrado “${token.text}”.`, { position: token.position });
    }
    return this.consume();
  }
}

function evaluateNode(node: FormulaAstNode, scope: Readonly<Record<string, FormulaQuantity | number>>): FormulaQuantity {
  switch (node.type) {
    case "literal":
      return { value: node.value, dimension: node.dimension };
    case "identifier": {
      const value = scope[node.name];
      if (value === undefined) {
        throw new FormulaError("missing-dependency", `A dependência ${node.name} não existe.`, { symbol: node.name });
      }
      return typeof value === "number" ? { value, dimension: "scalar" } : { ...value };
    }
    case "unary": {
      const argument = evaluateNode(node.argument, scope);
      return { value: node.operator === "-" ? -argument.value : argument.value, dimension: argument.dimension };
    }
    case "binary":
      return evaluateBinary(node.operator, evaluateNode(node.left, scope), evaluateNode(node.right, scope));
    case "call":
      return evaluateCall(node.name, node.arguments.map((argument) => evaluateNode(argument, scope)));
  }
}

function evaluateBinary(operator: "+" | "-" | "*" | "/" | "^", left: FormulaQuantity, right: FormulaQuantity): FormulaQuantity {
  if (operator === "+" || operator === "-") {
    assertSameDimension(left, right, `O operador ${operator}`);
    return finiteQuantity(operator === "+" ? left.value + right.value : left.value - right.value, left.dimension);
  }
  if (operator === "*") {
    if (left.dimension === "scalar") return finiteQuantity(left.value * right.value, right.dimension);
    if (right.dimension === "scalar") return finiteQuantity(left.value * right.value, left.dimension);
    throw new FormulaError("unit-mismatch", "Multiplicação entre duas grandezas dimensionais não é suportada neste motor.");
  }
  if (operator === "/") {
    if (Math.abs(right.value) <= Number.EPSILON) throw new FormulaError("division-by-zero", "A fórmula tentou dividir por zero.");
    if (right.dimension === "scalar") return finiteQuantity(left.value / right.value, left.dimension);
    if (left.dimension === right.dimension) return finiteQuantity(left.value / right.value, "scalar");
    throw new FormulaError("unit-mismatch", "A divisão usa unidades incompatíveis.");
  }
  if (right.dimension !== "scalar") throw new FormulaError("unit-mismatch", "O expoente precisa ser escalar.");
  if (left.dimension !== "scalar" && right.value !== 1) {
    throw new FormulaError("unit-mismatch", "Potências dimensionais diferentes de 1 não são suportadas.");
  }
  const value = Math.pow(left.value, right.value);
  if (!Number.isFinite(value)) throw new FormulaError("domain", "A potência está fora do domínio numérico.");
  return finiteQuantity(value, left.dimension);
}

function evaluateCall(name: string, args: FormulaQuantity[]): FormulaQuantity {
  if (!FUNCTIONS.has(name)) throw new FormulaError("unknown-function", `A função ${name} não é permitida.`, { symbol: name });
  switch (name) {
    case "min":
    case "max": {
      requireArityAtLeast(name, args, 1);
      assertAllSameDimension(args, name);
      const values = args.map((argument) => argument.value);
      return finiteQuantity(name === "min" ? Math.min(...values) : Math.max(...values), args[0].dimension);
    }
    case "abs":
    case "round":
    case "floor":
    case "ceil": {
      requireArity(name, args, 1);
      const operation = { abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil }[name];
      return finiteQuantity(operation(args[0].value), args[0].dimension);
    }
    case "sqrt":
      requireArity(name, args, 1);
      requireDimension(args[0], "scalar", name);
      if (args[0].value < 0) throw new FormulaError("domain", "sqrt exige um valor maior ou igual a zero.");
      return finiteQuantity(Math.sqrt(args[0].value), "scalar");
    case "clamp":
      requireArity(name, args, 3);
      assertAllSameDimension(args, name);
      if (args[1].value > args[2].value) throw new FormulaError("domain", "clamp exige mínimo menor ou igual ao máximo.");
      return finiteQuantity(Math.min(args[2].value, Math.max(args[1].value, args[0].value)), args[0].dimension);
    case "sin":
    case "cos":
    case "tan":
      requireArity(name, args, 1);
      requireDimension(args[0], "angle", name);
      return finiteQuantity(Math[name](args[0].value * Math.PI / 180), "scalar");
    case "asin":
    case "acos":
      requireArity(name, args, 1);
      requireDimension(args[0], "scalar", name);
      if (args[0].value < -1 || args[0].value > 1) throw new FormulaError("domain", `${name} exige um valor entre -1 e 1.`);
      return finiteQuantity(Math[name](args[0].value) * 180 / Math.PI, "angle");
    case "atan":
      requireArity(name, args, 1);
      requireDimension(args[0], "scalar", name);
      return finiteQuantity(Math.atan(args[0].value) * 180 / Math.PI, "angle");
    case "atan2":
      requireArity(name, args, 2);
      assertSameDimension(args[0], args[1], name);
      return finiteQuantity(Math.atan2(args[0].value, args[1].value) * 180 / Math.PI, "angle");
    case "hypot":
      requireArityAtLeast(name, args, 1);
      assertAllSameDimension(args, name);
      return finiteQuantity(Math.hypot(...args.map((argument) => argument.value)), args[0].dimension);
  }
  throw new FormulaError("unknown-function", `A função ${name} não é permitida.`, { symbol: name });
}

function assertExpectedUnit(quantity: FormulaQuantity, unit: FormulaUnit): void {
  const expected = dimensionForUnit(unit);
  if (quantity.dimension !== expected) {
    throw new FormulaError("unit-mismatch", `A fórmula produz ${dimensionLabel(quantity.dimension)}, mas o campo exige ${dimensionLabel(expected)}.`);
  }
}

function dimensionForUnit(unit: FormulaUnit): FormulaDimension {
  if (unit === "mm") return "length";
  if (unit === "degree") return "angle";
  return "scalar";
}

function assertSameDimension(first: FormulaQuantity, second: FormulaQuantity, operation: string): void {
  if (first.dimension !== second.dimension) {
    throw new FormulaError("unit-mismatch", `${operation} recebeu ${dimensionLabel(first.dimension)} e ${dimensionLabel(second.dimension)}.`);
  }
}

function assertAllSameDimension(args: FormulaQuantity[], operation: string): void {
  for (const argument of args.slice(1)) assertSameDimension(args[0], argument, operation);
}

function requireDimension(quantity: FormulaQuantity, dimension: FormulaDimension, operation: string): void {
  if (quantity.dimension !== dimension) {
    throw new FormulaError("unit-mismatch", `${operation} exige ${dimensionLabel(dimension)}.`);
  }
}

function requireArity(name: string, args: FormulaQuantity[], count: number): void {
  if (args.length !== count) throw new FormulaError("domain", `${name} exige ${count} argumento(s).`);
}

function requireArityAtLeast(name: string, args: FormulaQuantity[], count: number): void {
  if (args.length < count) throw new FormulaError("domain", `${name} exige ao menos ${count} argumento(s).`);
}

function finiteQuantity(value: number, dimension: FormulaDimension): FormulaQuantity {
  ensureFinite(value);
  return { value, dimension };
}

function ensureFinite(value: number): void {
  if (!Number.isFinite(value)) throw new FormulaError("non-finite", "A fórmula produziu um valor não finito.");
}

function dimensionLabel(dimension: FormulaDimension): string {
  return dimension === "length" ? "comprimento" : dimension === "angle" ? "ângulo" : "valor escalar";
}

function visitAst(node: FormulaAstNode, visitor: (node: FormulaAstNode) => void): void {
  visitor(node);
  if (node.type === "unary") visitAst(node.argument, visitor);
  if (node.type === "binary") {
    visitAst(node.left, visitor);
    visitAst(node.right, visitor);
  }
  if (node.type === "call") node.arguments.forEach((argument) => visitAst(argument, visitor));
}

function toFormulaError(error: unknown): FormulaError {
  return error instanceof FormulaError
    ? error
    : new FormulaError("domain", error instanceof Error ? error.message : "Erro desconhecido na fórmula.");
}

function isFormulaUnit(value: unknown): value is FormulaUnit {
  return value === "mm" || value === "ratio" || value === "degree" || value === "scalar";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
