"use strict";

// A run of unclosed openers ("*a *a *a …") made every candidate rescan the rest
// of the text for "\\" and "`". On node 22, "*a "×10000 and "_a "×10000 took
// 45831 ms each at 4269ee92 and 754 / 728 ms with the scan cached. Each opener
// still scans to the end, so the parse stays quadratic; the budget only catches
// the cubic one coming back. A wall-clock budget, so it lives here and not in
// tests/: under c8 coverage the same parse takes 6-7 s.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengineInRealm } = require("../tests/support/loadMarkengine.cjs");

const E = loadMarkengineInRealm();
const BUDGET_MS = 3000;

for (const opener of ["*a ", "_a "]) {
  test(`${JSON.stringify(opener)}×10000 parses inside ${BUDGET_MS} ms`, () => {
    const source = `${opener.repeat(10000)}x`;
    const started = performance.now();
    E.parse(source);
    const took = Math.round(performance.now() - started);
    assert.ok(took < BUDGET_MS, `${JSON.stringify(opener)}×10000 took ${took} ms`);
  });
}
