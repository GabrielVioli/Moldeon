import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalFemaleGlbModule } from "./canonicalFemaleVitePlugin";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [canonicalFemaleGlbModule(currentDirectory), react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
