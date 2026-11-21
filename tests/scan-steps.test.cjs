/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   scan-steps.test.cjs                                :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/11/20 00:00:00 by dlesieur          #+#    #+#             */
/*   Updated: 2026/11/20 00:00:00 by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengineInRealm } = require("./support/loadMarkengine.cjs");

const S = loadMarkengineInRealm("markdown/scanSteps.ts");

test("a reset counter reads 0", () => {
  S.resetSteps();
  assert.equal(S.readSteps(), 0);
});

test("a found needle adds the span up to and including the match", () => {
  S.resetSteps();
  assert.equal(S.countedIndexOf("abcabc", "c", 0), 2);
  assert.equal(S.readSteps(), 3);
});

test("a miss adds the rest of the text", () => {
  S.resetSteps();
  assert.equal(S.countedIndexOf("abcabc", "x", 2), -1);
  assert.equal(S.readSteps(), 4);
});

test("a start past the end adds nothing", () => {
  S.resetSteps();
  assert.equal(S.countedIndexOf("abc", "a", 10), -1);
  assert.equal(S.readSteps(), 0);
});

test("a negative start counts from 0", () => {
  S.resetSteps();
  assert.equal(S.countedIndexOf("abc", "c", -5), 2);
  assert.equal(S.readSteps(), 3);
});

test("a NaN start counts from 0 and an infinite one adds nothing", () => {
  S.resetSteps();
  assert.equal(S.countedIndexOf("abcabc", "c", Number.NaN), 2);
  assert.equal(S.readSteps(), 3);
  assert.equal(S.countedIndexOf("abc", "a", Number.POSITIVE_INFINITY), -1);
  assert.equal(S.readSteps(), 3);
});

// 2^31 - 1 is the largest small integer on 64-bit node 22; one more step used to
// turn every later count into a heap allocation (ADR 0068 D4).
test("the count stays exact past the small-integer range", () => {
  S.resetSteps();
  S.countSteps(2 ** 31 - 1);
  S.countSteps(5);
  S.countedIndexOf("abc", "c", 0);
  assert.equal(S.readSteps(), 2 ** 31 + 7);
  S.resetSteps();
  assert.equal(S.readSteps(), 0);
});

test("indexOfSpan is the span countedIndexOf counts, and counts nothing", () => {
  const cases = [["abcabc", "c", 0], ["abcabc", "c", 3], ["abc", "z", 1], ["abc", "a", -4], ["ab", "b", 9]];
  for (const [text, needle, from] of cases) {
    S.resetSteps();
    const at = S.countedIndexOf(text, needle, from);
    const counted = S.readSteps();
    S.resetSteps();
    assert.equal(S.indexOfSpan(text, needle, from, at), counted);
    assert.equal(S.readSteps(), 0);
  }
});

test("a regex hit adds the span through the match", () => {
  S.resetSteps();
  assert.equal(S.countedMatchIndex("aa bb", /b+/g, 0), 3);
  assert.equal(S.readSteps(), 5);
});

test("a regex miss adds the rest of the text", () => {
  S.resetSteps();
  assert.equal(S.countedMatchIndex("abc", /z/g, 1), -1);
  assert.equal(S.readSteps(), 2);
});

test("a non-global regex is refused", () => {
  S.resetSteps();
  assert.throws(() => S.countedMatchIndex("abc", /a/, 0), /global or sticky/);
  assert.equal(S.readSteps(), 0);
});

test("countSteps adds its argument and refuses a bad one", () => {
  S.resetSteps();
  S.countSteps(7);
  S.countSteps(0);
  assert.equal(S.readSteps(), 7);
  assert.throws(() => S.countSteps(-1), RangeError);
  assert.throws(() => S.countSteps(1.5), RangeError);
  assert.equal(S.readSteps(), 7);
});

test("counts accumulate until reset", () => {
  S.resetSteps();
  S.countedIndexOf("abcabc", "c", 0);
  S.countedIndexOf("abcabc", "c", 0);
  assert.equal(S.readSteps(), 6);
  S.resetSteps();
  assert.equal(S.readSteps(), 0);
});

test("the counted calls answer exactly like the native ones", () => {
  S.resetSteps();
  let seed = 42;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const alphabet = "ab][";
  for (let index = 0; index < 500; index++) {
    let text = "";
    const textLength = next() % 40;
    for (let at = 0; at < textLength; at++) text += alphabet[next() % alphabet.length];
    let needle = "";
    const needleLength = 1 + (next() % 2);
    for (let at = 0; at < needleLength; at++) needle += alphabet[next() % alphabet.length];
    const from = (next() % 50) - 5;
    assert.equal(S.countedIndexOf(text, needle, from), text.indexOf(needle, from));
    const expectedPattern = /\]+/g;
    expectedPattern.lastIndex = from;
    const expectedMatch = expectedPattern.exec(text);
    assert.equal(S.countedMatchIndex(text, /\]+/g, from), expectedMatch?.index ?? -1);
  }
});
