import { memo, useEffect, useRef, useState } from "react";
import type { GarmentDraft, PatternSnapshot } from "../domain/pattern";
import { ThreeViewport } from "./GlobalThreeViewport";

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
  const lastAppliedGarmentRef = useRef<GarmentDraft | null>(null);
  const lastAppliedSnapshotsRef = useRef<PatternSnapshot[] | null>(null);
  const updateFrameRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  latestSnapshotsRef.current = snapshots;
  latestGarmentRef.current = garment;
  latestActiveRef.current = active;
  latestSimulateVersionRef.current = simulateVersion;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let mounted = true;
    const abortController = new AbortController();
    setError(null);

    void ThreeViewport.create(host, abortController.signal)
      .then((viewport) => {
        if (!mounted) {
          viewport.dispose();
          return;
        }
        viewportRef.current = viewport;
        onBackendChange(viewport.backend);
        if (latestActiveRef.current) {
          setWarnings(viewport.updateGarment(latestSnapshotsRef.current, latestGarmentRef.current));
          lastAppliedGarmentRef.current = latestGarmentRef.current;
          lastAppliedSnapshotsRef.current = latestSnapshotsRef.current;
        }
        if (latestActiveRef.current && latestSimulateVersionRef.current > 0) {
          viewport.dress();
          lastDressedVersionRef.current = latestSimulateVersionRef.current;
        } else if (latestActiveRef.current) {
          viewport.refresh();
        }
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        console.error(reason);
        setError("Não foi possível iniciar o manequim 3D neste navegador.");
      });

    return () => {
      mounted = false;
      abortController.abort();
      if (updateFrameRef.current !== null) window.cancelAnimationFrame(updateFrameRef.current);
      updateFrameRef.current = null;
      viewportRef.current?.dispose();
      viewportRef.current = null;
    };
  }, [onBackendChange]);

  useEffect(() => {
    if (!active || updateFrameRef.current !== null) return;
    if (lastAppliedGarmentRef.current === garment && lastAppliedSnapshotsRef.current === snapshots) return;
    updateFrameRef.current = window.requestAnimationFrame(() => {
      updateFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      setWarnings(viewport.updateGarment(latestSnapshotsRef.current, latestGarmentRef.current));
      lastAppliedGarmentRef.current = latestGarmentRef.current;
      lastAppliedSnapshotsRef.current = latestSnapshotsRef.current;
    });
    return () => {
      if (updateFrameRef.current !== null) window.cancelAnimationFrame(updateFrameRef.current);
      updateFrameRef.current = null;
    };
  }, [active, garment, snapshots]);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => viewportRef.current?.refresh());
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (simulateVersion <= lastDressedVersionRef.current || !viewportRef.current) return;
    viewportRef.current.dress();
    lastDressedVersionRef.current = simulateVersion;
  }, [simulateVersion]);

  return (
    <div className="viewport-host" ref={hostRef} data-testid="dressed-avatar-viewport">
      {error ? <div className="viewport-error">{error}</div> : null}
      {warnings.length > 0 ? (
        <div className="viewport-warnings" role="alert">
          {warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}
      <div className="viewport-label">
        Manequim vestido · {garment.bodyType === "feminine" ? "Feminino" : "Masculino"} ·{" "}
        {garment.fabrics.length > 1 ? `${garment.fabrics.length} tecidos` : garment.fabrics[0]?.name ?? "sem tecido"}
      </div>
    </div>
  );
});
