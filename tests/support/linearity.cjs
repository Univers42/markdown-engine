"use strict";

// Linearity by ratio, not by wall clock: a run at 64 KiB against the same run at
// 8 KiB, in the same process and the same load window, so a slow machine slows
// both sides. 8x the input costs ~8x when linear and ~64x when quadratic; the
// bound sits at 32x (4x the linear cost per byte).
//
// Caveat: two timings, not a complexity proof. A load spike that hits every 64 KiB
// round and no 8 KiB round fails a linear run (false failure); interleaving the
// rounds and keeping each side's best makes that need five spikes in a row. Below
// the floor the ratio is not checked, so a fast enough super-linear scan passes
// (under-report): at 64 KiB it is then under 20 ms anyway. A growth between 4x and
// 8x per byte (n log n and worse-but-sub-quadratic shapes) passes. Measured
// 2026-11-23 in node:22 on the six `\s*(.*)$` shapes at 7c07e5f: 19-21 ms at 8 KiB,
// 1,206-1,367 ms at 64 KiB (62-66x), so a quadratic scan clears the 32x bound by
// only ~2x; linear code here is under 1 ms at 64 KiB, 20x below the floor.
const assert = require("node:assert/strict");

const SMALL_BYTES = 8 * 1024;
const LARGE_BYTES = 64 * 1024;
const PER_BYTE_GROWTH_BOUND = 4;
const FLOOR_MS = 20;
const ROUNDS = 5;

function elapsedMs(run, input) {
  const started = performance.now();
  run(input);
  return performance.now() - started;
}

/** Fails when `run(inputOfSize(64 KiB))` costs more than 32x `run(inputOfSize(8 KiB))`. */
function assertLinearGrowth(label, run, inputOfSize) {
  const small = inputOfSize(SMALL_BYTES);
  const large = inputOfSize(LARGE_BYTES);
  run(inputOfSize(1024));
  let smallMs = Infinity;
  let largeMs = Infinity;
  for (let round = 0; round < ROUNDS; round++) {
    smallMs = Math.min(smallMs, elapsedMs(run, small));
    largeMs = Math.min(largeMs, elapsedMs(run, large));
  }
  const boundMs = Math.max(FLOOR_MS, smallMs * (LARGE_BYTES / SMALL_BYTES) * PER_BYTE_GROWTH_BOUND);
  assert.ok(largeMs < boundMs,
    `${label}: ${largeMs.toFixed(2)} ms at 64 KiB vs ${smallMs.toFixed(2)} ms at 8 KiB, bound ${boundMs.toFixed(2)} ms`);
}

module.exports = { assertLinearGrowth };
