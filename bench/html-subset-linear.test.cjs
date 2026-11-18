"use strict";

// U3-6: the README HTML subset renders in linear time. Each input is parsed and
// rendered at 50 KB and at 200 KB (the subset's input cap); the 200 KB time must
// stay within 5x the 50 KB time (4x is linear) and inside the same absolute
// budget as emphasis-runs. Each time is the fastest of RUNS, after one warm-up,
// so a GC pause or a JIT tier-up does not decide the ratio.
//
// Measured 2026-11-17, node 22, docker --network none, `node --test
// bench/html-subset-linear.test.cjs` (fastest of 7 batches, ms at 50 KB -> 200 KB):
//   readme 4.09 -> 9.74 (2.38x, the 5,000-element cap turns the rest to text)
//   div soup 1.91 -> 7.88 (4.14x)        stray closers 0.62 -> 2.27 (3.66x)
//   no closing > 2.22 -> 9.15 (4.11x)    unclosed quote 2.01 -> 8.12 (4.05x)
//   entity soup 1.80 -> 7.17 (3.99x)     comment opens 0.14 -> 0.58 (4.10x)
//   less-than soup 6.18 -> 25.33 (4.10x) attribute soup 3.38 -> 13.61 (4.02x)
// Caveat: a wall-clock ratio. A 50 KB time under a few ms makes the ratio noisy
// (timer and GC granularity), so a flake here is re-run once before it is read
// as quadratic; a real O(n^2) shows as ~16x, far past the 5x line.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengineInRealm } = require("../tests/support/loadMarkengine.cjs");

const E = loadMarkengineInRealm("index.ts");
const R = loadMarkengineInRealm("react.tsx");
const BUDGET_MS = 3000;
const MAX_RATIO = 5;
const RUNS = 7;
const SAMPLE_MS = 20;
const SMALL = 50 * 1024;
const LARGE = 200 * 1024;

const README_UNIT = [
  '<div align="center">',
  '  <img src="https://a.io/banner.png" width="100%" alt="banner"/>',
  '  <h1 align="center">Hi &amp; welcome</h1>',
  "</div>",
  "",
  "## Stack",
  "",
  '<table><tr><td align="center" width="50%">',
  "",
  "**C** and [docs](https://a.io/d) &mdash; <kbd>Ctrl</kbd>+<kbd>K</kbd>",
  "",
  "```c",
  "int main(void) { return 0; }",
  "```",
  "",
  '</td><td valign="top"><img src="https://a.io/x.svg" height="20"/> <sub>v1</sub></td></tr></table>',
  "",
  "<details><summary>More</summary>",
  "",
  "- one <b>two</b>",
  "- <a href=\"https://a.io/\" title=\"t\">three</a>",
  "",
  "</details>",
  "<!-- a comment -->",
  "",
].join("\n");

// Adversarial shapes from the U3-5 structure class: what an O(n^2) tokenizer or
// a rescanning block parser chokes on.
const INPUTS = {
  readme: README_UNIT,
  "div soup": "<div>",
  "stray closers": "</div>",
  "no closing >": '<img src="https://a.io/x.png" alt="',
  "unclosed quote": '<a href="https://a.io/ title=x>t</a> ',
  "entity soup": '<a href="https://a.io/&#x41;&amp;" title="&amp;&#x41;&#106&colon;&Tab;&bogus &">&lt;&#65;</a> ',
  "comment opens": "<!-- x ",
  "less-than soup": "a < b <c <",
  "attribute soup": '<p align="left" align=right x="y" onclick="z" ',
};

function repeatToBytes(unit, bytes) {
  const copies = Math.floor(bytes / Buffer.byteLength(unit, "utf8"));
  return unit.repeat(Math.max(copies, 1));
}

function renderOnce(source, htmlSubset = true) {
  if (!htmlSubset) return void R.renderReact(E.parse(source));
  R.renderReact(E.parse(source, { htmlSubset: true }), { htmlSubset: { mediaPrefixes: [] } });
}

function batchMs(source, batch) {
  const started = performance.now();
  for (let index = 0; index < batch; index++) renderOnce(source);
  return (performance.now() - started) / batch;
}

// A render under a millisecond is timed as a batch of SAMPLE_MS, so the timer's
// granularity does not decide the ratio.
function fastestMs(source) {
  const batch = Math.max(1, Math.ceil(SAMPLE_MS / Math.max(batchMs(source, 1), 0.01)));
  let best = Infinity;
  for (let run = 0; run < RUNS; run++) best = Math.min(best, batchMs(source, batch));
  return best;
}

for (const [name, unit] of Object.entries(INPUTS)) {
  test(`U3-6 ${name}: 200 KB renders within ${MAX_RATIO}x the 50 KB time, under ${BUDGET_MS} ms`, (t) => {
    const small = repeatToBytes(unit, SMALL);
    const large = repeatToBytes(unit, LARGE);
    // Under the cap the parse is never refused (U3-5 class h), so this is the real work.
    assert.ok(Buffer.byteLength(large, "utf8") <= LARGE, "the large input stays under the input cap");
    const smallMs = fastestMs(small);
    const largeMs = fastestMs(large);
    const ratio = largeMs / smallMs;
    t.diagnostic(`${name}: 50 KB ${smallMs.toFixed(2)} ms, 200 KB ${largeMs.toFixed(2)} ms, ratio ${ratio.toFixed(2)}`);
    assert.ok(largeMs < BUDGET_MS, `${name}: 200 KB took ${largeMs.toFixed(1)} ms`);
    assert.ok(ratio <= MAX_RATIO, `${name}: 200 KB / 50 KB = ${ratio.toFixed(2)}`);
  });
}

// Both overflowed the call stack (RangeError) before the nesting budget; the
// colour run took 160-178 s to get there (logs/shapes-rebased.log, 2026-11-18).
const DEEP_INPUTS = {
  "quote x2000 (4 KB)": "> ".repeat(2000) + "x",
  "colour x5000": "[color=red]".repeat(5000) + "x" + "[/color]".repeat(5000),
};

for (const [name, source] of Object.entries(DEEP_INPUTS)) {
  test(`U3-6 ${name} parses and renders without throwing`, () => {
    for (const htmlSubset of [false, true]) renderOnce(source, htmlSubset);
  });
}
