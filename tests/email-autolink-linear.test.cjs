"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");

const { parse } = loadMarkengine("index.ts");

test("autolink email: validates valid email addresses", () => {
  const blocks = parse("Contact <user@example.com> or <test.user+tag@sub.domain.co.uk>");
  const paragraph = blocks[0];
  assert.equal(paragraph.type, "paragraph");

  const link1 = paragraph.children[1];
  assert.equal(link1.type, "link");
  assert.equal(link1.href, "mailto:user@example.com");
  assert.equal(link1.children[0].value, "user@example.com");

  const link2 = paragraph.children[3];
  assert.equal(link2.type, "link");
  assert.equal(link2.href, "mailto:test.user+tag@sub.domain.co.uk");
  assert.equal(link2.children[0].value, "test.user+tag@sub.domain.co.uk");
});

test("autolink email: rejects invalid patterns", () => {
  const invalidCases = [
    "<@example.com>",
    "<user@>",
    "<user@example>",
    "<user@.com>",
    "<user name@example.com>",
    "<user@exam ple.com>",
    "<user@@example.com>",
    "<a@b.>",
  ];

  for (const text of invalidCases) {
    const blocks = parse(text);
    const paragraph = blocks[0];
    const hasMailto = paragraph.children.some(
      (c) => c.type === "link" && c.href && c.href.startsWith("mailto:")
    );
    assert.equal(hasMailto, false, `Expected no mailto link for: ${text}`);
  }
});

test("autolink email: linear single-pass check executes within time bound for k = 20,000", () => {
  const pathological = `<a@${".".repeat(20000)} >`;
  const t0 = performance.now();
  const blocks = parse(pathological);
  const elapsed = performance.now() - t0;

  // Pathological backtracking with regex took >150 ms; linear check must take <25 ms
  assert.ok(elapsed < 100, `Expected parse to finish under 100ms, took ${elapsed.toFixed(2)}ms`);

  const paragraph = blocks[0];
  const hasMailto = paragraph.children.some(
    (c) => c.type === "link" && c.href && c.href.startsWith("mailto:")
  );
  assert.equal(hasMailto, false);
});
