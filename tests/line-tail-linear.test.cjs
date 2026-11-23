"use strict";

// osionos#240: five line regexes ended in `\s*(.*)$` or `\s+(.*)$`. `.` cannot match
// a line terminator, so a terminator after the whitespace run made `$` fail once per
// split of the run: ~1.2 s on a 64 KiB line. The toggle and container openers sit on
// parse(); the quoted toggle heading on detectBlockType(), the heading marker on
// renderSource(). Each linear matcher is checked against its old regex, kept
// verbatim below as the oracle; fixtures/line-tail-pins.json holds the public output
// at 7c07e5f.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");
const { createRandom } = require("./support/seededRandom.cjs");
const { assertLinearGrowth } = require("./support/linearity.cjs");
const pins = require("./fixtures/line-tail-pins.json");

const lines = loadMarkengine("markdown/blockLineMatchers.ts");
const kinds = loadMarkengine("markdown/blockKind.ts");
const { renderSource } = loadMarkengine("markdown.ts");
const { detectBlockType } = loadMarkengine("shortcutsDetect.ts");

const OLD_COMPACT_TOGGLE = /^(#{1,6})>\s*(.*)$/;
const OLD_BRACKET_TOGGLE = /^>\s*(?:\[\s*>\s*\]|\[toggle\])\s*(.*)$/i;
const OLD_CONTAINER_OPEN = /^:::\s*([A-Za-z][A-Za-z0-9_-]*)\s*(.*)$/;
const OLD_QUOTED_HEADING_TOGGLE = /^>\s+(#{1,6})\s+(.*)$/;
const OLD_HEADING_MARKER = /^(\s{0,3})(#{1,6})(\s+)(.*)$/;

const PAIRS = [
  ["matchCompactToggle", lines.matchCompactToggle, (line) => {
    const m = OLD_COMPACT_TOGGLE.exec(line);
    return m ? { level: m[1].length, text: m[2] } : null;
  }],
  ["matchBracketToggle", lines.matchBracketToggle, (line) => OLD_BRACKET_TOGGLE.exec(line)?.[1] ?? null],
  ["matchContainerOpen", kinds.matchContainerOpen, (line) => {
    const m = OLD_CONTAINER_OPEN.exec(line);
    return m ? { kind: m[1], params: m[2] } : null;
  }],
  ["matchQuotedHeadingToggle", lines.matchQuotedHeadingToggle, (line) => {
    const m = OLD_QUOTED_HEADING_TOGGLE.exec(line);
    return m ? { level: m[1].length, text: m[2] } : null;
  }],
  ["matchHeadingMarker", lines.matchHeadingMarker, (line) => {
    const m = OLD_HEADING_MARKER.exec(line);
    return m ? { indent: m[1], marker: m[2], space: m[3], text: m[4] } : null;
  }],
];

function assertAgree(line) {
  for (const [name, matcher, oracle] of PAIRS) {
    assert.deepEqual(matcher(line), oracle(line), `${name} ${JSON.stringify(line)}`);
  }
}

// Every string of up to `length` characters over the alphabet, after `prefix`.
function* everyLine(prefix, alphabet, length) {
  yield prefix;
  if (length === 0) return;
  for (const ch of alphabet) yield* everyLine(prefix + ch, alphabet, length - 1);
}

const CHARS = [" ", "\t", "\r", "\u00a0", "\u2028", "#", ">", "[", "]", ":", "a"];

test("line tail matchers: agree with the old regexes on every line of up to 5 characters", () => {
  for (const line of everyLine("", CHARS, 5)) assertAgree(line);
});

test("line tail matchers: agree after each opener prefix, up to 4 more characters", () => {
  const prefixes = ["#>", "######>", "#######>", "> [>]", ">\t[ >\u00a0]", "> [toggle]", "> [TOGGLE]",
    ":::", ":::note", "::: x-1_", "> #", ">\u00a0###", "   #", "    #", "# ", "> [toggle"];
  for (const prefix of prefixes) {
    for (const line of everyLine(prefix, CHARS, 4)) assertAgree(line);
  }
});

// Caveat: a sample, not a proof: 20,000 short and 400 long (50-450 token) lines
// from one token alphabet. The tokens cover every class the regexes distinguish
// (# runs, >, brackets, toggle in mixed case, ::: and word characters, \s members
// incl. line terminators, BOM and the Unicode spaces, and non-\s look-alikes NEL and
// ZWSP), so a disagreement needs a combination these do not generate.
const TOKENS = [" ", " ", "\t", "\v", "\f", "\r", "\n", "\u00a0", "\u1680", "\u2005", "\u2028", "\u2029",
  "\u202f", "\u3000", "\ufeff", "\u0085", "\u200b", "#", "#", "###", ">", "[", "]", "[>]", "[toggle]",
  "[ToGgLe]", ":", ":::", "a", "Z", "9", "-", "_", "{", "}", "x"];

function* sampleLines(seed, count, minTokens, maxTokens) {
  const random = createRandom(seed);
  for (let index = 0; index < count; index++) {
    const length = minTokens + Math.floor(random() * (maxTokens - minTokens + 1));
    let line = "";
    for (let token = 0; token < length; token++) line += TOKENS[Math.floor(random() * TOKENS.length)];
    yield line;
  }
}

test("line tail matchers: agree with the old regexes on seeded random lines", () => {
  for (const line of sampleLines(343, 20000, 0, 14)) assertAgree(line);
  for (const line of sampleLines(344, 400, 50, 450)) assertAgree(line);
});

test("line tail pins: detectBlockType and renderSource output is unchanged from 7c07e5f", () => {
  for (const [line, expected] of pins.detectBlockType) {
    assert.deepEqual(detectBlockType(line), expected, JSON.stringify(line));
  }
  for (const [source, expected] of pins.renderSource) {
    assert.equal(renderSource(source), expected, JSON.stringify(source));
  }
});

const LONG_LINES = {
  detect_quoted_heading_ws_cr: [detectBlockType, (size) => `> #${" ".repeat(size)}a\rb`],
  detect_compact_toggle_ws_cr: [detectBlockType, (size) => `#>${" ".repeat(size)}a\rb`],
  source_heading_ws_ls: [renderSource, (size) => `#${" ".repeat(size)}a\u2028b`],
};

for (const [shape, [run, inputOfSize]] of Object.entries(LONG_LINES)) {
  test(`line tail linear: ${shape} time grows linearly to 64 KiB`, () => {
    assertLinearGrowth(shape, run, inputOfSize);
  });
}
