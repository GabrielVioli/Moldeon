import { memo } from "react";

interface StatusBarProps {
  backend: "wasm" | "typescript";
  renderBackend: "deferred" | "webgpu" | "webgl2";
  autosaveStatus: string;
}

export const StatusBar = memo(function StatusBar({
  backend,
  renderBackend,
  autosaveStatus,
}: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span>Núcleo: {backend === "wasm" ? "Rust/WASM" : "TypeScript fallback"}</span>
      <span>Render: {renderBackendLabel(renderBackend)}</span>
      <span>Isolamento: {crossOriginIsolated ? "ativo" : "inativo"}</span>
      <span>{autosaveStatus}</span>
    </footer>
  );
});

function renderBackendLabel(
  backend: StatusBarProps["renderBackend"],
): string {
  if (backend === "webgpu") return "WebGPU";
  if (backend === "webgl2") return "WebGL 2";
  return "3D sob demanda";
}
