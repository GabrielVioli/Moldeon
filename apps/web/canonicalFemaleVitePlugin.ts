import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const canonicalFemaleModuleId = "virtual:canonical-female-glb";
const resolvedCanonicalFemaleModuleId = `\0${canonicalFemaleModuleId}`;

/**
 * Embeds the approved GLB as immutable module data so HumanBodyModel can keep
 * its synchronous public API. The plugin is read-only: it never materializes
 * or rewrites application source during build or CI.
 */
export function canonicalFemaleGlbModule(webRoot: string): Plugin {
  const assetPath = resolve(webRoot, "public/models/human/canonical-female.glb");
  return {
    name: "moldeon-canonical-female-glb",
    resolveId(source) {
      return source === canonicalFemaleModuleId
        ? resolvedCanonicalFemaleModuleId
        : null;
    },
    load(id) {
      if (id !== resolvedCanonicalFemaleModuleId) return null;
      const bytes = readFileSync(assetPath);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      return [
        `export const canonicalFemaleGlbBase64 = ${JSON.stringify(bytes.toString("base64"))};`,
        `export const canonicalFemaleGlbSha256 = ${JSON.stringify(sha256)};`,
        `export const canonicalFemaleGlbByteLength = ${bytes.byteLength};`,
      ].join("\n");
    },
  };
}
