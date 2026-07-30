import { memo, useEffect, useRef, useState } from "react";
import type { GarmentDraft, PatternSnapshot } from "../domain/pattern";
import { ThreeViewport } from "./ThreeViewport";

interface GarmentViewportProps {
  garment: GarmentDraft;
  snapshots: PatternSnapshot[];
  simulateVersion: number;
  active: boolean;
  onBackendChange(backend: "webgpu" | "webgl2"): void;
}

export const GarmentViewport = memo(function GarmentViewport({
  garment,
  snapshots,
  simulateVersion,
  active,
  onBackendChange,
}: GarmentViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<ThreeViewport | null>(null);
  const latestSnapshotsRef = useRef(snapshots);
  const latestGarmentRef = useRef(garment);
  const latestActiveRef = useRef(active);
  const latestSimulateVersionRef = useRef(simulateVersion);
  const lastDressedVersionRef = useRef(0);
  const updateFrameRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  latestSnapshotsRef.current = snapshots;
  latestGarmentRef.current = garment;
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
          viewport.updateGarment(
            latestSnapshotsRef.current,
            latestGarmentRef.current,
          );
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
      viewportRef.current?.updateGarment(
        latestSnapshotsRef.current,
        latestGarmentRef.current,
      );
    });
  }, [active, garment, snapshots]);

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
      <div className="viewport-label">
        Preview 3D · {garment.bodyType === "feminine" ? "Feminino" : "Masculino"} ·{" "}
        {garment.fabrics.length > 1
          ? `${garment.fabrics.length} tecidos`
          : garment.fabrics[0]?.name ?? "sem tecido"}
      </div>
    </div>
  );
});
