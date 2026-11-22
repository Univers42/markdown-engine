"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { basename } = require("node:path");
const { bundleToDisk, computeSourceTreeHash } = require("./support/loadMarkengine.cjs");

test("bundleToDisk keys the cached file by source tree hash rather than pid", () => {
  const outfile = bundleToDisk("index.ts");
  const fileName = basename(outfile);

  // Must match index_ts.<16-char-hash>.cjs
  const hash = computeSourceTreeHash();
  assert.equal(hash.length, 16);
  assert.match(fileName, /^index_ts\.[0-9a-f]{16}\.cjs$/);
  assert.equal(fileName, `index_ts.${hash}.cjs`);

  // Must not be keyed by process.pid
  assert.notEqual(fileName, `index_ts.${process.pid}.cjs`);
});

test("bundleToDisk produces consistent output across invocations", () => {
  const first = bundleToDisk("blocks.ts");
  const second = bundleToDisk("blocks.ts");
  assert.equal(first, second);
});
