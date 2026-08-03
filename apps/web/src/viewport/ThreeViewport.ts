import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  BodyMeasurements,
  BodyType,
  GarmentDraft,
  PatternPoint,
  PatternPreviewPlacement,
  PatternSnapshot,
  createPreviewPlacement,
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
  key: string;
  signature: string;
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
  private readonly gltfLoader = new GLTFLoader();
  private frameId: number | null = null;
  private garmentMeshes: GarmentMeshData[] = [];
  private dressProgress = 1;
  private dressStartedAt = 0;
  private lastFrameAt = 0;
  private disposed = false;
  private bodySignature = "";
  private exploded = false;
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
  private loadedGlbModel: THREE.Group | null = null;
  private bodyType: BodyType = "feminine";

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
  ): string[] {
    this.updateBody(garment.bodyType, garment.measurements);

    const scale = 0.00145;
    const meshes: GarmentMeshData[] = [];
    const existingMeshes = new Map(this.garmentMeshes.map((item) => [item.key, item]));
    const fabricById = new Map(
      garment.fabrics.map((source) => [source.id, source]),
    );
    const fallbackFabric = garment.fabrics[0];
    const warnings: string[] = [];
    snapshots.forEach((snapshot) => {
      const points = samplePatternContour(snapshot.piece.points);
      const triangulation = triangulatePatternContour(points);
      if (!triangulation.ok) {
        warnings.push(`${snapshot.piece.name}: contorno inválido para a prévia 3D.`);
        return;
      }
      const placements =
        garment.assemblyPlacements?.filter((candidate) => candidate.pieceId === snapshot.piece.id).map((candidate, placementIndex): PatternPreviewPlacement => ({
          id: `assembly-${candidate.pieceId}-${placementIndex}`,
          pieceId: candidate.pieceId,
          region: candidate.role === "sleeve" ? "arm" : candidate.role === "leg" ? "leg" : candidate.role === "waist" ? "waist" : "torso",
          surface: candidate.outwardSide,
          bodySide: candidate.role === "sleeve" || candidate.role === "leg" ? (placementIndex % 2 ? "left" : "right") : "center",
          rotationDeg: candidate.rotationDeg[2],
          offsetXMm: candidate.positionMm[0],
          offsetYMm: candidate.positionMm[1],
          offsetZMm: candidate.positionMm[2],
          scale: 1,
          mirrorX: candidate.flipped,
        })) ?? snapshot.piece.previewPlacements ?? [createPreviewPlacement(snapshot.piece.id)];
      const fabric =
        fabricById.get(snapshot.piece.fabricId ?? "") ?? fallbackFabric;
      if (!fabric) return;
      for (const placement of placements) {
        const key = `${snapshot.piece.id}/${placement.id}`;
        const signature = JSON.stringify([points, placement, fabric]);
        const existing = existingMeshes.get(key);
        if (existing?.signature === signature) {
          meshes.push(existing);
          existingMeshes.delete(key);
        } else {
          if (existing) {
            this.disposeGarmentMesh(existing);
            existingMeshes.delete(key);
          }
          meshes.push({ ...this.createPanel(
            points,
            triangulation.indices,
            scale,
            placement,
            fabric,
            meshes.length,
          ), key, signature });
        }
      }
    });
    existingMeshes.forEach((item) => this.disposeGarmentMesh(item));
    this.garmentMeshes = meshes;
    this.garmentMeshes.forEach(({ mesh }) => {
      if (mesh.parent !== this.garmentGroup) this.garmentGroup.add(mesh);
    });
    this.applyDressProgress(1);
    this.setExploded(this.exploded);
    this.requestRender();
    return warnings;
  }

  setBodyVisible(visible: boolean): void {
    if (this.mannequinGroup.visible !== visible) this.bodySignature = "";
    this.mannequinGroup.visible = visible;
    this.requestRender();
  }

  setExploded(exploded: boolean): void {
    this.exploded = exploded;
    this.garmentGroup.children.forEach((child, index) => {
      child.position.x = exploded ? ((index % 3) - 1) * 0.38 : 0;
      child.position.z = exploded ? Math.floor(index / 3) * 0.18 : 0;
    });
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
  ): Omit<GarmentMeshData, "key" | "signature"> {
    const bounds = pointBounds(points);
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

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const localY = positions.getY(index);
      const flatColumn = (instanceIndex % 4) - 1.5;
      const flatRow = Math.floor(instanceIndex / 4);
      flat[index * 3] = x + flatColumn * 0.58;
      flat[index * 3 + 1] = localY + 1.65 - flatRow * 0.28;
      flat[index * 3 + 2] = 0.82;

      const target = dressedPosition(
        x,
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
    for (const item of this.garmentMeshes) this.disposeGarmentMesh(item);
    this.garmentMeshes = [];
  }

  private disposeGarmentMesh({ mesh }: GarmentMeshData): void {
    this.garmentGroup.remove(mesh);
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  }

  private updateBody(
    bodyType: BodyType,
    measurements: BodyMeasurements,
  ) {
    const signature = `${bodyType}:${Object.values(measurements).join(":")}`;
    if (signature === this.bodySignature) return;

    disposeObjectTree(this.mannequinGroup);
    this.mannequinGroup.clear();
    this.bodyType = bodyType;
    this.avatarMetrics = createAvatarMetrics(bodyType, measurements);

    if (!this.mannequinGroup.visible) {
      this.mannequinGroup.add(this.createMannequin(bodyType, this.avatarMetrics));
      this.bodySignature = signature;
      this.requestRender();
      return;
    }

    // Tenta carregar modelo GLB, fallback para procedural
    const modelPath = bodyType === "feminine"
      ? "/models/avatar-feminine.glb"
      : "/models/avatar-masculine.glb";

    this.loadGlbModel(modelPath, bodyType, measurements)
      .then((model) => {
        if (model && !this.disposed) {
          this.loadedGlbModel = model;
          this.mannequinGroup.add(model);
          this.applyMorphTargets(model, measurements);
          this.requestRender();
        }
      })
      .catch((error) => {
        console.warn("Falha ao carregar modelo GLB, usando fallback procedural:", error);
        if (!this.disposed) {
          this.mannequinGroup.add(
            this.createMannequin(bodyType, this.avatarMetrics),
          );
          this.requestRender();
        }
      });

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

  private async loadGlbModel(
    path: string,
    bodyType: BodyType,
    measurements: BodyMeasurements,
  ): Promise<THREE.Group | null> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        path,
        (gltf) => {
          const model = gltf.scene;
          // Configurar materiais
          model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = this.profile.shadows;
              child.receiveShadow = this.profile.shadows;
              // Ajustar cor baseada no tipo de corpo
              if (child.material instanceof THREE.MeshStandardMaterial) {
                child.material.color.setHex(
                  bodyType === "feminine" ? 0xc3aa9a : 0xb8a08f
                );
                child.material.roughness = 0.94;
              }
            }
          });

          // Escalar e posicionar o modelo
          model.scale.set(1, 1, 1);
          model.position.set(0, 0, 0);
          resolve(model);
        },
        (progress) => {
          // Progresso do carregamento (opcional)
          console.log(`Loading model: ${(progress.loaded / progress.total * 100).toFixed(1)}%`);
        },
        (error: unknown) => {
          reject(error);
        }
      );
    });
  }

  private applyMorphTargets(
    model: THREE.Group,
    measurements: BodyMeasurements,
  ): void {
    // Valores base para normalização
    const baseMeasurements: BodyMeasurements = {
      heightMm: 1680,
      bustMm: 920,
      waistMm: 760,
      hipMm: 1000,
      shoulderWidthMm: 400,
      torsoLengthMm: 440,
      armLengthMm: 590,
      inseamMm: 780,
    };

    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (!child.morphTargetDictionary || !child.morphTargetInfluences) return;

      const dict = child.morphTargetDictionary;
      const influences = child.morphTargetInfluences;

      // Aplicar morph targets baseados nas diferenças de medidas
      // Estes nomes devem corresponder aos morph targets do modelo GLB
      const morphTargets: Array<{
        key: keyof typeof dict;
        ratio: number;
        clamp: [number, number];
      }> = [
        { key: "height", ratio: measurements.heightMm / baseMeasurements.heightMm, clamp: [-0.5, 0.5] },
        { key: "bust", ratio: measurements.bustMm / baseMeasurements.bustMm, clamp: [-0.3, 0.3] },
        { key: "waist", ratio: measurements.waistMm / baseMeasurements.waistMm, clamp: [-0.3, 0.3] },
        { key: "hip", ratio: measurements.hipMm / baseMeasurements.hipMm, clamp: [-0.3, 0.3] },
        { key: "shoulders", ratio: measurements.shoulderWidthMm / baseMeasurements.shoulderWidthMm, clamp: [-0.2, 0.2] },
        { key: "torso", ratio: measurements.torsoLengthMm / baseMeasurements.torsoLengthMm, clamp: [-0.2, 0.2] },
        { key: "arms", ratio: measurements.armLengthMm / baseMeasurements.armLengthMm, clamp: [-0.2, 0.2] },
        { key: "legs", ratio: measurements.inseamMm / baseMeasurements.inseamMm, clamp: [-0.2, 0.2] },
      ];

      for (const morph of morphTargets) {
        const index = dict[morph.key];
        if (typeof index === "number" && influences[index] !== undefined) {
          influences[index] = THREE.MathUtils.clamp(morph.ratio - 1, morph.clamp[0], morph.clamp[1]);
        }
      }
    });
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

export function dressedPosition(
  localX: number,
  localY: number,
  placement: PatternPreviewPlacement,
  metrics: AvatarMetrics,
  fabric: FabricSource,
): { x: number; y: number; z: number } {
  void fabricDrapeFactor(fabric);
  const scale = Math.max(0.05, placement.scale);
  const rotation = THREE.MathUtils.degToRad(placement.rotationDeg);
  const x = (placement.mirrorX ? -localX : localX) * scale;
  const y = localY * scale;
  const rotatedX = x * Math.cos(rotation) - y * Math.sin(rotation);
  const rotatedY = x * Math.sin(rotation) + y * Math.cos(rotation);
  const sideX = placement.bodySide === "left" ? -1 : placement.bodySide === "right" ? 1 : 0;
  const anchor = placement.region === "arm"
    ? { x: sideX * metrics.shoulderHalf, y: metrics.shoulderY, z: 0.08 }
    : placement.region === "leg"
      ? { x: (sideX || 1) * metrics.legCenterX, y: metrics.hipY, z: 0.1 }
      : placement.region === "hip"
        ? { x: sideX * metrics.hipRadius * 0.55, y: metrics.waistY, z: metrics.hipRadius * 1.04 }
        : placement.region === "waist"
          ? { x: sideX * metrics.waistRadius * 0.55, y: metrics.waistY, z: metrics.waistRadius * 1.04 }
          : { x: sideX * metrics.chestRadius * 0.55, y: metrics.shoulderY, z: metrics.chestRadius * 1.04 };
  const surfaceSign = placement.surface === "back" ? -1 : 1;
  return {
    x: anchor.x + rotatedX + placement.offsetXMm * 0.001,
    y: anchor.y + rotatedY + placement.offsetYMm * 0.001,
    z: surfaceSign * anchor.z + placement.offsetZMm * 0.001,
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
