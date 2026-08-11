import { describe, expect, it } from "vitest";
import { normalizeMoldeonFileName } from "./browserPatternProjectFile";

describe("browser pattern project file", () => {
  it("normalizes project names to one portable .moldeon extension", () => {
    expect(normalizeMoldeonFileName("Vestido assimétrico")).toBe(
      "Vestido assimétrico.moldeon",
    );
    expect(normalizeMoldeonFileName("teste.MOLDEON")).toBe("teste.moldeon");
    expect(normalizeMoldeonFileName("  projeto:final/2  ")).toBe(
      "projeto-final-2.moldeon",
    );
    expect(normalizeMoldeonFileName("   ")).toBe("projeto.moldeon");
  });
});
