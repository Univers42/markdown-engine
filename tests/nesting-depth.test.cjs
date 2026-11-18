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

// ADR 0062 NC-1: the counter on its own. This bundle of nestingDepth.ts is its
// own module, so no parser moves the counter it tests.
test("the budget lets 32 levels in, refuses the 33rd, and is whole again after 32 leaves", () => {
  const { enterNesting, leaveNesting } = loadMarkengine("markdown/nestingDepth.ts");
  const enterAll = () => Array.from({ length: 33 }, () => enterNesting());
  const leaveAll = () => Array.from({ length: 32 }, () => leaveNesting());
  assert.strictEqual(MAX_NESTING_DEPTH, 32);
  assert.deepStrictEqual(enterAll(), [...Array(32).fill(true), false]);
  leaveAll();
  assert.deepStrictEqual(enterAll(), [...Array(32).fill(true), false], "after 32 leaves the budget is whole");
  leaveAll();
});

// ADR 0062 NC-2: a parse that hits the budget hands all of it back. FRESH is a
// second bundle of the same entry ("./index.ts" is another cache key) that never
// parses past the budget.
for (const [mode, options] of Object.entries(MODES)) {
  test(`${mode}: the budget does not leak from a capped parse into the next one`, () => {
    const FRESH = loadMarkengine("./index.ts");
    const document = "> ".repeat(MAX_NESTING_DEPTH - 1) + "# x";
    E.parse("> ".repeat(2000) + "x", options);
    const after = E.parse(document, options);
    assert.deepStrictEqual(after, FRESH.parse(document, options));
    // The innermost quote's content is the budget's last level: one level leaked
    // would keep "# x" as source text instead of a heading.
    const { types, leaf } = firstChildChain(after[0]);
    assert.deepStrictEqual([count(types, "blockquote"), types.at(-1), leaf], [MAX_NESTING_DEPTH - 1, "heading", { type: "text", value: "x" }]);
  });
}
