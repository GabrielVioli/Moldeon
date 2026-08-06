import type {
  ClothConstraintBuffers,
  ClothSimulationInput,
  ClothSimulationOptions,
  ClothStepReport,
  InterpolatedConstraintBuffer,
} from "./clothXpbd";

export type ClothWorkerCommand =
  | { type: "initialize"; input: ClothSimulationInput; options?: Partial<ClothSimulationOptions> }
  | { type: "update-geometry"; input: ClothSimulationInput }
  | { type: "update-seams"; stitches: InterpolatedConstraintBuffer }
  | { type: "update-fabric"; options: Partial<ClothSimulationOptions> }
  | { type: "start" }
  | { type: "pause" }
  | { type: "step" }
  | { type: "reset" }
  | { type: "release-frame"; buffer: ArrayBuffer }
  | { type: "dispose" };

export type ClothWorkerEvent =
  | { type: "ready"; particleCount: number; sharedMemory: boolean }
  | { type: "status"; status: "running" | "paused" | "disposed"; report?: ClothStepReport }
  | { type: "frame"; frame: number; positions: ArrayBuffer; report: ClothStepReport }
  | { type: "unstable"; report: ClothStepReport }
  | { type: "error"; message: string; stack?: string };

export function clothInputTransferables(input: ClothSimulationInput): Transferable[] {
  return uniqueBuffers([
    asArrayBuffer(input.positions),
    asArrayBuffer(input.inverseMasses),
    asArrayBuffer(input.restPositions2D),
    asArrayBuffer(input.triangles),
    asArrayBuffer(input.materialCoordinates),
    ...constraintTransferables(input.constraints),
  ]);
}

export function stitchTransferables(stitches: InterpolatedConstraintBuffer): Transferable[] {
  return uniqueBuffers([
    asArrayBuffer(stitches.aIndices),
    asArrayBuffer(stitches.aWeights),
    asArrayBuffer(stitches.bIndices),
    asArrayBuffer(stitches.bWeights),
    asArrayBuffer(stitches.restDistance),
    asArrayBuffer(stitches.compliance),
    asArrayBuffer(stitches.lambda),
  ]);
}

function constraintTransferables(constraints: ClothConstraintBuffers): ArrayBuffer[] {
  return [
    ...distanceTransferables(constraints.warp),
    ...distanceTransferables(constraints.weft),
    ...distanceTransferables(constraints.shear),
    ...distanceTransferables(constraints.bend),
    asArrayBuffer(constraints.stitches.aIndices),
    asArrayBuffer(constraints.stitches.aWeights),
    asArrayBuffer(constraints.stitches.bIndices),
    asArrayBuffer(constraints.stitches.bWeights),
    asArrayBuffer(constraints.stitches.restDistance),
    asArrayBuffer(constraints.stitches.compliance),
    asArrayBuffer(constraints.stitches.lambda),
    asArrayBuffer(constraints.anchors.particle),
    asArrayBuffer(constraints.anchors.target),
    asArrayBuffer(constraints.anchors.compliance),
    asArrayBuffer(constraints.anchors.lambda),
  ];
}

function distanceTransferables(buffer: ClothConstraintBuffers["warp"]): ArrayBuffer[] {
  return [
    asArrayBuffer(buffer.a),
    asArrayBuffer(buffer.b),
    asArrayBuffer(buffer.restLength),
    asArrayBuffer(buffer.compliance),
    asArrayBuffer(buffer.lambda),
  ];
}

function asArrayBuffer(view: ArrayBufferView<ArrayBufferLike>): ArrayBuffer {
  if (!(view.buffer instanceof ArrayBuffer)) {
    throw new TypeError("A transferência XPBD exige buffers ArrayBuffer próprios.");
  }
  return view.buffer;
}

function uniqueBuffers(buffers: ArrayBuffer[]): Transferable[] {
  return [...new Set(buffers)];
}
