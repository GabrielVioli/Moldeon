/// <reference lib="webworker" />

import { solveDistanceConstraints, XpbdState } from "../physics/xpbd";

type WorkerRequest = {
  type: "solve-distance-demo";
  positions: Float32Array;
  inverseMasses: Float32Array;
  restLength: number;
};

type WorkerResponse = {
  type: "distance-demo-result";
  positions: Float32Array;
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type !== "solve-distance-demo") return;

  const state: XpbdState = {
    positions: request.positions,
    previousPositions: request.positions.slice(),
    inverseMasses: request.inverseMasses,
    constraints: [
      {
        a: 0,
        b: 1,
        restLength: request.restLength,
        compliance: 0,
        lambda: 0,
      },
    ],
  };

  solveDistanceConstraints(state, 1 / 60, 8);

  const response: WorkerResponse = {
    type: "distance-demo-result",
    positions: state.positions,
  };

  self.postMessage(response, [response.positions.buffer as ArrayBuffer]);
};

export {};
