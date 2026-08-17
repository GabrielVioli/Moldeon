import { memo, useEffect, useRef, useState } from "react";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import {
  approvedAvatarForBody,
  AVATAR_NOT_CONFIGURED_MESSAGE,
} from "../avatar/ApprovedAvatarAsset";
import {
  ThreeViewport,
  type SimulationDevSettings,
  type SimulationDevTelemetry,
  type SimulationLifecycleState,
} from "./GlobalThreeViewport";

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
  const [simulationState, setSimulationState] = useState<"ready" | SimulationLifecycleState>("ready");
  const [devSettings, setDevSettings] = useState<SimulationDevSettings>({
    gravityScale: 1,
    cadence: 1,
    autoPauseSteps: 0,
  });
  const [wireframe, setWireframe] = useState(false);
  const [telemetry, setTelemetry] = useState<SimulationDevTelemetry | null>(null);
  const devSettingsRef = useRef(devSettings);
  const wireframeRef = useRef(wireframe);
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

    void ThreeViewport.create(
      host,
      abortController.signal,
      (nextState) => {
        if (mounted) setSimulationState(nextState);
      },
      (nextTelemetry) => {
        if (mounted) setTelemetry(nextTelemetry);
      },
    )
      .then((viewport) => {
        if (!mounted) {
          viewport.dispose();
          return;
        }
        viewportRef.current = viewport;
        viewport.setSimulationDevSettings(devSettingsRef.current);
        viewport.setWireframe(wireframeRef.current);
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

  useEffect(() => {
    devSettingsRef.current = devSettings;
    viewportRef.current?.setSimulationDevSettings(devSettings);
  }, [devSettings]);

  useEffect(() => {
    wireframeRef.current = wireframe;
    viewportRef.current?.setWireframe(wireframe);
  }, [wireframe]);

  return (
    <div className="viewport-host" ref={hostRef} data-testid="dressed-avatar-viewport" data-simulation-ui-state={simulationState}>
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
      <div className="viewport-simulation-controls" aria-label="Controles da simula\u00e7\u00e3o">
        {simulationState === "running" ? (
          <button type="button" onClick={() => {
            viewportRef.current?.pauseSimulation();
          }}>Pausar</button>
        ) : (
          <button type="button" onClick={() => {
            viewportRef.current?.resumeSimulation();
          }}>Continuar</button>
        )}
        <button type="button" onClick={() => {
          viewportRef.current?.stepSimulation();
        }}>Passo</button>
        <button type="button" onClick={() => {
          viewportRef.current?.resetSimulation();
        }}>Reiniciar</button>
      </div>
      {import.meta.env.DEV ? (
        <aside className="viewport-physics-dev" aria-label="Diagnóstico físico DEV">
          <strong>Física DEV</strong>
          <label>
            Gravidade
            <select
              value={devSettings.gravityScale}
              onChange={(event) => setDevSettings((current) => ({
                ...current,
                gravityScale: Number(event.target.value) as SimulationDevSettings["gravityScale"],
              }))}
            >
              <option value={0}>0%</option>
              <option value={0.25}>25%</option>
              <option value={1}>100%</option>
            </select>
          </label>
          <label>
            Simulação
            <select
              value={devSettings.cadence}
              onChange={(event) => setDevSettings((current) => ({
                ...current,
                cadence: Number(event.target.value) as SimulationDevSettings["cadence"],
              }))}
            >
              <option value={0.1}>0.1x</option>
              <option value={0.25}>0.25x</option>
              <option value={1}>1x</option>
            </select>
          </label>
          <label>
            Auto-pause
            <select
              value={devSettings.autoPauseSteps}
              onChange={(event) => setDevSettings((current) => ({
                ...current,
                autoPauseSteps: Number(event.target.value) as SimulationDevSettings["autoPauseSteps"],
              }))}
            >
              <option value={0}>desligado</option>
              <option value={30}>30 steps</option>
              <option value={60}>60 steps</option>
              <option value={120}>120 steps</option>
            </select>
          </label>
          <label className="viewport-physics-toggle">
            <input
              type="checkbox"
              checked={wireframe}
              onChange={(event) => setWireframe(event.target.checked)}
            />
            Wireframe
          </label>
          <button type="button" onClick={() => viewportRef.current?.frameGarment()}>
            Enquadrar roupa
          </button>
          <dl>
            <dt>physicsStep</dt><dd>{telemetry?.stepCount ?? 0}</dd>
            <dt>FPS</dt><dd>{formatMetric(telemetry?.approximateFps)}</dd>
            <dt>physicsStepMs</dt><dd>{formatMetric(telemetry?.physicsStepMs)}</dd>
            <dt>particles</dt><dd>{telemetry?.particleCount ?? 0}</dd>
            <dt>triangles</dt><dd>{telemetry?.triangleCount ?? 0}</dd>
            <dt>stretch</dt><dd>{telemetry?.stretchConstraintCount ?? 0}</dd>
            <dt>shear</dt><dd>{telemetry?.shearConstraintCount ?? 0}</dd>
            <dt>bend</dt><dd>{telemetry?.bendConstraintCount ?? 0}</dd>
            <dt>seams</dt><dd>{telemetry?.seamConstraintCount ?? 0}</dd>
            <dt>seamMeanErrorMm</dt><dd>{formatMetric((telemetry?.seamErrorAverage ?? 0) * 1000)}</dd>
            <dt>seamMaxErrorMm</dt><dd>{formatMetric((telemetry?.seamErrorMaximum ?? 0) * 1000)}</dd>
          </dl>
        </aside>
      ) : null}
    </div>
  );
});

function formatMetric(value: number | undefined): string {
  return Number.isFinite(value) ? (value ?? 0).toFixed(2) : "0.00";
}
