import {
  advanceClothSimulation,
  createClothSimulationState,
  disposeClothSimulation,
  pauseClothSimulation,
  resetClothSimulation,
  startClothSimulation,
  stepClothSimulation,
  type ClothSimulationOptions,
  type ClothSimulationState,
} from "../physics/clothXpbd";
import type { ClothWorkerCommand, ClothWorkerEvent } from "../physics/ClothWorkerProtocol";

interface ClothWorkerScope {
  onmessage: ((event: MessageEvent<ClothWorkerCommand>) => void) | null;
  postMessage(message: ClothWorkerEvent, transfer?: Transferable[]): void;
  close(): void;
  crossOriginIsolated?: boolean;
}

const workerScope = globalThis as unknown as ClothWorkerScope;
let state: ClothSimulationState | null = null;
let options: Partial<ClothSimulationOptions> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let lastTickAt = 0;
const framePool: ArrayBuffer[] = [];

workerScope.onmessage = (event) => {
  try {
    handleCommand(event.data);
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
};

function handleCommand(command: ClothWorkerCommand): void {
  switch (command.type) {
    case "initialize":
      stopLoop();
      state = createClothSimulationState(command.input);
      options = { ...command.options };
      framePool.length = 0;
      post({
        type: "ready",
        particleCount: state.inverseMasses.length,
        sharedMemory: typeof SharedArrayBuffer !== "undefined" && workerScope.crossOriginIsolated === true,
      });
      post({ type: "status", status: "paused" });
      return;
    case "update-geometry": {
      const wasRunning = state !== null && !state.paused;
      stopLoop();
      state = createClothSimulationState(command.input);
      framePool.length = 0;
      if (wasRunning) {
        startClothSimulation(state);
        startLoop();
      }
      post({
        type: "ready",
        particleCount: state.inverseMasses.length,
        sharedMemory: typeof SharedArrayBuffer !== "undefined" && workerScope.crossOriginIsolated === true,
      });
      return;
    }
    case "update-seams":
      requireState().constraints.stitches = command.stitches;
      return;
    case "update-fabric":
      options = { ...options, ...command.options };
      return;
    case "start":
      startClothSimulation(requireState());
      startLoop();
      post({ type: "status", status: "running" });
      return;
    case "pause":
      pauseClothSimulation(requireState());
      stopLoop();
      post({ type: "status", status: "paused" });
      return;
    case "step": {
      const report = stepClothSimulation(requireState(), options);
      publishFrame(report);
      post({ type: "status", status: "paused", report });
      return;
    }
    case "reset":
      resetClothSimulation(requireState());
      publishFrame({
        simulatedSteps: 0,
        elapsedSeconds: 0,
        maximumSpeed: 0,
        maximumCorrection: 0,
        unstable: false,
        rolledBack: false,
      });
      return;
    case "release-frame":
      if (state && command.buffer.byteLength === state.positions.byteLength && framePool.length < 3) {
        framePool.push(command.buffer);
      }
      return;
    case "dispose":
      stopLoop();
      if (state) disposeClothSimulation(state);
      state = null;
      framePool.length = 0;
      post({ type: "status", status: "disposed" });
      workerScope.close();
      return;
  }
}

function startLoop(): void {
  if (timer !== null) return;
  lastTickAt = performance.now();
  timer = setTimeout(tick, 0);
}

function stopLoop(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  lastTickAt = 0;
}

function tick(): void {
  timer = null;
  const current = state;
  if (!current || current.paused || current.disposed) return;
  const now = performance.now();
  const deltaSeconds = lastTickAt === 0 ? 1 / 60 : Math.max(0, (now - lastTickAt) / 1000);
  lastTickAt = now;
  const report = advanceClothSimulation(current, deltaSeconds, options);
  if (report.simulatedSteps > 0) publishFrame(report);
  if (report.unstable) {
    pauseClothSimulation(current);
    stopLoop();
    post({ type: "status", status: "paused", report });
    return;
  }
  timer = setTimeout(tick, 1000 / 60);
}

function publishFrame(report: ReturnType<typeof stepClothSimulation>): void {
  const current = requireState();
  const buffer = framePool.pop() ?? new ArrayBuffer(current.positions.byteLength);
  new Float32Array(buffer).set(current.positions);
  post({ type: "frame", frame: current.frame, positions: buffer, report }, [buffer]);
  if (report.unstable) post({ type: "unstable", report });
}

function requireState(): ClothSimulationState {
  if (!state) throw new Error("A simulação precisa ser inicializada antes deste comando.");
  return state;
}

function post(event: ClothWorkerEvent, transfer: Transferable[] = []): void {
  workerScope.postMessage(event, transfer);
}
