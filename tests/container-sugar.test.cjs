"use strict";

// ADR 0064 F2/PS11/PS13: `row | stack | grid | section` read as a column_list, so the
// columns inside keep their structure. With `containerAttributes`, column blocks carry
// their opener's kind and raw attributes for the host; without it, nothing new appears.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");

const { parseMarkdownToBlocks } = loadMarkengine("blocks.ts");
const WITH = { containerAttributes: true };

const shape = (blocks) =>
  blocks.map((block) => [block.type, block.children ? shape(block.children) : block.content]);

const attributesOf = (block) => {
  const { kind, values, dropped } = block.containerAttributes;
  return { kind, values: { ...values }, dropped };
};

const grid = ["::: grid {cols=3 gap=4}", ":::column 0.5 {span=2}", "a", ":::", ":::column", "b", ":::", ":::"].join("\n");

test("a grid wrapping columns is a column list, not orphan columns", () => {
  const blocks = parseMarkdownToBlocks(grid);
  assert.deepEqual(shape(blocks), [
    ["column_list", [["column", [["paragraph", "a"]]], ["column", [["paragraph", "b"]]]]],
  ]);
  assert.equal(blocks[0].children[0].widthRatio, 0.5);
  assert.equal("containerAttributes" in blocks[0], false);
  assert.equal("containerAttributes" in blocks[0].children[0], false);
});

test("with containerAttributes the kind and raw values ride the column blocks", () => {
  const [list] = parseMarkdownToBlocks(grid, WITH);
  assert.deepEqual(attributesOf(list), { kind: "grid", values: { cols: "3", gap: "4" }, dropped: [] });
  assert.equal(Object.getPrototypeOf(list.containerAttributes.values), null);
  assert.deepEqual(attributesOf(list.children[0]), { kind: "column", values: { span: "2" }, dropped: [] });
  assert.equal("containerAttributes" in list.children[1], false);
});

for (const kind of ["row", "stack", "grid", "section"]) {
  test(`::: ${kind} without attributes still reports its kind`, () => {
    const [list] = parseMarkdownToBlocks(`::: ${kind}\n:::column\nx\n:::\n:::`, WITH);
    assert.equal(list.type, "column_list");
    assert.deepEqual(attributesOf(list), { kind, values: {}, dropped: [] });
  });
}

test("blocks between a sugar block's columns become one column per run", () => {
  const source = ["::: section {surface=muted}", "# Title", "", "text", ":::column", "c", ":::", "tail", ":::"].join("\n");
  assert.deepEqual(shape(parseMarkdownToBlocks(source)), [
    ["column_list", [
      ["column", [["heading_1", "Title"], ["paragraph", "text"]]],
      ["column", [["paragraph", "c"]]],
      ["column", [["paragraph", "tail"]]],
    ]],
  ]);
});

test(":::columns and :::column parse as before, attributes or not", () => {
  const source = [":::columns", ":::column 0.25", "a", ":::", ":::column 0.75", "b", ":::", ":::"].join("\n");
  for (const options of [undefined, WITH]) {
    const blocks = parseMarkdownToBlocks(source, options);
    assert.deepEqual(shape(blocks), [
      ["column_list", [["column", [["paragraph", "a"]]], ["column", [["paragraph", "b"]]]]],
    ]);
    assert.deepEqual(Object.keys(blocks[0].children[0]), ["id", "type", "content", "widthRatio", "children"]);
    assert.deepEqual(Object.keys(blocks[0]), ["id", "type", "content", "children"]);
  }
});

test("loose blocks directly in :::columns are not wrapped", () => {
  const blocks = parseMarkdownToBlocks(":::columns\nloose\n:::", WITH);
  assert.deepEqual(shape(blocks), [["column_list", [["paragraph", "loose"]]]]);
});

test("an unknown kind still flattens to its children", () => {
  const blocks = parseMarkdownToBlocks(":::note {a=1}\nx\n:::", WITH);
  assert.deepEqual(shape(blocks), [["paragraph", "x"]]);
});

test("the attribute mode is scoped to one call", () => {
  parseMarkdownToBlocks(grid, WITH);
  assert.equal("containerAttributes" in parseMarkdownToBlocks(grid)[0], false);
});
