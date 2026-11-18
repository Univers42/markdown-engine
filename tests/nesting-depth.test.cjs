"use strict";

// U3-6: block and inline nesting share one depth budget; past it the source is
// kept as text, so a deep input renders instead of overflowing the call stack.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");

const E = loadMarkengine("index.ts");
const R = loadMarkengine("react.tsx");
const { MAX_NESTING_DEPTH } = loadMarkengine("markdown/nestingDepth.ts");
const MODES = { plain: undefined, subset: { htmlSubset: true } };

// The node types down the first-child chain, and the leaf it ends on.
function firstChildChain(node) {
  const types = [];
  while (node.children?.length) {
    types.push(node.type);
    node = node.children[0];
  }
  return { types, leaf: node };
}

const count = (types, type) => types.filter((each) => each === type).length;

// The most nodes of one type on any root-to-leaf path.
function deepestRun(node, type) {
  const below = Math.max(0, ...(node.children ?? []).map((child) => deepestRun(child, type)));
  return below + (node.type === type ? 1 : 0);
}

for (const [mode, options] of Object.entries(MODES)) {
  test(`${mode}: a quote nested 2,000 deep stops at the budget and keeps the rest as text`, () => {
    const blocks = E.parse("> ".repeat(2000) + "x", options);
    const { types, leaf } = firstChildChain(blocks[0]);
    assert.strictEqual(count(types, "blockquote"), MAX_NESTING_DEPTH);
    assert.deepStrictEqual(leaf, { type: "text", value: "> ".repeat(2000 - MAX_NESTING_DEPTH) + "x" });
    assert.ok(R.renderReact(blocks).length > 0);
  });

  test(`${mode}: a list nested 100 deep stops at the budget`, () => {
    const markdown = Array.from({ length: 100 }, (_, level) => "  ".repeat(level) + "- x").join("\n");
    assert.strictEqual(deepestRun(E.parse(markdown, options)[0], "list_item"), MAX_NESTING_DEPTH);
  });

  test(`${mode}: a colour run nested 200 deep keeps its inner source as text`, () => {
    const blocks = E.parse("[color=red]".repeat(200) + "x" + "[/color]".repeat(200), options);
    const { types, leaf } = firstChildChain(blocks[0]);
    const spans = types.length - 1;
    assert.strictEqual(spans, MAX_NESTING_DEPTH - 1, "the paragraph is one level, its spans the rest");
    const rest = 200 - spans;
    assert.deepStrictEqual(leaf, { type: "text", value: "[color=red]".repeat(rest) + "x" + "[/color]".repeat(rest) });
  });
}
