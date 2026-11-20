"use strict";

// ADR 0068 D6: ONE bundle for the whole guard. index.ts and react.tsx loaded
// as two bundles made two copies of markdown/scanSteps.ts, and the steps split
// between the counters; the bench-only bench/scanEntry.ts puts parse, render
// and the counter in one module instance, so readSteps() below is the whole
// render's counted work.
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { loadMarkengineInRealm } = require("../tests/support/loadMarkengine.cjs");

const E = loadMarkengineInRealm("bench/scanEntry.ts");

// resetSteps -> parse+render -> readSteps: the counted work of one first render.
function renderOnce(source, htmlSubset = true) {
  E.resetSteps();
  if (!htmlSubset) E.renderReact(E.parse(source));
  else E.renderReact(E.parse(source, { htmlSubset: true }), { htmlSubset: { mediaPrefixes: [] } });
  return E.readSteps();
}

const CACHE_DIR = join(__dirname, "..", "node_modules", ".cache", "loadMarkengine");

// The outfile the loader picked for THIS process (its pid names the bundle, as
// tests/support/loadMarkengine.cjs writes it). The digest lets the test hold
// every worker to one bundle (D6): a stale or split bundle shows as two digests.
function bundleEvidence() {
  const file = join(CACHE_DIR, `bench_scanEntry_ts.${process.pid}.cjs`);
  return { file, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") };
}

module.exports = { renderOnce, bundleEvidence };
