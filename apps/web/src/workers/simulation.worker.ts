/// <reference lib="webworker" />

import { measureXpbdDiagnostics, resetXpbdState, stepXpbd, type XpbdState } from "../physics/xpbd";
import type { XpbdInitializationData } from "../physics/GarmentXpbdAdapter";
import { createXpbdWorkerState } from "../physics/XpbdWorkerState";
import type {
  XpbdAutoPauseSteps,
  XpbdSimulationCadence,
  XpbdWorkerDiagnostics,
  XpbdWorkerRequest,
  XpbdWorkerResponse,
} from "../physics/xpbdProtocol";

let state: XpbdState | null = null;
let revision = "";
let generation = 0;
let epoch = 0;
let commandId = 0;
let running = false;
let disposed = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let sequence = 0;
let timersStarted = 0;
let timersCanceled = 0;
let framesProduced = 0;
let framesSent = 0;
let commandsProcessed = 0;
let lastCommand: XpbdWorkerRequest["type"] = "initialize";
let cadence: XpbdSimulationCadence = 1;
let autoPauseSteps: XpbdAutoPauseSteps = 0;
let lastPhysicsStepMs = 0;
let lastWorkerStepTotalMs = 0;
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
      epoch,
      message: error instanceof Error ? error.message : "Falha desconhecida no Worker XPBD.",
      recoverable: state !== null,
    });
  }
};

function handleRequest(request: XpbdWorkerRequest): void {
  commandsProcessed += 1;
  lastCommand = request.type;
  switch (request.type) {
    case "initialize":
    case "updateGeometry":
      initialize(request.payload, request.generation, request.epoch, request.commandId);
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
      if (request.particleHalfThicknessM?.length === state.body.particleHalfThicknessM.length) {
        state.body.particleHalfThicknessM.set(request.particleHalfThicknessM);
      }
      if (request.particleFriction?.length === state.body.particleFriction.length) {
        state.body.particleFriction.set(request.particleFriction);
      }
      state.config = { ...state.config, ...request.config };
      return;
    case "configureDev":
      if (!state || request.generation !== generation) return;
      state.config = { ...state.config, gravity: request.gravity };
      if (request.bodyCollisionEnabled !== undefined) {
        state.body.enabled = request.bodyCollisionEnabled;
      }
      cadence = request.cadence;
      autoPauseSteps = request.autoPauseSteps;
      if (running) {
        cancelTimer();
        if (reachedAutoPause()) {
          running = false;
          ensureOutputBuffer();
          emitFrame(currentDiagnostics());
        } else schedule(epoch);
      }
      postState();
      return;
    case "start":
    case "resume":
      if (!state || !acceptLifecycleCommand(request)) return;
      cancelTimer();
      if (reachedAutoPause()) {
        running = false;
        ensureOutputBuffer();
        emitFrame(currentDiagnostics());
        postState();
        return;
      }
      running = true;
      schedule(epoch);
      postState();
      return;
    case "pause":
      if (!state || !acceptLifecycleCommand(request)) return;
      running = false;
      cancelTimer();
      ensureOutputBuffer();
      emitFrame(currentDiagnostics());
      postState();
      return;
    case "step":
      if (!state || !acceptLifecycleCommand(request)) return;
      running = false;
      cancelTimer();
      ensureOutputBuffer();
      emitFrame(performOneStep());
      postState();
      return;
    case "reset":
      if (!state || !acceptLifecycleCommand(request)) return;
      running = false;
      cancelTimer();
      resetXpbdState(state);
      lastPhysicsStepMs = 0;
      sequence = 0;
      outputBuffers.length = 0;
      allocateOutputBuffers();
      emitFrame(currentDiagnostics());
      postState();
      return;
    case "recyclePositions":
      if (state && request.buffer.byteLength === state.positions.byteLength && outputBuffers.length < 3) {
        outputBuffers.push(request.buffer);
      }
      return;
    case "dispose":
      if (!acceptLifecycleCommand(request)) return;
      running = false;
      disposed = true;
      cancelTimer();
      state = null;
      outputBuffers.length = 0;
      postState();
  }
}

function initialize(payload: XpbdInitializationData, nextGeneration: number, nextEpoch: number, nextCommandId: number): void {
  if (nextGeneration < generation || (nextGeneration === generation && nextEpoch <= epoch)) return;
  running = false;
  cancelTimer();
  outputBuffers.length = 0;
  revision = payload.revision;
  generation = nextGeneration;
  epoch = nextEpoch;
  commandId = nextCommandId;
  sequence = 0;
  state = createXpbdWorkerState(payload);
  allocateOutputBuffers();
  lastPhysicsStepMs = 0;
  lastWorkerStepTotalMs = 0;
  post({ type: "ready", revision, generation, epoch, diagnostics: currentDiagnostics() });
  postState();
}

function schedule(scheduledEpoch: number): void {
  if (!running || disposed || timer !== null) return;
  timer = setTimeout(() => tick(scheduledEpoch), state ? state.config.fixedTimeStep * 1000 / cadence : 8);
  timersStarted += 1;
}

function tick(scheduledEpoch: number): void {
  timer = null;
  if (!running || !state || disposed || scheduledEpoch !== epoch) return;
  const diagnostics = performOneStep();
  const shouldAutoPause = reachedAutoPause();
  if (shouldAutoPause) ensureOutputBuffer();
  emitFrame(diagnostics);
  if (shouldAutoPause) {
    running = false;
    postState();
    return;
  }
  schedule(scheduledEpoch);
}

function performOneStep(): XpbdWorkerDiagnostics {
  if (!state) throw new Error("Simulação XPBD não inicializada.");
  const startedAt = performance.now();
  stepXpbd(state);
  lastPhysicsStepMs = performance.now() - startedAt;
  lastWorkerStepTotalMs = lastPhysicsStepMs;
  return currentDiagnostics(1);
}

function currentDiagnostics(substeps = 0): XpbdWorkerDiagnostics {
  if (!state) throw new Error("Simulação XPBD não inicializada.");
  return { ...measureXpbdDiagnostics(state, substeps), physicsStepMs: lastPhysicsStepMs, workerStepTotalMs: lastWorkerStepTotalMs };
}

function reachedAutoPause(): boolean {
  return Boolean(state && autoPauseSteps > 0 && state.stepCount >= autoPauseSteps);
}

function emitFrame(diagnostics: XpbdWorkerDiagnostics): void {
  framesProduced += 1;
  if (!state || outputBuffers.length === 0) return;
  const buffer = outputBuffers.pop()!;
  if (buffer.byteLength !== state.positions.byteLength) return;
  const positions = new Float32Array(buffer);
  positions.set(state.positions);
  sequence += 1;
  framesSent += 1;
  post({ type: "positions", revision, generation, epoch, sequence, positions, diagnostics }, [buffer]);
}

function cancelTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timersCanceled += 1;
  }
  timer = null;
}

function postState(): void {
  post({
    type: "state",
    generation,
    epoch,
    running,
    disposed,
    snapshot: {
      timestampMs: performance.now(),
      lifecycle: disposed ? "disposed" : running ? "running" : "paused",
      generation,
      epoch,
      commandId,
      stepCount: state?.stepCount ?? 0,
      accumulator: state?.accumulator ?? 0,
      timerActive: timer !== null,
      timersStarted,
      timersCanceled,
      framesProduced,
      framesSent,
      commandsProcessed,
      lastCommand,
    },
  });
}

function acceptLifecycleCommand(request: XpbdCommandRequest): boolean {
  if (request.generation !== generation || request.epoch <= epoch || request.commandId <= commandId) return false;
  epoch = request.epoch;
  commandId = request.commandId;
  return true;
}

function allocateOutputBuffers(): void {
  if (!state) return;
  outputBuffers.push(new ArrayBuffer(state.positions.byteLength), new ArrayBuffer(state.positions.byteLength));
}

function ensureOutputBuffer(): void {
  if (state && outputBuffers.length === 0) outputBuffers.push(new ArrayBuffer(state.positions.byteLength));
}

type XpbdCommandRequest = Extract<XpbdWorkerRequest, { generation: number; epoch: number; commandId: number }>;

function post(message: XpbdWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

export {};
