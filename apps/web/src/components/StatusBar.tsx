interface StatusBarProps {
  backend: "wasm" | "typescript";
  autosaveStatus: string;
}

export function StatusBar({ backend, autosaveStatus }: StatusBarProps) {
  const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;

  return (
    <footer className="status-bar">
      <span>Núcleo: {backend === "wasm" ? "Rust/WASM" : "TypeScript fallback"}</span>
      <span>Render: {hasWebGpu ? "WebGPU disponível" : "fallback WebGL 2"}</span>
      <span>Isolamento: {crossOriginIsolated ? "ativo" : "inativo"}</span>
      <span>{autosaveStatus}</span>
    </footer>
  );
}
