"use strict";

// Link mentions: `[text](url "osio:mention")` renders as a chip (favicon + text) in both
// the HTML and the React renderer, and never leaks the marker as a tooltip.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengine, loadMarkengineAll } = require("./support/loadMarkengine.cjs");

const E = loadMarkengineAll();
const R = loadMarkengine("markdown/renderers/react.tsx");
const MENTION = '[Example](https://example.com/a "osio:mention")';
const H = loadMarkengine("markdown/renderers/inlineHtml.ts");
const html = (src, options) => H.renderInlineNodesToHtml(E.parseInline(src), options);

test("HTML: the mention is an editor-link chip with a same-origin favicon and the host as tooltip", () => {
  const out = html(MENTION);
  assert.match(out, /class="editor-link editor-link-mention"/);
  assert.match(out, /title="example\.com"/);
  assert.match(out, /<img [^>]*src="https:\/\/example\.com\/favicon\.ico" alt="" loading="lazy" \/>/);
  assert.doesNotMatch(out, /osio:mention/);
});

test("HTML: a non-http mention gets no favicon", () => {
  assert.doesNotMatch(html('[x](javascript:alert(1) "osio:mention")'), /<img/);
});

test("React: the same chip, marker not used as the title", () => {
  const [anchor] = R.renderInlines(E.parseInline(MENTION), { classPrefix: "md", externalLinks: true });
  assert.equal(anchor.props.className, "editor-link editor-link-mention");
  assert.equal(anchor.props.title, "example.com");
  assert.equal(anchor.children[0].props.src, "https://example.com/favicon.ico");
  assert.equal(anchor.children[0].props.alt, "");
});
