import { useEffect, useRef, useState } from "react";
import { PatternSnapshot } from "../domain/pattern";
import { ThreeViewport } from "./ThreeViewport";

interface GarmentViewportProps {
  snapshot: PatternSnapshot;
  simulateVersion: number;
}

export function GarmentViewport({ snapshot, simulateVersion }: GarmentViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<ThreeViewport | null>(null);
  const latestSnapshotRef = useRef(snapshot);
  const [error, setError] = useState<string | null>(null);

  latestSnapshotRef.current = snapshot;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let active = true;

    void ThreeViewport.create(host)
      .then((viewport) => {
        if (!active) {
          viewport.dispose();
          return;
        }
        viewportRef.current = viewport;
        viewport.updatePattern(latestSnapshotRef.current);
      })
      .catch((reason: unknown) => {
        console.error(reason);
        setError("Não foi possível iniciar o viewport 3D neste navegador.");
      });

    return () => {
      active = false;
      viewportRef.current?.dispose();
      viewportRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewportRef.current?.updatePattern(snapshot);
  }, [snapshot]);

  useEffect(() => {
    if (simulateVersion > 0) viewportRef.current?.dress();
  }, [simulateVersion]);

  return (
    <div className="viewport-host" ref={hostRef}>
      {error ? <div className="viewport-error">{error}</div> : null}
      <div className="viewport-label">Preview 3D · arraste para girar</div>
    </div>
  );
}
