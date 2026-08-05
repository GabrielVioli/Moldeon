import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [, , requestedMode = "fallback", requestedLabel = requestedMode, requestedPort = "5173"] =
  process.argv;

if (requestedMode !== "fallback" && requestedMode !== "wasm") {
  console.error("Modo inválido. Use fallback ou wasm.");
  process.exit(2);
}

const port = Number.parseInt(requestedPort, 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error("A porta precisa ser um inteiro entre 1 e 65535.");
  process.exit(2);
}

const artifactRoot = resolve(
  process.env.PHASE0_ARTIFACT_DIR ?? "artifacts/baseline",
);
await mkdir(artifactRoot, { recursive: true });
const serverLogPath = resolve(artifactRoot, `server-${requestedLabel}.log`);
let serverLog = "";
let serverProcess = null;

try {
  if (requestedMode === "wasm") {
    await runForeground("npm", ["run", "wasm:build:dev"]);
  }

  serverProcess = startServer(requestedMode, port);
  await waitForServer(`http://127.0.0.1:${port}/`, 60_000);
  await runForeground(process.execPath, ["scripts/phase0-browser-audit.mjs"], {
    PHASE0_BASE_URL: `http://127.0.0.1:${port}`,
    PHASE0_BROWSER_LABEL: requestedLabel,
  });
} finally {
  await stopProcessTree(serverProcess);
  await writeFile(serverLogPath, serverLog, "utf8");
}

function startServer(mode, serverPort) {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const script = mode === "fallback" ? "dev:fallback" : "dev";
  const child = spawn(
    npmExecutable,
    [
      "run",
      script,
      "--workspace",
      "@moldeon/web",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(serverPort),
      "--strictPort",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", appendServerLog);
  child.stderr?.on("data", appendServerLog);
  child.on("error", appendServerLog);
  return child;
}

function appendServerLog(chunk) {
  const text = chunk instanceof Error ? `${chunk.stack ?? chunk.message}\n` : String(chunk);
  serverLog += text;
  process.stdout.write(text);
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null) {
      throw new Error(
        `O servidor encerrou antes da auditoria, código ${serverProcess.exitCode}.`,
      );
    }

    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  throw new Error(
    `O servidor não respondeu em ${timeoutMs} ms: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function runForeground(command, args, extraEnvironment = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const executable =
      process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnvironment },
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", rejectRun);
    child.on("close", (exitCode, signal) => {
      if (exitCode === 0) resolveRun();
      else {
        rejectRun(
          new Error(
            `${command} ${args.join(" ")} falhou com código ${exitCode ?? "?"}${
              signal ? ` e sinal ${signal}` : ""
            }.`,
          ),
        );
      }
    });
  });
}

async function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return;

  if (process.platform === "win32") {
    await new Promise((resolveStop) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.on("close", () => resolveStop());
      killer.on("error", () => resolveStop());
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }

  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(2_000),
  ]);

  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
