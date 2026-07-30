import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  BodyMeasurements,
  BodyType,
  GarmentDraft,
  PatternPoint,
  PatternPreviewPlacement,
  PatternSnapshot,
} from "../domain/pattern";
import {
  fabricDrapeFactor,
  type FabricSource,
} from "../domain/fabric";
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
  clothSubdivisions: number;
}

interface AvatarMetrics {
  heightScale: number;
  floorY: number;
  hipY: number;
  waistY: number;
  shoulderY: number;
  headY: number;
  chestRadius: number;
  waistRadius: number;
  hipRadius: number;
  depthScale: number;
  shoulderHalf: number;
  armRadius: number;
  armCenterY: number;
  armLength: number;
  legRadius: number;
  legCenterX: number;
  legCenterY: number;
  legLength: number;
}

export class ThreeViewport {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  private readonly renderer: ViewportRenderer;
  private readonly controls: OrbitControls;
  private readonly garmentGroup = new THREE.Group();
  private readonly mannequinGroup = new THREE.Group();
  private readonly resizeObserver: ResizeObserver;
  private readonly profile: PerformanceProfile;
  private frameId: number | null = null;
  private garmentMeshes: GarmentMeshData[] = [];
  private dressProgress = 1;
  private dressStartedAt = 0;
  private lastFrameAt = 0;
  private disposed = false;
  private bodySignature = "";
  private avatarMetrics = createAvatarMetrics("feminine", {
    heightMm: 1680,
    bustMm: 920,
    waistMm: 760,
    hipMm: 1000,
    shoulderWidthMm: 400,
    torsoLengthMm: 440,
    armLengthMm: 590,
    inseamMm: 780,
  });

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
    this.scene.add(this.mannequinGroup);
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

  updateGarment(
    snapshots: readonly PatternSnapshot[],
    garment: GarmentDraft,
  ) {
    this.updateBody(garment.bodyType, garment.measurements);
    this.clearGarment();

    const scale = 0.00145;
    const meshes: GarmentMeshData[] = [];
    const fabricById = new Map(
      garment.fabrics.map((source) => [source.id, source]),
    );
    const fallbackFabric = garment.fabrics[0];
    snapshots.forEach((snapshot) => {
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
      const fabric =
        fabricById.get(snapshot.piece.fabricId ?? "") ?? fallbackFabric;
      if (!fabric) return;
      for (const placement of placements) {
        meshes.push(
          this.createPanel(
            points,
            triangulation.indices,
            scale,
            placement,
            fabric,
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
    fabric: FabricSource,
    instanceIndex: number,
  ): GarmentMeshData {
    const bounds = pointBounds(points);
    const width = Math.max(1, bounds.maxX - bounds.minX) * scale;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const contourPositions = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      const x = (point.xMm - centerX) * scale;
      contourPositions[index * 3] = placement.mirrorX ? -x : x;
      contourPositions[index * 3 + 1] =
        -(point.yMm - bounds.minY) * scale;
      contourPositions[index * 3 + 2] = 0;
    });
    const surface = subdividePanel(
      contourPositions,
      indices,
      this.profile.clothSubdivisions,
    );

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(surface.positions, 3),
    );
    geometry.setIndex(surface.indices);
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
        this.avatarMetrics,
        fabric,
      );
      dressed[index * 3] = target.x;
      dressed[index * 3 + 1] = target.y;
      dressed[index * 3 + 2] = target.z;
    }

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(fabric.color),
      roughness: THREE.MathUtils.clamp(
        0.48 + fabric.physics.friction * 0.45,
        0.48,
        0.95,
      ),
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

  private updateBody(
    bodyType: BodyType,
    measurements: BodyMeasurements,
  ) {
    const signature = `${bodyType}:${Object.values(measurements).join(":")}`;
    if (signature === this.bodySignature) return;

    disposeObjectTree(this.mannequinGroup);
    this.mannequinGroup.clear();
    this.avatarMetrics = createAvatarMetrics(bodyType, measurements);
    this.mannequinGroup.add(
      this.createMannequin(bodyType, this.avatarMetrics),
    );
    this.bodySignature = signature;
  }

  private createMannequin(
    bodyType: BodyType,
    metrics: AvatarMetrics,
  ): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: bodyType === "feminine" ? 0xc3aa9a : 0xb8a08f,
      roughness: 0.94,
    });
    const radialSegments = this.profile.geometrySegments;

    const torsoProfile = [
      new THREE.Vector2(metrics.hipRadius * 0.88, metrics.hipY - 0.2),
      new THREE.Vector2(metrics.hipRadius, metrics.hipY),
      new THREE.Vector2(metrics.waistRadius, metrics.waistY),
      new THREE.Vector2(metrics.chestRadius, metrics.shoulderY - 0.28),
      new THREE.Vector2(metrics.shoulderHalf * 0.82, metrics.shoulderY - 0.08),
      new THREE.Vector2(metrics.chestRadius * 0.72, metrics.shoulderY + 0.04),
    ];
    const torso = new THREE.Mesh(
      new THREE.LatheGeometry(torsoProfile, radialSegments),
      material,
    );
    torso.scale.z = metrics.depthScale;
    torso.castShadow = this.profile.shadows;

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.17 * metrics.heightScale,
        radialSegments,
        Math.max(8, radialSegments - 4),
      ),
      material,
    );
    head.position.y = metrics.headY;
    head.scale.set(0.9, 1.15, 0.92);
    head.castShadow = this.profile.shadows;

    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(
        metrics.chestRadius * 0.29,
        metrics.chestRadius * 0.33,
        0.2 * metrics.heightScale,
        radialSegments,
      ),
      material,
    );
    neck.position.y = metrics.shoulderY + 0.13 * metrics.heightScale;

    const legGeometry = new THREE.CapsuleGeometry(
      metrics.legRadius,
      metrics.legLength,
      5,
      radialSegments,
    );
    const leftLeg = new THREE.Mesh(legGeometry, material);
    leftLeg.position.set(
      -metrics.legCenterX,
      metrics.legCenterY,
      0,
    );
    leftLeg.castShadow = this.profile.shadows;
    const rightLeg = leftLeg.clone();
    rightLeg.position.x = metrics.legCenterX;

    const armGeometry = new THREE.CapsuleGeometry(
      metrics.armRadius,
      metrics.armLength,
      5,
      radialSegments,
    );
    const leftArm = new THREE.Mesh(armGeometry, material);
    leftArm.position.set(
      -metrics.shoulderHalf - metrics.armRadius * 0.35,
      metrics.armCenterY,
      0,
    );
    leftArm.rotation.z = -0.08;
    leftArm.castShadow = this.profile.shadows;
    const rightArm = leftArm.clone();
    rightArm.position.x =
      metrics.shoulderHalf + metrics.armRadius * 0.35;
    rightArm.rotation.z = 0.08;

    group.add(torso, head, neck, leftLeg, rightLeg, leftArm, rightArm);
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
      clothSubdivisions: 1,
    };
  }

  return {
    antialias: true,
    maxPixelRatio: 1.75,
    shadows: true,
    geometrySegments: 20,
    clothSubdivisions: 2,
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
  metrics: AvatarMetrics,
  fabric: FabricSource,
): { x: number; y: number; z: number } {
  const backRotation = placement.surface === "back" ? Math.PI : 0;
  const surfaceDirection = placement.surface === "back" ? -1 : 1;
  const drape = fabricDrapeFactor(fabric);
  const stretch = THREE.MathUtils.clamp(
    fabric.physics.stretchWeftPercent / 35,
    0,
    1,
  );
  const hang = Math.max(0, -localY);
  const thicknessOffset = Math.max(
    0.003,
    fabric.physics.thicknessMm * 0.0022,
  );
  const fold =
    Math.sin(normalizedX * Math.PI * 5 + hang * 8) *
    drape *
    (1 - stretch * 0.55) *
    Math.min(0.026, hang * 0.05);
  const weightDrop =
    hang *
    drape *
    THREE.MathUtils.clamp(fabric.physics.weightGsm / 420, 0.25, 1.25) *
    0.018;

  if (placement.region === "leg") {
    const legCenter =
      placement.bodySide === "left"
        ? -metrics.legCenterX
        : metrics.legCenterX;
    const angle = backRotation + surfaceDirection * normalizedX * 0.88;
    const radius = metrics.legRadius + thicknessOffset + fold;
    return {
      x: legCenter + Math.sin(angle) * radius,
      y: metrics.hipY + localY - weightDrop,
      z: Math.cos(angle) * radius * metrics.depthScale,
    };
  }

  if (placement.region === "sleeve") {
    const armCenter =
      placement.bodySide === "left"
        ? -metrics.shoulderHalf
        : metrics.shoulderHalf;
    const angle = backRotation + surfaceDirection * normalizedX * 0.95;
    const radius = metrics.armRadius + thicknessOffset + fold * 0.6;
    return {
      x: armCenter + Math.sin(angle) * radius,
      y: metrics.shoulderY - metrics.armRadius + localY - weightDrop,
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
    const y = metrics.waistY + localY - weightDrop;
    const hipProgress = THREE.MathUtils.clamp(
      (metrics.waistY - y) / Math.max(0.01, metrics.waistY - metrics.hipY),
      0,
      1,
    );
    const fittedRadius = THREE.MathUtils.lerp(
      metrics.waistRadius,
      metrics.hipRadius,
      hipProgress,
    );
    const belowHip = Math.max(0, metrics.hipY - y);
    const hangingEase =
      belowHip * (0.018 + drape * 0.025) * (1 - stretch * 0.4);
    const radius =
      fittedRadius + hangingEase + thicknessOffset + fold;
    return {
      x: Math.sin(angle) * radius,
      y,
      z: Math.cos(angle) * radius * metrics.depthScale,
    };
  }

  const y = metrics.shoulderY + localY - weightDrop;
  const radius =
    bodyRadiusAtY(y, metrics) +
    thicknessOffset +
    fold * 0.55 +
    (1 - stretch) * 0.006;
  return {
    x: Math.sin(angle) * radius,
    y,
    z: Math.cos(angle) * radius * metrics.depthScale,
  };
}

function createAvatarMetrics(
  bodyType: BodyType,
  measurements: BodyMeasurements,
): AvatarMetrics {
  const heightScale = THREE.MathUtils.clamp(
    measurements.heightMm / 1680,
    0.78,
    1.28,
  );
  const chestRadius =
    0.3 *
    (measurements.bustMm / 920) *
    (bodyType === "masculine" ? 1.03 : 1);
  const waistRadius = 0.24 * (measurements.waistMm / 760);
  const hipRadius =
    0.35 *
    (measurements.hipMm / 1000) *
    (bodyType === "masculine" ? 0.96 : 1);
  const shoulderHalf =
    0.43 *
    (measurements.shoulderWidthMm / 400) *
    (bodyType === "masculine" ? 1.02 : 1);
  const legRadius = THREE.MathUtils.clamp(hipRadius * 0.3, 0.085, 0.17);
  const legCenterX = Math.max(legRadius * 1.25, hipRadius * 0.4);
  const legLength = 0.75 * (measurements.inseamMm / 780);
  const floorY = -0.2 * heightScale;
  const legCenterY = floorY + (legLength + legRadius * 2) / 2;
  const hipY = floorY + legLength + legRadius * 2 + 0.12;
  const torsoRatio = measurements.torsoLengthMm / 440;
  const waistY = hipY + 0.32 * torsoRatio;
  const shoulderY = hipY + 0.88 * torsoRatio;
  const armRadius = THREE.MathUtils.clamp(chestRadius * 0.27, 0.07, 0.12);
  const armLength = 0.58 * (measurements.armLengthMm / 590);
  const armCenterY = shoulderY - (armLength + armRadius * 2) / 2;

  return {
    heightScale,
    floorY,
    hipY,
    waistY,
    shoulderY,
    headY: shoulderY + 0.32 * heightScale,
    chestRadius,
    waistRadius,
    hipRadius,
    depthScale: bodyType === "feminine" ? 0.8 : 0.86,
    shoulderHalf,
    armRadius,
    armCenterY,
    armLength,
    legRadius,
    legCenterX,
    legCenterY,
    legLength,
  };
}

function bodyRadiusAtY(y: number, metrics: AvatarMetrics): number {
  if (y >= metrics.waistY) {
    const progress = THREE.MathUtils.clamp(
      (y - metrics.waistY) /
        Math.max(0.01, metrics.shoulderY - metrics.waistY),
      0,
      1,
    );
    const chestPeak = Math.sin(progress * Math.PI * 0.78);
    return THREE.MathUtils.lerp(
      metrics.waistRadius,
      metrics.chestRadius,
      chestPeak,
    );
  }
  const progress = THREE.MathUtils.clamp(
    (metrics.waistY - y) /
      Math.max(0.01, metrics.waistY - metrics.hipY),
    0,
    1,
  );
  return THREE.MathUtils.lerp(
    metrics.waistRadius,
    metrics.hipRadius,
    progress,
  );
}

function subdividePanel(
  sourcePositions: Float32Array,
  sourceIndices: readonly number[],
  levels: number,
): { positions: Float32Array; indices: number[] } {
  let positions = Array.from(sourcePositions);
  let indices = [...sourceIndices];

  for (let level = 0; level < levels; level += 1) {
    const edgeMidpoints = new Map<string, number>();
    const nextIndices: number[] = [];
    const midpoint = (first: number, second: number) => {
      const low = Math.min(first, second);
      const high = Math.max(first, second);
      const key = `${low}:${high}`;
      const existing = edgeMidpoints.get(key);
      if (existing !== undefined) return existing;

      const index = positions.length / 3;
      positions.push(
        (positions[first * 3] + positions[second * 3]) / 2,
        (positions[first * 3 + 1] + positions[second * 3 + 1]) / 2,
        (positions[first * 3 + 2] + positions[second * 3 + 2]) / 2,
      );
      edgeMidpoints.set(key, index);
      return index;
    };

    for (let index = 0; index < indices.length; index += 3) {
      const a = indices[index];
      const b = indices[index + 1];
      const c = indices[index + 2];
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      nextIndices.push(
        a,
        ab,
        ca,
        ab,
        b,
        bc,
        ca,
        bc,
        c,
        ab,
        bc,
        ca,
      );
    }
    indices = nextIndices;
  }

  return {
    positions: new Float32Array(positions),
    indices,
  };
}
