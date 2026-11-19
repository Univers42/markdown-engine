"use strict";

// ADR 0064 PS13: `{k=v …}` on a container opener is a null-prototype record of strings,
// bounded at 256 characters and 16 pairs, dropped and reported past that, never thrown.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");
const { createRandom } = require("./support/seededRandom.cjs");

const { parseContainerAttributes } = loadMarkengine("markdown/containerAttributes.ts");
const { parse } = loadMarkengine("index.ts");

const plain = (attributes) => ({ values: { ...attributes.values }, dropped: attributes.dropped });

test("pairs after a ratio or alone read as strings", () => {
  const read = parseContainerAttributes("{layout=grid cols=3 minCol=16}");
  assert.equal(Object.getPrototypeOf(read.values), null);
  assert.deepEqual(plain(read), { values: { layout: "grid", cols: "3", minCol: "16" }, dropped: [] });
  assert.deepEqual(plain(parseContainerAttributes("0.5 {span=2}")), { values: { span: "2" }, dropped: [] });
});

test("an opener without a trailing {…} has no attributes", () => {
  for (const params of [undefined, "", "0.5", "{a=1} tail", "a=1}"]) {
    assert.equal(parseContainerAttributes(params), undefined, String(params));
  }
});

test("prototype names are own string values, never the prototype", () => {
  const read = parseContainerAttributes("{__proto__=x constructor=y toString=z}");
  assert.equal(Object.getPrototypeOf(read.values), null);
  // A key starts with a letter, so `__proto__` is malformed before it reaches the record.
  assert.deepEqual(read.dropped, ["malformed"]);
  assert.deepEqual(Object.keys(read.values), ["constructor", "toString"]);
  assert.equal(read.values.constructor, "y");
  assert.equal(parseContainerAttributes("{hasOwnProperty=1}").values.hasOwnProperty, "1");
});

test("malformed and duplicate tokens are dropped and reported", () => {
  const read = parseContainerAttributes('{a b= =c 1x=2 d="e" f=g f=h}');
  assert.deepEqual(plain(read), {
    values: { f: "g" },
    dropped: ["malformed", "malformed", "malformed", "malformed", "malformed", "duplicate"],
  });
});

test("past 16 pairs the rest is dropped and reported once", () => {
  const pairs = Array.from({ length: 20 }, (_, index) => `k${index}=v`).join(" ");
  const read = parseContainerAttributes(`{${pairs}}`);
  assert.equal(Object.keys(read.values).length, 16);
  assert.equal(read.values.k15, "v");
  assert.deepEqual(read.dropped, ["pairs"]);
});

test("past 256 characters the rest and the cut token are dropped", () => {
  const pairs = Array.from({ length: 40 }, (_, index) => `key${String(index).padStart(2, "0")}=v`).join(" ");
  const read = parseContainerAttributes(`{${pairs}}`);
  // 8 characters per pair with its space: 32 whole pairs fit, then the pair limit.
  assert.equal(Object.keys(read.values).length, 16);
  assert.deepEqual(read.dropped, ["length", "pairs"]);
  const long = parseContainerAttributes(`{a=${"x".repeat(300)} b=1}`);
  assert.deepEqual(plain(long), { values: {}, dropped: ["length"] });
});

test("a 1 MB attribute block reads in under 50 ms and never throws", () => {
  for (const params of ["{" + "k=v ".repeat(262144) + "}", "{".repeat(1 << 20) + "}", "x".repeat(1 << 20) + "}"]) {
    const started = performance.now();
    const read = parseContainerAttributes(params);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 50, `${elapsed.toFixed(1)} ms`);
    assert.ok(read === undefined || Object.keys(read.values).length <= 16);
  }
});

test("a document whose opener line is 1 MB parses in under 50 ms", () => {
  const source = [":::columns {" + "k=v ".repeat(262144) + "}", "a", ":::"].join("\n");
  const started = performance.now();
  const [node] = parse(source);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 50, `${elapsed.toFixed(1)} ms`);
  assert.equal(node.type, "container");
  // The 256-character window holds 64 `k=v` tokens: one kept, 63 duplicates.
  assert.deepEqual({ ...node.attributes.values }, { k: "v" });
  assert.deepEqual(node.attributes.dropped, ["length", ...Array(63).fill("duplicate")]);
});

test("seeded random openers never throw and stay bounded strings", () => {
  const random = createRandom(0x5eed);
  const alphabet = ["a", "Z", "1", "=", " ", "{", "}", '"', "_", "-", "\t", "é", "__proto__", "constructor="];
  for (let round = 0; round < 5000; round++) {
    let text = "";
    const length = Math.floor(random() * 80);
    for (let index = 0; index < length; index++) text += alphabet[Math.floor(random() * alphabet.length)];
    const read = parseContainerAttributes(`${text}}`);
    if (read === undefined) continue;
    assert.equal(Object.getPrototypeOf(read.values), null);
    assert.ok(Object.keys(read.values).length <= 16);
    for (const value of Object.values(read.values)) assert.equal(typeof value, "string");
  }
});

test("the AST carries attributes only when the opener has them", () => {
  const [bare, braced] = parse(":::columns\n:::\n\n:::column 0.5 {span=2}\n:::");
  assert.equal("attributes" in bare, false);
  assert.equal(braced.params, "0.5 {span=2}");
  assert.deepEqual(plain(braced.attributes), { values: { span: "2" }, dropped: [] });
});
