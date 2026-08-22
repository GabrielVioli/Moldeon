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
const body = buildHumanBodyModel(DEFAULT_BODY_MEASUREMENTS);
const source = body.visualMesh;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0xf2f2ef, 1);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2f2ef);

const geometry = new THREE.BufferGeometry();
geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(source.positions), 3));
geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(source.normals), 3));
geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(source.indices), 1));
geometry.computeBoundingSphere();

const solid = new THREE.Mesh(
  geometry,
  new THREE.MeshStandardMaterial({
    color: 0xd0cec8,
    roughness: 0.72,
    metalness: 0,
    side: THREE.FrontSide,
  }),
);
solid.name = "canonical-human-body";
solid.castShadow = true;
solid.receiveShadow = true;
scene.add(solid);

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

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(5, 5),
  new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 1, metalness: 0 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.002;
floor.receiveShadow = true;
scene.add(floor);

scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b8b0, 2.15));
const key = new THREE.DirectionalLight(0xffffff, 3.0);
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

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 20);
const target = new THREE.Vector3(0, 0.84, 0.01);
const cameras: Record<string, [number, number, number]> = {
  front: [0, 0.88, 3.45],
  side: [3.45, 0.88, 0],
  back: [0, 0.88, -3.45],
  "three-quarter": [2.38, 0.91, 2.52],
};
const cameraPosition = cameras[requestedView] ?? cameras.front;
camera.position.set(...cameraPosition);
camera.lookAt(target);

const label = document.getElementById("view-label");
if (label) label.textContent = `HumanBodyModel · ${requestedView}`;

renderer.render(scene, camera);
requestAnimationFrame(() => {
  renderer.render(scene, camera);
  window.bodySmokeMetadata = {
    view: requestedView,
    version: body.version,
    measurements: {
      heightMm: body.measurements.heightMm,
      bustMm: body.measurements.bustMm,
      waistMm: body.measurements.waistMm,
      fullHipMm: body.measurements.fullHipMm,
    },
    vertices: source.positions.length / 3,
    triangles: source.indices.length / 3,
    bounds: source.bounds,
  };
  window.bodySmokeReady = true;
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.render(scene, camera);
});
