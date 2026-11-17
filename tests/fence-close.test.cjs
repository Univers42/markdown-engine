"use strict";

// keepEmptyParagraphs turns extra blank lines into empty paragraphs, except inside
// a fence. A fence closes only on a run at least as long as its opener (CommonMark),
// so a 3-backtick line inside a 4-backtick block is content, and its blanks are too.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");

const { parseMarkdownToBlocks } = loadMarkengine("blocks.ts");

const inner = (mark) => [`${mark}c`, "int a;", "", "", "int b;", mark, "", "", "tail"].join("\n");

for (const mark of ["```", "~~~"]) {
  test(`blanks inside a ${mark}${mark[0]} fence holding a ${mark} fence stay code`, () => {
    const INNER = inner(mark);
    const source = [`${mark}${mark[0]}md`, INNER, `${mark}${mark[0]}`].join("\n");
    const blocks = parseMarkdownToBlocks(source, { keepEmptyParagraphs: true });
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "code");
    assert.equal(blocks[0].content, INNER);
  });
}

test("a fence still closes on a run longer than its opener", () => {
  const source = ["```", "a", "", "", "b", "`````", "", "", "after"].join("\n");
  const blocks = parseMarkdownToBlocks(source, { keepEmptyParagraphs: true });
  assert.equal(blocks[0].type, "code");
  assert.equal(blocks[0].content, "a\n\n\nb");
  assert.deepEqual(Array.from(blocks.slice(1), (block) => [block.type, block.content]), [
    ["paragraph", ""],
    ["paragraph", "after"],
  ]);
});

test("a reference definition inside a 4-backtick fence stays code", () => {
  const { parse } = loadMarkengine("index.ts");
  const INNER = ["```", "[x]: https://example.com", "```"].join("\n");
  const blocks = parse(["````md", INNER, "````", "", "[x]"].join("\n"));
  assert.equal(blocks[0].type, "code_block");
  assert.equal(blocks[0].value, INNER);
  assert.equal(blocks[1].children[0].type, "text");
});
