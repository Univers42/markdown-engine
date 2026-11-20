"use strict";

// One first render per worker (R1): no JIT-warm state and no memoised scan
// crosses a probe. The done message carries the counted steps and the bundle
// digest beside the time — steps are the gate; ms and the digest are evidence.
const { parentPort } = require("node:worker_threads");
const { renderOnce, bundleEvidence } = require("./html-subset-render.cjs");

parentPort.postMessage({ type: "ready" });
parentPort.once("message", ({ source, htmlSubset }) => {
  const started = performance.now();
  const steps = renderOnce(source, htmlSubset);
  parentPort.postMessage({ type: "done", ms: performance.now() - started, steps, bundle: bundleEvidence() });
});
