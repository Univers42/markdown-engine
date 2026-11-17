"use strict";

// U3-5: every corpus vector, through both outputs of the subset path (React tree
// and renderHtml) and through the clipboard path (plain parse + renderHtml),
// must produce no script, no handler, no dangerous URL and no tag outside the
// allowlist. Structure vectors also check the depth and element caps.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");
const { KB200, XSS_CORPUS } = require("./support/xssCorpus.cjs");
const {
  MEDIA_PREFIXES, SUBSET_TAGS, elementsOfType, htmlProblems, maxDepth, reactProblems,
} = require("./support/htmlSubsetInvariants.cjs");

const E = loadMarkengine("index.ts");
const R = loadMarkengine("react.tsx");
const SUBSET = { htmlSubset: true };
const RENDER = { htmlSubset: { mediaPrefixes: MEDIA_PREFIXES } };

function renderAll(markdown) {
  const blocks = E.parse(markdown, SUBSET);
  return {
    blocks,
    tree: R.renderReact(blocks, RENDER),
    html: E.renderHtml(blocks),
    clipboard: E.renderHtml(E.parse(markdown)),
  };
}

for (const [kind, label, markdown] of XSS_CORPUS) {
  test(`U3-5 ${kind}: ${label}`, () => {
    const { tree, html, clipboard } = renderAll(markdown);
    assert.deepStrictEqual(reactProblems(tree), [], "React tree");
    assert.deepStrictEqual(htmlProblems(html), [], "renderHtml (subset parse)");
    assert.deepStrictEqual(htmlProblems(clipboard), [], "renderHtml (plain parse)");
  });
}

test("U3-5 g: a 40000-deep div bomb keeps 16 levels", () => {
  const { tree } = renderAll("<div>".repeat(40000));
  assert.strictEqual(maxDepth(tree, new Set(SUBSET_TAGS)), 16);
});

// An <img> without an accepted src renders nothing, so the cap is measured on
// images that would render: 8000 x 25 bytes stays under the 200 KB input cap.
test("U3-5 g: 8000 images render at most 5000 elements", () => {
  const { tree } = renderAll('<img src="https://a.io/">'.repeat(8000));
  assert.strictEqual(elementsOfType(tree, "img").length, 5000);
});

test("U3-5 h: input over 200 KB is refused whole", () => {
  assert.strictEqual(E.parse("a".repeat(KB200 + 1), SUBSET).length, 0);
  assert.strictEqual(E.parse("é".repeat(KB200 / 2 + 1), SUBSET).length, 0, "UTF-8 bytes, not chars");
  assert.strictEqual(E.parse("a".repeat(KB200), SUBSET).length, 1, "the cap itself is allowed");
});

test("U3-1: no renderer injects HTML", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "..", "markdown", "renderers");
  for (const file of fs.readdirSync(dir)) {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    assert.ok(!source.includes("dangerouslySetInnerHTML"), file);
  }
});
