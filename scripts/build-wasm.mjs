import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedProfile = process.argv[2] ?? "--release";

if (requestedProfile !== "--dev" && requestedProfile !== "--release") {
  console.error(`Perfil WASM inválido: ${requestedProfile}. Use --dev ou --release.`);
  process.exit(1);
}

const locator = process.platform === "win32" ? "where.exe" : "which";
const lookup = spawnSync(locator, ["wasm-pack"], {
  cwd: projectRoot,
  encoding: "utf8",
  windowsHide: true,
});

if (lookup.status !== 0) {
  console.error(
    [
      "Não foi possível compilar o núcleo Rust/WASM porque wasm-pack não está instalado ou não está no PATH.",
      "Instale Rust e wasm-pack conforme docs/INSTALL_WINDOWS.md, ou use o modo TypeScript:",
      "  npm run dev:fallback",
      "  npm run build",
    ].join("\n"),
  );
  process.exit(1);
}

const result = spawnSync(
  "wasm-pack",
  [
    "build",
    "crates/pattern-core",
    "--target",
    "web",
    requestedProfile,
    "--out-dir",
    "../../apps/web/public/wasm",
  ],
  {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) {
  console.error(`Falha ao iniciar wasm-pack: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
