"use strict";

// Unclosed `[`×N used to make findClosingBracket re-scan the remainder for every
// opener (quadratic). After the per-parse memo, the first failed scan marks the
// tail and the rest is O(1).
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengineInRealm } = require("../tests/support/loadMarkengine.cjs");

const E = loadMarkengineInRealm();
const BUDGET_MS = 1000;

test(`[×50000 parses inside ${BUDGET_MS} ms`, () => {
  const source = "[".repeat(50000);
  const started = performance.now();
  E.parse(source);
  const took = Math.round(performance.now() - started);
  assert.ok(took < BUDGET_MS, `[×50000 took ${took} ms`);
});

test(`"*a "×10000 still inside 3000 ms (linear after no-close memo)`, () => {
  const source = `${"*a ".repeat(10000)}x`;
  const started = performance.now();
  E.parse(source);
  const took = Math.round(performance.now() - started);
  assert.ok(took < 3000, `*a ×10000 took ${took} ms`);
});
