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

// An editor hands the parser a new string per keystroke: every render gets its
// own equal-content copy, so a cache keyed by content cannot time a hit.
const freshCopy = (source) => Buffer.from(source, "utf8").toString("utf8");

function batchMs(source, batch, htmlSubset) {
  const copies = Array.from({ length: batch }, () => freshCopy(source));
  const started = performance.now();
  for (const copy of copies) renderOnce(copy, htmlSubset);
  return (performance.now() - started) / batch;
}

// A render under a millisecond is timed as a batch of SAMPLE_MS, so the timer's
// granularity does not decide the ratio. A warm-up past the budget is the answer:
// a quadratic input fails on it instead of being timed RUNS more times.
function fastestMs(source, htmlSubset = true) {
  const warmUp = batchMs(source, 1, htmlSubset);
  if (warmUp > BUDGET_MS) return warmUp;
  const batch = Math.max(1, Math.ceil(SAMPLE_MS / Math.max(warmUp, 0.01)));
  let best = Infinity;
  for (let run = 0; run < RUNS; run++) best = Math.min(best, batchMs(source, batch, htmlSubset));
  return best;
}

function assertLinear(t, name, build, htmlSubset) {
  const small = build(SMALL);
  const large = build(LARGE);
  // Under the cap the parse is never refused (U3-5 class h), so this is the real work.
  assert.ok(Buffer.byteLength(large, "utf8") <= LARGE, "the large input stays under the input cap");
  const smallMs = fastestMs(small, htmlSubset);
  const largeMs = fastestMs(large, htmlSubset);
  const ratio = largeMs / smallMs;
  t.diagnostic(`${name}: 50 KB ${smallMs.toFixed(2)} ms, 200 KB ${largeMs.toFixed(2)} ms, ratio ${ratio.toFixed(2)}`);
  assert.ok(largeMs < BUDGET_MS, `${name}: 200 KB took ${largeMs.toFixed(1)} ms`);
  assert.ok(ratio <= MAX_RATIO, `${name}: 200 KB / 50 KB = ${ratio.toFixed(2)}`);
}

for (const [name, unit] of Object.entries(INPUTS)) {
  test(`U3-6 ${name}: 200 KB renders within ${MAX_RATIO}x the 50 KB time, under ${BUDGET_MS} ms`, (t) => {
    assertLinear(t, name, (bytes) => repeatToBytes(unit, bytes), true);
  });
}

// Markdown spans whose closer scan restarted at every opener (security review,
// 2026-11-18): 200 KB / 50 KB was 15.0-15.8 for the four runs of unclosed
// openers, and the colour and quote nests threw RangeError. With one closer
// scan per inline scan (2026-11-18, same command, plain / subset ratio, 3 runs):
//   colour nest 3.90-3.91 / 3.90-3.95       emphasis openers 4.19-4.33 / 4.17-4.23
//   link of tags 4.20-4.26 / 4.67-4.76      link brackets 4.10-4.17 / 4.04-4.08
//   link of less-thans 4.03-4.06 / 4.60-4.70  quote nest 3.71-3.75 / 3.82-3.86
const SPAN_SHAPES = {
  "colour nest": (bytes) => {
    const depth = Math.floor(bytes / 19);
    return "[color=red]".repeat(depth) + "x" + "[/color]".repeat(depth);
  },
  "emphasis openers": (bytes) => repeatToBytes("*a ", bytes),
  "link of tags": (bytes) => repeatToBytes("[<x ", bytes),
  "link brackets": (bytes) => repeatToBytes("[x ", bytes),
  "link of less-thans": (bytes) => repeatToBytes("[< ", bytes),
  "quote nest": (bytes) => "> ".repeat(Math.floor((bytes - 1) / 2)) + "x",
  // Found after the review by the same probe: 14.3-16.0 at 200 KB / 50 KB, the
  // half-closed nests 12 s (colour) and 88 s (underline). With each closer
  // answer kept for the scan, 3 runs: 4.11-4.49, the subset run of inline tags
  // 4.60-5.24 (the refused tags' text is appended one tag at a time).
  "colour nest, half closed": (bytes) => {
    const depth = Math.floor((bytes - 1) / 15);
    return "[color=red]".repeat(depth) + "x" + "[/color]".repeat(depth >> 1);
  },
  "underline nest, half closed": (bytes) => {
    const depth = Math.floor((bytes - 1) / 5);
    return "[u]".repeat(depth) + "x" + "[/u]".repeat(depth >> 1);
  },
  "colour openers": (bytes) => repeatToBytes("[color=x ", bytes),
  "footnote refs": (bytes) => repeatToBytes("[^a ", bytes),
  "inline tags": (bytes) => repeatToBytes("<b>", bytes),
  "reversed links": (bytes) => repeatToBytes("(a)[b ", bytes),
  "page link ids": (bytes) => repeatToBytes("[[page:a ", bytes),
};

for (const [name, build] of Object.entries(SPAN_SHAPES)) {
  for (const htmlSubset of [false, true]) {
    const label = `${name} (${htmlSubset ? "subset" : "plain"})`;
    test(`U3-6 ${label}: 200 KB renders within ${MAX_RATIO}x the 50 KB time, under ${BUDGET_MS} ms`, (t) => {
      assertLinear(t, label, build, htmlSubset);
    });
  }
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
