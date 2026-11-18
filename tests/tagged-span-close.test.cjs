"use strict";

// findMatchingTaggedClose answers what the depth-counting scan it replaced
// answered, from every start, inside a scan (answers kept) and outside one.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");
const { createRandom } = require("./support/seededRandom.cjs");

const M = loadMarkengine("markdown/taggedSpanClose.ts");
const Memo = loadMarkengine("markdown/inlineScanMemo.ts");
const PIECES = ["[color=", "red", "]", "[/color]", "x", "[u]", "[/u]", "[color=a"];

// The scan before the memo (parserInlineMatchers.ts at e09d947), with indexOf.
function closeByDepth(text, start, tag, hasAttribute) {
  const closeTag = `[/${tag}]`;
  const openTag = hasAttribute ? `[${tag}=` : `[${tag}]`;
  let depth = 1;
  let cursor = start;
  while (cursor < text.length) {
    const close = text.indexOf(closeTag, cursor);
    if (close === -1) return -1;
    const open = text.indexOf(openTag, cursor);
    const bracket = open === -1 || !hasAttribute ? -1 : text.indexOf("]", open + openTag.length);
    const opens = open !== -1 && open < close && (!hasAttribute || bracket !== -1);
    if (opens) {
      depth += 1;
      cursor = hasAttribute ? bracket + 1 : open + openTag.length;
    } else if (--depth === 0) {
      return close;
    } else {
      cursor = close + closeTag.length;
    }
  }
  return -1;
}

function randomText(random) {
  let text = "";
  const pieces = 1 + Math.floor(random() * 40);
  for (let piece = 0; piece < pieces; piece++) text += PIECES[Math.floor(random() * PIECES.length)];
  return text;
}

function startsIn(random, text) {
  return Array.from({ length: 30 }, () => Math.floor(random() * (text.length + 1)));
}

test("the tagged close equals the depth scan from any start, in a scan or not", () => {
  const random = createRandom(0x7a99ed);
  for (let round = 0; round < 500; round++) {
    const text = randomText(random);
    for (const [tag, hasAttribute] of [["color", true], ["u", false]]) {
      const starts = startsIn(random, text);
      const expected = starts.map((start) => closeByDepth(text, start, tag, hasAttribute));
      const label = `${JSON.stringify(text)} ${tag}`;
      assert.deepStrictEqual(starts.map((start) => M.findMatchingTaggedClose(text, start, tag, hasAttribute)), expected, label);
      const outer = Memo.enterScan(text);
      try {
        assert.deepStrictEqual(starts.map((start) => M.findMatchingTaggedClose(text, start, tag, hasAttribute)), expected, label);
      } finally {
        Memo.leaveScan(outer);
      }
    }
  }
});

test("a deep nest is resolved without recursion", () => {
  const text = "[u]".repeat(100000) + "x" + "[/u]".repeat(100000);
  assert.strictEqual(M.findMatchingTaggedClose(text, 3, "u", false), text.length - 4);
});
