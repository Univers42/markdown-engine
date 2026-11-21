"use strict";

// osionos#321: inline parse work grows linearly with the text. Work is counted
// steps (markdown/scanSteps.ts), never wall clock, so a result is the same on an
// idle laptop and a loaded runner. Each shape is parsed once at 32K and once at
// 128K characters, plain and with the HTML subset on: four times the text may
// cost at most RATIO_LIMIT times the steps.
//
// RATIO_LIMIT = 4.5 (devil ruling on #321, IM2). At engine 9ff30b1 the linear
// shapes read 4.00, "<" x n then ">" read 16.00 (plain) and "[a](" x n 15.99.
//
// Caveat: only counted sites are counted, and a regex counts its matched span,
// never its backtracking. The email shape read 4.00 at 9ff30b1 while its time
// grew 16x, so its test guards the linear check that replaced the regex, not the
// regex itself. The random units are a seeded sample of short repeated shapes,
// not a proof over all inputs.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");
const { createRandom } = require("./support/seededRandom.cjs");

const E = loadMarkengine("tests/support/inlineStepsEntry.ts");
const SMALL = 32 * 1024;
const LARGE = 128 * 1024;
const RATIO_LIMIT = 4.5;
const MODES = [false, true];

function repeatTo(length, unit, tail = "") {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length - tail.length) + tail;
}

const SHAPES = {
  '"<" x n then ">"': (length) => repeatTo(length, "<", ">"),
  'email autolink, "b." x n then " >"': (length) => "<a@" + repeatTo(length, "b.", " >").slice(3),
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

// Short units over the characters that open or end the spans these matchers
// look for, each repeated to 32K and 128K.
const UNIT_ALPHABET = ["<", "[", "(", "@", ".", "*", "_", "a", " ", ">", "]", ")"];

function randomUnit(random) {
  let unit = "";
  const length = 1 + Math.floor(random() * 6);
  while (unit.length < length) unit += UNIT_ALPHABET[Math.floor(random() * UNIT_ALPHABET.length)];
  return unit;
}

test(`seeded random units over <[(@.*_: steps 128K / 32K within ${RATIO_LIMIT}x`, (t) => {
  const random = createRandom(0x321);
  for (let round = 0; round < 24; round++) {
    const unit = randomUnit(random);
    for (const htmlSubset of MODES) {
      assertLinear(t, `${JSON.stringify(unit)} (${htmlSubset ? "subset" : "plain"})`, (length) => repeatTo(length, unit), htmlSubset);
    }
  }
});

// The plain "<" autolink before osionos#321, restricted to content with no
// whitespace or "<" (the close search now stops there, so such text is no link).
const OLD_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function expectedAutolink(inner) {
  if (/[\s<>]/.test(inner)) return null;
  if (/^https?:\/\//.test(inner)) return inner;
  return OLD_EMAIL.test(inner) ? `mailto:${inner}` : null;
}

function autolinkHref(nodes, inner) {
  const [node] = nodes;
  if (nodes.length !== 1 || node.type !== "link") return null;
  return node.children.length === 1 && node.children[0].value === inner ? node.href : null;
}

test("a plain <…> is an autolink exactly when the old URL or email rule holds and nothing stops the scan", () => {
  const random = createRandom(0xe3a11);
  const alphabet = ["a", "b", "@", ".", "http://", "https://", " ", "<", "\t", "..", "@@"];
  for (let round = 0; round < 600; round++) {
    let inner = "";
    const parts = Math.floor(random() * 8);
    for (let part = 0; part < parts; part++) inner += alphabet[Math.floor(random() * alphabet.length)];
    const nodes = parseOnce(`<${inner}>`, false);
    assert.strictEqual(autolinkHref(nodes, inner), expectedAutolink(inner), JSON.stringify(inner));
  }
});
