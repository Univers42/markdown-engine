"use strict";

// `{{NAME | filter}}` variables: the engine owns syntax, a lossless AST node and the
// chip markup; resolving a name to a value is the host's resolveVariable hook.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengine, loadMarkengineAll } = require("./support/loadMarkengine.cjs");

const E = loadMarkengineAll();
const H = loadMarkengine("markdown/renderers/inlineHtml.ts");
const R = loadMarkengine("markdown/renderers/react.tsx");
// The engine runs in its own VM realm, so compare plain copies, not cross-realm objects.
const plain = (value) => JSON.parse(JSON.stringify(value));
const html = (src, options) => H.renderInlineNodesToHtml(E.parseInline(src), options);
const variables = (src) => plain(E.parseInline(src).filter((n) => n.type === "variable"));

test("parse: names and filter chains become variable nodes with the raw inner text", () => {
  const nodes = plain(E.parseInline('Paid {{PRICE}} on {{ NOW | date:"yyyy" }}'));
  assert.deepStrictEqual(nodes, [
    { type: "text", value: "Paid " },
    { type: "variable", expr: "PRICE" },
    { type: "text", value: " on " },
    { type: "variable", expr: ' NOW | date:"yyyy" ' },
  ]);
});

test("parse: dotted names (page properties) are accepted", () => {
  assert.deepStrictEqual(variables("{{page.Status|upper}}"), [{ type: "variable", expr: "page.Status|upper" }]);
});

test("serialize: parse → serialize is byte-identical", () => {
  for (const src of ["{{NOW}}", "a {{ X | default:\"n/a\" }} b", "[b]{{CLIENT}}[/b] and {{page.Owner}}", "{{{X}}}"]) {
    assert.equal(E.serializeInlineNodes(E.parseInline(src)), src);
  }
});

test("parse: shapes that are not variables stay plain text", () => {
  const notVariables = ["{{}}", "{{1abc}}", "{{a b}}", "{{X}", "{ {X} }", "{{X\n}}", "{{X|a{b}}", `{{${"A".repeat(300)}}}`];
  for (const src of notVariables) {
    assert.deepStrictEqual(variables(src), [], src);
  }
});

test("parse: inline math and code spans are unaffected", () => {
  assert.equal(E.parseInline("$(x)^2$")[0].type, "math_inline");
  assert.deepStrictEqual(plain(E.parseInline("`{{X}}`")), [{ type: "code", value: "{{X}}" }]);
  assert.deepStrictEqual(variables("\\{{X}}"), []);
});

test("parse: a stray `{{` in long prose does not scan to the end", () => {
  const src = `{{ ${"word ".repeat(20000)}`;
  const started = process.hrtime.bigint();
  E.parseInline(src);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 200);
});

test("HTML: without a resolver the literal source is kept, escaped", () => {
  assert.equal(html("{{X}}"), "{{X}}");
  assert.equal(html("{{X|default:\"<b>\"}}"), "{{X|default:&quot;&lt;b&gt;&quot;}}");
  assert.equal(html("{{X}}", { resolveVariable: () => null }), "{{X}}");
});

test("HTML: a resolved variable is an atomic chip carrying its expression", () => {
  const out = html("{{CLIENT}}", { resolveVariable: () => ({ text: "<Acme>" }) });
  assert.equal(
    out,
    '<span class="md-variable" data-inline-type="variable" data-var-expr="CLIENT" contenteditable="false" title="{{CLIENT}}">&lt;Acme&gt;</span>​',
  );
  const reading = html("{{CLIENT}}", { editorChrome: false, resolveVariable: () => ({ text: "Acme" }) });
  assert.ok(!reading.includes("​"));
});

test("HTML: an error chip names the problem in its tooltip", () => {
  const out = html("{{A}}", { resolveVariable: () => ({ text: "{{A}}", error: "cycle: A → B → A" }) });
  assert.match(out, /class="md-variable md-variable-error"/);
  assert.match(out, /title="\{\{A\}\} — cycle: A → B → A"/);
});

test("React: the host renderer receives the expression; default is the literal", () => {
  const nodes = E.parseInline("{{NOW}}");
  const [withRenderer] = R.renderInlines(nodes, { classPrefix: "md", externalLinks: true, variableRenderer: (expr) => `v:${expr}` });
  assert.deepStrictEqual(plain(withRenderer.children), ["v:NOW"]);
  const [fallback] = R.renderInlines(nodes, { classPrefix: "md", externalLinks: true });
  assert.deepStrictEqual(plain(fallback.children), ["{{NOW}}"]);
});
