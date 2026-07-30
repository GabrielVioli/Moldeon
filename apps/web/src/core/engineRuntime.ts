import { FallbackPatternEngine } from "./fallbackPatternEngine";
import { PatternEngineFacade } from "../domain/pattern";
import { loadPatternEngine } from "../wasm/loadPatternEngine";

let engine: PatternEngineFacade = new FallbackPatternEngine();

export function currentEngine(): PatternEngineFacade {
  return engine;
}

export async function initializeEngine(): Promise<PatternEngineFacade> {
  engine = await loadPatternEngine();
  return engine;
}
