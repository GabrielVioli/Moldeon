/// <reference lib="webworker" />

import { advanceXpbd, createXpbdState, measureXpbdDiagnostics, resetXpbdState, type XpbdState } from "../physics/xpbd";
import type { XpbdInitializationData } from "../physics/GarmentXpbdAdapter";
import type { XpbdWorkerRequest, XpbdWorkerResponse } from "../physics/xpbdProtocol";

let state: XpbdState | null = null;
let revision = "";
let generation = 0;
let running = false;
let disposed = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastTick = 0;
let sequence = 0;
const outputBuffers: ArrayBuffer[] = [];

self.onmessage = (event: MessageEvent<XpbdWorkerRequest>) => {
  if (disposed) return;
  try {
    handleRequest(event.data);
  } catch (error) {
    post({
      type: "error",
      revision: revision || undefined,
      generation,
      message: error instanceof Error ? error.message : "Falha desconhecida no Worker XPBD.",
      recoverable: state !== null,
    });
  }
};

function handleRequest(request: XpbdWorkerRequest): void {
  switch (request.type) {
    case "initialize":
    case "updateGeometry":
      initialize(request.payload, request.generation);
      return;
    case "updateSeams":
      if (!state || request.revision !== revision) return;
      state.seams = {
        indices: request.seamIndices,
        weights: request.seamWeights,
        restDistances: request.seamRestDistances,
        compliances: request.seamCompliances,
        relaxations: request.seamRelaxations,
        lambdas: new Float32Array(request.seamRestDistances.length),
        seamGroupIds: request.seamGroupIds,
      };
      return;
    case "updateFabric":
      if (!state || request.revision !== revision) return;
      if (request.distanceCompliances.length === state.distances.compliances.length) {
        state.distances.compliances.set(request.distanceCompliances);
      }
      if (request.shearCompliances.length === state.shears.compliances.length) {
        state.shears.compliances.set(request.shearCompliances);
      }
      state.config = { ...state.config, ...request.config };
      return;
    case "start":
    case "resume":
      running = true;
      lastTick = performance.now();
      schedule();
      post({ type: "state", generation, running, disposed: false });
      return;
    case "pause":
      running = false;
      cancelTimer();
      post({ type: "state", generation, running, disposed: false });
      return;
    case "step":
      if (!state) return;
      emitFrame(advanceXpbd(state, request.deltaSeconds ?? state.config.fixedTimeStep));
      return;
    case "reset":
      if (!state) return;
      resetXpbdState(state);
      emitFrame(measureXpbdDiagnostics(state));
      return;
    case "recyclePositions":
      if (state && request.buffer.byteLength === state.positions.byteLength && outputBuffers.length < 3) {
        outputBuffers.push(request.buffer);
      }
      return;
    case "dispose":
      running = false;
      disposed = true;
      cancelTimer();
      state = null;
      outputBuffers.length = 0;
      post({ type: "state", generation, running: false, disposed: true });
  }
}

function initialize(payload: XpbdInitializationData, nextGeneration: number): void {
  running = false;
  cancelTimer();
  outputBuffers.length = 0;
  revision = payload.revision;
  generation = nextGeneration;
  sequence = 0;
  state = createXpbdState({
    positions: payload.positions,
    previousPositions: payload.previousPositions,
    predictedPositions: payload.predictedPositions,
    velocities: payload.velocities,
    inverseMasses: payload.inverseMasses,
    restPositions: payload.restPositions,
    materialCoordinates: payload.materialCoordinates,
    triangles: payload.triangles,
    distances: {
      indices: payload.distanceIndices,
      restLengths: payload.distanceRestLengths,
      compliances: payload.distanceCompliances,
      lambdas: new Float32Array(payload.distanceRestLengths.length),
      kinds: payload.distanceKinds,
    },
    shears: {
      indices: payload.shearIndices,
      restCosines: payload.shearRestCosines,
      compliances: payload.shearCompliances,
      lambdas: new Float32Array(payload.shearRestCosines.length),
    },
    seams: {
      indices: payload.seamIndices,
      weights: payload.seamWeights,
      restDistances: payload.seamRestDistances,
      compliances: payload.seamCompliances,
      relaxations: payload.seamRelaxations,
      lambdas: new Float32Array(payload.seamRestDistances.length),
      seamGroupIds: payload.seamGroupIds,
    },
    pins: { indices: payload.pinIndices, targets: payload.pinTargets },
    config: payload.config,
  });
  outputBuffers.push(new ArrayBuffer(state.positions.byteLength), new ArrayBuffer(state.positions.byteLength));
  post({ type: "ready", revision, generation, diagnostics: measureXpbdDiagnostics(state) });
}

function schedule(): void {
  if (!running || disposed || timer !== null) return;
  timer = setTimeout(tick, 8);
}

function tick(): void {
  timer = null;
  if (!running || !state || disposed) return;
  const now = performance.now();
  const delta = lastTick > 0 ? (now - lastTick) / 1000 : state.config.fixedTimeStep;
  lastTick = now;
  const diagnostics = advanceXpbd(state, delta);
  emitFrame(diagnostics);
  schedule();
}

function emitFrame(diagnostics: ReturnType<typeof measureXpbdDiagnostics>): void {
  if (!state || outputBuffers.length === 0) return;
  const buffer = outputBuffers.pop()!;
  if (buffer.byteLength !== state.positions.byteLength) return;
  const positions = new Float32Array(buffer);
  positions.set(state.positions);
  sequence += 1;
  post({ type: "positions", revision, generation, sequence, positions, diagnostics }, [buffer]);
}

function cancelTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function post(message: XpbdWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

export {};
