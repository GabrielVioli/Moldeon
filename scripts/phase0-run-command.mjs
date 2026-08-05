import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [, , name, ...commandParts] = process.argv;

if (!name || commandParts.length === 0) {
  console.error(
    "Uso: node scripts/phase0-run-command.mjs <nome> <comando> [argumentos...]",
  );
  process.exit(2);
}

const artifactRoot = resolve(
  process.env.PHASE0_ARTIFACT_DIR ?? "artifacts/baseline",
);
const commandDirectory = resolve(artifactRoot, "commands");
await mkdir(commandDirectory, { recursive: true });

const startedAt = new Date();
const startedNs = process.hrtime.bigint();
const command = commandParts.map(quoteShellPart).join(" ");
let stdout = "";
let stderr = "";

console.log(`\n[phase0] $ ${command}`);

const child = spawn(command, {
  cwd: process.cwd(),
  env: process.env,
  shell: true,
  windowsHide: true,
});

child.stdout?.setEncoding("utf8");
child.stderr?.setEncoding("utf8");

child.stdout?.on("data", (chunk) => {
  stdout += chunk;
  process.stdout.write(chunk);
});
child.stderr?.on("data", (chunk) => {
  stderr += chunk;
  process.stderr.write(chunk);
});

const result = await new Promise((resolveResult) => {
  child.on("error", (error) => {
    resolveResult({ exitCode: 1, signal: null, spawnError: error.message });
  });
  child.on("close", (exitCode, signal) => {
    resolveResult({ exitCode: exitCode ?? 1, signal, spawnError: null });
  });
});

const endedAt = new Date();
const durationMs = Number(process.hrtime.bigint() - startedNs) / 1_000_000;
const record = {
  name,
  command,
  cwd: process.cwd(),
  platform: process.platform,
  architecture: process.arch,
  startedAt: startedAt.toISOString(),
  endedAt: endedAt.toISOString(),
  durationMs: Math.round(durationMs * 100) / 100,
  exitCode: result.exitCode,
  signal: result.signal,
  spawnError: result.spawnError,
  status: result.exitCode === 0 ? "passed" : "failed",
  stdoutBytes: Buffer.byteLength(stdout),
  stderrBytes: Buffer.byteLength(stderr),
};

await Promise.all([
  writeFile(
    resolve(commandDirectory, `${safeName(name)}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    resolve(commandDirectory, `${safeName(name)}.log`),
    [
      `$ ${command}`,
      "",
      "--- stdout ---",
      stdout,
      "",
      "--- stderr ---",
      stderr,
      "",
    ].join("\n"),
    "utf8",
  ),
]);

console.log(
  `[phase0] ${name}: ${record.status} em ${(durationMs / 1000).toFixed(2)} s`,
);
process.exit(result.exitCode);

function quoteShellPart(value) {
  if (/^[A-Za-z0-9_./:@=+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function safeName(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}
