"use strict";

// U3-6: the README HTML subset renders in linear work. Each input is parsed and
// rendered once at 50 KB and at 200 KB (the subset's input cap), each first
// render in a fresh worker thread stopped at DEADLINE_MS (BUDGET_MS plus
// PROBE_SLACK_MS for the message round trip): a render that is too slow, or
// never ends, fails its test naming the input, the size and the deadline
// instead of hanging the job. The linearity gate itself is on counted steps,
// never on wall clock: a render's steps are the characters its native scans
// examined plus its counted loops (markdown/scanSteps.ts), deterministic for
// an input — the same total on an idle laptop and a loaded CI runner — so
// 200 KB / 50 KB staying within T_STEPS says the WORK grew with the size, not
// the seconds. Wall-clock time appears only in the deadline and the MS lines.
//
// Caveat: (a) only counted sites are counted, and the scan census pins counts,
// not bounds, so a wider bound at an existing site passes; (b) regex
// backtracking inside one exec counts as its matched span only (the email
// regex is quadratic and under-counted); (c) renderer, allocation and GC work
// is not counted and is bounded only by the deadline; (d) the MS lines are
// diagnostics, read and never re-run as a gate.
// (e) plain-mode quote nests count nothing at all (UNCOUNTED below): only the
// deadline bounds them.
//
// T_STEPS = 5 (ADR 0068 D9): a linear render measures 4.00-4.03 (length
// ratio 4.00); the slowest caught mutant measures 15.99 (M2', the counted
// rescan) and 16.00 (M1, memo off), so 5 <= 15.99 / 2 = 8.0 keeps both a
// margin over linear and twice the room under quadratic. Measured 2026-11-20,
// three runs per mutant, identical step totals idle and under 20 busy loops.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { Worker } = require("node:worker_threads");

const BUDGET_MS = 3000;
const PROBE_SLACK_MS = 500;
const DEADLINE_MS = BUDGET_MS + PROBE_SLACK_MS;
const PROBE_START_MS = 60000;
const T_STEPS = 5;
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

// The R1 probe: one first render in its own worker, stopped at DEADLINE_MS and
// reporting { timedOut, ms, steps, bundle }. A fresh worker per render, so no
// JIT-warm state and no module cache crosses probes.
function startProbeWorker() {
  const worker = new Worker(path.join(__dirname, "first-render-worker.cjs"));
  let startTimer;
  const ready = new Promise((resolve, reject) => {
    startTimer = setTimeout(() => reject(new Error("first-render worker did not start within 60000 ms")), PROBE_START_MS);
    worker.once("message", (message) => {
      if (message.type === "ready") resolve();
    });
    worker.once("error", reject);
    worker.once("exit", (code) => reject(new Error(`first-render worker exited with code ${code}`)));
  });
  return { worker, ready: ready.finally(() => clearTimeout(startTimer)) };
}

function timeRenderInWorker(worker, source, htmlSubset) {
  let deadlineTimer;
  const timed = new Promise((resolve, reject) => {
    worker.once("message", (message) => {
      if (message.type === "done") resolve({ timedOut: false, ms: message.ms, steps: message.steps, bundle: message.bundle });
    });
    worker.once("error", reject);
    worker.once("exit", (code) => reject(new Error(`first-render worker exited with code ${code}`)));
    worker.postMessage({ source, htmlSubset });
    deadlineTimer = setTimeout(() => resolve({ timedOut: true }), DEADLINE_MS);
  });
  return timed.finally(() => clearTimeout(deadlineTimer));
}

async function probeRender(source, htmlSubset) {
  const { worker, ready } = startProbeWorker();
  try {
    await ready;
    return await timeRenderInWorker(worker, source, htmlSubset);
  } finally {
    await worker.terminate();
  }
}

// One bundle per realm (D6): the first worker's evidence is reported once, and
// every later worker must report the same digest — a second bundle would be a
// second scanSteps instance with the steps split between realms. A mismatch
// fails the test by throwing, so the assert lines stay exactly the gates (a-c),
// the input cap and the DEEP checks.
let firstBundle = null;

function checkBundle(t, bundle) {
  if (firstBundle === null) {
    firstBundle = bundle;
    t.diagnostic(`BUNDLE ${bundle.file} sha256:${bundle.sha256}`);
  } else if (bundle.sha256 !== firstBundle.sha256) {
    throw new Error(`two bundles in one run: ${firstBundle.file} sha256:${firstBundle.sha256}, then ${bundle.file} sha256:${bundle.sha256}`);
  }
}

// Plain-mode quote nests do no counted work: the block-quote strip
// (markdown/parserBlockQuote.ts) is no counted site, and past MAX_NESTING_DEPTH
// the rest is kept as source text with no inline parse (parserBlockContext.ts).
// Subset mode counts them through its UTF-8 cap walk. These labels are held to
// exactly 0 steps, so the day a site starts counting them the gate says so and
// they move back under the ratio; until then the deadline is their only bound.
const UNCOUNTED = new Set(["quote nest (plain)", "quote x2000 (4 KB) (plain)"]);

// Gate (b): the counter saw the work, or saw none at all for an UNCOUNTED label.
function assertCounted(label, ...steps) {
  if (!UNCOUNTED.has(label)) {
    assert.ok(steps.every((n) => n > 0), `${label}: the counter saw no work (steps ${steps.join(", ")}; D6)`);
    return;
  }
  assert.ok(steps.every((n) => n === 0), `${label}: listed UNCOUNTED but counted ${steps.join(", ")} steps; drop it from UNCOUNTED`);
}

// The gates (D7): (a) neither first render passed the deadline; (b) the
// counter saw the work; (c) the 200 KB / 50 KB step ratio stays within
// T_STEPS. No wall-clock ratio, no absolute time budget, anywhere.
async function assertLinear(t, label, build, htmlSubset) {
  const small = build(SMALL);
  const large = build(LARGE);
  // Under the cap the parse is never refused (U3-5 class h), so this is the real work.
  assert.ok(Buffer.byteLength(large, "utf8") <= LARGE, "the large input stays under the input cap");
  const smallProbe = await probeRender(small, htmlSubset);
  const largeProbe = await probeRender(large, htmlSubset);
  assert.ok(!smallProbe.timedOut, `${label}: the 50 KB first render passed its ${DEADLINE_MS} ms deadline (worker stopped)`);
  assert.ok(!largeProbe.timedOut, `${label}: the 200 KB first render passed its ${DEADLINE_MS} ms deadline (worker stopped); 200 KB / 50 KB >= ${(DEADLINE_MS / smallProbe.ms).toFixed(1)}`);
  assertCounted(label, smallProbe.steps, largeProbe.steps);
  checkBundle(t, smallProbe.bundle);
  checkBundle(t, largeProbe.bundle);
  if (UNCOUNTED.has(label)) return t.diagnostic(`STEPS ${label} uncounted (deadline only)`);
  const ratio = largeProbe.steps / smallProbe.steps;
  const lenRatio = Buffer.byteLength(large, "utf8") / Buffer.byteLength(small, "utf8");
  t.diagnostic(`STEPS ${label} small=${smallProbe.steps} large=${largeProbe.steps} ratio=${ratio.toFixed(2)} len=${lenRatio.toFixed(2)}`);
  t.diagnostic(`MS ${label} small=${smallProbe.ms.toFixed(1)} large=${largeProbe.ms.toFixed(1)}`);
  assert.ok(ratio <= T_STEPS, `${label}: steps 200 KB / 50 KB = ${ratio.toFixed(2)} > T_STEPS ${T_STEPS} (length ratio ${lenRatio.toFixed(2)})`);
}

for (const [name, unit] of Object.entries(INPUTS)) {
  test(`U3-6 ${name}: steps 200 KB / 50 KB within ${T_STEPS}x, first renders inside the ${DEADLINE_MS} ms deadline`, async (t) => {
    await assertLinear(t, name, (bytes) => repeatToBytes(unit, bytes), true);
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
  // answer kept for the scan, and a refused tag left in the text run, 3 runs:
  // 3.78-4.47 (the subset run of inline tags was 4.60-5.24 while each refused
  // tag's text was appended on its own).
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
    test(`U3-6 ${label}: steps 200 KB / 50 KB within ${T_STEPS}x, first renders inside the ${DEADLINE_MS} ms deadline`, async (t) => {
      await assertLinear(t, label, build, htmlSubset);
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
  test(`U3-6 ${name} parses and renders without throwing`, async (t) => {
    for (const htmlSubset of [false, true]) {
      const label = `${name} (${htmlSubset ? "subset" : "plain"})`;
      const probe = await probeRender(source, htmlSubset);
      assert.ok(!probe.timedOut, `${label}: the first render passed its ${DEADLINE_MS} ms deadline (worker stopped)`);
      assertCounted(label, probe.steps);
      checkBundle(t, probe.bundle);
    }
  });
}
