import {
  PatternEngineFacade,
  PatternPiece,
  PatternSnapshot,
  parsePatternSnapshot,
} from "../domain/pattern";
import { FallbackPatternEngine } from "../core/fallbackPatternEngine";

type WasmPatternEngine = {
  snapshot(): unknown;
  restore_piece(piece: PatternPiece): unknown;
  move_point(pointId: string, xMm: number, yMm: number): unknown;
  set_seam_allowance(valueMm: number): unknown;
  reset(): unknown;
};

type WasmModule = {
  default(): Promise<unknown>;
  PatternEngine: new () => WasmPatternEngine;
};

class RustPatternEngine implements PatternEngineFacade {
  readonly backend = "wasm" as const;

  constructor(private readonly engine: WasmPatternEngine) {}

  snapshot(): PatternSnapshot {
    return parsePatternSnapshot(this.engine.snapshot());
  }

  restorePiece(piece: PatternPiece): PatternSnapshot {
    return parsePatternSnapshot(this.engine.restore_piece(piece));
  }

  movePoint(pointId: string, xMm: number, yMm: number): PatternSnapshot {
    return parsePatternSnapshot(this.engine.move_point(pointId, xMm, yMm));
  }

  setSeamAllowance(valueMm: number): PatternSnapshot {
    return parsePatternSnapshot(this.engine.set_seam_allowance(valueMm));
  }

  reset(): PatternSnapshot {
    return parsePatternSnapshot(this.engine.reset());
  }
}

export async function loadPatternEngine(): Promise<PatternEngineFacade> {
  if (import.meta.env.MODE === "fallback") {
    return new FallbackPatternEngine();
  }

  try {
    const modulePath = "/wasm/pattern_core.js";
    const wasm = (await import(/* @vite-ignore */ modulePath)) as WasmModule;
    await wasm.default();
    return new RustPatternEngine(new wasm.PatternEngine());
  } catch (error) {
    throw new Error(
      "O modo WASM foi solicitado, mas o pacote não está disponível. Execute npm run wasm:build ou use npm run dev:fallback.",
      { cause: error },
    );
  }
}
