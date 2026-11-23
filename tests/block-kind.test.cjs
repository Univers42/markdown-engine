"use strict";

// ADR 0062 CK-1: one word grammar decides which callout or container kinds
// become a class, and it is the grammar the container opener reads.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");

const K = loadMarkengine("markdown/blockKind.ts");

test("isWordKind accepts a letter followed by letters, digits, - and _", () => {
  for (const kind of ["a", "Note", "tip-2", "a_b", "x-"]) {
    assert.strictEqual(K.isWordKind(kind), true, JSON.stringify(kind));
  }
});

test("isWordKind refuses anything else, the empty kind and a trailing newline included", () => {
  const others = ["", "1a", "-a", "_a", "a b", 'a"', "💡", "⚠️", "é", "note\n", "a.b"];
  for (const kind of others) {
    assert.strictEqual(K.isWordKind(kind), false, JSON.stringify(kind));
  }
});

test("kindClassName adds the kind class only for a word", () => {
  assert.strictEqual(K.kindClassName("md", "callout", "tip"), "md-callout md-callout-tip");
  assert.strictEqual(K.kindClassName("md", "container", 'x" y'), "md-container");
});

test("the container opener captures the same word and leaves the rest as params", () => {
  assert.deepStrictEqual(K.matchContainerOpen(':::note"><img'), { kind: "note", params: '"><img' });
  assert.strictEqual(K.matchContainerOpen(":::1a"), null);
});
