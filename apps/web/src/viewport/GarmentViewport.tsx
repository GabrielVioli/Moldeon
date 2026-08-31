import { memo, useEffect, useRef, useState } from "react";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import {
  approvedAvatarForBody,
  AVATAR_NOT_CONFIGURED_MESSAGE,
} from "../avatar/ApprovedAvatarAsset";
import {
  ThreeViewport,
  type ArrangementTool,
  type SimulationDevSettings,
  type SimulationDevTelemetry,
  type SimulationLifecycleState,
} from "./GlobalThreeViewport";
import type { ArrangementCommit } from "./ArrangementWorkspace";

interface GarmentViewportProps {
  assemblyInput: ResolvedAssemblyInput;
  simulateVersion: number;
  active: boolean;
  displayMode: "side-preview" | "full-fitting";
  onBackendChange(backend: "webgpu" | "webgl2"): void;
  onArrangementCommit?(commits: ArrangementCommit[]): void;
}

export const GarmentViewport = memo(function GarmentViewport({
  assemblyInput,
  simulateVersion,
  active,
  displayMode,
  onBackendChange,
  onArrangementCommit,
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
    bodyCollisionEnabled: true,
    floorCollisionEnabled: true,
    showBodyColliders: false,
    showProceduralAvatar: true,
    showRegistrationAxes: false,
  });
  const [wireframe, setWireframe] = useState(false);
  const [telemetry, setTelemetry] = useState<SimulationDevTelemetry | null>(null);
  const devSettingsRef = useRef(devSettings);
  const wireframeRef = useRef(wireframe);
  const arrangementCommitRef = useRef(onArrangementCommit);
  const pendingArrangementCommitsRef = useRef<ArrangementCommit[] | null>(null);
  const [selectedArrangementIds, setSelectedArrangementIds] = useState<string[]>([]);
  const [selectionPinned, setSelectionPinned] = useState(false);
  const [arrangementTool, setArrangementTool] = useState<ArrangementTool>("move");
  const arrangementToolRef = useRef<ArrangementTool>(arrangementTool);
  const approvedAvatar = approvedAvatarForBody(assemblyInput.document.body.type);
  const selectedArrangementState = selectedArrangementIds.length === 0
    ? null
    : selectedArrangementIds.every((id) =>
      assemblyInput.panelInstances.find((instance) => instance.id === id)?.arrangementAnchor,
    )
      ? "AJUSTADO"
      : "POSICIONAR";

  latestInputRef.current = assemblyInput;
  latestActiveRef.current = active;
  latestSimulateVersionRef.current = simulateVersion;
  arrangementCommitRef.current = onArrangementCommit;
  arrangementToolRef.current = arrangementTool;

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
        viewport.setArrangementInteractionHandlers(
          (commits) => {
            const handler = arrangementCommitRef.current;
            if (!handler || commits.length === 0) return;
            pendingArrangementCommitsRef.current = commits;
            handler(commits);
          },
          (instanceIds) => {
            setSelectedArrangementIds(instanceIds);
            setSelectionPinned(false);
          },
        );
        viewport.setArrangementTool(arrangementToolRef.current);
        viewport.setSimulationDevSettings(devSettingsRef.current);
        viewport.setWireframe(wireframeRef.current);
        onBackendChange(viewport.backend);
        if (latestActiveRef.current) {
          const mode = displayMode === "full-fitting" ? "fitting" : "assembly";
          setWarnings(viewport.updateGarment(latestInputRef.current, mode));
          lastAppliedSignatureRef.current = mode === "fitting"
            ? latestInputRef.current.simulationRevision
            : latestInputRef.current.geometryRevision;
        }
        if (displayMode === "full-fitting" && latestActiveRef.current && latestSimulateVersionRef.current > 0) {
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
    const effectiveRevision = displayMode === "full-fitting"
      ? assemblyInput.simulationRevision
      : assemblyInput.geometryRevision;
    if (lastAppliedSignatureRef.current === effectiveRevision) return;
    updateFrameRef.current = window.requestAnimationFrame(() => {
      updateFrameRef.current = null;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const mode = displayMode === "full-fitting" ? "fitting" : "assembly";
      setWarnings(viewport.updateGarment(latestInputRef.current, mode));
      lastAppliedSignatureRef.current = effectiveRevision;
    });
    return () => {
      if (updateFrameRef.current !== null) window.cancelAnimationFrame(updateFrameRef.current);
      updateFrameRef.current = null;
    };
  }, [active, assemblyInput.geometryRevision, assemblyInput.simulationRevision, displayMode]);

  useEffect(() => {
    if (!active || displayMode !== "side-preview") return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const pending = pendingArrangementCommitsRef.current;
    pendingArrangementCommitsRef.current = null;
    viewport.updateWorkspaceArrangement(assemblyInput, {
      transformOnly: Boolean(pending && arrangementCommitsMatchInput(assemblyInput, pending)),
    });
  }, [active, assemblyInput.arrangementRevision, displayMode]);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => viewportRef.current?.refresh());
    return () => window.cancelAnimationFrame(frame);
  }, [active, displayMode]);

  useEffect(() => {
    const host = hostRef.current;
    const workspace = host?.closest(".workspace") as HTMLElement | null;
    if (!host || !workspace || !active) return;
    let frame: number | null = null;
    const syncWorkspaceLayout = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const primary3D = workspace.classList.contains("mode-assembly")
          || workspace.classList.contains("mode-fitting");
        host.dataset.viewportWorkspaceRole = primary3D ? "primary-3d" : "side-preview";
        viewportRef.current?.refresh();
      });
    };
    syncWorkspaceLayout();
    const observer = new MutationObserver(syncWorkspaceLayout);
    observer.observe(workspace, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [active]);

  useEffect(() => {
    if (displayMode !== "full-fitting" || simulateVersion <= lastDressedVersionRef.current || !viewportRef.current) return;
    viewportRef.current.dress();
    lastDressedVersionRef.current = simulateVersion;
  }, [displayMode, simulateVersion]);

  useEffect(() => {
    devSettingsRef.current = devSettings;
    viewportRef.current?.setSimulationDevSettings(devSettings);
  }, [devSettings]);

  useEffect(() => {
    wireframeRef.current = wireframe;
    viewportRef.current?.setWireframe(wireframe);
  }, [wireframe]);

  useEffect(() => {
    arrangementToolRef.current = arrangementTool;
    viewportRef.current?.setArrangementTool(arrangementTool);
  }, [arrangementTool]);

  return (
    <div
      className="viewport-host"
      ref={hostRef}
      data-testid="dressed-avatar-viewport"
      data-simulation-ui-state={simulationState}
      data-viewport-layout={displayMode}
      data-arrangement-tool={arrangementTool}
    >
      {error ? <div className="viewport-error">{error}</div> : null}
      {warnings.length > 0 ? (
        <div className="viewport-warnings" role="alert">
          {warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}
      <div className="viewport-label">
        {import.meta.env.DEV
          ? `Manequim procedural DEV · ${assemblyInput.document.body.type}`
          : approvedAvatar
            ? `Manequim aprovado · ${approvedAvatar.assetId}`
            : AVATAR_NOT_CONFIGURED_MESSAGE}
      </div>
      {displayMode === "side-preview" ? (
        <div className="viewport-arrangement-controls" aria-label="Ações da montagem 3D">
          <div className="viewport-arrangement-status">
            <strong>{selectedArrangementIds.length > 0
              ? `${selectedArrangementIds.length} selecionada(s) · ${selectedArrangementState}`
              : "Selecione uma peça"}</strong>
            <small>{arrangementTool === "move" ? "Arraste a peça para mover" : "Arraste horizontalmente para girar"}</small>
          </div>
          <div className="viewport-arrangement-actions">
            <button
              type="button"
              className="arrangement-tool-button"
              aria-pressed={arrangementTool === "move"}
              onClick={() => setArrangementTool("move")}
            >Mover</button>
            <button
              type="button"
              className="arrangement-tool-button"
              aria-pressed={arrangementTool === "rotate"}
              onClick={() => setArrangementTool("rotate")}
            >Girar</button>
            <button type="button" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.adjustArrangementSelectionToBody()}>Ajustar</button>
            <button type="button" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.flipArrangementSelection()}>Virar face</button>
            <button
              type="button"
              disabled={selectedArrangementIds.length === 0}
              aria-pressed={selectionPinned}
              onClick={() => setSelectionPinned(viewportRef.current?.toggleArrangementPin() ?? false)}
            >{selectionPinned ? "Soltar" : "Fixar"}</button>
            <button type="button" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.focusArrangementSelection()}>Focar</button>
            <details className="viewport-arrangement-more">
              <summary aria-label="Mais ações de rotação">•••</summary>
              <div>
                <button type="button" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.rotateArrangementSelection(-15)}>−15°</button>
                <button type="button" disabled={selectedArrangementIds.length === 0} onClick={() => viewportRef.current?.rotateArrangementSelection(15)}>+15°</button>
              </div>
            </details>
          </div>
        </div>
      ) : null}
      {displayMode === "full-fitting" ? <div className="viewport-simulation-controls" aria-label="Controles da simulação">
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
      </div> : null}
      {import.meta.env.DEV && displayMode === "full-fitting" ? (
        <details className="viewport-physics-dev" data-testid="physics-dev-panel">
          <summary>Física DEV</summary>
          <div className="viewport-physics-dev-body">
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
              <option value={0.25}>25%</option>
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
              checked={devSettings.bodyCollisionEnabled}
              onChange={(event) => setDevSettings((current) => ({ ...current, bodyCollisionEnabled: event.target.checked }))}
            />
            Body collision
          </label>
          <label className="viewport-physics-toggle">
            <input
              type="checkbox"
              checked={devSettings.floorCollisionEnabled}
              onChange={(event) => setDevSettings((current) => ({ ...current, floorCollisionEnabled: event.target.checked }))}
            />
            Floor collision
          </label>
          <label className="viewport-physics-toggle">
            <input
              type="checkbox"
              checked={devSettings.showBodyColliders}
              onChange={(event) => setDevSettings((current) => ({ ...current, showBodyColliders: event.target.checked }))}
            />
            Mostrar malha exata de colisão
          </label>
          <label className="viewport-physics-toggle">
            <input
              type="checkbox"
              checked={devSettings.showProceduralAvatar}
              onChange={(event) => setDevSettings((current) => ({ ...current, showProceduralAvatar: event.target.checked }))}
            />
            Show procedural avatar
          </label>
          <label className="viewport-physics-toggle">
            <input
              type="checkbox"
              checked={devSettings.showRegistrationAxes}
              onChange={(event) => setDevSettings((current) => ({ ...current, showRegistrationAxes: event.target.checked }))}
            />
            Show registration axes
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
            <dt>body registration</dt><dd>{telemetry?.bodyRegistrationStatus ?? "body-placement-required"}</dd>
            <dt>Body collision mode</dt><dd>{telemetry?.bodyCollisionMode ?? "disabled"}</dd>
            <dt>Body mesh V / T / BVH</dt><dd>{telemetry?.bodyMeshVertices ?? 0} / {telemetry?.bodyMeshTriangles ?? 0} / {telemetry?.bodyBvhNodes ?? 0}</dd>
            <dt>Visual/collision delta mm</dt><dd>{formatMetric(telemetry?.bodyVisualCollisionMaxDeltaMm)}</dd>
            <dt>Body surface triangles</dt><dd>{telemetry?.bodyColliderCount ?? 0}</dd>
            <dt>Body contacts</dt><dd>{telemetry?.bodyContactCount ?? 0}</dd>
            <dt>Floor contacts</dt><dd>{telemetry?.floorContactCount ?? 0}</dd>
            <dt>Floor CCD contacts</dt><dd>{telemetry?.floorCcdContactCount ?? 0}</dd>
            <dt>Floor friction contacts</dt><dd>{telemetry?.floorFrictionContactCount ?? 0}</dd>
            <dt>Max floor penetration mm</dt><dd>{formatMetric((telemetry?.maximumFloorPenetrationM ?? 0) * 1000)}</dd>
            <dt>Mean floor penetration mm</dt><dd>{formatMetric((telemetry?.meanFloorPenetrationM ?? 0) * 1000)}</dd>
            <dt>Floor collision ms</dt><dd>{formatMetric(telemetry?.floorCollisionMs)}</dd>
            <dt>Max penetration mm</dt><dd>{formatMetric((telemetry?.maximumBodyPenetrationM ?? 0) * 1000)}</dd>
            <dt>Max body correction mm</dt><dd>{formatMetric((telemetry?.maximumBodyCorrectionM ?? 0) * 1000)}</dd>
            <dt>Body collision ms</dt><dd>{formatMetric(telemetry?.bodyCollisionMs)}</dd>
            <dt>Body broadphase ms</dt><dd>{formatMetric(telemetry?.bodyBroadphaseMs)}</dd>
            <dt>Body narrowphase ms</dt><dd>{formatMetric(telemetry?.bodyNarrowphaseMs)}</dd>
            <dt>Body projection ms</dt><dd>{formatMetric(telemetry?.bodyProjectionMs)}</dd>
            <dt>Body friction ms</dt><dd>{formatMetric(telemetry?.bodyFrictionMs)}</dd>
            <dt>Body broadphase reject %</dt><dd>{formatMetric((telemetry?.bodyBroadphaseRejectRate ?? 0) * 100)}</dd>
            <dt>Body candidates/query</dt><dd>{formatMetric(telemetry?.bodyAverageCandidatesPerParticle)}</dd>
            <dt>Body tests (all / narrow)</dt><dd>{telemetry?.bodyColliderTests ?? 0} / {telemetry?.bodyCandidateColliderTests ?? 0}</dd>
            <dt>Body narrow (capsule / ellipsoid)</dt><dd>{telemetry?.bodyCapsuleNarrowphaseTests ?? 0} / {telemetry?.bodyEllipsoidNarrowphaseTests ?? 0}</dd>
            <dt>Body swept (tests / hits)</dt><dd>{telemetry?.bodySweptTests ?? 0} / {telemetry?.bodySweptContactsFound ?? 0}</dd>
            <dt>Exact body surface</dt><dd>{telemetry?.bodyExactSurface ? "yes" : "no"}</dd>
            <dt>Body BVH build ms</dt><dd>{formatMetric(telemetry?.bodyBvhBuildMs)}</dd>
            <dt>Body BVH node visits</dt><dd>{telemetry?.bodyBvhNodeVisits ?? 0}</dd>
            <dt>Body BVH query ms</dt><dd>{formatMetric(telemetry?.bodyBvhQueryMs)}</dd>
            <dt>Body contact solve ms</dt><dd>{formatMetric(telemetry?.bodyContactSolveMs)}</dd>
            <dt>Body intersection audit ms</dt><dd>{formatMetric(telemetry?.bodyIntersectionAuditMs)}</dd>
            <dt>Body candidates/query</dt><dd>{formatMetric(telemetry?.bodyCandidatesPerQuery)}</dd>
            <dt>Body triangle tests</dt><dd>{telemetry?.bodyTriangleTests ?? 0}</dd>
            <dt>Body inside / CCD tests</dt><dd>{telemetry?.bodyInsideTests ?? 0} / {telemetry?.bodyCcdTests ?? 0}</dd>
            <dt>Body CCD ms</dt><dd>{formatMetric(telemetry?.bodyCcdMs)}</dd>
            <dt>Body contacts V / E / T</dt><dd>{telemetry?.bodyVertexContacts ?? 0} / {telemetry?.bodyEdgeContacts ?? 0} / {telemetry?.bodyTriangleContacts ?? 0}</dd>
            <dt>Residual intersections / crossings</dt><dd>{telemetry?.bodyResidualIntersections ?? 0} / {telemetry?.bodyResidualCrossings ?? 0}</dd>
            <dt>Triangle intersections / complete crossings</dt><dd>{telemetry?.bodyTriangleIntersectionCount ?? 0} / {telemetry?.bodyCompleteCrossings ?? 0}</dd>
            <dt>Max signed penetration mm</dt><dd>{formatMetric((telemetry?.maximumSignedBodyPenetrationM ?? 0) * 1000)}</dd>
            <dt>Signed penetration max / mean mm</dt><dd>{formatMetric(telemetry?.bodySignedPenetrationMaxMm)} / {formatMetric(telemetry?.bodySignedPenetrationMeanMm)}</dd>
            <dt>Clearance error max / mean mm</dt><dd>{formatMetric(telemetry?.bodyClearanceErrorMaxMm)} / {formatMetric(telemetry?.bodyClearanceErrorMeanMm)}</dd>
            <dt>Invalid cloth primitives skipped</dt><dd>{telemetry?.bodyInvalidClothPrimitiveSkips ?? 0}</dd>
            <dt>Local overlap skips</dt><dd>{telemetry?.bodyLocalInitialOverlapSkipCount ?? 0}</dd>
            <dt>Global collision early returns</dt><dd>{telemetry?.bodyGlobalCollisionEarlyReturnCount ?? 0}</dd>
            <dt>Contact skip reasons</dt><dd>{JSON.stringify(telemetry?.bodyContactSkipReasons ?? {})}</dd>
            <dt>Structural contact deferred</dt><dd>{telemetry?.bodyStructuralContactDeferred ? "yes" : "no"}</dd>
            <dt>Assembly contact blocked</dt><dd>{telemetry?.bodyAssemblyContactBlocked ? "yes" : "no"}</dd>
            <dt>Deep initial overlaps</dt><dd>{telemetry?.bodyDeepOverlapCount ?? 0}</dd>
            <dt>Initial intersections</dt><dd>{telemetry?.bodyInitialIntersectionCount ?? 0}</dd>
            <dt>Dressing steps</dt><dd>{telemetry?.bodyDressingStepsRemaining ?? 0} / {telemetry?.bodyInitialDressingSteps ?? 0}</dd>
            <dt>Initial overlap recovery</dt><dd>{telemetry?.initialOverlapRecoveryStatus ?? "not-needed"} ({telemetry?.initialOverlapRecoverySteps ?? 0})</dd>
            <dt>Friction contacts</dt><dd>{telemetry?.frictionContactCount ?? 0}</dd>
            <dt>Swept contacts</dt><dd>{telemetry?.sweptContactCount ?? 0}</dd>
            <dt>seamMeanErrorMm</dt><dd>{formatMetric((telemetry?.seamErrorAverage ?? 0) * 1000)}</dd>
            <dt>seamMaxErrorMm</dt><dd>{formatMetric((telemetry?.seamErrorMaximum ?? 0) * 1000)}</dd>
            <dt>stretch mean / max</dt><dd>{formatMetric(telemetry?.structuralStretchMeanRatio)} / {formatMetric(telemetry?.structuralStretchMaxRatio)}</dd>
            <dt>compression min</dt><dd>{formatMetric(telemetry?.structuralCompressionMinRatio)}</dd>
            <dt>shear mean / max</dt><dd>{formatMetric(telemetry?.shearStrainMean)} / {formatMetric(telemetry?.shearStrainMax)}</dd>
            <dt>area mean / min / max</dt><dd>{formatMetric(telemetry?.triangleAreaMeanRatio)} / {formatMetric(telemetry?.triangleAreaMinRatio)} / {formatMetric(telemetry?.triangleAreaMaxRatio)}</dd>
            <dt>flipped triangles</dt><dd>{telemetry?.flippedTriangleCount ?? 0}</dd>
            <dt>AABB growth</dt><dd>{formatMetric(telemetry?.garmentAabbGrowthRatio)}</dd>
            <dt>velocity max</dt><dd>{formatMetric(telemetry?.maximumVelocityMagnitude)}</dd>
            <dt>pins explicit / temporary</dt><dd>{telemetry?.explicitPinCount ?? 0} / {telemetry?.temporarySupportCount ?? 0}</dd>
            <dt>invalid reason</dt><dd>{telemetry?.invalidReason ?? "-"}</dd>
          </dl>
          {telemetry ? (
            <details className="viewport-physics-seam-groups">
              <summary>SeamGroups por residual</summary>
              {[...Object.entries(telemetry.seamErrorsByGroup)]
                .sort((left, right) => right[1].maxError - left[1].maxError)
                .slice(0, 8)
                .map(([groupId, group]) => (
                  <div key={groupId}>
                    <code>{groupId}</code>
                    <span> mean {formatMetric(group.meanError * 1000)} mm · max {formatMetric(group.maxError * 1000)} mm</span>
                  </div>
                ))}
            </details>
          ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
});

function arrangementCommitsMatchInput(
  input: ResolvedAssemblyInput,
  commits: readonly ArrangementCommit[],
): boolean {
  const instances = new Map(input.panelInstances.map((instance) => [instance.id, instance] as const));
  return commits.every((commit) => {
    const anchor = instances.get(commit.instanceId)?.arrangementAnchor;
    return tupleClose(anchor?.positionMm, commit.positionMm)
      && tupleClose(anchor?.orientationDeg, commit.orientationDeg);
  });
}

function tupleClose(
  left: readonly number[] | undefined,
  right: readonly number[],
  epsilon = 1e-4,
): boolean {
  return Boolean(left
    && left.length === right.length
    && left.every((value, index) => Math.abs(value - right[index]) <= epsilon));
}

function formatMetric(value: number | undefined): string {
  return Number.isFinite(value) ? (value ?? 0).toFixed(2) : "0.00";
}
