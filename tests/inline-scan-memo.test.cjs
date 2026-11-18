"use strict";

// The inline scan memo answers exactly what a fresh scan would: nextIndexOf as
// indexOf for positions asked in any order, closing brackets as a depth scan,
// and nothing remembered outside a scan of the same text.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");
const { createRandom } = require("./support/seededRandom.cjs");

const M = loadMarkengine("markdown/inlineScanMemo.ts");
const NEEDLES = ["]", ">", "-->", "[/color]", "a"];

function randomText(random, alphabet, length) {
  let text = "";
  while (text.length < length) text += alphabet[Math.floor(random() * alphabet.length)];
  return text;
}

function withScan(text, body) {
  const outer = M.enterScan(text);
  try {
    body();
  } finally {
    M.leaveScan(outer);
  }
}

// Rising positions hit the memo; random ones also replace it.
function positions(random, text, rising) {
  const asked = Array.from({ length: 40 }, () => Math.floor(random() * (text.length + 2)));
  return rising ? asked.sort((left, right) => left - right) : asked;
}

test("nextIndexOf answers as indexOf, for rising and for random positions", () => {
  const random = createRandom(0x5ca11ed);
  for (let round = 0; round < 400; round++) {
    const text = randomText(random, ["a", "b", "]", ">", "-->", "[/color]", " "], 1 + Math.floor(random() * 80));
    withScan(text, () => {
      for (const from of positions(random, text, round % 2 === 0)) {
        const needle = NEEDLES[Math.floor(random() * NEEDLES.length)];
        assert.strictEqual(M.nextIndexOf(text, needle, from), text.indexOf(needle, from), `${JSON.stringify(text)} ${needle} @${from}`);
      }
    });
  }
});

// The parser's own definition: depth counted from the opener until it is back to 0.
function closingByDepth(text, openPos) {
  let depth = 0;
  for (let index = openPos; index < text.length; index++) {
    if (text[index] === "[") depth++;
    else if (text[index] === "]" && --depth === 0) return index;
  }
  return -1;
}

test("findClosingBracket matches a depth scan from every opener, in a scan or not", () => {
  const random = createRandom(0xb7ac4e75);
  for (let round = 0; round < 300; round++) {
    const text = randomText(random, "[[]]x ", Math.floor(random() * 60));
    const openers = [...text].flatMap((char, index) => (char === "[" ? [index] : []));
    const expected = openers.map((open) => closingByDepth(text, open));
    assert.deepStrictEqual(openers.map((open) => M.findClosingBracket(text, open)), expected, text);
    withScan(text, () => {
      assert.deepStrictEqual(openers.map((open) => M.findClosingBracket(text, open)), expected, text);
    });
  }
});

test("unclosable openers are kept per scan and per marker, and restored on leave", () => {
  withScan("*a _b", () => {
    M.unclosableOpeners("*a _b", "*").add(0);
    assert.ok(M.unclosableOpeners("*a _b", "*").has(0));
    assert.strictEqual(M.unclosableOpeners("*a _b", "_").size, 0, "per marker");
    withScan("a _b", () => assert.strictEqual(M.unclosableOpeners("a _b", "*").size, 0, "an inner scan starts empty"));
    assert.ok(M.unclosableOpeners("*a _b", "*").has(0), "the outer scan is back");
  });
  M.unclosableOpeners("*a _b", "*").add(0);
  assert.strictEqual(M.unclosableOpeners("*a _b", "*").size, 0, "outside a scan nothing is remembered");
});
