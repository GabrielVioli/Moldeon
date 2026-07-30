import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  PatternPoint,
  PatternPreviewPlacement,
  PatternSnapshot,
} from "../domain/pattern";
import {
  samplePatternContour,
  triangulatePatternContour,
} from "../domain/polygonGeometry";
import { disposeObjectTree } from "./disposeObjectTree";

interface GarmentMeshData {
  mesh: THREE.Mesh;
  flat: Float32Array;
  dressed: Float32Array;
}

type ViewportRenderer = THREE.WebGLRenderer | WebGPURenderer;
export type RenderBackend = "webgpu" | "webgl2";

interface PerformanceProfile {
  antialias: boolean;
  maxPixelRatio: number;
  shadows: boolean;
  geometrySegments: number;
}

const PANEL_COLORS = [
  0x775a92,
  0x9a7187,
  0x5f7891,
  0xa46f58,
  0x677d68,
] as const;

export class ThreeViewport {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  private readonly renderer: ViewportRenderer;
  private readonly controls: OrbitControls;
  private readonly garmentGroup = new THREE.Group();
  private readonly resizeObserver: ResizeObserver;
  private readonly profile: PerformanceProfile;
  private frameId: number | null = null;
  private garmentMeshes: GarmentMeshData[] = [];
  private dressProgress = 1;
  private dressStartedAt = 0;
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
    this.camera.position.set(2.4, 1.45, 3.8);

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio),
    );
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.domElement.className = "three-canvas";
    this.host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.05, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 8;
    this.controls.addEventListener("change", this.requestRender);

    this.scene.add(this.createLights());
    this.scene.add(this.createMannequin());
    this.scene.add(this.garmentGroup);
    this.scene.add(this.createFloor());

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

  updatePatterns(snapshots: readonly PatternSnapshot[]) {
    this.clearGarment();

    const scale = 0.00145;
    const meshes: GarmentMeshData[] = [];
    snapshots.forEach((snapshot, pieceIndex) => {
      const points = samplePatternContour(snapshot.piece.points);
      const triangulation = triangulatePatternContour(points);
      if (!triangulation.ok) return;
      const placements =
        snapshot.piece.previewPlacements ?? [
          {
            region: "torso",
            surface: "front",
            bodySide: "center",
          } satisfies PatternPreviewPlacement,
        ];
      for (const placement of placements) {
        meshes.push(
          this.createPanel(
            points,
            triangulation.indices,
            scale,
            placement,
            pieceIndex,
            meshes.length,
          ),
        );
      }
    });
    this.garmentMeshes = meshes;
    this.garmentMeshes.forEach(({ mesh }) => this.garmentGroup.add(mesh));
    this.applyDressProgress(1);
    this.requestRender();
  }

  dress() {
    this.dressProgress = 0;
    this.dressStartedAt = performance.now();
    this.applyDressProgress(0);
    this.requestRender();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    if (this.frameId !== null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.controls.removeEventListener("change", this.requestRender);
    this.controls.dispose();
    disposeObjectTree(this.scene);
    this.garmentMeshes = [];
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private createPanel(
    points: readonly PatternPoint[],
    indices: readonly number[],
    scale: number,
    placement: PatternPreviewPlacement,
    pieceIndex: number,
    instanceIndex: number,
  ): GarmentMeshData {
    const bounds = pointBounds(points);
    const width = Math.max(1, bounds.maxX - bounds.minX) * scale;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const initialPositions = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      const x = (point.xMm - centerX) * scale;
      initialPositions[index * 3] = placement.mirrorX ? -x : x;
      initialPositions[index * 3 + 1] = -(point.yMm - bounds.minY) * scale;
      initialPositions[index * 3 + 2] = 0;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(initialPositions, 3),
    );
    geometry.setIndex([...indices]);
    geometry.computeVertexNormals();

    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const flat = new Float32Array(positions.array.length);
    const dressed = new Float32Array(positions.array.length);
    const halfWidth = Math.max(width / 2, 0.001);

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const localY = positions.getY(index);
      const normalizedX = THREE.MathUtils.clamp(x / halfWidth, -1, 1);
      const flatColumn = (instanceIndex % 4) - 1.5;
      const flatRow = Math.floor(instanceIndex / 4);
      flat[index * 3] = x + flatColumn * 0.58;
      flat[index * 3 + 1] = localY + 1.65 - flatRow * 0.28;
      flat[index * 3 + 2] = 0.82;

      const target = dressedPosition(
        normalizedX,
        localY,
        placement,
      );
      dressed[index * 3] = target.x;
      dressed[index * 3 + 1] = target.y;
      dressed[index * 3 + 2] = target.z;
    }

    const material = new THREE.MeshStandardMaterial({
      color: PANEL_COLORS[pieceIndex % PANEL_COLORS.length],
      roughness: 0.8,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = this.profile.shadows;
    mesh.receiveShadow = this.profile.shadows;

    return { mesh, flat, dressed };
  }

  private applyDressProgress(progress: number) {
    const eased = 1 - Math.pow(1 - progress, 3);

    for (const item of this.garmentMeshes) {
      const attribute = item.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;

      for (let index = 0; index < array.length; index += 1) {
        array[index] = THREE.MathUtils.lerp(item.flat[index], item.dressed[index], eased);
      }

      attribute.needsUpdate = true;
      item.mesh.geometry.computeVertexNormals();
    }
  }

  private clearGarment() {
    for (const { mesh } of this.garmentMeshes) {
      this.garmentGroup.remove(mesh);
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    }
    this.garmentMeshes = [];
  }

  private createMannequin(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0xb7aa9a, roughness: 0.92 });

    const radialSegments = this.profile.geometrySegments;
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.65, 6, radialSegments),
      material,
    );
    torso.position.y = 1.25;
    torso.scale.set(1, 1, 0.72);
    torso.castShadow = true;

    const hips = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, radialSegments, 12),
      material,
    );
    hips.position.y = 0.86;
    hips.scale.set(1, 0.72, 0.82);
    hips.castShadow = true;

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, radialSegments, 10),
      material,
    );
    head.position.y = 2.05;
    head.scale.set(0.9, 1.15, 0.92);
    head.castShadow = true;

    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.1, 0.22, radialSegments),
      material,
    );
    neck.position.y = 1.84;

    const legGeometry = new THREE.CapsuleGeometry(
      0.105,
      0.75,
      5,
      radialSegments,
    );
    const leftLeg = new THREE.Mesh(legGeometry, material);
    leftLeg.position.set(-0.14, 0.25, 0);
    leftLeg.castShadow = true;
    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.14;

    const armGeometry = new THREE.CapsuleGeometry(
      0.082,
      0.58,
      5,
      radialSegments,
    );
    const leftArm = new THREE.Mesh(armGeometry, material);
    leftArm.position.set(-0.43, 1.3, 0);
    leftArm.rotation.z = -0.08;
    leftArm.castShadow = true;
    const rightArm = leftArm.clone();
    rightArm.position.x = 0.43;
    rightArm.rotation.z = 0.08;

    group.add(torso, hips, head, neck, leftLeg, rightLeg, leftArm, rightArm);
    return group;
  }

  private createLights(): THREE.Group {
    const group = new THREE.Group();
    const ambient = new THREE.HemisphereLight(0xffffff, 0x4a4a50, 2.1);
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(3, 5, 4);
    key.castShadow = this.profile.shadows;
    const fill = new THREE.DirectionalLight(0xc8d2ff, 1.2);
    fill.position.set(-3, 2, 2);
    group.add(ambient, key, fill);
    return group;
  }

  private createFloor(): THREE.Mesh {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, this.profile.geometrySegments * 2),
      new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.25;
    floor.receiveShadow = true;
    return floor;
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private readonly requestRender = () => {
    if (this.disposed || this.frameId !== null) return;
    this.frameId = window.requestAnimationFrame(this.render);
  };

  private readonly render = (time: number) => {
    this.frameId = null;
    if (this.disposed) return;

    const deltaSeconds =
      this.lastFrameAt === 0 ? 1 / 60 : Math.min((time - this.lastFrameAt) / 1000, 0.05);
    this.lastFrameAt = time;
    let needsAnotherFrame = false;

    if (this.dressProgress < 1) {
      this.dressProgress = Math.min(1, (time - this.dressStartedAt) / 1200);
      this.applyDressProgress(this.dressProgress);
      needsAnotherFrame = this.dressProgress < 1;
    }

    needsAnotherFrame = this.controls.update(deltaSeconds) || needsAnotherFrame;
    this.renderer.render(this.scene, this.camera);
    if (needsAnotherFrame) this.requestRender();
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
      console.info("WebGPU indisponível; iniciando o fallback WebGL 2.", error);
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

  const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    alpha: false,
    antialias: profile.antialias,
    powerPreference: "high-performance",
  });
  return { renderer, backend: "webgl2" };
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
      geometrySegments: 14,
    };
  }

  return {
    antialias: true,
    maxPixelRatio: 1.75,
    shadows: true,
    geometrySegments: 20,
  };
}

function pointBounds(points: readonly PatternPoint[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.xMm);
    minY = Math.min(minY, point.yMm);
    maxX = Math.max(maxX, point.xMm);
    maxY = Math.max(maxY, point.yMm);
  }

  return { minX, minY, maxX, maxY };
}

function dressedPosition(
  normalizedX: number,
  localY: number,
  placement: PatternPreviewPlacement,
): { x: number; y: number; z: number } {
  const backRotation = placement.surface === "back" ? Math.PI : 0;
  const surfaceDirection = placement.surface === "back" ? -1 : 1;

  if (placement.region === "leg") {
    const legCenter = placement.bodySide === "left" ? -0.14 : 0.14;
    const angle = backRotation + surfaceDirection * normalizedX * 0.88;
    const radius = 0.118;
    return {
      x: legCenter + Math.sin(angle) * radius,
      y: 0.88 + localY,
      z: Math.cos(angle) * radius,
    };
  }

  if (placement.region === "sleeve") {
    const armCenter = placement.bodySide === "left" ? -0.43 : 0.43;
    const angle = backRotation + surfaceDirection * normalizedX * 0.95;
    const radius = 0.092;
    return {
      x: armCenter + Math.sin(angle) * radius,
      y: 1.6 + localY,
      z: Math.cos(angle) * radius,
    };
  }

  const sideCenter =
    placement.bodySide === "left"
      ? -0.62
      : placement.bodySide === "right"
        ? 0.62
        : 0;
  const angularSpan = placement.bodySide === "center" ? 1.18 : 0.62;
  const angle =
    backRotation +
    surfaceDirection * (sideCenter + normalizedX * angularSpan);

  if (placement.region === "lower") {
    const radius = 0.34 + Math.max(0, -localY) * 0.035;
    return {
      x: Math.sin(angle) * radius,
      y: 1.05 + localY,
      z: Math.cos(angle) * radius,
    };
  }

  const torsoTaper = THREE.MathUtils.clamp(-localY / 0.72, 0, 1);
  const radius = THREE.MathUtils.lerp(0.31, 0.34, torsoTaper);
  return {
    x: Math.sin(angle) * radius,
    y: 1.72 + localY,
    z: Math.cos(angle) * radius,
  };
}
