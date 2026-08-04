import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GarmentDraft, PatternSnapshot } from "../domain/pattern";
import { buildGarmentAssembly } from "../garment3d/GarmentAssembly";
import { solveGarmentAssembly } from "../garment3d/GarmentSolver";
import {
  buildGarmentAssemblyMeshes,
  type GarmentAssemblyMeshData,
} from "../garment3d/GarmentThreeBridge";

export type RenderBackend = "webgpu" | "webgl2";
type ViewportRenderer = THREE.WebGLRenderer | WebGPURenderer;

interface PerformanceProfile {
  antialias: boolean;
  maxPixelRatio: number;
  shadows: boolean;
  solverIterations: number;
}

export class ThreeViewport {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  private readonly controls: OrbitControls;
  private readonly garmentGroup = new THREE.Group();
  private readonly bodyGroup = new THREE.Group();
  private readonly resizeObserver: ResizeObserver;
  private readonly profile: PerformanceProfile;
  private readonly renderer: ViewportRenderer;
  private garmentMeshes: GarmentAssemblyMeshData[] = [];
  private frameId: number | null = null;
  private lastFrameAt = 0;
  private dressProgress = 1;
  private dressStartedAt = 0;
  private exploded = false;
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
    this.camera.position.set(2.2, 1.5, 3.4);

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio),
    );
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.domElement.className = "three-canvas";
    this.host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.2, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.35;
    this.controls.maxDistance = 12;
    this.controls.addEventListener("change", this.requestRender);

    this.scene.add(createLights());
    this.scene.add(this.bodyGroup);
    this.scene.add(this.garmentGroup);
    this.scene.add(createFloor(profile.shadows));

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.requestRender();
    });
    this.resizeObserver.observe(this.host);
  }

  static async create(
    host: HTMLElement,
    signal?: AbortSignal,
  ): Promise<ThreeViewport> {
    if (signal?.aborted) {
      throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
    }

    const profile = getPerformanceProfile();
    const rendererResult = await createRenderer(profile, signal);
    const viewport = new ThreeViewport(
      host,
      rendererResult.renderer,
      rendererResult.backend,
      profile,
    );

    const abort = () => viewport.dispose();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      if (signal?.aborted || viewport.disposed) {
        throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
      }
      viewport.resize();
      viewport.requestRender();
      return viewport;
    } catch (error) {
      viewport.dispose();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  updateGarment(
    snapshots: readonly PatternSnapshot[],
    garment: GarmentDraft,
  ): string[] {
    this.clearGarment();

    const assembly = buildGarmentAssembly(snapshots, garment);
    const report = solveGarmentAssembly(assembly, {
      iterations: this.profile.solverIterations,
      structuralPasses: 2,
      stitchPasses: 3,
      anchorPasses: 1,
    });

    this.garmentMeshes = buildGarmentAssemblyMeshes(assembly, garment, {
      castShadow: this.profile.shadows,
      receiveShadow: this.profile.shadows,
    });

    for (const item of this.garmentMeshes) {
      this.garmentGroup.add(item.mesh);
    }

    this.applyDressProgress(1);
    this.setExploded(this.exploded);
    this.frameGarment();
    this.requestRender();

    const warnings = [...assembly.warnings];
    if (report.invalid) {
      warnings.push(
        "A montagem 3D encontrou valores inválidos e voltou à posição inicial.",
      );
    } else if (!report.converged && assembly.stitchConstraints.length > 0) {
      warnings.push(
        `A montagem parou com erro residual de ${(report.maximumError * 1000).toFixed(1)} mm.`,
      );
    }

    return [...new Set(warnings)];
  }

  setBodyVisible(visible: boolean): void {
    this.bodyGroup.visible = visible;
    this.requestRender();
  }

  setExploded(exploded: boolean): void {
    this.exploded = exploded;

    this.garmentMeshes.forEach((item, index) => {
      if (!exploded) {
        item.mesh.position.set(0, 0, 0);
        return;
      }

      const column = (index % 3) - 1;
      const row = Math.floor(index / 3);
      item.mesh.position.set(column * 0.48, 0, row * 0.24);
    });

    this.frameGarment();
    this.requestRender();
  }

  dress(): void {
    this.dressProgress = 0;
    this.dressStartedAt = performance.now();
    this.applyDressProgress(0);
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
    this.clearGarment();
    disposeObject(this.bodyGroup);
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private applyDressProgress(progress: number): void {
    const eased = 1 - Math.pow(1 - progress, 3);

    for (const item of this.garmentMeshes) {
      const attribute = item.mesh.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const target = attribute.array as Float32Array;

      for (let index = 0; index < target.length; index += 1) {
        target[index] = THREE.MathUtils.lerp(
          item.flat[index],
          item.dressed[index],
          eased,
        );
      }

      attribute.needsUpdate = true;
      item.mesh.geometry.computeVertexNormals();
      item.mesh.geometry.computeBoundingBox();
      item.mesh.geometry.computeBoundingSphere();
    }
  }

  private frameGarment(): void {
    if (this.garmentMeshes.length === 0) return;

    this.garmentGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.garmentGroup);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.25) * 0.72;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const distance = Math.max(0.7, radius / Math.tan(halfFov));
    const direction = new THREE.Vector3(1.25, 0.55, 1.65).normalize();

    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = Math.max(0.005, distance / 100);
    this.camera.far = Math.max(20, distance * 20);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  private clearGarment(): void {
    for (const item of this.garmentMeshes) {
      this.garmentGroup.remove(item.mesh);
      item.mesh.geometry.dispose();
      const material = item.mesh.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material.dispose();
      }
    }
    this.garmentMeshes = [];
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

    const deltaSeconds = this.lastFrameAt === 0
      ? 1 / 60
      : Math.min((time - this.lastFrameAt) / 1000, 0.05);
    this.lastFrameAt = time;
    let needsAnotherFrame = false;

    if (this.dressProgress < 1) {
      this.dressProgress = Math.min(1, (time - this.dressStartedAt) / 1200);
      this.applyDressProgress(this.dressProgress);
      needsAnotherFrame = this.dressProgress < 1;
    }

    this.controls.update(deltaSeconds);
    this.renderer.render(this.scene, this.camera);

    if (needsAnotherFrame) {
      this.requestRender();
    }
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
      if (signal?.aborted) {
        throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
      }

      renderer = new WebGPURenderer({
        antialias: profile.antialias,
        alpha: false,
      });
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

  if (!context) {
    throw new Error("Este navegador não disponibiliza WebGPU nem WebGL 2.");
  }

  return {
    renderer: new THREE.WebGLRenderer({
      canvas,
      context,
      alpha: false,
      antialias: profile.antialias,
      powerPreference: "high-performance",
    }),
    backend: "webgl2",
  };
}

function getPerformanceProfile(): PerformanceProfile {
  const compact = window.matchMedia("(max-width: 760px)").matches;
  const lowPower =
    navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4;

  if (compact || lowPower) {
    return {
      antialias: false,
      maxPixelRatio: 1.25,
      shadows: false,
      solverIterations: 70,
    };
  }

  return {
    antialias: true,
    maxPixelRatio: 1.75,
    shadows: true,
    solverIterations: 110,
  };
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
    new THREE.MeshStandardMaterial({
      color: 0xd8d4cc,
      roughness: 1,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.28;
  floor.receiveShadow = shadows;
  return floor;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const material = object.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material.dispose();
    }
  });
}
