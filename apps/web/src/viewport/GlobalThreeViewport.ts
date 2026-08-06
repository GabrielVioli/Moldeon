import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GarmentDraft, PatternSnapshot } from "../domain/pattern";
import { buildAvatarParametricModel } from "../avatar/AvatarParametricModel";
import { buildSemanticAvatarArrangement } from "../garment3d/SemanticAvatarArrangement";
import {
  buildGarmentAssemblyMeshes,
  refreshMeshFromAssembly,
  type GarmentAssemblyMeshData,
} from "../garment3d/GarmentThreeBridge";
import type { GarmentAssemblyState } from "../garment3d/GarmentAssembly";
import { buildClothSimulationInput } from "../garment3d/ClothSimulationInput";
import { ClothWorkerBridge } from "../physics/ClothWorkerBridge";
import { createAvatarVisual } from "./AvatarVisual";

export type RenderBackend = "webgpu" | "webgl2";
type ViewportRenderer = THREE.WebGLRenderer | WebGPURenderer;

interface PerformanceProfile {
  antialias: boolean;
  maxPixelRatio: number;
  shadows: boolean;
  avatarRadialSegments: number;
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
  private garmentState: GarmentAssemblyState | null = null;
  private clothWorker: ClothWorkerBridge | null = null;
  private simulationRequested = false;
  private simulationRunning = false;
  private readonly simulationToolbar: HTMLDivElement;
  private readonly simulationStatusLabel: HTMLSpanElement;
  private readonly simulationToggleButton: HTMLButtonElement;
  private readonly simulationStepButton: HTMLButtonElement;
  private readonly simulationResetButton: HTMLButtonElement;
  private frameId: number | null = null;
  private lastFrameAt = 0;
  private disposed = false;

  private constructor(
    private readonly host: HTMLElement,
    renderer: ViewportRenderer,
    readonly backend: RenderBackend,
    profile: PerformanceProfile,
  ) {
    this.renderer = renderer;
    this.profile = profile;
    this.scene.background = new THREE.Color(0xe9e6df);
    this.camera.position.set(2.1, 1.25, 3.2);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio));
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.domElement.className = "three-canvas";
    this.host.appendChild(this.renderer.domElement);

    const simulationControls = createSimulationControls();
    this.simulationToolbar = simulationControls.root;
    this.simulationStatusLabel = simulationControls.status;
    this.simulationToggleButton = simulationControls.toggle;
    this.simulationStepButton = simulationControls.step;
    this.simulationResetButton = simulationControls.reset;
    this.simulationToggleButton.addEventListener("click", this.handleSimulationToggle);
    this.simulationStepButton.addEventListener("click", this.handleSimulationStep);
    this.simulationResetButton.addEventListener("click", this.handleSimulationReset);
    this.host.appendChild(this.simulationToolbar);
    this.setSimulationStatus("unavailable", "Carregue uma peça para iniciar a física.");

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
  }

  static async create(host: HTMLElement, signal?: AbortSignal): Promise<ThreeViewport> {
    if (signal?.aborted) throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
    const profile = getPerformanceProfile();
    const rendererResult = await createRenderer(profile, signal);
    const viewport = new ThreeViewport(host, rendererResult.renderer, rendererResult.backend, profile);
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

  updateGarment(snapshots: readonly PatternSnapshot[], garment: GarmentDraft): string[] {
    this.clearGarment();
    this.clearAvatar();

    const avatar = buildAvatarParametricModel(garment.measurements, garment.bodyType);
    const arrangement = buildSemanticAvatarArrangement(snapshots, garment, avatar);
    const visual = createAvatarVisual(avatar, {
      radialSegments: this.profile.avatarRadialSegments,
      castShadow: this.profile.shadows,
      receiveShadow: this.profile.shadows,
    });
    this.avatarGroup.add(visual);
    this.garmentMeshes = buildGarmentAssemblyMeshes(arrangement.state, arrangement.garment, {
      castShadow: this.profile.shadows,
      receiveShadow: this.profile.shadows,
      visibleInstanceIds: arrangement.visibleInstanceIds,
    });
    for (const item of this.garmentMeshes) this.garmentGroup.add(item.mesh);
    this.attachClothWorker(arrangement.state, arrangement.garment);

    this.frameDressedScene();
    this.host.dataset.avatarVisible = "true";
    this.host.dataset.avatarAnchorCount = String(avatar.anchors.length);
    this.host.dataset.collisionProxyCount = String(arrangement.collision.proxies.length);
    this.host.dataset.garmentInstanceCount = String(this.garmentMeshes.length);
    this.host.dataset.coveredAvatarPartCount = String(arrangement.coveredAvatarPartNames.size);
    this.host.dataset.arrangementDiagnosticCount = String(arrangement.diagnostics.length);
    this.host.dataset.arrangementErrorCount = String(arrangement.diagnostics.filter((item) => item.severity === "error").length);
    this.host.dataset.frameTarget = "avatar-and-garment";
    this.requestRender();

    return [...new Set([
      ...arrangement.state.warnings,
      ...arrangement.diagnostics.map((diagnostic) => diagnostic.message),
    ])];
  }

  dress(): void {
    this.resumeSimulation();
    this.refresh();
  }

  resumeSimulation(): void {
    this.simulationRequested = true;
    this.clothWorker?.start();
  }

  pauseSimulation(): void {
    this.simulationRequested = false;
    this.clothWorker?.pause();
  }

  stepSimulation(): void {
    this.simulationRequested = false;
    this.clothWorker?.pause();
    this.clothWorker?.step();
  }

  resetSimulation(): void {
    this.simulationRequested = false;
    this.clothWorker?.pause();
    this.clothWorker?.reset();
    this.setSimulationStatus("paused", "Estado inicial restaurado.");
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
    if (this.frameId !== null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.controls.removeEventListener("change", this.requestRender);
    this.controls.dispose();
    this.simulationRequested = false;
    this.simulationToggleButton.removeEventListener("click", this.handleSimulationToggle);
    this.simulationStepButton.removeEventListener("click", this.handleSimulationStep);
    this.simulationResetButton.removeEventListener("click", this.handleSimulationReset);
    this.clearGarment();
    this.clearAvatar();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.simulationToolbar.remove();
    delete this.host.dataset.avatarVisible;
    delete this.host.dataset.garmentInstanceCount;
    delete this.host.dataset.simulationBackend;
    delete this.host.dataset.simulationStatus;
    delete this.host.dataset.simulationFrame;
    delete this.host.dataset.simulationElapsed;
    delete this.host.dataset.simulationUnstable;
    delete this.host.dataset.simulationError;
  }

  private attachClothWorker(state: GarmentAssemblyState, garment: GarmentDraft): void {
    this.garmentState = state;
    if (state.invalid || state.positions.length === 0 || this.garmentMeshes.length === 0) {
      this.setSimulationStatus("unavailable", "A montagem não possui uma malha física válida.");
      return;
    }

    try {
      this.host.dataset.simulationBackend = "worker-xpbd";
      this.host.dataset.simulationFrame = "0";
      this.host.dataset.simulationElapsed = "0";
      this.setSimulationStatus("initializing", "Preparando XPBD no Worker…");
      const activeState = state;
      this.clothWorker = new ClothWorkerBridge(
        buildClothSimulationInput(state, garment),
        {
          onFrame: (positions, report, frame) => {
            if (this.disposed || this.garmentState !== activeState) return;
            if (positions.length !== activeState.positions.length) {
              this.setSimulationStatus("error", "O Worker devolveu uma malha incompatível.");
              return;
            }
            activeState.positions.set(positions);
            for (const item of this.garmentMeshes) refreshMeshFromAssembly(item, activeState);
            this.host.dataset.simulationFrame = String(frame);
            this.host.dataset.simulationElapsed = report.elapsedSeconds.toFixed(3);
            this.host.dataset.simulationMaximumSpeed = report.maximumSpeed.toFixed(4);
            this.host.dataset.simulationMaximumCorrection = report.maximumCorrection.toFixed(5);
            if (!report.unstable) this.host.dataset.simulationUnstable = "false";
            this.requestRender();
          },
          onStatus: (status) => {
            if (status === "disposed") return;
            if (status === "running") this.setSimulationStatus("running", "XPBD em execução no Worker.");
            else if (status === "paused" && this.host.dataset.simulationUnstable !== "true") {
              this.setSimulationStatus("paused", "Simulação pausada.");
            }
          },
          onUnstable: (report) => {
            this.host.dataset.simulationUnstable = "true";
            this.setSimulationStatus(
              "unstable",
              `Instabilidade contida após ${report.elapsedSeconds.toFixed(2)} s; a última malha estável foi preservada.`,
            );
          },
          onError: (message) => {
            this.host.dataset.simulationError = message;
            this.setSimulationStatus("error", message);
          },
        },
      );
      if (this.simulationRequested) this.clothWorker.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.host.dataset.simulationError = message;
      this.setSimulationStatus("error", message);
    }
  }

  private setSimulationStatus(
    status: "unavailable" | "initializing" | "running" | "paused" | "unstable" | "error",
    detail: string,
  ): void {
    this.host.dataset.simulationStatus = status;
    this.simulationRunning = status === "running";
    this.simulationToolbar.hidden = status === "unavailable";
    this.simulationStatusLabel.textContent = detail;
    this.simulationToggleButton.textContent = this.simulationRunning ? "Pausar" : "Continuar";
    const unavailable = status === "unavailable" || status === "initializing" || status === "error";
    this.simulationToggleButton.disabled = unavailable;
    this.simulationStepButton.disabled = unavailable || this.simulationRunning;
    this.simulationResetButton.disabled = status === "unavailable" || status === "initializing";
    if (status === "running" || status === "paused") {
      this.host.dataset.simulationUnstable = "false";
      delete this.host.dataset.simulationError;
    }
  }

  private readonly handleSimulationToggle = (): void => {
    if (this.simulationRunning) this.pauseSimulation();
    else this.resumeSimulation();
  };

  private readonly handleSimulationStep = (): void => {
    this.stepSimulation();
  };

  private readonly handleSimulationReset = (): void => {
    this.resetSimulation();
  };

  private frameDressedScene(): void {
    this.avatarGroup.updateMatrixWorld(true);
    this.garmentGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.avatarGroup);
    box.expandByObject(this.garmentGroup);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const verticalRadius = Math.max(size.y * 0.57, 0.75);
    const horizontalRadius = Math.max(size.x, size.z) * 0.72;
    const radius = Math.max(verticalRadius, horizontalRadius, 0.55);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const aspectAllowance = this.camera.aspect < 0.8 ? 1.2 : 1;
    const distance = Math.max(1.25, radius / Math.tan(halfFov) * aspectAllowance);
    const direction = new THREE.Vector3(1.15, 0.3, 1.7).normalize();
    this.controls.target.copy(center).add(new THREE.Vector3(0, size.y * 0.02, 0));
    this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
    this.camera.near = Math.max(0.01, distance / 120);
    this.camera.far = Math.max(20, distance * 20);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private clearGarment(): void {
    this.clothWorker?.dispose();
    this.clothWorker = null;
    this.garmentState = null;
    this.setSimulationStatus("unavailable", "Carregue uma peça para iniciar a física.");
    delete this.host.dataset.simulationBackend;
    delete this.host.dataset.simulationFrame;
    delete this.host.dataset.simulationElapsed;
    delete this.host.dataset.simulationMaximumSpeed;
    delete this.host.dataset.simulationMaximumCorrection;
    delete this.host.dataset.simulationUnstable;
    delete this.host.dataset.simulationError;
    for (const item of this.garmentMeshes) {
      this.garmentGroup.remove(item.mesh);
      item.mesh.geometry.dispose();
      const material = item.mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    }
    this.garmentMeshes = [];
  }

  private clearAvatar(): void {
    disposeObject(this.avatarGroup);
    this.avatarGroup.clear();
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
    this.controls.update(deltaSeconds);
    this.renderer.render(this.scene, this.camera);
  };
}

interface SimulationControls {
  root: HTMLDivElement;
  status: HTMLSpanElement;
  toggle: HTMLButtonElement;
  step: HTMLButtonElement;
  reset: HTMLButtonElement;
}

function createSimulationControls(): SimulationControls {
  const root = document.createElement("div");
  root.className = "simulation-toolbar";
  root.setAttribute("aria-label", "Controles da simulação física");

  const status = document.createElement("span");
  status.className = "simulation-status-label";
  status.setAttribute("aria-live", "polite");

  const actions = document.createElement("div");
  actions.className = "simulation-actions";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "Continuar";
  const step = document.createElement("button");
  step.type = "button";
  step.textContent = "Passo";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reiniciar";
  actions.append(toggle, step, reset);
  root.append(status, actions);
  return { root, status, toggle, step, reset };
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
    return { antialias: false, maxPixelRatio: 1.25, shadows: false, avatarRadialSegments: 10 };
  }
  return { antialias: true, maxPixelRatio: 1.75, shadows: true, avatarRadialSegments: 18 };
}

function createLights(): THREE.Group {
  const group = new THREE.Group();
  const ambient = new THREE.HemisphereLight(0xffffff, 0x4a4a50, 2.1);
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(3, 5, 4);
  key.castShadow = true;
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
    object.geometry.dispose();
    const material = object.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material.dispose();
  });
}
