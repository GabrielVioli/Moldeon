import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { canonicalFemaleGlbModule } from "./canonicalFemaleVitePlugin";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const wasmDirectory = resolve(currentDirectory, "public/wasm");

export default defineConfig({
  plugins: [canonicalFemaleGlbModule(currentDirectory), serveGeneratedWasmPackage(), react()],
  server: {
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 600,
  },
});

/**
 * Vite 8 blocks JavaScript modules imported directly from public/ because
 * public assets normally bypass transforms. wasm-pack --target web generates
 * one JavaScript module and one .wasm asset in that directory. This
 * development-only middleware serves those generated files before Vite's
 * transform middleware, preserving their relative URLs without changing the
 * production output.
 */
function serveGeneratedWasmPackage(): Plugin {
  return {
    name: "moldeon-generated-wasm-package",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = (request as unknown as { url?: string }).url;
        const pathname = requestUrl?.split("?", 1)[0] ?? "";
        if (!pathname.startsWith("/wasm/")) {
          next();
          return;
        }

        const fileName = decodeURIComponent(pathname.slice("/wasm/".length));
        if (
          fileName.length === 0 ||
          fileName.includes("/") ||
          fileName.includes("\\") ||
          fileName.includes("..")
        ) {
          next();
          return;
        }

        try {
          const contents = await readFile(resolve(wasmDirectory, fileName));
          response.statusCode = 200;
          response.setHeader("Content-Type", contentType(fileName));
          response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
          response.end(contents);
        } catch {
          next();
        }
      });
    },
  };
}

function contentType(fileName: string): string {
  switch (extname(fileName).toLowerCase()) {
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    case ".json":
      return "application/json; charset=utf-8";
    case ".ts":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
