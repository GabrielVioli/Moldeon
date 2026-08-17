import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import {
  approvedAvatarForBody,
  AVATAR_NOT_CONFIGURED_MESSAGE,
} from "../avatar/ApprovedAvatarAsset";
import { loadApprovedAvatar } from "../avatar/ApprovedAvatarLoader";
import type { BodyType } from "../domain/pattern";
import { buildSemanticAvatarArrangement } from "../garment3d/SemanticAvatarArrangement";
import {
  buildGarmentAssemblyMeshes,
  canReuseGarmentAssemblyMesh,
  captureGarmentMeshDiagnostics,
  copyGarmentAssemblyGeometry,
  type GarmentAssemblyMeshData,
} from "../garment3d/GarmentThreeBridge";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";
import { measureIntrinsicDistortion, type GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import { refreshMeshFromAssembly } from "../garment3d/GarmentThreeBridge";
import { buildXpbdInitialization } from "../physics/GarmentXpbdAdapter";
import { XpbdWorkerClient } from "../physics/XpbdWorkerClient";
import type {
  XpbdAutoPauseSteps,
  XpbdSimulationCadence,
  XpbdWorkerDiagnostics,
} from "../physics/xpbdProtocol";

export type RenderBackend = "webgpu" | "webgl2";
export type SimulationLifecycleState = "paused" | "running";
export interface SimulationDevSettings {
  gravityScale: 0 | 0.25 | 1;
  cadence: XpbdSimulationCadence;
  autoPauseSteps: XpbdAutoPauseSteps;
}
export interface SimulationDevTelemetry extends XpbdWorkerDiagnostics {
  approximateFps: number;
}
type ViewportRenderer = THREE.WebGLRenderer | WebGPURenderer;

interface PerformanceProfile {
  antialias: boolean;
  maxPixelRatio: number;
  shadows: boolean;
}

export class ThreeViewport {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly garmentGroup = new THREE.Group();
  private readonly avatarGroup = new THREE.Group();
  private readonly resizeObserver: ResizeObserver;
  private readonly profile: PerformanceProfile;
  private readonly renderer: ViewportRenderer;
  private garmentMeshes: GarmentAssemblyMeshData[] = [];
  private readonly simulation: XpbdWorkerClient;
  private assemblyState: GarmentAssemblyState | null = null;
  private assemblyRevision: string | null = null;
  private assemblyGeneration = 0;
  private simulationEpoch = 0;
  private avatarSignature: string | null = null;
  private avatarLoadController: AbortController | null = null;
  private hasFramedScene = false;
  private frameId: number | null = null;
  private lastFrameAt = 0;
  private disposed = false;
  private simulationRunning = false;
  private resumeAfterVisibility = false;
  private framesReceived = 0;
  private framesApplied = 0;
  private framesDiscarded = 0;
  private baseGravity: [number, number, number] = [0, -9.81, 0];
  private devSettings: SimulationDevSettings = { gravityScale: 1, cadence: 1, autoPauseSteps: 0 };
  private wireframeEnabled = false;
  private approximateFps = 0;
  private lastAppliedFrameAt = 0;

  private constructor(
    private readonly host: HTMLElement,
    renderer: ViewportRenderer,
    readonly backend: RenderBackend,
    profile: PerformanceProfile,
    private readonly onSimulationStateChange?: (state: SimulationLifecycleState) => void,
    private readonly onSimulationDiagnosticsChange?: (diagnostics: SimulationDevTelemetry) => void,
  ) {
    this.renderer = renderer;
    this.profile = profile;
    this.host.dataset.simulationWorker = "created";
    this.simulation = new XpbdWorkerClient({
      onFrame: (frame) => {
        this.framesReceived += 1;
        this.writeFrameCounters();
        this.host.dataset.simulationWorkerFrame = JSON.stringify({
          revision: frame.revision,
          generation: frame.generation,
          epoch: frame.epoch,
          sequence: frame.sequence,
          positionsLength: frame.positions.length,
          stepCount: frame.diagnostics.stepCount,
        });
        this.requestRender();
      },
      onReady: (revision, generation, epoch, diagnostics) => {
        this.host.dataset.simulationWorkerReady = JSON.stringify({ revision, generation, epoch });
        if (revision !== this.assemblyRevision || generation !== this.assemblyGeneration || epoch !== this.simulationEpoch) return;
        this.writeSimulationDiagnostics(diagnostics);
      },
      onState: (generation, running, disposed, snapshot) => {
        this.simulationRunning = running && !disposed;
        this.simulationEpoch = snapshot.epoch;
        this.host.dataset.simulationWorkerState = disposed
          ? "disposed"
          : `${running ? "running" : "paused"}:${generation}:${snapshot.epoch}`;
        this.host.dataset.simulationStatus = disposed ? "disposed" : running ? "running" : "paused";
        if (!disposed) this.onSimulationStateChange?.(running ? "running" : "paused");
        this.traceLifecycle("worker-state", snapshot);
        if (running) this.requestRender();
      },
      onDiscardedFrame: (revision, generation, epoch, reason) => {
        this.framesDiscarded += 1;
        this.writeFrameCounters();
        this.host.dataset.simulationDiscardedFrame = JSON.stringify({ revision, generation, epoch, reason });
        this.traceLifecycle("frame-discarded", { revision, generation, epoch, reason });
      },
      onError: (message, recoverable) => {
        console.error("Worker XPBD:", message);
        this.host.dataset.simulationStatus = recoverable ? "recoverable-error" : "error";
      },
    });
    this.scene.background = new THREE.Color(0xe9e6df);
    this.camera.position.set(2.1, 1.25, 3.2);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio));
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.domElement.className = "three-canvas";
    this.host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.45;
    this.controls.maxDistance = 12;
    this.controls.addEventListener("change", this.requestRender);

    this.avatarGroup.name = "avatar-root";
    this.garmentGroup.name = "garment-root";
    this.scene.add(createLights());
    this.scene.add(this.avatarGroup);
    this.scene.add(this.garmentGroup);
    this.scene.add(createFloor(profile.shadows));

    this.resizeObserver = new ResizeObserver(() => {
      this.refresh();
    });
    this.resizeObserver.observe(this.host);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  static async create(
    host: HTMLElement,
    signal?: AbortSignal,
    onSimulationStateChange?: (state: SimulationLifecycleState) => void,
    onSimulationDiagnosticsChange?: (diagnostics: SimulationDevTelemetry) => void,
  ): Promise<ThreeViewport> {
    if (signal?.aborted) throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
    const profile = getPerformanceProfile();
    const rendererResult = await createRenderer(profile, signal);
    const viewport = new ThreeViewport(
      host,
      rendererResult.renderer,
      rendererResult.backend,
      profile,
      onSimulationStateChange,
      onSimulationDiagnosticsChange,
    );
    const abort = () => viewport.dispose();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted || viewport.disposed) throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
      viewport.refresh();
      return viewport;
    } catch (error) {
      viewport.dispose();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  updateGarment(input: ResolvedAssemblyInput): string[] {
    const garment = input.garmentProjection;
    const avatar = buildAvatarParametricModel(input.document.measurements.values, input.document.body.type);
    const arrangement = buildSemanticAvatarArrangement(input, avatar);
    const avatarConfiguration = this.configureApprovedAvatar(input.document.body.type);

    const nextMeshes = buildGarmentAssemblyMeshes(arrangement.state, arrangement.garment, {
      castShadow: this.profile.shadows,
      receiveShadow: this.profile.shadows,
      visibleInstanceIds: arrangement.visibleInstanceIds,
    });
    this.reconcileGarmentMeshes(nextMeshes);
    this.applyWireframe();
    this.assemblyState = arrangement.state;
    this.assemblyRevision = input.signature;
    this.host.dataset.simulationGeometryRevision = input.signature;
    const settings = input.document.simulationSettings;
    this.baseGravity = settings.gravityMmS2.map((value) => value * 0.001) as [number, number, number];
    const resumeAfterRebuild = this.simulationRunning;
    const initialization = buildXpbdInitialization(
      arrangement.state,
      arrangement.garment,
      input.signature,
      {
        config: {
          gravity: this.scaledGravity(),
          maximumSubsteps: settings.substeps,
          iterations: settings.iterations,
        },
      },
    );
    this.host.dataset.simulationTopologyDiagnostics = JSON.stringify(initialization.topologyDiagnostics);
    if (import.meta.env.DEV) {
      this.host.dataset.initialSeamResidualAudit = JSON.stringify({
        assembly: arrangement.initialSeamResidualAudit,
        adapter: initialization.seamResidualAudit,
      });
    }
    this.host.dataset.spatialAssemblyDiagnostics = JSON.stringify({
      revision: input.signature,
      intrinsicDistortion: measureIntrinsicDistortion(arrangement.state),
      initialPositionSignature: positionSignature(arrangement.state.positions),
      instances: arrangement.state.instances.map((instance) => ({
        id: instance.id,
        pieceId: instance.pieceId,
        mapping: instance.arrangement?.mapping ?? null,
        tubeCenter: instance.arrangement?.tubeCenter ?? null,
        tubeRadiusM: instance.arrangement?.tubeRadiusM ?? null,
        axis: instance.arrangement?.axis ?? null,
        vertexCount: instance.vertexCount,
      })),
      seamGraph: summarizeAssemblySeamGraph(arrangement.state),
      seamPlacementDiagnostics: arrangement.seamPlacementDiagnostics,
    });
    const identity = this.simulation.updateGeometry(initialization);
    this.assemblyGeneration = identity.generation;
    this.simulationEpoch = identity.epoch;
    this.applyWorkerDevSettings();
    this.host.dataset.simulationGeneration = String(this.assemblyGeneration);
    this.host.dataset.simulationEpoch = String(this.simulationEpoch);
    if (resumeAfterRebuild) {
      this.simulationEpoch = this.simulation.resume();
      this.host.dataset.simulationEpoch = String(this.simulationEpoch);
    }
    this.host.dataset.simulationStatus = resumeAfterRebuild ? "running" : "ready";

    if (!this.hasFramedScene || avatarConfiguration.changed) {
      this.frameDressedScene();
      this.hasFramedScene = true;
    }
    this.host.dataset.avatarAnchorCount = String(avatar.anchors.length);
    this.host.dataset.collisionProxyCount = String(arrangement.collision.proxies.length);
    this.host.dataset.garmentInstanceCount = String(this.garmentMeshes.length);
    this.host.dataset.garmentInstanceIds = this.garmentMeshes.map((item) => item.key).join(",");
    this.host.dataset.garmentGeometrySignatures = this.garmentMeshes
      .map((item) => `${item.key}:${item.geometrySignature}`)
      .join(",");
    if (import.meta.env.DEV) {
      this.host.dataset.garmentMeshDiagnostics = JSON.stringify(
        captureGarmentMeshDiagnostics(this.garmentMeshes),
      );
    }
    this.host.dataset.coveredAvatarPartCount = String(arrangement.coveredAvatarPartNames.size);
    this.host.dataset.arrangementDiagnosticCount = String(arrangement.diagnostics.length);
    this.host.dataset.arrangementErrorCount = String(arrangement.diagnostics.filter((item) => item.severity === "error").length);
    this.host.dataset.frameTarget = "avatar-and-garment";
    this.requestRender();

    return [...new Set([
      ...arrangement.state.warnings,
      ...arrangement.diagnostics.map((diagnostic) => diagnostic.message),
      ...(avatarConfiguration.warning ? [avatarConfiguration.warning] : []),
    ])];
  }

  dress(): void {
    this.resumeSimulation();
  }

  pauseSimulation(): void {
    this.traceLifecycle("ui-command", { command: "pause", uiState: this.host.dataset.simulationUiState ?? "unknown" });
    this.simulationEpoch = this.simulation.pause();
    this.host.dataset.simulationEpoch = String(this.simulationEpoch);
  }

  resumeSimulation(): void {
    this.traceLifecycle("ui-command", { command: "resume", uiState: this.host.dataset.simulationUiState ?? "unknown" });
    this.host.dataset.simulationResumeRequested = this.assemblyRevision ?? "without-geometry";
    this.simulationEpoch = this.simulation.resume();
    this.host.dataset.simulationEpoch = String(this.simulationEpoch);
    this.requestRender();
  }

  stepSimulation(): void {
    this.traceLifecycle("ui-command", { command: "step", uiState: this.host.dataset.simulationUiState ?? "unknown" });
    this.simulationEpoch = this.simulation.step();
    this.host.dataset.simulationEpoch = String(this.simulationEpoch);
    this.requestRender();
  }

  resetSimulation(): void {
    this.traceLifecycle("ui-command", { command: "reset", uiState: this.host.dataset.simulationUiState ?? "unknown" });
    this.approximateFps = 0;
    this.lastAppliedFrameAt = 0;
    this.simulationEpoch = this.simulation.reset();
    this.host.dataset.simulationEpoch = String(this.simulationEpoch);
    this.requestRender();
  }

  setSimulationDevSettings(settings: SimulationDevSettings): void {
    this.devSettings = settings;
    this.host.dataset.simulationDevSettings = JSON.stringify(settings);
    this.applyWorkerDevSettings();
  }

  setWireframe(enabled: boolean): void {
    this.wireframeEnabled = enabled;
    this.applyWireframe();
    this.requestRender();
  }

  frameGarment(): void {
    this.frameDressedScene();
    this.requestRender();
  }

  refresh(): void {
    if (this.disposed) return;
    this.resize();
    this.frameDressedScene();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    if (this.frameId !== null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.controls.removeEventListener("change", this.requestRender);
    this.controls.dispose();
    this.avatarLoadController?.abort();
    this.avatarLoadController = null;
    this.simulation.dispose();
    this.assemblyState = null;
    this.assemblyRevision = null;
    this.assemblyGeneration = 0;
    this.simulationEpoch = 0;
    this.clearGarment();
    this.clearAvatar();
    disposeObject(this.scene);
    this.scene.clear();
    if (this.renderer instanceof THREE.WebGLRenderer) {
      this.renderer.renderLists.dispose();
      this.renderer.forceContextLoss();
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete this.host.dataset.avatarVisible;
    delete this.host.dataset.avatarStatus;
    delete this.host.dataset.avatarAssetId;
    delete this.host.dataset.avatarInspection;
    delete this.host.dataset.garmentInstanceCount;
    delete this.host.dataset.garmentMeshDiagnostics;
    delete this.host.dataset.simulationStatus;
    delete this.host.dataset.simulationDiagnostics;
    delete this.host.dataset.simulationDevSettings;
    delete this.host.dataset.initialSeamResidualAudit;
  }

  private frameDressedScene(): void {
    this.avatarGroup.updateMatrixWorld(true);
    this.garmentGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.avatarGroup);
    box.expandByObject(this.garmentGroup);
    if (box.isEmpty()) return;
    const hasVisualAvatar = this.avatarGroup.children.length > 0;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const verticalRadius = Math.max(size.y * 0.57, hasVisualAvatar ? 0.75 : 0.12);
    const horizontalRadius = Math.max(size.x, size.z) * 0.72;
    const radius = Math.max(verticalRadius, horizontalRadius, hasVisualAvatar ? 0.55 : 0.16);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const aspectAllowance = this.camera.aspect < 0.8 ? 1.2 : 1;
    const distance = Math.max(hasVisualAvatar ? 1.25 : 0.5, radius / Math.tan(halfFov) * aspectAllowance);
    const direction = new THREE.Vector3(1.15, 0.3, 1.7).normalize();
    this.controls.target.copy(center).add(new THREE.Vector3(0, size.y * 0.02, 0));
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.camera.near = Math.max(0.01, distance / 120);
    this.camera.far = Math.max(20, distance * 20);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private clearGarment(): void {
    for (const item of this.garmentMeshes) {
      this.garmentGroup.remove(item.mesh);
      disposeMesh(item.mesh);
    }
    this.garmentMeshes = [];
  }

  private reconcileGarmentMeshes(nextMeshes: GarmentAssemblyMeshData[]): void {
    const previousByKey = new Map(this.garmentMeshes.map((item) => [item.key, item]));
    const reconciled: GarmentAssemblyMeshData[] = [];

    for (const next of nextMeshes) {
      const previous = previousByKey.get(next.key);
      previousByKey.delete(next.key);
      const canReuse = previous !== undefined && canReuseGarmentAssemblyMesh(previous, next);

      if (!canReuse || !previous) {
        if (previous) {
          this.garmentGroup.remove(previous.mesh);
          disposeMesh(previous.mesh);
        }
        this.garmentGroup.add(next.mesh);
        reconciled.push(next);
        continue;
      }

      copyGarmentAssemblyGeometry(previous.mesh.geometry, next.mesh.geometry);
      disposeMaterial(previous.mesh.material);
      previous.mesh.material = next.mesh.material;
      next.mesh.geometry.dispose();
      reconciled.push({
        ...next,
        mesh: previous.mesh,
      });
    }

    for (const stale of previousByKey.values()) {
      this.garmentGroup.remove(stale.mesh);
      disposeMesh(stale.mesh);
    }
    this.garmentMeshes = reconciled;
  }

  private clearAvatar(): void {
    disposeObject(this.avatarGroup);
    this.avatarGroup.clear();
  }

  private configureApprovedAvatar(
    bodyType: BodyType,
  ): { changed: boolean; warning?: string } {
    const descriptor = approvedAvatarForBody(bodyType);
    if (!descriptor) {
      const signature = `missing:${bodyType}`;
      const changed = signature !== this.avatarSignature;
      if (changed) {
        this.avatarLoadController?.abort();
        this.avatarLoadController = null;
        this.clearAvatar();
        this.avatarSignature = signature;
      }
      this.host.dataset.avatarVisible = "false";
      this.host.dataset.avatarStatus = "not-configured";
      return { changed, warning: AVATAR_NOT_CONFIGURED_MESSAGE };
    }

    const signature = `${descriptor.assetId}@${descriptor.version}`;
    if (signature === this.avatarSignature) return { changed: false };
    this.avatarLoadController?.abort();
    const controller = new AbortController();
    this.avatarLoadController = controller;
    this.clearAvatar();
    this.avatarSignature = signature;
    this.host.dataset.avatarVisible = "false";
    this.host.dataset.avatarStatus = "loading";

    void loadApprovedAvatar(descriptor, controller.signal)
      .then((loaded) => {
        if (this.disposed || controller.signal.aborted || this.avatarSignature !== signature) {
          disposeObject(loaded.root);
          loaded.root.clear();
          return;
        }
        this.avatarGroup.add(loaded.root);
        this.host.dataset.avatarVisible = "true";
        this.host.dataset.avatarStatus = "ready";
        this.host.dataset.avatarAssetId = descriptor.assetId;
        this.host.dataset.avatarInspection = JSON.stringify(loaded.inspection);
        this.frameDressedScene();
        this.requestRender();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || this.disposed) return;
        console.error("Falha ao carregar o manequim aprovado.", error);
        this.host.dataset.avatarVisible = "false";
        this.host.dataset.avatarStatus = "error";
      });

    return { changed: true, warning: "Carregando manequim humano aprovado…" };
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private readonly requestRender = (): void => {
    if (this.disposed || this.frameId !== null) return;
    this.frameId = window.requestAnimationFrame(this.render);
  };

  private readonly render = (time: number): void => {
    this.frameId = null;
    if (this.disposed) return;
    const deltaSeconds = this.lastFrameAt === 0 ? 1 / 60 : Math.min((time - this.lastFrameAt) / 1000, 0.05);
    this.lastFrameAt = time;
    const frame = this.simulation.consumeLatestFrame();
    if (frame) {
      if (frame.revision === this.assemblyRevision
        && frame.generation === this.assemblyGeneration
        && frame.epoch === this.simulationEpoch
        && this.assemblyState
        && frame.positions.length === this.assemblyState.positions.length
        && frameCanUpdateMeshes(frame.positions, this.assemblyState, this.garmentMeshes)) {
        this.assemblyState.positions.set(frame.positions);
        for (const mesh of this.garmentMeshes) refreshMeshFromAssembly(mesh, this.assemblyState);
        const appliedAt = performance.now();
        if (this.lastAppliedFrameAt > 0) {
          const instantaneousFps = 1000 / Math.max(1, appliedAt - this.lastAppliedFrameAt);
          this.approximateFps = this.approximateFps === 0
            ? instantaneousFps
            : this.approximateFps * 0.8 + instantaneousFps * 0.2;
        }
        this.lastAppliedFrameAt = appliedAt;
        this.framesApplied += 1;
        this.writeFrameCounters();
        this.writeSimulationDiagnostics(frame.diagnostics);
        this.host.dataset.simulationPositionSignature = positionSignature(frame.positions);
        // Um frame aceito prova que o Worker concluiu a inicialização dessa
        // identidade. Regrava o marcador porque uma renderização React muito
        // rápida pode reconciliar o host depois do callback onReady.
        this.host.dataset.simulationWorkerReady = JSON.stringify({
          revision: frame.revision,
          generation: frame.generation,
          epoch: frame.epoch,
        });
        this.host.dataset.simulationAppliedFrame = JSON.stringify({
          revision: frame.revision,
          generation: frame.generation,
          epoch: frame.epoch,
          sequence: frame.sequence,
          positionsLength: frame.positions.length,
        });
      } else {
        this.host.dataset.simulationRejectedFrame = JSON.stringify({
          revision: frame.revision,
          generation: frame.generation,
          expectedRevision: this.assemblyRevision,
          expectedGeneration: this.assemblyGeneration,
          epoch: frame.epoch,
          expectedEpoch: this.simulationEpoch,
          positionsLength: frame.positions.length,
          expectedPositionsLength: this.assemblyState?.positions.length ?? 0,
        });
      }
      this.simulation.recycleFrame(frame);
    }
    this.controls.update(deltaSeconds);
    this.renderer.render(this.scene, this.camera);
    if (this.simulationRunning) this.requestRender();
  };

  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.resumeAfterVisibility = this.simulationRunning;
      if (this.simulationRunning) this.pauseSimulation();
      return;
    }
    if (this.resumeAfterVisibility) this.resumeSimulation();
    this.resumeAfterVisibility = false;
  };

  private writeSimulationDiagnostics(diagnostics: XpbdWorkerDiagnostics): void {
    this.host.dataset.simulationDiagnostics = JSON.stringify(diagnostics);
    this.onSimulationDiagnosticsChange?.({ ...diagnostics, approximateFps: this.approximateFps });
  }

  private scaledGravity(): [number, number, number] {
    return this.baseGravity.map((value) => value * this.devSettings.gravityScale) as [number, number, number];
  }

  private applyWorkerDevSettings(): void {
    this.simulation.configureDev({
      gravity: this.scaledGravity(),
      cadence: this.devSettings.cadence,
      autoPauseSteps: this.devSettings.autoPauseSteps,
    });
  }

  private applyWireframe(): void {
    for (const item of this.garmentMeshes) {
      const materials = Array.isArray(item.mesh.material) ? item.mesh.material : [item.mesh.material];
      for (const material of materials) {
        if ("wireframe" in material) {
          (material as THREE.MeshStandardMaterial).wireframe = this.wireframeEnabled;
          material.needsUpdate = true;
        }
      }
    }
    this.host.dataset.simulationWireframe = String(this.wireframeEnabled);
  }

  private writeFrameCounters(): void {
    this.host.dataset.simulationFrameCounters = JSON.stringify({
      received: this.framesReceived,
      applied: this.framesApplied,
      discarded: this.framesDiscarded,
    });
  }

  private traceLifecycle(event: string, detail: object): void {
    if (!import.meta.env.DEV) return;
    const trace = JSON.parse(this.host.dataset.simulationLifecycleTrace ?? "[]") as object[];
    trace.push({
      timestampMs: performance.now(),
      event,
      revision: this.assemblyRevision,
      generation: this.assemblyGeneration,
      simulationRunning: this.simulationRunning,
      framesReceived: this.framesReceived,
      framesApplied: this.framesApplied,
      framesDiscarded: this.framesDiscarded,
      ...detail,
    });
    if (trace.length > 200) trace.splice(0, trace.length - 200);
    this.host.dataset.simulationLifecycleTrace = JSON.stringify(trace);
  }
}

function summarizeAssemblySeamGraph(state: GarmentAssemblyState): {
  nodes: string[];
  edges: Array<{
    seamGroupId: string;
    firstInstanceId: string;
    secondInstanceId: string;
    sampleCount: number;
  }>;
} {
  const byKey = new Map<string, {
    seamGroupId: string;
    firstInstanceId: string;
    secondInstanceId: string;
    sampleCount: number;
  }>();
  for (const constraint of state.stitchConstraints) {
    if (!constraint.instanceA || !constraint.instanceB) continue;
    const instances = [constraint.instanceA, constraint.instanceB].sort();
    const key = `${constraint.seamGroupId}\u0000${instances[0]}\u0000${instances[1]}`;
    const current = byKey.get(key);
    if (current) current.sampleCount += 1;
    else byKey.set(key, {
      seamGroupId: constraint.seamGroupId,
      firstInstanceId: instances[0],
      secondInstanceId: instances[1],
      sampleCount: 1,
    });
  }
  return {
    nodes: state.instances.map((instance) => instance.id).sort(),
    edges: [...byKey.values()].sort((left, right) =>
      left.seamGroupId.localeCompare(right.seamGroupId)
      || left.firstInstanceId.localeCompare(right.firstInstanceId)
      || left.secondInstanceId.localeCompare(right.secondInstanceId)),
  };
}

function positionSignature(positions: Float32Array): string {
  const bytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
  let hash = 0x811c9dc5;
  for (const value of bytes) {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${positions.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function frameCanUpdateMeshes(
  positions: Float32Array,
  state: GarmentAssemblyState,
  meshes: readonly GarmentAssemblyMeshData[],
): boolean {
  for (const value of positions) if (!Number.isFinite(value)) return false;
  const instanceById = new Map(state.instances.map((instance) => [instance.id, instance]));
  for (const mesh of meshes) {
    const instance = instanceById.get(mesh.key);
    const positionAttribute = mesh.mesh.geometry.getAttribute("position");
    if (!instance
      || instance.particleStart < 0
      || instance.particleStart + instance.vertexCount > positions.length / 3
      || positionAttribute.count !== instance.vertexCount) return false;
    const index = mesh.mesh.geometry.index;
    if (index) {
      for (let offset = 0; offset < index.count; offset += 1) {
        if (index.getX(offset) >= instance.vertexCount) return false;
      }
    }
  }
  return true;
}

async function createRenderer(
  profile: PerformanceProfile,
  signal?: AbortSignal,
): Promise<{ renderer: ViewportRenderer; backend: RenderBackend }> {
  if ("gpu" in navigator) {
    let renderer: WebGPURenderer | null = null;
    try {
      const { WebGPURenderer } = await import("three/webgpu");
      if (signal?.aborted) throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
      renderer = new WebGPURenderer({ antialias: profile.antialias, alpha: false });
      await renderer.init();
      return { renderer, backend: "webgpu" };
    } catch (error) {
      renderer?.dispose();
      if (signal?.aborted) throw error;
      console.info("WebGPU indisponível; usando WebGL 2.", error);
    }
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: profile.antialias,
    powerPreference: "high-performance",
  });
  if (!context) throw new Error("Este navegador não disponibiliza WebGPU nem WebGL 2.");
  return {
    renderer: new THREE.WebGLRenderer({ canvas, context, alpha: false, antialias: profile.antialias, powerPreference: "high-performance" }),
    backend: "webgl2",
  };
}

function getPerformanceProfile(): PerformanceProfile {
  const compact = window.matchMedia("(max-width: 760px)").matches;
  const lowPower = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4;
  if (compact || lowPower) {
    return { antialias: false, maxPixelRatio: 1.25, shadows: false };
  }
  return { antialias: true, maxPixelRatio: 1.75, shadows: true };
}

function createLights(): THREE.Group {
  const group = new THREE.Group();
  const ambient = new THREE.HemisphereLight(0xffffff, 0x4a4a50, 2.1);
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  // Evita que a própria superfície fina do tecido se sombreie em blocos
  // seguindo os triângulos. O deslocamento é pequeno na escala em metros e
  // preserva a sombra projetada no chão e no avatar.
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.002;
  const fill = new THREE.DirectionalLight(0xc8d2ff, 1.2);
  fill.position.set(-3, 2, 2);
  group.add(ambient, key, fill);
  return group;
}

function createFloor(shadows: boolean): THREE.Mesh {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.8, 48),
    new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = shadows;
  return floor;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    disposeMesh(object);
  });
}

function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  disposeMaterial(mesh.material);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  const entries = Array.isArray(material) ? material : [material];
  const textures = new Set<THREE.Texture>();
  for (const entry of entries) {
    for (const value of Object.values(entry)) {
      if (value instanceof THREE.Texture && !textures.has(value)) {
        textures.add(value);
        value.dispose();
      }
    }
    entry.dispose();
  }
}
