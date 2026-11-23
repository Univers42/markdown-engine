"use strict";

// Line corpora for output pins: every line of up to n tokens over an alphabet, and
// seeded longer lines. inlineCorpus() is the one tests/source-inline-linear.test.cjs
// pinned renderSource's output over: every line of up to 4 tokens over
// INLINE_TOKENS (111,151 lines), and seeded longer lines over SEEDED_TOKENS.
const { createRandom } = require("./seededRandom.cjs");

const INLINE_TOKENS = ["[", "]", "(", ")", "`", "``", "```", "*", "_", "~", "<", "!", "\\", "\u2028", " ",
  "a", "x", "X"];
const SEEDED_TOKENS = [...INLINE_TOKENS, "**", "~~", "![", "](", "[ ]", "[x]", "[X]", "[a](b)", "![a](b)",
  "`c`", "*e*", "**s**", "~~t~~", "[[page:", "\u2029", "\t", "\""];

function everyLine(tokens, maxTokens) {
  let level = [""];
  let lines = [""];
  for (let length = 1; length <= maxTokens; length++) {
    level = level.flatMap((prefix) => tokens.map((token) => prefix + token));
    lines = lines.concat(level);
  }
  return lines;
}

function seededLines(tokens, { seed, count, minTokens, maxTokens }) {
  const random = createRandom(seed);
  const lines = [];
  for (let index = 0; index < count; index++) {
    const length = minTokens + Math.floor(random() * (maxTokens - minTokens + 1));
    let line = "";
    for (let token = 0; token < length; token++) line += tokens[Math.floor(random() * tokens.length)];
    lines.push(line);
  }
  return lines;
}

function inlineCorpus() {
  return {
    exhaustive: everyLine(INLINE_TOKENS, 4),
    seeded: [
      ...seededLines(SEEDED_TOKENS, { seed: 240, count: 5000, minTokens: 5, maxTokens: 40 }),
      ...seededLines(SEEDED_TOKENS, { seed: 241, count: 300, minTokens: 100, maxTokens: 600 }),
    ],
  };
}

module.exports = { inlineCorpus, everyLine, seededLines };
