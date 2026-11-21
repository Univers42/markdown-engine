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
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { KINDS, countScans, compare, scopeOf } = require("../scripts/check-scan-census.cjs");

const ROOT = path.resolve(__dirname, "..");

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

// Runs the real CLI on a temporary copy of the real markdown/ tree and census, plus
// one extra file, so the scope the CLI builds is the one under test (D14 review X2).
function runCensusOnCopy(extra) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "scan-census-"));
  try {
    fs.cpSync(path.join(ROOT, "markdown"), path.join(copy, "markdown"), { recursive: true });
    fs.mkdirSync(path.join(copy, "scripts"));
    for (const name of ["check-scan-census.cjs", "scan-census.json"]) {
      fs.copyFileSync(path.join(ROOT, "scripts", name), path.join(copy, "scripts", name));
    }
    if (extra !== undefined) {
      fs.writeFileSync(path.join(copy, ...extra.file.split("/")), extra.text);
    }
    return spawnSync(process.execPath, [path.join(copy, "scripts", "check-scan-census.cjs")], {
      encoding: "utf8",
      env: { ...process.env, NODE_PATH: path.join(ROOT, "node_modules") },
      timeout: 60_000,
    });
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

test("the CLI passes on an unchanged copy of the tree", () => {
  const run = runCensusOnCopy();
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /scan census: \d+ files match/);
});

for (const file of ["markdown/parserInlineX.ts", "markdown/htmlSubset/extra.ts"]) {
  test(`a new ${file} with a raw indexOf fails the CLI`, () => {
    const text = 'export function close(text: string, from: number): number {\n  return text.indexOf("]", from);\n}\n';
    const run = runCensusOnCopy({ file, text });
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stderr, new RegExp(`${file}: not in the census`));
  });
}

test("a scope pattern that matches no file is refused", () => {
  assert.throws(() => scopeOf(ROOT, ["markdown/noSuchFile*"]), /matches no file/);
});
