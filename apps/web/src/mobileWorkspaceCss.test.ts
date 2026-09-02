import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const css = readFileSync(resolve(root, "src/mobile-touch-workspace-11-0-7a.css"), "utf8");
const main = readFileSync(resolve(root, "src/main.tsx"), "utf8");
const manifest = readFileSync(resolve(root, "public/manifest.webmanifest"), "utf8");

describe("mobile workspace CSS contract", () => {
  it("loads the reviewed mobile layers last", () => {
    expect(main).toContain('import "./mobile-touch-workspace.css"');
    expect(main).toContain('import "./mobile-touch-workspace-v2.css"');
    expect(main).toContain('import "./mobile-touch-workspace-11-0-7a.css"');
  });

  it("has explicit portrait and landscape layouts plus coarse-pointer touch behavior", () => {
    expect(css).toContain("(pointer: coarse)");
    expect(css).toContain("(orientation: portrait)");
    expect(css).toContain("(orientation: landscape)");
    expect(css).toContain("arrangement-mobile-multiselect");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain(".status-bar,");
    expect(css).toContain(".panel-titlebar");
    expect(css).toContain(".pieces-panel:has(.pieces-list:empty)");
    expect(css).toContain("button:nth-of-type(4)::after");
  });

  it("supports standalone installation without forcing one orientation", () => {
    const parsed = JSON.parse(manifest) as { display?: string; orientation?: string };
    expect(parsed.display).toBe("standalone");
    expect(parsed.orientation).toBe("any");
  });
});
