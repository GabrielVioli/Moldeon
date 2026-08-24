import * as THREE from "three";
import { buildHumanBodyModel } from "./avatar/HumanBodyModel";
import { DEFAULT_BODY_MEASUREMENTS } from "./patterns/templateCatalog";

declare global {
  interface Window {
    bodySmokeReady?: boolean;
    bodySmokeMetadata?: Record<string, unknown>;
  }
}

const host = document.getElementById("app");
if (!host) throw new Error("body smoke host ausente");

const params = new URLSearchParams(window.location.search);
const requestedView = params.get("view") ?? "front";
const requestedStage = params.get("stage") ?? "final";
const silhouette = requestedView.endsWith("-silhouette");
const showWireframe = params.get("wireframe") === "true";
const baseView = requestedView.replace(/-silhouette$/u, "");
const body = buildHumanBodyModel(DEFAULT_BODY_MEASUREMENTS, { includeCalibrationStages: true });
const stages = body.calibrationStages!;
const stageMeshes = {
  raw: stages.raw,
  normalized: stages.normalized,
  posed: stages.posed,
  "pre-metric": stages.deformedBeforeMetric,
  final: stages.final,
  "final-rest": stages.finalRestShape,
} as const;
const source = stageMeshes[requestedStage as keyof typeof stageMeshes] ?? stages.final;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = !silhouette;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(silhouette ? 0xffffff : 0xf2f2ef, 1);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(silhouette ? 0xffffff : 0xf2f2ef);

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(source.positions), 3));
geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(source.normals), 3));
geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(source.indices), 1));
geometry.computeBoundingSphere();

const solid = new THREE.Mesh(
  geometry,
  silhouette
    ? new THREE.MeshBasicMaterial({ color: 0x080808, side: THREE.FrontSide })
    : new THREE.MeshStandardMaterial({
        color: 0xd0cec8,
        roughness: 0.72,
        metalness: 0,
        side: THREE.FrontSide,
      }),
);
solid.name = "canonical-human-body";
solid.castShadow = !silhouette;
solid.receiveShadow = !silhouette;
scene.add(solid);

if (!silhouette) {
  if (showWireframe) {
    const wire = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x747470,
        wireframe: true,
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
      }),
    );
    wire.renderOrder = 2;
    scene.add(wire);
  }

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 5),
    new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.002;
  floor.receiveShadow = true;
  scene.add(floor);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b8b0, 2.15));
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.position.set(2.6, 3.4, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 8;
  key.shadow.camera.left = -1.5;
  key.shadow.camera.right = 1.5;
  key.shadow.camera.top = 2.2;
  key.shadow.camera.bottom = -0.4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 1.15);
  rim.position.set(-2.4, 2.2, -2.8);
  scene.add(rim);
}

const aspect = window.innerWidth / window.innerHeight;
const halfHeight = Math.max(0.96, (source.bounds.max[1] - source.bounds.min[1]) * 0.57);
const camera = new THREE.OrthographicCamera(
  -halfHeight * aspect,
  halfHeight * aspect,
  halfHeight,
  -halfHeight,
  0.05,
  20,
);
const target = new THREE.Vector3(0, (source.bounds.min[1] + source.bounds.max[1]) * 0.5, 0);
const cameras: Record<string, [number, number, number]> = {
  front: [0, target.y, 4],
  side: [4, target.y, 0],
  back: [0, target.y, -4],
  "front-three-quarter": [2.83, target.y, 2.83],
  "back-three-quarter": [2.83, target.y, -2.83],
};
const cameraPosition = cameras[baseView] ?? cameras.front;
camera.position.set(...cameraPosition);
camera.lookAt(target);

const label = document.getElementById("view-label");
if (label) {
  label.textContent = silhouette ? "" : `HumanBodyModel · ${requestedStage} · ${baseView}`;
  label.hidden = silhouette;
}

function render(): void {
  renderer.render(scene, camera);
}

render();
requestAnimationFrame(() => {
  render();
  window.bodySmokeMetadata = {
    view: requestedView,
    stage: requestedStage,
    silhouette,
    version: body.version,
    sourceAssetId: source.sourceAssetId,
    assetSha256: body.diagnostics.asset.sha256,
    topologySignature: source.topologySignature,
    topologyInvariant: body.diagnostics.topologyInvariant,
    visualCollisionTopologyParity: body.diagnostics.visualCollisionTopologyParity,
    measurements: body.measurements,
    measurementErrorsMm: body.diagnostics.measurementErrorsMm,
    identityDeformation: body.diagnostics.identityDeformation,
    deformationByRegion: body.diagnostics.deformationByRegion,
    shapeQuality: body.diagnostics.meshQuality,
    meshDiagnostics: body.diagnostics.visual,
    vertices: source.positions.length / 3,
    triangles: source.indices.length / 3,
    bounds: source.bounds,
  };
  window.bodySmokeReady = true;
});

window.addEventListener("resize", () => {
  const nextAspect = window.innerWidth / window.innerHeight;
  camera.left = -halfHeight * nextAspect;
  camera.right = halfHeight * nextAspect;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  render();
});
