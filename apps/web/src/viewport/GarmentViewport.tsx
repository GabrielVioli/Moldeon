import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { GarmentDraft, PatternSnapshot, PreviewRegion } from "../domain/pattern";
import { ThreeViewport } from "./ThreeViewport";

interface GarmentViewportProps {
  garment: GarmentDraft;
  snapshots: PatternSnapshot[];
  simulateVersion: number;
  active: boolean;
  onBackendChange(backend: "webgpu" | "webgl2"): void;
  onPieceDrop?(pieceId: string, region: PreviewRegion): void;
  showBody: boolean;
  connectedPieceIds: string[];
}

export const GarmentViewport = memo(function GarmentViewport({
  garment,
  snapshots,
  simulateVersion,
  active,
  onBackendChange,
  onPieceDrop,
  showBody,
  connectedPieceIds,
}: GarmentViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<ThreeViewport | null>(null);
  const latestSnapshotsRef = useRef(snapshots);
  const latestGarmentRef = useRef(garment);
  const latestActiveRef = useRef(active);
  const latestSimulateVersionRef = useRef(simulateVersion);
  const latestShowBodyRef = useRef(showBody);
  const latestConnectedIdsRef = useRef(new Set(connectedPieceIds));
  const lastDressedVersionRef = useRef(0);
  const updateFrameRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [draggingPiece, setDraggingPiece] = useState(false);
  const [inspectionMode, setInspectionMode] = useState<"mounted" | "exploded">("mounted");

  latestSnapshotsRef.current = snapshots;
  latestGarmentRef.current = garment;
  latestActiveRef.current = active;
  latestSimulateVersionRef.current = simulateVersion;
  latestShowBodyRef.current = showBody;
  latestConnectedIdsRef.current = new Set(connectedPieceIds);
  const connectedSnapshots = useMemo(() => {
    const connectedIds = new Set(connectedPieceIds);
    return snapshots.filter((candidate) => connectedIds.has(candidate.piece.id));
  }, [connectedPieceIds, snapshots]);

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
        viewport.setBodyVisible(latestShowBodyRef.current);

        if (latestActiveRef.current) {
          setWarnings(viewport.updateGarment(
            latestSnapshotsRef.current.filter((candidate) => latestConnectedIdsRef.current.has(candidate.piece.id)),
            latestGarmentRef.current,
          ));
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
    viewportRef.current?.setBodyVisible(showBody);
  }, [showBody]);

  useEffect(() => {
    viewportRef.current?.setExploded(inspectionMode === "exploded");
  }, [inspectionMode]);

  useEffect(() => {
    if (!active) return;
    if (updateFrameRef.current !== null) return;
    updateFrameRef.current = window.requestAnimationFrame(() => {
      updateFrameRef.current = null;
      const nextWarnings = viewportRef.current?.updateGarment(
        connectedSnapshots,
        latestGarmentRef.current,
      );
      if (nextWarnings) setWarnings(nextWarnings);
    });
  }, [active, garment, connectedSnapshots, showBody]);

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
    <div
      className={`viewport-host${draggingPiece ? " is-piece-dragging" : ""}`}
      ref={hostRef}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("application/x-moldeon-piece")) setDraggingPiece(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("application/x-moldeon-piece")) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingPiece(false);
      }}
      onDrop={() => setDraggingPiece(false)}
    >
      {error ? <div className="viewport-error">{error}</div> : null}
      {warnings.length ? <div className="viewport-warnings" role="alert">{warnings.join(" ")}</div> : null}
      {draggingPiece ? (
        <div className="preview-drop-zones" aria-label="Regiões de posicionamento">
          {(["torso", "waist", "hip", "arm", "leg"] as const).map((region) => (
            <button
              key={region}
              type="button"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const pieceId = event.dataTransfer.getData("application/x-moldeon-piece");
                if (pieceId) onPieceDrop?.(pieceId, region);
                setDraggingPiece(false);
              }}
            >
              {regionLabel(region)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="viewport-inspection" role="group" aria-label="Inspeção da montagem">
        <button type="button" className={inspectionMode === "mounted" ? "active" : ""} onClick={() => setInspectionMode("mounted")}>Montada</button>
        <button type="button" className={inspectionMode === "exploded" ? "active" : ""} onClick={() => setInspectionMode("exploded")}>Explodida</button>
      </div>
      <div className="viewport-label">
        Preview 3D · {garment.bodyType === "feminine" ? "Feminino" : "Masculino"} ·{" "}
        {garment.fabrics.length > 1
          ? `${garment.fabrics.length} tecidos`
          : garment.fabrics[0]?.name ?? "sem tecido"}
      </div>
    </div>
  );
});

function regionLabel(region: PreviewRegion): string {
  return { torso: "Tronco", waist: "Cintura", hip: "Quadril", arm: "Braço", leg: "Perna" }[region];
}
