"use strict";

// osionos#321: inline parse work grows linearly with the text. Work is counted
// steps (markdown/scanSteps.ts), never wall clock, so a result is the same on an
// idle laptop and a loaded runner. Each shape is parsed once at 32K and once at
// 128K characters, plain and with the HTML subset on: four times the text may
// cost at most RATIO_LIMIT times the steps.
//
// RATIO_LIMIT = 4.5 (devil ruling on #321, IM2). At engine 9ff30b1 the linear
// shapes read 4.00 and "[a](" x n 15.99.
//
// Caveat: only counted sites are counted, and a regex counts its matched span,
// never its backtracking.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");

const E = loadMarkengine("tests/support/inlineStepsEntry.ts");
const SMALL = 32 * 1024;
const LARGE = 128 * 1024;
const RATIO_LIMIT = 4.5;
const MODES = [false, true];

function repeatTo(length, unit, tail = "") {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length - tail.length) + tail;
}

const SHAPES = {
  'unclosed links "[a](" x n': (length) => repeatTo(length, "[a]("),
  'emphasis openers "*a " x n': (length) => repeatTo(length, "*a "),
  'unclosed "[" x n': (length) => repeatTo(length, "["),
};

function parseOnce(text, htmlSubset) {
  return htmlSubset ? E.runInHtmlSubsetSession(text.length, () => E.parseInline(text)) : E.parseInline(text);
}

function stepsOf(text, htmlSubset) {
  E.resetSteps();
  parseOnce(text, htmlSubset);
  return E.readSteps();
}

function assertLinear(t, label, build, htmlSubset) {
  const small = stepsOf(build(SMALL), htmlSubset);
  const large = stepsOf(build(LARGE), htmlSubset);
  assert.ok(small > 0, `${label}: the counter saw no work at 32K`);
  const ratio = large / small;
  t.diagnostic(`STEPS ${label} 32K=${small} 128K=${large} ratio=${ratio.toFixed(2)}`);
  assert.ok(ratio <= RATIO_LIMIT, `${label}: steps 128K / 32K = ${ratio.toFixed(2)} > ${RATIO_LIMIT}`);
}

for (const [name, build] of Object.entries(SHAPES)) {
  for (const htmlSubset of MODES) {
    const label = `${name} (${htmlSubset ? "subset" : "plain"})`;
    test(`${label}: steps 128K / 32K within ${RATIO_LIMIT}x`, (t) => assertLinear(t, label, build, htmlSubset));
  }
}
