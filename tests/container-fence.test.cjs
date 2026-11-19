"use strict";

// ADR 0064 F3/PS15: a `:::` line inside fenced code inside a container is code, so it
// neither closes nor opens a container. A fence that never closes protects nothing.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");

const { parseMarkdownToBlocks } = loadMarkengine("blocks.ts");

const columns = (first, second) =>
  [":::columns", ":::column 0.5", ...first, ":::", ":::column 0.5", ...second, ":::", ":::"].join("\n");

const shape = (blocks) =>
  blocks.map((block) => [block.type, block.children ? shape(block.children) : block.content]);

for (const mark of ["```", "~~~", "````"]) {
  test(`a ::: line inside a ${mark} fence inside a column stays code`, () => {
    const code = ["a", ":::", ":::note", "b"].join("\n");
    const blocks = parseMarkdownToBlocks(columns([`${mark}md`, code, mark], ["x"]));
    assert.deepEqual(shape(blocks), [
      ["column_list", [
        ["column", [["code", code]]],
        ["column", [["paragraph", "x"]]],
      ]],
    ]);
  });
}

test("a 3-backtick line inside a 4-backtick fence does not end the protection", () => {
  const code = ["```", ":::", "```"].join("\n");
  const blocks = parseMarkdownToBlocks(columns(["````", code, "````"], ["x"]));
  assert.deepEqual(shape(blocks)[0][1][0], ["column", [["code", code]]]);
});

test("a fence that never closes leaves the container closed by its ::: line", () => {
  const source = [columns(["```", "a"], ["x"]), "", "after"].join("\n");
  const blocks = parseMarkdownToBlocks(source);
  assert.deepEqual(shape(blocks), [
    ["column_list", [
      ["column", [["code", "a"]]],
      ["column", [["paragraph", "x"]]],
    ]],
    ["paragraph", "after"],
  ]);
});

test("a fence outside any container is unchanged", () => {
  const blocks = parseMarkdownToBlocks(["```", ":::", "```"].join("\n"));
  assert.deepEqual(shape(blocks), [["code", ":::"]]);
});

test("many fences that never close inside a container scan in linear time", () => {
  const lines = Array.from({ length: 20000 }, () => "```js");
  const started = performance.now();
  const blocks = parseMarkdownToBlocks([":::columns", ...lines, ":::", "after"].join("\n"));
  const elapsed = performance.now() - started;
  assert.equal(blocks.at(-1).content, "after");
  // Quadratic rescans measure seconds here; the bound leaves room for a loaded runner.
  assert.ok(elapsed < 1000, `${elapsed.toFixed(1)} ms`);
});
