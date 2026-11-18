"use strict";

// U3-1/U3-3/U3-4/U3-7: what the React renderer (and the inline source serializer)
// do with html_element nodes and with markdown images and links when the HTML
// subset is on.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");
const { MEDIA_PREFIXES, collectElements, elementsOfType } = require("./support/htmlSubsetInvariants.cjs");

const E = loadMarkengine("index.ts");
const R = loadMarkengine("react.tsx");
const RENDER = { htmlSubset: { mediaPrefixes: MEDIA_PREFIXES } };
const render = (markdown, options = {}) =>
  R.renderReact(E.parse(markdown, { htmlSubset: true }), { ...RENDER, ...options });
const ownProps = (element) => {
  const props = { ...element.props };
  delete props.key;
  return JSON.parse(JSON.stringify(props));
};
const REMOTE_IMAGE = { loading: "lazy", decoding: "async", referrerPolicy: "no-referrer" };

test("U3-7 an <img> renders with the remote-image policy and only mapped props", () => {
  const [img] = elementsOfType(render('<img src="https://a.io/x.png" alt="A" width="45%" align="right">'), "img");
  assert.deepStrictEqual(ownProps(img), {
    src: "https://a.io/x.png", alt: "A", width: "45%", align: "right", ...REMOTE_IMAGE,
  });
});

test("U3-7 a markdown image gets the same policy; http and data sources render nothing", () => {
  const [img] = elementsOfType(render("![A](https://a.io/x.png)"), "img");
  assert.deepStrictEqual(ownProps(img), { src: "https://a.io/x.png", alt: "A", ...REMOTE_IMAGE });
  assert.strictEqual(elementsOfType(render("![A](http://a.io/x.png)"), "img").length, 0);
  assert.strictEqual(elementsOfType(render('<img src="data:image/png;base64,AAAA">'), "img").length, 0);
});

test("U3-3 an app media path is kept; an imageRenderer cannot bypass the policy", () => {
  const custom = () => ({ type: "img", props: { src: "http://evil.io/x" }, children: [] });
  const tree = render("![A](/api/media/uploads/a.png)", { imageRenderer: custom });
  const [img] = elementsOfType(tree, "img");
  assert.deepStrictEqual(ownProps(img), { src: "/api/media/uploads/a.png", alt: "A", ...REMOTE_IMAGE });
});

// React 19 warns on `vAlign` and accepts lowercase `valign` (probe/react-attrs.cjs).
test("table cells carry colSpan, rowSpan and valign as React props", () => {
  const tree = render('<table><tr><td colspan="2" rowspan="3" valign="top" width="55%">x</td></tr></table>');
  const [cell] = elementsOfType(tree, "td");
  assert.deepStrictEqual(ownProps(cell), { colSpan: 2, rowSpan: 3, valign: "top", width: "55%" });
});

test("U3-3 an HTML anchor goes through the link renderer, never as a mention", () => {
  const [anchor] = elementsOfType(render('<a href="https://a.io" title="osio:mention">x</a>'), "a");
  const props = ownProps(anchor);
  assert.strictEqual(props.href, "https://a.io");
  assert.strictEqual(props["data-link-mention"], undefined);
  assert.strictEqual(props.rel, "noopener noreferrer");
  assert.deepStrictEqual(anchor.children, ["x"], "no favicon chip, the tag is not text");
});

test("an anchor whose href is refused renders its children only", () => {
  const tree = render('<a href="javascript:alert(1)">x</a>');
  assert.strictEqual(elementsOfType(tree, "a").length, 0);
  assert.ok(JSON.stringify(tree).includes('"x"'));
});

test("a markdown link inside an HTML anchor is unwrapped, never a nested <a>", () => {
  const anchors = elementsOfType(render('<a href="https://a.io">[in](https://b.io) and https://c.io</a>'), "a");
  assert.deepStrictEqual(anchors.map((anchor) => anchor.props.href), ["https://a.io"]);
});

test("U3-1 allowHtml is gone: an HTML block without the subset is shown as code", () => {
  const tree = R.renderReact(E.parse("<div>x</div>"), { allowHtml: true });
  assert.deepStrictEqual(collectElements(tree).map((element) => element.type), ["pre", "code"]);
});

test("heading ids are prefixed so a README cannot clobber window globals", () => {
  const [heading] = elementsOfType(render("# config"), "h1");
  assert.strictEqual(heading.props.id, "user-content-config");
  const [plainHeading] = elementsOfType(R.renderReact(E.parse("# config")), "h1");
  assert.strictEqual(plainHeading.props.id, "config", "outside the subset nothing changes");
});

test("footnote ids and their links are prefixed like heading ids", () => {
  const markdown = "See[^name].\n\n[^name]: The note.";
  const footnote = (tree) => collectElements(tree).find((element) => element.props?.id?.endsWith("fn-name"));
  const link = (tree) => elementsOfType(tree, "a").find((element) => element.props.href?.endsWith("fn-name"));
  assert.strictEqual(footnote(render(markdown)).props.id, "user-content-fn-name");
  assert.strictEqual(link(render(markdown)).props.href, "#user-content-fn-name");
  const plainTree = R.renderReact(E.parse(markdown));
  assert.strictEqual(footnote(plainTree).props.id, "fn-name", "outside the subset nothing changes");
  assert.strictEqual(link(plainTree).props.href, "#fn-name");
});

test("U3-4 no variable is ever expanded into a URL or an attribute", () => {
  const markdown = [
    '<img src="https://a.io/{{secret}}.png" alt="{{secret}}" title="{{secret}}">',
    '<a href="https://a.io/?q={{secret}}" title="{{secret}}">a</a>',
    "![{{secret}}](https://a.io/{{secret}}.png)",
    "[{{secret}}](https://a.io/{{secret}})",
  ].join("\n\n");
  const tree = render(markdown, { variableRenderer: (expr) => (expr === "secret" ? "S3CR3T" : null) });
  for (const element of collectElements(tree)) {
    for (const [name, value] of Object.entries(element.props)) {
      if (name === "children") continue;
      assert.ok(!JSON.stringify(value ?? "").includes("S3CR3T"), `${String(element.type)}.${name}`);
    }
  }
});

// The inline source serializer (editor round-trip) keeps an element's text and
// writes no tag back: it has no attribute escaping, so re-created markup is
// exactly what the subset exists to prevent.
test("serializeInlineNodes writes a subset element's children, never the element", () => {
  const [paragraph] = E.parse('x <b title="t">bold</b> <a href="https://a.io/">link</a>', { htmlSubset: true });
  assert.strictEqual(paragraph.type, "paragraph");
  assert.ok(paragraph.children.some((node) => node.type === "html_element"));
  assert.strictEqual(E.serializeInlineNodes(paragraph.children), "x bold link");
});
