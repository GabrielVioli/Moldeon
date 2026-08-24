import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

if (typeof globalThis.ProgressEvent === "undefined") {
  globalThis.ProgressEvent = class ProgressEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
}

const bytes = await readFile(new URL(
  "../apps/web/public/models/human/canonical-female.glb",
  import.meta.url,
));
const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const gltf = await new GLTFLoader().parseAsync(buffer, "");
gltf.scene.updateMatrixWorld(true);
const body = gltf.scene.getObjectByName("Body__0");
if (!(body instanceof THREE.Mesh) || body.geometry.index === null) {
  throw new Error("Body__0 indexed mesh not found");
}
const attribute = body.geometry.getAttribute("position");
const indices = body.geometry.index.array;
const positions = new Float64Array(attribute.count * 3);
const point = new THREE.Vector3();
let minY = Number.POSITIVE_INFINITY;
let maxY = Number.NEGATIVE_INFINITY;
for (let vertex = 0; vertex < attribute.count; vertex += 1) {
  point.fromBufferAttribute(attribute, vertex).applyMatrix4(body.matrixWorld);
  positions.set([point.x, point.y, point.z], vertex * 3);
  minY = Math.min(minY, point.y);
  maxY = Math.max(maxY, point.y);
}
for (let offset = 1; offset < positions.length; offset += 3) positions[offset] -= minY;
const height = maxY - minY;

const stations = {
  ankle: height * 0.045,
  knee: height * 0.251,
  crotch: height * 0.445,
  fullHip: height * 0.505,
  highHip: height * 0.552,
  waist: height * 0.601,
  underbust: height * 0.690,
  bust: height * 0.735,
  shoulder: height * 0.824,
  neck: height * 0.857,
};

const torso = Object.fromEntries(
  ["fullHip", "highHip", "waist", "underbust", "bust", "neck"].map((id) => [
    id,
    planeLength([0, stations[id], 0], [0, 1, 0], (center) => Math.abs(center[0]) < 0.35),
  ]),
);
const legs = {
  thigh: planeLength([-0.075, stations.crotch * 0.8 + stations.knee * 0.2, 0], [0, 1, 0], (center) => center[0] < -0.008),
  knee: planeLength([-0.06, stations.knee, 0], [0, 1, 0], (center) => center[0] < -0.008),
  calf: planeLength([-0.055, stations.knee * 0.52 + stations.ankle * 0.48, 0], [0, 1, 0], (center) => center[0] < -0.008),
  ankle: planeLength([-0.05, stations.ankle, 0], [0, 1, 0], (center) => center[0] < -0.008),
};
const arms = {
  bicep: planeLength([-0.41, stations.shoulder, 0], [1, 0, 0], (center) => center[0] < -0.2),
  elbow: planeLength([-0.57, stations.shoulder, 0], [1, 0, 0], (center) => center[0] < -0.2),
  wrist: planeLength([-0.76, stations.shoulder, 0], [1, 0, 0], (center) => center[0] < -0.2),
};

console.log(JSON.stringify({ heightMm: height * 1000, stations, torso, legs, arms }, null, 2));

function planeLength(origin, normal, includeTriangle) {
  let length = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const vertices = [indices[offset], indices[offset + 1], indices[offset + 2]].map(at);
    const center = vertices.reduce((sum, value) => [sum[0] + value[0] / 3, sum[1] + value[1] / 3, sum[2] + value[2] / 3], [0, 0, 0]);
    if (!includeTriangle(center)) continue;
    const hits = [];
    for (const [a, b] of [[vertices[0], vertices[1]], [vertices[1], vertices[2]], [vertices[2], vertices[0]]]) {
      const da = dot(sub(a, origin), normal);
      const db = dot(sub(b, origin), normal);
      if (Math.abs(da) <= 1e-9) hits.push(a);
      if (da * db < -1e-14) {
        const t = da / (da - db);
        hits.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    const unique = [];
    for (const hit of hits) {
      if (!unique.some((candidate) => distance(candidate, hit) < 1e-8)) unique.push(hit);
    }
    if (unique.length >= 2) length += distance(unique[0], unique[1]);
  }
  return length * 1000;
}

function at(vertex) { return [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
