import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PatternPoint, PatternSnapshot } from "../domain/pattern";
import { triangulatePatternContour } from "../domain/polygonGeometry";
import { disposeObjectTree } from "./disposeObjectTree";

interface GarmentMeshData {
  mesh: THREE.Mesh;
  flat: Float32Array;
  dressed: Float32Array;
}

export class ThreeViewport {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  private readonly renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
  private readonly controls: OrbitControls;
  private readonly garmentGroup = new THREE.Group();
  private readonly resizeObserver: ResizeObserver;
  private garmentMeshes: GarmentMeshData[] = [];
  private dressProgress = 1;
  private dressStartedAt = 0;
  private disposed = false;

  private constructor(private readonly host: HTMLElement) {
    this.scene.background = new THREE.Color(0xe9e6df);
    this.camera.position.set(2.4, 1.45, 3.8);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.domElement.className = "three-canvas";
    this.host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.05, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 8;

    this.scene.add(this.createLights());
    this.scene.add(this.createMannequin());
    this.scene.add(this.garmentGroup);
    this.scene.add(this.createFloor());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
  }

  static async create(
    host: HTMLElement,
    signal?: AbortSignal,
  ): Promise<ThreeViewport> {
    if (signal?.aborted) {
      throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
    }

    const viewport = new ThreeViewport(host);
    const abort = () => viewport.dispose();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      await viewport.renderer.init();

      if (signal?.aborted || viewport.disposed) {
        throw new DOMException("Inicialização do viewport cancelada.", "AbortError");
      }

      viewport.resize();
      viewport.renderer.setAnimationLoop((time) => viewport.render(time));
      return viewport;
    } catch (error) {
      viewport.dispose();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  updatePattern(snapshot: PatternSnapshot) {
    this.clearGarment();

    const points = snapshot.piece.points;
    const triangulation = triangulatePatternContour(points);
    if (!triangulation.ok) return;

    const minX = Math.min(...points.map((point) => point.xMm));
    const maxX = Math.max(...points.map((point) => point.xMm));
    const minY = Math.min(...points.map((point) => point.yMm));
    const widthMm = Math.max(1, maxX - minX);
    const centerX = (minX + maxX) / 2;
    const scale = 0.00145;

    const front = this.createPanel(
      points,
      triangulation.indices,
      centerX,
      minY,
      widthMm * scale,
      scale,
      false,
    );
    const back = this.createPanel(
      points,
      triangulation.indices,
      centerX,
      minY,
      widthMm * scale,
      scale,
      true,
    );
    this.garmentMeshes = [front, back];
    this.garmentMeshes.forEach(({ mesh }) => this.garmentGroup.add(mesh));
    this.applyDressProgress(1);
  }

  dress() {
    this.dressProgress = 0;
    this.dressStartedAt = performance.now();
    this.applyDressProgress(0);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.renderer.setAnimationLoop(null);
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
    centerX: number,
    minY: number,
    width: number,
    scale: number,
    back: boolean,
  ): GarmentMeshData {
    const initialPositions = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      initialPositions[index * 3] = (point.xMm - centerX) * scale;
      initialPositions[index * 3 + 1] = -(point.yMm - minY) * scale;
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
      const y = positions.getY(index) + 1.25;
      const normalizedX = THREE.MathUtils.clamp(x / halfWidth, -1, 1);
      const angle = normalizedX * 1.22;
      const radius = 0.31 + Math.max(0, -positions.getY(index)) * 0.035;

      flat[index * 3] = x + (back ? 0.55 : -0.55);
      flat[index * 3 + 1] = y;
      flat[index * 3 + 2] = back ? -0.75 : 0.75;

      const wrappedAngle = back ? Math.PI - angle : angle;
      dressed[index * 3] = Math.sin(wrappedAngle) * radius;
      dressed[index * 3 + 1] = y;
      dressed[index * 3 + 2] = Math.cos(wrappedAngle) * radius;
    }

    const material = new THREE.MeshStandardMaterial({
      color: back ? 0x5e625f : 0x777d79,
      roughness: 0.8,
      metalness: 0,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

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

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.65, 8, 24), material);
    torso.position.y = 1.25;
    torso.scale.set(1, 1, 0.72);
    torso.castShadow = true;

    const hips = new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 20), material);
    hips.position.y = 0.86;
    hips.scale.set(1, 0.72, 0.82);
    hips.castShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), material);
    head.position.y = 2.05;
    head.scale.set(0.9, 1.15, 0.92);
    head.castShadow = true;

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.22, 20), material);
    neck.position.y = 1.84;

    const legGeometry = new THREE.CapsuleGeometry(0.105, 0.75, 6, 18);
    const leftLeg = new THREE.Mesh(legGeometry, material);
    leftLeg.position.set(-0.14, 0.25, 0);
    leftLeg.castShadow = true;
    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.14;

    group.add(torso, hips, head, neck, leftLeg, rightLeg);
    return group;
  }

  private createLights(): THREE.Group {
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

  private createFloor(): THREE.Mesh {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 64),
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

  private render(time: number) {
    if (this.disposed) return;

    if (this.dressProgress < 1) {
      this.dressProgress = Math.min(1, (time - this.dressStartedAt) / 1200);
      this.applyDressProgress(this.dressProgress);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
