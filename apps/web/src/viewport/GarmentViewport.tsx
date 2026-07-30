import { useEffect, useRef, useState } from "react";
import { PatternSnapshot } from "../domain/pattern";
import { ThreeViewport } from "./ThreeViewport";

interface GarmentViewportProps {
  snapshot: PatternSnapshot;
  simulateVersion: number;
  active: boolean;
  onBackendChange(backend: "webgpu" | "webgl2"): void;
}

export function GarmentViewport({
  snapshot,
  simulateVersion,
  active,
  onBackendChange,
}: GarmentViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<ThreeViewport | null>(null);
  const latestSnapshotRef = useRef(snapshot);
  const latestActiveRef = useRef(active);
  const latestSimulateVersionRef = useRef(simulateVersion);
  const lastDressedVersionRef = useRef(0);
  const updateFrameRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  latestSnapshotRef.current = snapshot;
  latestActiveRef.current = active;
  latestSimulateVersionRef.current = simulateVersion;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let active = true;
    const abortController = new AbortController();
    setError(null);

    void ThreeViewport.create(host, abortController.signal)
      .then((viewport) => {
        if (!active) {
          viewport.dispose();
          return;
        }
        viewportRef.current = viewport;
        onBackendChange(viewport.backend);

        if (latestActiveRef.current) {
          viewport.updatePattern(latestSnapshotRef.current);
        }

        if (
          latestActiveRef.current &&
          latestSimulateVersionRef.current > 0
        ) {
          viewport.dress();
          lastDressedVersionRef.current =
            latestSimulateVersionRef.current;
        }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        console.error(reason);
        setError("Não foi possível iniciar o viewport 3D neste navegador.");
      });

    return () => {
      active = false;
      abortController.abort();
      if (updateFrameRef.current !== null) {
        window.cancelAnimationFrame(updateFrameRef.current);
        updateFrameRef.current = null;
      }
      viewportRef.current?.dispose();
      viewportRef.current = null;
    };
  }, [onBackendChange]);

  useEffect(() => {
    if (!active) return;
    if (updateFrameRef.current !== null) return;
    updateFrameRef.current = window.requestAnimationFrame(() => {
      updateFrameRef.current = null;
      viewportRef.current?.updatePattern(latestSnapshotRef.current);
    });
  }, [active, snapshot]);

  useEffect(() => {
    if (
      simulateVersion > lastDressedVersionRef.current &&
      viewportRef.current
    ) {
      viewportRef.current.dress();
      lastDressedVersionRef.current = simulateVersion;
    }
  }, [simulateVersion]);

  return (
    <div className="viewport-host" ref={hostRef}>
      {error ? <div className="viewport-error">{error}</div> : null}
      <div className="viewport-label">Preview 3D · arraste para girar</div>
    </div>
  );
}
