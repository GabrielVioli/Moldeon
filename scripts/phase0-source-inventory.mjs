import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const artifactRoot = resolve(
  process.env.PHASE0_ARTIFACT_DIR ?? "artifacts/baseline",
);
const outputDirectory = resolve(artifactRoot, "architecture");
await mkdir(outputDirectory, { recursive: true });

const trackedFiles = execFileSync("git", ["ls-files"], {
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((path) =>
    [
      "apps/web/src/",
      "crates/",
      "scripts/",
      "infrastructure/",
      ".github/workflows/",
    ].some((prefix) => path.startsWith(prefix)),
  );

const records = [];

for (const path of trackedFiles) {
  const buffer = await readFile(resolve(path));
  const text = isTextFile(path) ? buffer.toString("utf8") : "";
  const lines = text ? text.split(/\r?\n/).length : null;
  const imports = text
    ? [...text.matchAll(/\b(?:import|export)\b[^\n]*?from\s+["']([^"']+)["']/g)].map(
        (match) => match[1],
      )
    : [];
  const record = {
    path,
    name: basename(path),
    extension: extname(path).toLowerCase() || "none",
    bytes: buffer.byteLength,
    lines,
    imports,
    importCount: imports.length,
    isTest: /(?:\.test\.|\.spec\.|\/tests?\/)/.test(path),
    hasTemporaryCompatibility: /compatibilidade temporária|temporar(?:y|ily)|deprecated/i.test(
      text,
    ),
    todoCount: (text.match(/\b(?:TODO|FIXME|HACK)\b/g) ?? []).length,
  };
  records.push(record);
}

const byName = new Map();
for (const record of records) {
  const list = byName.get(record.name) ?? [];
  list.push(record.path);
  byName.set(record.name, list);
}

const duplicateNames = [...byName.entries()]
  .filter(([, paths]) => paths.length > 1)
  .map(([name, paths]) => ({ name, paths }))
  .sort((left, right) => right.paths.length - left.paths.length);

const summary = {
  generatedAt: new Date().toISOString(),
  trackedFileCount: records.length,
  totalBytes: records.reduce((total, record) => total + record.bytes, 0),
  totalTextLines: records.reduce(
    (total, record) => total + (record.lines ?? 0),
    0,
  ),
  testFileCount: records.filter((record) => record.isTest).length,
  temporaryCompatibilityFileCount: records.filter(
    (record) => record.hasTemporaryCompatibility,
  ).length,
  todoCount: records.reduce((total, record) => total + record.todoCount, 0),
  largestByLines: records
    .filter((record) => record.lines !== null)
    .sort((left, right) => right.lines - left.lines)
    .slice(0, 40),
  largestByBytes: [...records]
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 40),
  duplicateNames,
  files: records.sort((left, right) => left.path.localeCompare(right.path)),
};

await Promise.all([
  writeFile(
    resolve(outputDirectory, "source-inventory.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, "source-inventory.md"),
    renderMarkdown(summary),
    "utf8",
  ),
]);

console.log(renderMarkdown(summary));

function isTextFile(path) {
  return [
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".json",
    ".md",
    ".rs",
    ".toml",
    ".yml",
    ".yaml",
    ".css",
    ".html",
    ".conf",
  ].includes(extname(path).toLowerCase());
}

function renderMarkdown(summary) {
  const largestRows = summary.largestByLines
    .slice(0, 25)
    .map(
      (record) =>
        `| \`${record.path}\` | ${record.lines} | ${record.bytes} | ${record.importCount} | ${record.isTest ? "sim" : "não"} |`,
    )
    .join("\n");
  const duplicateRows = summary.duplicateNames
    .slice(0, 20)
    .map(
      (entry) =>
        `| \`${entry.name}\` | ${entry.paths.map((path) => `\`${path}\``).join("<br>")} |`,
    )
    .join("\n");

  return `# Inventário de código da Fase 0\n\n` +
    `- Arquivos rastreados: ${summary.trackedFileCount}\n` +
    `- Linhas de texto: ${summary.totalTextLines}\n` +
    `- Arquivos de teste: ${summary.testFileCount}\n` +
    `- Arquivos com compatibilidade temporária/depreciação: ${summary.temporaryCompatibilityFileCount}\n` +
    `- Marcadores TODO/FIXME/HACK: ${summary.todoCount}\n\n` +
    `## Maiores arquivos por linhas\n\n` +
    `| Arquivo | Linhas | Bytes | Imports | Teste |\n` +
    `|---|---:|---:|---:|---:|\n${largestRows}\n\n` +
    `## Nomes de arquivo duplicados\n\n` +
    `| Nome | Caminhos |\n|---|---|\n${duplicateRows}\n`;
}
