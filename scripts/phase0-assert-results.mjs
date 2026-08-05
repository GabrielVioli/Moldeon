import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const artifactRoot = resolve(
  process.env.PHASE0_ARTIFACT_DIR ?? "artifacts/baseline",
);
const required = process.argv.slice(2);

if (required.length === 0) {
  console.error("Informe ao menos um resultado obrigatório.");
  process.exit(2);
}

const failures = [];

for (const name of required) {
  const path = resolve(
    artifactRoot,
    "commands",
    `${name.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`,
  );

  try {
    const result = JSON.parse(await readFile(path, "utf8"));
    if (result.exitCode !== 0) {
      failures.push(`${name}: exit code ${result.exitCode}`);
    }
  } catch (error) {
    failures.push(
      `${name}: resultado ausente (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

if (failures.length > 0) {
  console.error("A Fase 0 encontrou validações obrigatórias com falha:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Todas as ${required.length} validações obrigatórias passaram.`);
