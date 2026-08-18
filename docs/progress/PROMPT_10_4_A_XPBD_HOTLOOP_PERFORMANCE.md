# Prompt 10.4-A — XPBD hot-loop performance

## Scope

This recovery keeps the physical model from Prompt 10/10.1/10.3 intact and optimizes only the CPU XPBD hot path. Physics mesh resolution, fixed timestep, solver iteration count, compliances, correction limits, seams, stretch, shear and bend remain unchanged.

## Baseline

Deterministic synthetic scenes were profiled on GitHub Actions, Ubuntu 24.04, Node 22.12.0, with the same profiling instrumentation before and after optimization.

| Scene | Baseline median | Baseline p95 | Optimized median | Optimized p95 |
| --- | ---: | ---: | ---: | ---: |
| A — free panel | 3.519 ms | 4.503 ms | 0.787 ms | 1.064 ms |
| B — self-seam tube | 6.742 ms | 7.330 ms | 1.254 ms | 1.690 ms |
| C — four-panel cycle | 14.116 ms | 14.386 ms | 2.923 ms | 3.149 ms |
| D — heavy garment | 52.462 ms | 53.077 ms | 10.891 ms | 11.131 ms |

Heavy-scene median step time decreased by about 79.2%, roughly 4.8x faster. The p95 decreased by about 79.0%.

## Hotspots found

In the heavy baseline, the measured solver phase distribution was dominated by:

- shear: 20.039 ms, 38.20%;
- stretch: 15.835 ms, 30.18%;
- bend: 13.915 ms, 26.52%;
- seams: 2.288 ms, 4.36%.

Integration, velocity update and validation together were below 1% of the baseline step. Worker transport was therefore not the primary bottleneck.

## Changes

The distance/stretch/bend kernels now operate directly on their TypedArrays and compute correction caps with scalar values instead of allocating temporary tuple arrays per constraint.

The shear kernel keeps its vectors and gradient magnitudes as scalar locals. It removes temporary u/v/g0/g1/g2 arrays, repeated helper calls and correction-entry allocations from the inner loop.

The seam kernel computes interpolated endpoints and the at-most-four material gradient entries in scalar locals. It removes the per-constraint Map, intermediate arrays, map/filter passes and normal tuple while preserving merged coefficients for repeated particle references.

The benchmark/profiler records phase timings and worker-level physicsStepMs without changing solver parameters. Worker output buffers and transferable-frame recycling remain unchanged.

## Physical equivalence

The heavy deterministic scene retained seamMeanError and seamMaxError to floating-point noise. The optimized run reported seamMeanError approximately 8.320920e-10 m and seamMaxError approximately 2.338294e-9 m, matching the baseline at practical precision.

Canonical XPBD scenes, seam interpolation/composite relationships, tube assembly integration, rebuild behavior and Prompt 10.3 initial-seam-residual regressions passed after the optimized kernels were applied. Deterministic inputs remain deterministic.

No solver iterations, substeps, mesh density, compliances, trust regions or physical constraints were reduced to obtain the result.

## Optimized heavy-scene phase medians

| Phase | Baseline | Optimized |
| --- | ---: | ---: |
| integration | 0.032 ms | 0.033 ms |
| stretch | 15.835 ms | 2.964 ms |
| shear | 20.039 ms | 4.753 ms |
| bend | 13.915 ms | 2.521 ms |
| seams | 2.288 ms | 0.285 ms |
| velocity update | 0.239 ms | 0.234 ms |
| validation | 0.080 ms | 0.086 ms |

## Decision after 10.4-A

A separate reduced physics mesh is not implemented in this recovery. The optimized heavy fixture is already near 11 ms median per physics step on the CI runner, so a 10.4-B mesh-resolution change should remain a separate decision after real garment assembly and manual measurement.

## Validation

Finalization runs typecheck, the deterministic performance fixture, focused XPBD/Worker regressions, the full JavaScript test suite, fallback build and git diff checks before publishing the implementation to the recovery branch.
