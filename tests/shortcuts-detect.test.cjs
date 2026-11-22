"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");

const { detectBlockType } = loadMarkengine("shortcutsDetect.ts");

test("ordered list shortcut ignores decimals and identifier prefixes", () => {
  // Decimals and non-spaced tokens must not trigger numbered_list shortcut
  assert.equal(detectBlockType("3.14 "), null);
  assert.equal(detectBlockType("1.x "), null);
  assert.equal(detectBlockType("2.5x "), null);
  assert.equal(detectBlockType("3.14159"), null);
  assert.equal(detectBlockType("1.0"), null);
  assert.equal(detectBlockType("1.0 "), null);
});

test("ordered list shortcut converts valid markers with trailing space", () => {
  assert.deepEqual(detectBlockType("1. "), {
    type: "numbered_list",
    content: "",
    remainingContent: "",
  });

  assert.deepEqual(detectBlockType("12. "), {
    type: "numbered_list",
    content: "",
    remainingContent: "",
  });

  assert.deepEqual(detectBlockType("1. First item"), {
    type: "numbered_list",
    content: "First item",
    remainingContent: "First item",
  });

  assert.deepEqual(detectBlockType("42) With parenthesis"), {
    type: "numbered_list",
    content: "With parenthesis",
    remainingContent: "With parenthesis",
  });

  assert.deepEqual(detectBlockType("1) "), {
    type: "numbered_list",
    content: "",
    remainingContent: "",
  });
});

test("other shortcuts continue to detect properly", () => {
  assert.equal(detectBlockType("# Header")?.type, "heading_1");
  assert.equal(detectBlockType("## Header")?.type, "heading_2");
  assert.equal(detectBlockType("- Bullet")?.type, "bulleted_list");
  assert.equal(detectBlockType("* Bullet")?.type, "bulleted_list");
  assert.equal(detectBlockType("> Quote")?.type, "toggle");
  assert.equal(detectBlockType("---")?.type, "divider");
  assert.equal(detectBlockType("Regular paragraph"), null);
});
