/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   scan-census.test.cjs                               :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/11/20          by dlesieur          #+#    #+#             */
/*   Updated: 2026/11/20          by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

const test = require("node:test");
const assert = require("node:assert/strict");
const { KINDS, countScans, compare } = require("../scripts/check-scan-census.cjs");

function zeroCounts() {
  const counts = {};
  for (const kind of KINDS) {
    counts[kind] = 0;
  }
  counts.loop = 0;
  return counts;
}

test("each raw scan kind is counted", () => {
  const source = 'const a = s.indexOf("x"); s.lastIndexOf("y"); s.includes("z"); s.search(/q/); s.match(/q/); [...s.matchAll(/q/g)]; re.exec(s); re.test(s); s.replace("a", "b"); s.split(","); s.slice(1); s.substring(2);';
  const { counts } = countScans(source, "x.ts");
  for (const kind of KINDS) {
    assert.equal(counts[kind], 1);
  }
  assert.equal(counts.loop, 0);
});

test("loops of every form are counted", () => {
  const source = "for (;;) {} for (const k in o) {} for (const v of a) {} while (x) {} do {} while (y);";
  const { counts } = countScans(source, "x.ts");
  assert.equal(counts.loop, 5);
  for (const kind of KINDS) {
    assert.equal(counts[kind], 0);
  }
});

test("comments and strings are not counted", () => {
  const source = '// s.indexOf("x")\nconst t = "s.indexOf(1)"; /* while (x) {} */';
  const { counts } = countScans(source, "x.ts");
  assert.equal(counts.loop, 0);
  for (const kind of KINDS) {
    assert.equal(counts[kind], 0);
  }
});

test("optional-chained calls are counted", () => {
  const { counts } = countScans("re?.exec(s); s?.slice(1);", "x.ts");
  assert.equal(counts.exec, 1);
  assert.equal(counts.slice, 1);
});

test("a .tsx file parses JSX", () => {
  const { counts } = countScans("const e = <a>{s.slice(1)}</a>;", "x.tsx");
  assert.equal(counts.slice, 1);
});

test("sites carry 1-based lines in order", () => {
  const { sites } = countScans("\ns.slice(1);\nfor (;;) {}", "x.ts");
  assert.deepEqual(sites, [
    { line: 2, kind: "slice" },
    { line: 3, kind: "loop" },
  ]);
});

test("compare names each difference", () => {
  const expected = {
    files: {
      "a.ts": { reason: "", counts: { ...zeroCounts(), slice: 1 } },
      "c.ts": { reason: "x", counts: zeroCounts() },
    },
  };
  const actual = { "a.ts": { ...zeroCounts(), slice: 2 }, "b.ts": zeroCounts() };
  assert.deepEqual(
    compare(expected, actual).sort(),
    [
      "a.ts: slice expected 1, found 2",
      "a.ts: raw scans remain but no reason is given",
      "b.ts: not in the census",
      "c.ts: in the census but not in scope",
    ].sort(),
  );
});

test("equal counts with a reason compare clean", () => {
  const expected = {
    files: {
      "a.ts": { reason: "bounded by the 8-char tag name", counts: { ...zeroCounts(), slice: 1 } },
    },
  };
  const actual = { "a.ts": { ...zeroCounts(), slice: 1 } };
  assert.deepEqual(compare(expected, actual), []);
});
