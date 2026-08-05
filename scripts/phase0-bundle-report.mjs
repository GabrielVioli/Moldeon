import { brotliCompressSync, gzipSync } from "node:zlib";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const [, , requestedDirectory = "apps/web/dist", requestedLabel = "fallback"] =
  process.argv;
const distributionDirectory = resolve(requestedDirectory);
const artifactRoot = resolve(
  process.env.PHASE0_ARTIFACT_DIR ?? "artifacts/baseline",
);
const outputDirectory = resolve(artifactRoot, "bundle");
await mkdir(outputDirectory, { recursive: true });

const files = await walk(distributionDirectory);
const entries = [];

for (const file of files) {
  const buffer = await readFile(file);
  const relativePath = relative(distributionDirectory, file).replaceAll("\\", "/");
  entries.push({
    path: relativePath,
    extension: extname(file).toLowerCase() || "none",
    category: categorize(relativePath),
    rawBytes: buffer.byteLength,
    gzipBytes: gzipSync(buffer, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(buffer).byteLength,
  });
}

entries.sort((left, right) => right.rawBytes - left.rawBytes);
const indexPath = resolve(distributionDirectory, "index.html");
const indexHtml = await readFile(indexPath, "utf8").catch(() => "");
const initialScripts = [...indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
  (match) => match[1].replace(/^\//, ""),
);
const initialStyles = [...indexHtml.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(
  (match) => match[1].replace(/^\//, ""),
);
const initialPaths = new Set([...initialScripts, ...initialStyles]);

const summary = {
  label: requestedLabel,
  generatedAt: new Date().toISOString(),
  directory: requestedDirectory,
  fileCount: entries.length,
  total: sum(entries),
  javascript: sum(entries.filter((entry) => entry.extension === ".js")),
  css: sum(entries.filter((entry) => entry.extension === ".css")),
  wasm: sum(entries.filter((entry) => entry.extension === ".wasm")),
  initial: sum(entries.filter((entry) => initialPaths.has(entry.path))),
  initialPaths: [...initialPaths],
  categories: Object.fromEntries(
    [...new Set(entries.map((entry) => entry.category))].map((category) => [
      category,
      sum(entries.filter((entry) => entry.category === category)),
    ]),
  ),
  largestFiles: entries.slice(0, 20),
  files: entries,
};

const baseName = `bundle-${safeName(requestedLabel)}`;
await Promise.all([
  writeFile(
    resolve(outputDirectory, `${baseName}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, `${baseName}.md`),
    renderMarkdown(summary),
    "utf8",
  ),
]);

console.log(renderMarkdown(summary));

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else if (entry.isFile() && (await stat(path)).size >= 0) result.push(path);
  }
  return result;
}

function sum(items) {
  return items.reduce(
    (total, item) => ({
      rawBytes: total.rawBytes + item.rawBytes,
      gzipBytes: total.gzipBytes + item.gzipBytes,
      brotliBytes: total.brotliBytes + item.brotliBytes,
    }),
    { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 },
  );
}

function categorize(path) {
  const lower = path.toLowerCase();
  if (lower.includes("webgpu")) return "webgpu";
  if (lower.includes("three") || lower.includes("viewport")) return "threejs";
  if (lower.endsWith(".wasm")) return "wasm";
  if (lower.endsWith(".css")) return "styles";
  if (lower.endsWith(".js")) return "javascript-other";
  return "assets";
}

function renderMarkdown(summary) {
  const rows = summary.largestFiles
    .map(
      (entry) =>
        `| \`${entry.path}\` | ${entry.category} | ${formatBytes(entry.rawBytes)} | ${formatBytes(entry.gzipBytes)} | ${formatBytes(entry.brotliBytes)} |`,
    )
    .join("\n");

  return `# Bundle ${summary.label}\n\n` +
    `Gerado em: ${summary.generatedAt}\n\n` +
    `- Arquivos: ${summary.fileCount}\n` +
    `- Total bruto: ${formatBytes(summary.total.rawBytes)}\n` +
    `- Total gzip: ${formatBytes(summary.total.gzipBytes)}\n` +
    `- Total Brotli: ${formatBytes(summary.total.brotliBytes)}\n` +
    `- JavaScript bruto: ${formatBytes(summary.javascript.rawBytes)}\n` +
    `- JavaScript gzip: ${formatBytes(summary.javascript.gzipBytes)}\n` +
    `- Entrada inicial bruta: ${formatBytes(summary.initial.rawBytes)}\n` +
    `- Entrada inicial gzip: ${formatBytes(summary.initial.gzipBytes)}\n` +
    `- WASM bruto: ${formatBytes(summary.wasm.rawBytes)}\n\n` +
    `## Maiores arquivos\n\n` +
    `| Arquivo | Categoria | Bruto | Gzip | Brotli |\n` +
    `|---|---:|---:|---:|---:|\n${rows}\n`;
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}

function safeName(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}
