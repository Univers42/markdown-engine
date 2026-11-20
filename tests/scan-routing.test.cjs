/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   scan-routing.test.cjs                              :+:      :+:    :+:    */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+  +#+           */
/*   Created: 2026/11/20 00:00:00 by dlesieur          #+#    #+#             */
/*   Updated: 2026/11/20 00:00:00 by dlesieur          ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdirSync, renameSync, writeFileSync } = require("node:fs");
const { join, relative, resolve } = require("node:path");
const { loadMarkengineInRealm } = require("./support/loadMarkengine.cjs");

// scanSteps is deliberately not re-exported by any entry (its header, D5), so
// no loadable entry exposes the counter next to the public parse — and every
// loadMarkengineInRealm entry is a separate bundle with its own module state,
// so a second scanSteps bundle would read a different counter than the parse
// counts into. The test therefore writes one private entry under the loader's
// own (gitignored) cache directory that re-exports the public parse, the
// counter and the scan-memo API from a single bundle, and loads it through the
// same loader with the same build approach as tests/scan-steps.test.cjs.
const ROOT = resolve(__dirname, "..");
const CACHE_DIR = join(ROOT, "node_modules", ".cache", "loadMarkengine");
const ENTRY = join(CACHE_DIR, "scan-routing-entry.ts");
mkdirSync(CACHE_DIR, { recursive: true });
const staged = `${ENTRY}.${process.pid}.${Date.now()}.tmp`;
writeFileSync(
  staged,
  [
    'export { parse } from "../../../index.ts";',
    'export { readSteps, resetSteps } from "../../../markdown/scanSteps.ts";',
    'export { enterScan, leaveScan, nextIndexOf } from "../../../markdown/inlineScanMemo.ts";',
    "",
  ].join("\n"),
);
renameSync(staged, ENTRY);

const { enterScan, leaveScan, nextIndexOf, parse, readSteps, resetSteps } =
  loadMarkengineInRealm(relative(ROOT, ENTRY));

// The memo hit is reachable from the public parse ("[a [b" makes the footnote
// matcher ask for "]" at 2 and again at 5, and the second ask hits), but one
// lookup's step delta is not observable through it: a parse reports a single
// cumulative total. So the test drives the scan frame the parse itself drives
// — nextIndexOf, the only exported path into indexOfIn — against the same
// counter that parse counts into.
test("a memo hit adds 0", () => {
  const text = "[a [b";
  const outer = enterScan(text);
  try {
    resetSteps();
    assert.equal(nextIndexOf(text, "]", 2), -1); // a miss: the memo scans and counts
    assert.ok(readSteps() > 0, "the memo's first lookup counted its scan");
    resetSteps();
    assert.equal(nextIndexOf(text, "]", 5), -1); // second lookup of the same needle: a hit
    assert.equal(readSteps(), 0, "a memo hit adds 0");
  } finally {
    leaveScan(outer);
  }
});

test("parse counts steps", () => {
  resetSteps();
  parse("a *b* [c](d) <span>e</span>");
  assert.ok(readSteps() > 0);
});

test("plain prose is linear", () => {
  const paragraph = "A sentence of plain prose runs here. Letters, spaces and full stops. ";
  resetSteps();
  parse(paragraph);
  const oneFold = readSteps();
  assert.ok(oneFold > 0);
  resetSteps();
  parse(paragraph.repeat(10));
  const tenFold = readSteps();
  assert.ok(tenFold <= 12 * oneFold, `steps grew superlinearly: 1x ${oneFold}, 10x ${tenFold}`);
});
