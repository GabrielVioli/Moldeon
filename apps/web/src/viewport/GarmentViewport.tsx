import { memo, useEffect, useRef, useState } from "react";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import {
  approvedAvatarForBody,
  AVATAR_NOT_CONFIGURED_MESSAGE,
} from "../avatar/ApprovedAvatarAsset";
import { ThreeViewport } from "./GlobalThreeViewport";

interface GarmentViewportProps {
  assemblyInput: ResolvedAssemblyInput;
  simulateVersion: number;
  active: boolean;
  onBackendChange(backend: "webgpu" | "webgl2"): void;
}

export const GarmentViewport = memo(function GarmentViewport({
  assemblyInput,
  simulateVersion,
  active,
  onBackendChange,
}: GarmentViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<ThreeViewport | null>(null);
  const latestInputRef = useRef(assemblyInput);
  const latestActiveRef = useRef(active);
  const latestSimulateVersionRef = useRef(simulateVersion);
  const lastDressedVersionRef = useRef(0);
  const lastAppliedSignatureRef = useRef<string | null>(null);
  const updateFrameRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const approvedAvatar = approvedAvatarForBody(assemblyInput.document.body.type);

  latestInputRef.current = assemblyInput;
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
          setWarnings(viewport.updateGarment(latestInputRef.current));
          lastAppliedSignatureRef.current = latestInputRef.current.signature;
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
    if (lastAppliedSignatureRef.current === assemblyInput.signature) return;
    updateFrameRef.current = window.requestAnimationFrame(() => {
      updateFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      setWarnings(viewport.updateGarment(latestInputRef.current));
      lastAppliedSignatureRef.current = latestInputRef.current.signature;
    });
    return () => {
      if (updateFrameRef.current !== null) window.cancelAnimationFrame(updateFrameRef.current);
      updateFrameRef.current = null;
    };
  }, [active, assemblyInput.signature]);

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
        {approvedAvatar
          ? `Manequim aprovado · ${approvedAvatar.assetId}`
          : AVATAR_NOT_CONFIGURED_MESSAGE}
      </div>
    </div>
  );
});
