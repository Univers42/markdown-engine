"use strict";

// osionos#240: renderSource's inline scanner rebuilt seven regexes per token and
// each rescanned to the end of the line, and the image and link patterns read to
// the end from every "[" without a "]": 0.3-1.6 s on a 64 KiB line at 1202d23.
// The old scanner is kept verbatim below as the oracle for src/source-inline-tokens.ts;
// fixtures/source-inline-pins.json holds the sha256 of renderSource's output over
// the shared corpus at 1202d23 (rows would be ~25 MB) and a few readable rows.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");
const { assertLinearGrowth } = require("./support/linearity.cjs");
const { inlineCorpus } = require("./support/inlineCorpus.cjs");
const pins = require("./fixtures/source-inline-pins.json");

const { inlineTokens } = loadMarkengine("src/source-inline-tokens.ts");
const { renderSource } = loadMarkengine("markdown.ts");

const OLD_INLINE_TOKEN_PATTERNS = [
  /`[^`]*`/,
  /\*\*[^*]+\*\*/,
  /\*[^*]+\*/,
  /~~[^~]+~~/,
  /!\[[^\]]*\]\([^)]+\)/,
  /\[[^\]]+\]\([^)]+\)/,
  /\[[ xX]\]/,
];

function oldNextInlineToken(line, fromIndex) {
  let bestIndex = Number.POSITIVE_INFINITY;
  let bestToken = "";
  for (const pattern of OLD_INLINE_TOKEN_PATTERNS) {
    const search = new RegExp(pattern.source, "g");
    search.lastIndex = fromIndex;
    const match = search.exec(line);
    if (!match) continue;
    if (match.index < bestIndex) {
      bestIndex = match.index;
      bestToken = match[0];
    }
  }
  return Number.isFinite(bestIndex) ? { index: bestIndex, token: bestToken } : null;
}

function oldInlineTokens(line) {
  const tokens = [];
  let cursor = 0;
  while (cursor < line.length) {
    const match = oldNextInlineToken(line, cursor);
    if (!match) break;
    tokens.push(match);
    cursor = match.index + match.token.length;
  }
  return tokens;
}

const corpus = inlineCorpus();

test("source inline tokens: agree with the old per-token scanner on the corpus", () => {
  for (const lines of Object.values(corpus)) {
    for (const line of lines) assert.deepEqual(inlineTokens(line), oldInlineTokens(line), JSON.stringify(line));
  }
});

function renderDigest(lines) {
  const hash = createHash("sha256");
  for (const line of lines) hash.update(renderSource(line)).update("\0");
  return hash.digest("hex");
}

test("source inline pins: renderSource output is unchanged from 1202d23", () => {
  for (const [name, lines] of Object.entries(corpus)) {
    assert.equal(lines.length, pins[name].lines, `${name} corpus size`);
    assert.equal(renderDigest(lines), pins[name].sha256, `${name} digest`);
  }
  for (const [source, expected] of pins.rows) assert.equal(renderSource(source), expected, JSON.stringify(source));
});

const rep = (unit, size) => unit.repeat(Math.floor(size / unit.length));
const LONG_LINES = {
  open_brackets: (size) => `a ${rep("[ ", size)}`,
  backtick_run: (size) => `a${rep("`", size)}`,
  image_openers: (size) => rep("![", size),
  unclosed_link_parens: (size) => rep("[a](", size),
  // Cubic at 1202d23 (7.4 ms at 1 KiB, 373 ms at 4 KiB): every task box rescanned
  // the link pattern, which read to the end from every "[".
  task_boxes_before_unclosed_parens: (size) => rep("[x](", size),
  titled_image_openers: (size) => rep("![a](b ", size),
  code_spans_over_one_label: (size) => `${rep("`[`", size)}](u)`,
  strong_openers: (size) => rep("**a", size),
  emphasis_openers: (size) => rep("*a", size),
  strike_openers: (size) => rep("~~a", size),
  task_boxes: (size) => rep("[x]", size),
  links: (size) => rep("[a](b)", size),
  code_span_pairs: (size) => rep("` ", size),
  page_link_openers: (size) => rep("[[page:", size),
};

for (const [shape, inputOfSize] of Object.entries(LONG_LINES)) {
  test(`source inline linear: ${shape} time grows linearly to 64 KiB`, () => {
    assertLinearGrowth(shape, renderSource, inputOfSize);
  });
}
