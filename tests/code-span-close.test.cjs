"use strict";

// osionos#240: the inline code-span matcher measured the backtick run from every
// position in it and searched for a closer of that many backticks, so a run that
// never closes cost its length squared (tests/inline-linear-steps.test.cjs holds
// the shapes). The digests pin parseInline's output at 1202d23, before the
// matcher changed, over every line of up to 5 tokens and seeded longer lines.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");
const { everyLine, seededLines } = require("./support/inlineCorpus.cjs");

const { parseInline } = loadMarkengine("index.ts");

const TOKENS = ["`", "``", "```", "a", " ", "\\", "*", "\n"];
const SEEDED_TOKENS = [...TOKENS, "````", "`a`", "``a``", "[", "](u)", "**"];
const CORPUS = {
  exhaustive: everyLine(TOKENS, 5),
  seeded: seededLines(SEEDED_TOKENS, { seed: 0x240c, count: 3000, minTokens: 6, maxTokens: 80 }),
};
const PINS = {
  exhaustive: { lines: 37449, sha256: "5f5f3f557231518a793c42e2211a71a4a7e2cf45451c1009ddb5a80cc2ac4807" },
  seeded: { lines: 3000, sha256: "548030bf70d786e14bf5e5ad0aa6fb34a094c19602b444dee11be3f3a2c0f832" },
};
// A closer is the first later run of at least the opener's length, and only if
// it has exactly that length: "```a``" closes from its second backtick.
const ROWS = [
  ["a`b`c", [{ type: "text", value: "a" }, { type: "code", value: "b" }, { type: "text", value: "c" }]],
  ["``a``", [{ type: "code", value: "a" }]],
  ["```a``", [{ type: "text", value: "`" }, { type: "code", value: "a" }]],
  ["``a```", [{ type: "text", value: "``a```" }]],
  ["`` ` ``", [{ type: "code", value: "`" }]],
  ["a````", [{ type: "text", value: "a````" }]],
  ["`a``b`", [{ type: "text", value: "`a`" }, { type: "code", value: "b" }]],
  ["\\`a`", [{ type: "text", value: "`a`" }]],
  ["` a `", [{ type: "code", value: "a" }]],
  ["``\na\n``", [{ type: "code", value: "a" }]],
];

const { backtickRunEnd, findCodeSpanClose } = loadMarkengine("markdown/codeSpanClose.ts");

// The matcher's run measure and closer search at 1202d23.
function oldRunAndClose(text, pos) {
  let end = pos;
  while (text[end] === "`") end++;
  const ticks = end - pos;
  const close = text.indexOf("`".repeat(ticks), end);
  return [end, close === -1 || text[close + ticks] === "`" ? -1 : close];
}

test("code span close: agrees with the old run measure and closer search at every backtick", () => {
  const lines = seededLines(["`", "``", "```", "````", "a", "\\"], { seed: 0xc0de, count: 4000, minTokens: 1, maxTokens: 40 });
  for (const line of lines) {
    for (let pos = 0; pos < line.length; pos++) {
      if (line[pos] !== "`") continue;
      const end = backtickRunEnd(line, pos);
      assert.deepEqual([end, findCodeSpanClose(line, end, end - pos)], oldRunAndClose(line, pos), `${JSON.stringify(line)} @${pos}`);
    }
  }
});

function parseDigest(lines) {
  const hash = createHash("sha256");
  for (const line of lines) hash.update(JSON.stringify(parseInline(line))).update("\0");
  return hash.digest("hex");
}

test("code span pins: parseInline output over backtick runs is unchanged from 1202d23", () => {
  for (const [name, lines] of Object.entries(CORPUS)) {
    assert.equal(lines.length, PINS[name].lines, `${name} corpus size`);
    assert.equal(parseDigest(lines), PINS[name].sha256, `${name} digest`);
  }
  for (const [source, expected] of ROWS) assert.deepEqual(parseInline(source), expected, JSON.stringify(source));
});
