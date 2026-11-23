"use strict";

// M240-1 (osionos#240): an ATX heading line and a table delimiter row are matched
// in time linear in the line. The old regexes backtracked quadratically on one long
// line: 13.2 s for a 128 KiB heading line, 8.0 s for a 128 KiB delimiter-like line.
//
// fixtures/block-line-pins.json holds each input with the exact parse() output the
// regex parser gave at 683be5c, so a linear matcher that changes any output fails.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");
const pins = require("./fixtures/block-line-pins.json");

const { createRandom } = require("./support/seededRandom.cjs");
const { assertLinearGrowth } = require("./support/linearity.cjs");

const { parse } = loadMarkengine("index.ts");
const matchers = loadMarkengine("markdown/blockLineMatchers.ts");

test("block line pins: parse() output is unchanged from the regex parser", () => {
  for (const [markdown, expected] of pins) {
    assert.deepEqual(parse(markdown), expected, JSON.stringify(markdown));
  }
});

// The replaced regexes, verbatim, as the oracle. They are quadratic only on long
// lines, so the short generated lines below keep them fast.
const OLD_HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const OLD_CUSTOM_ID = /\s*\{#([A-Za-z0-9_-]+)\}\s*$/;
const OLD_DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function oldHeading(line) {
  const hm = OLD_HEADING.exec(line);
  return hm ? { level: hm[1].length, text: hm[2] } : null;
}

function oldCustomId(text) {
  const match = OLD_CUSTOM_ID.exec(text);
  return match ? { text: text.slice(0, match.index).trimEnd(), id: match[1] } : { text };
}

// Caveat: a sample, not a proof: 20,000 lines of up to 14 tokens per matcher from
// a small alphabet. It covers every character class the regexes distinguish (#, \s
// incl. tab, NBSP and line terminators, pipe, dash, colon, braces, id chars, other),
// so a disagreement needs a longer combination than these generate; the long-line
// test below covers length only for its listed shapes.
function* sampleLines(seed, alphabet) {
  const random = createRandom(seed);
  for (let count = 0; count < 20000; count++) {
    let line = "";
    const length = Math.floor(random() * 15);
    for (let index = 0; index < length; index++) line += alphabet[Math.floor(random() * alphabet.length)];
    yield line;
  }
}

test("block line matchers: matchAtxHeading agrees with the old heading regex", () => {
  const alphabet = ["#", "#", "#", " ", " ", "\t", "\r", "\u00a0", "\u2028", "a", "{", "}", "x"];
  for (const line of sampleLines(240, alphabet)) {
    assert.deepEqual(matchers.matchAtxHeading(line), oldHeading(line), JSON.stringify(line));
  }
});

test("block line matchers: splitHeadingCustomId agrees with the old custom id regex", () => {
  const alphabet = ["{#", "{#", "}", "}", "{", "#", "a", "Z9", "-", "_", " ", "\t", "\u00a0", "!"];
  for (const text of sampleLines(241, alphabet)) {
    assert.deepEqual(matchers.splitHeadingCustomId(text), oldCustomId(text), JSON.stringify(text));
  }
});

test("block line matchers: isTableDelimiterRow agrees with the old delimiter regex", () => {
  const alphabet = ["|", "|", "-", "-", "-", ":", " ", "\t", "\r", "\u00a0", "a"];
  for (const line of sampleLines(242, alphabet)) {
    assert.equal(matchers.isTableDelimiterRow(line), OLD_DELIMITER_ROW.test(line), JSON.stringify(line));
  }
});

test("block line matchers: agree with the old regexes on 2 KiB lines", () => {
  const run = " ".repeat(2048);
  const headings = [`# a${run}x`, `# a${run}\rx`, `# a${" #".repeat(1024)}`, `# a${run}#${run}`,
    `## a${run}{#id}${run}`, `#${"\t\u00a0".repeat(1024)}x`, `# a\u2028${run}##`];
  for (const line of headings) {
    const old = oldHeading(line);
    assert.deepEqual(matchers.matchAtxHeading(line), old, line.slice(0, 12));
    if (old) assert.deepEqual(matchers.splitHeadingCustomId(old.text), oldCustomId(old.text));
  }
  const rows = [`---${run}x`, `---${run}|${run}:-:`, "|-".repeat(1024), `${"-|".repeat(1024)}x`,
    ":".repeat(2048), `${" | ".repeat(700)}-`];
  for (const line of rows) {
    assert.equal(matchers.isTableDelimiterRow(line), OLD_DELIMITER_ROW.test(line), line.slice(0, 12));
  }
});

// One long whitespace run per shape, the run where each regex backtracked; the
// growth bound and what it gets wrong are in support/linearity.cjs.
const LONG_LINES = {
  heading_ws: (size) => `# a${" ".repeat(size)}x`,
  heading_ws_cr: (size) => `# a${" ".repeat(size)}\rx`,
  table_sep_ws: (size) => `a|b\n---${" ".repeat(size)}x`,
};

for (const [shape, inputOfSize] of Object.entries(LONG_LINES)) {
  test(`block line linear: ${shape} parse time grows linearly to 64 KiB`, () => {
    assertLinearGrowth(shape, parse, inputOfSize);
  });
}
