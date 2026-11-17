"use strict";

// U3-1/U3-2/U3-3: GitHub's HTML subset parses into typed html_element nodes.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");
const { htmlElementDepth } = require("./support/htmlSubsetInvariants.cjs");

const E = loadMarkengine("index.ts");

// JSON round trip: the engine runs in a vm realm, deepStrictEqual needs ours.
const plain = (value) => JSON.parse(JSON.stringify(value));

function strip(nodes) {
  return nodes
    .filter((node) => !(node.type === "text" && node.value.trim() === ""))
    .map((node) => (Array.isArray(node.children) ? { ...node, children: strip(node.children) } : node));
}

const ast = (markdown) => strip(plain(E.parse(markdown, { htmlSubset: true })));
const el = (tag, attrs, ...children) => ({ type: "html_element", tag, attrs, children });
const text = (value) => ({ type: "text", value });
const firstOfType = (nodes, tag) => {
  for (const node of nodes) {
    if (node.tag === tag) return node;
    const found = Array.isArray(node.children) ? firstOfType(node.children, tag) : null;
    if (found) return found;
  }
  return null;
};

test("without the option an HTML block stays a raw html_block", () => {
  assert.deepStrictEqual(plain(E.parse('<div align="center">x</div>')), [
    { type: "html_block", value: '<div align="center">x</div>' },
  ]);
});

test("a centered div with an image becomes elements, attributes kept", () => {
  const md = '<div align="center">\n  <img src="https://a.io/x.png" width="100%" alt="A"/>\n</div>';
  assert.deepStrictEqual(ast(md), [
    el("div", { align: "center" }, el("img", { src: "https://a.io/x.png", width: "100%", alt: "A" })),
  ]);
});

test("attributes outside the map, and failing values, are dropped", () => {
  const md = '<div align="middle" id="x" class="c" style="color:red" onclick="a()" name="n">x</div>';
  assert.deepStrictEqual(ast(md), [el("div", {}, text("x"))]);
  assert.deepStrictEqual(ast('<p align="CENTER">x</p>'), [el("p", { align: "center" }, text("x"))]);
});

test("width and height: 1-2048 px or 1-100 %, never clamped", () => {
  const sizes = (attrs) => ast(`<img src="https://a.io/x" ${attrs}>`)[0].attrs;
  assert.deepStrictEqual(sizes('width="0" height="2049"'), { src: "https://a.io/x" });
  assert.deepStrictEqual(sizes('width="2048" height="100%"'), {
    src: "https://a.io/x", width: "2048", height: "100%",
  });
  assert.deepStrictEqual(sizes('width="101%" height="12px"'), { src: "https://a.io/x" });
  assert.deepStrictEqual(sizes('width="01" height=" 5"'), { src: "https://a.io/x" });
});

test("colspan 1-64, rowspan 1-256, valign enum, alt and title <= 512", () => {
  const cell = firstOfType(ast('<table><tr><td colspan="64" rowspan="257" valign="top">x</td></tr></table>'), "td");
  assert.deepStrictEqual(cell.attrs, { colspan: "64", valign: "top" });
  const img = ast(`<img alt="${"a".repeat(513)}" title="${"t".repeat(512)}">`)[0];
  assert.deepStrictEqual(img.attrs, { title: "t".repeat(512) });
});

test("entities are decoded once before validation", () => {
  assert.deepStrictEqual(ast('<a href="&#106;avascript:alert(1)">x</a>')[0].children, [
    el("a", {}, text("x")),
  ]);
  assert.deepStrictEqual(ast('<a href="https&colon;//a.io">x</a>')[0].children, [
    el("a", { href: "https://a.io" }, text("x")),
  ]);
  assert.deepStrictEqual(ast("<div>a &amp; b &lt;i&gt;</div>"), [el("div", {}, text("a & b <i>"))]);
});

test("an unknown tag is text; comments and forbidden elements are dropped", () => {
  assert.deepStrictEqual(ast("x <custom>hi</custom>"), [
    { type: "paragraph", children: [text("x <custom>hi</custom>")] },
  ]);
  assert.deepStrictEqual(ast("a <!-- c --> b <script>alert(1)</script> c"), [
    { type: "paragraph", children: [text("a  b  c")] },
  ]);
});

test("table rows and cells imply their missing parents", () => {
  assert.deepStrictEqual(ast("<table><td>x</td></table>"), [
    el("table", {}, el("tbody", {}, el("tr", {}, el("td", {}, text("x"))))),
  ]);
});

test("markdown after a blank line inside a cell is parsed (fenced code highlighted)", () => {
  const md = "<table>\n<tr>\n<td>\n\n```js\nlet x;\n```\n\n</td>\n</tr>\n</table>";
  const cell = firstOfType(ast(md), "td");
  assert.deepStrictEqual(cell.children, [{ type: "code_block", lang: "js", value: "let x;" }]);
});

test("closing tags on their own line start HTML blocks, so markdown nests", () => {
  assert.deepStrictEqual(ast("<div>\n\ntext\n\n</div>\nafter"), [
    el("div", {}, { type: "paragraph", children: [text("text")] }),
    { type: "paragraph", children: [text("after")] },
  ]);
});

test("a markdown block closes an open <p> instead of nesting in it", () => {
  assert.deepStrictEqual(ast('<p align="center">\n\npara\n\n</p>'), [
    el("p", { align: "center" }),
    { type: "paragraph", children: [text("para")] },
  ]);
});

test("nested anchors, headings and list items are flattened like the browser", () => {
  assert.deepStrictEqual(ast('<a href="https://a.io">x<a href="https://b.io">y</a>z</a>')[0].children, [
    el("a", { href: "https://a.io" }, text("xyz")),
  ]);
  assert.deepStrictEqual(ast("<h1>a<h2>b</h2></h1>"), [el("h1", {}, text("a")), el("h2", {}, text("b"))]);
  assert.deepStrictEqual(ast("<ul><li>a<li>b</ul>"), [el("ul", {}, el("li", {}, text("a")), el("li", {}, text("b")))]);
});

test("inline: only phrasing tags; block tags in a paragraph are dropped", () => {
  assert.deepStrictEqual(ast("x <b>bold</b> <div>y</div> <sub>2</sub>"), [
    { type: "paragraph", children: [text("x "), el("b", {}, text("bold")), text(" y "), el("sub", {}, text("2"))] },
  ]);
});

test("nesting beyond 16 is text", () => {
  const nodes = ast(`${"<span>".repeat(20)}x`)[0].children;
  let depth = 0;
  let node = { children: nodes };
  while (node.children?.[0]?.type === "html_element") {
    node = node.children[0];
    depth += 1;
  }
  assert.strictEqual(depth, 16);
  assert.deepStrictEqual(node.children, [text(`${"<span>".repeat(4)}x`)]);
});

test("nesting stays at 16 across markdown inside HTML (paragraphs, quotes, lists)", () => {
  const deep = "<div>".repeat(16);
  for (const inner of ["<b>x</b> y", "> <span>q</span>", "- <i>l</i>", "<div>\n\n<em>e</em>\n\n</div>"]) {
    const blocks = plain(E.parse(`${deep}\n\n${inner}\n`, { htmlSubset: true }));
    assert.strictEqual(htmlElementDepth(blocks), 16, inner);
  }
});
