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
  type GarmentAssemblyMeshData,
} from "../garment3d/GarmentThreeBridge";
import type { ResolvedAssemblyInput } from "../garment3d/ResolvedAssemblyInput";

export type RenderBackend = "webgpu" | "webgl2";
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
  private avatarSignature: string | null = null;
  private avatarLoadController: AbortController | null = null;
  private hasFramedScene = false;
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
    this.refresh();
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
    this.avatarLoadController?.abort();
    this.avatarLoadController = null;
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
  }

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
      const previousPositions = previous?.mesh.geometry.getAttribute("position");
      const nextPositions = next.mesh.geometry.getAttribute("position");
      const canReuse = previous !== undefined
        && previousPositions !== undefined
        && previous.geometrySignature === next.geometrySignature
        && previousPositions.count === nextPositions.count;

      if (!canReuse || !previous || !previousPositions) {
        if (previous) {
          this.garmentGroup.remove(previous.mesh);
          disposeMesh(previous.mesh);
        }
        this.garmentGroup.add(next.mesh);
        reconciled.push(next);
        continue;
      }

      const target = previousPositions.array as Float32Array;
      target.set(nextPositions.array as ArrayLike<number>);
      previousPositions.needsUpdate = true;
      previous.mesh.geometry.computeVertexNormals();
      previous.mesh.geometry.computeBoundingBox();
      previous.mesh.geometry.computeBoundingSphere();
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
    this.controls.update(deltaSeconds);
    this.renderer.render(this.scene, this.camera);
  };
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
