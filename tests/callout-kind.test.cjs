"use strict";

// ADR 0062 D1: a callout or container kind is author text. It becomes a class
// only when it is a word; any other kind adds no class and no attribute, in the
// HTML string and in React alike. The parser and the stored kind do not change:
// the host keeps an emoji kind (`> [!💡]`) as the callout's colour.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengine, loadMarkengineAll } = require("./support/loadMarkengine.cjs");

const E = loadMarkengineAll();
const R = loadMarkengine("react.tsx");
const openingTag = (html) => html.split("\n")[0];
const reactRoot = (ast) => R.renderReact(ast)[0];
const BARE_CALLOUT = '<div class="md-callout" data-block-state="reading">';

// The two PoCs of the security review (2026-11-18, sec/callout-string.cjs): a
// copy puts renderHtml(parse(markdown)) on the clipboard as text/html.
test("CK-8 a kind that closes the class attribute adds no attribute and no element", () => {
  const sources = [
    '> [!x"><img src=x onerror=alert(1)>] hi\n\nnext block',
    '> [!warning" onclick="alert(1)] click\n\nnext block',
  ];
  for (const source of sources) {
    const html = E.renderHtml(E.parse(source));
    assert.strictEqual(openingTag(html), BARE_CALLOUT, source);
    assert.doesNotMatch(html, /<img|onerror|onclick/, source);
  }
});

test("CK-8 a kind with spaces adds no class token, in React or in the HTML string", () => {
  const ast = E.parse("> [!note fixed inset-0 z-50 bg-white] t");
  assert.strictEqual(reactRoot(ast).props.className, "md-callout");
  assert.strictEqual(openingTag(E.renderHtml(ast)), BARE_CALLOUT);
});

test('CK-8 CK-6 a kind holding ", <, > and & reaches neither renderer, as a class or any attribute', () => {
  const ast = E.parse('> [!a"<b>&c] t');
  assert.strictEqual(ast[0].kind, 'a"<b>&c', "the parser keeps the kind");
  assert.deepStrictEqual(reactRoot(ast).props, { key: 0, className: "md-callout", "data-block-state": "reading" });
  const html = E.renderHtml(ast);
  assert.strictEqual(openingTag(html), BARE_CALLOUT);
  assert.doesNotMatch(html, /<b>|&amp;c|&quot;/);
});

const WORD_KINDS = ["note", "NOTE", "tip-2", "a_b", "x-"];
const OTHER_KINDS = ["💡", "⚠️", 'x" y', "a b", "1a", "-a", "_a", "", "a\tb", "note\n", "é"];
const classAttribute = (html) => /^<div class="([^"]*)"/.exec(html)[1];
const blockOf = (block, kind) =>
  block === "callout" ? { type: "callout", kind, title: [], children: [] } : { type: "container", kind, children: [] };

// An AST need not come from this parser (a host builds or stores one), so the
// renderers decide on their own, containers included.
for (const block of ["callout", "container"]) {
  test(`CK-2 CK-3 a ${block} kind is a class in both renderers only when it is a word`, () => {
    for (const kind of [...WORD_KINDS, ...OTHER_KINDS]) {
      const expected = WORD_KINDS.includes(kind) ? `md-${block} md-${block}-${kind}` : `md-${block}`;
      const node = blockOf(block, kind);
      assert.strictEqual(reactRoot([node]).props.className, expected, `react ${JSON.stringify(kind)}`);
      assert.strictEqual(classAttribute(E.renderHtml([node])), expected, `html ${JSON.stringify(kind)}`);
    }
  });
}

test("CK-4 a word kind renders byte for byte as on engine main ca5dbee84", () => {
  const ast = E.parse("> [!NOTE] Title\n> body");
  assert.strictEqual(
    E.renderHtml(ast),
    '<div class="md-callout md-callout-note" data-block-state="reading">\n<div class="md-callout-title">Title</div>\n<p data-block-state="reading">body</p>\n</div>',
  );
  assert.deepStrictEqual(reactRoot(ast).props, { key: 0, className: "md-callout md-callout-note", "data-block-state": "reading" });
  const container = E.parse(':::Note p"<\nx\n:::');
  assert.strictEqual(
    openingTag(E.renderHtml(container)),
    '<div class="md-container md-container-note" data-params="p&quot;&lt;" data-block-state="reading">',
  );
  assert.deepStrictEqual(reactRoot(container).props, {
    key: 0, className: "md-container md-container-note", "data-params": 'p"<', "data-block-state": "reading",
  });
});

test("CK-7 an emoji or odd kind still parses to a callout, is stored as is and written back", () => {
  assert.strictEqual([..."⚠️"].length, 2, "the warning sign is two code points");
  for (const kind of ["💡", "⚠️", 'x" onmouseover=y']) {
    const source = `> [!${kind}] t`;
    assert.deepStrictEqual(E.parse(source), [{ type: "callout", kind, title: [{ type: "text", value: "t" }], children: [] }]);
    const [block] = E.parseMarkdownToBlocks(source);
    assert.deepStrictEqual([block.type, block.color, block.content], ["callout", kind, "t"]);
    const [quote] = E.parseMarkdownToBlocks(`> ${source}`);
    assert.strictEqual(quote.content.split("\n")[0], source, "the engine writes the same line back");
  }
});
