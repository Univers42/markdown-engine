/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   check-scan-census.cjs                              :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/11/20          by dlesieur          #+#    #+#             */
/*   Updated: 2026/11/20          by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

// ADR 0068 D2: the census of raw scans on the parse+render path. Each scope file's
// raw scan calls and loops are counted from its TypeScript syntax tree and compared
// with scripts/scan-census.json; any difference fails and names the file and kind.
// A step counter (markdown/scanSteps.ts) only sees the scans routed through it, so
// a new raw scan must be routed or listed here with a reason.
//
// The scope is the census "scope" list; an entry with a `*` in its file name stands
// for every file of its directory that matches, so a file added on the path (a
// parserInline split, a new htmlSubset module) is in scope and fails until it has a
// census entry.
//
// Caveat: it pins counts, not bounds: a wider loop or scan at an existing site
// passes (under-report). A call is matched by method name alone, so an array's
// .includes or .slice counts like a string's (over-report, merely noisy).
// Caveat: under-report: methods outside KINDS (replaceAll, trim, toLowerCase,
// startsWith, findIndex, some, forEach), aliased calls (String.prototype.indexOf
// .call(...), x["indexOf"](...)) and recursion are not counted. A `*` matches
// files in its own directory only; a new subdirectory is not walked.

const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const KINDS = ["indexOf", "lastIndexOf", "includes", "search", "match", "matchAll", "exec", "test",
  "replace", "split", "slice", "substring"];
const LOOP_KINDS = new Set([
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
]);

function zeroCounts() {
  const counts = {};
  for (const kind of KINDS) {
    counts[kind] = 0;
  }
  counts.loop = 0;
  return counts;
}

function scanKindOf(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const name = node.expression.name.text;
    if (KINDS.includes(name)) {
      return name;
    }
  }
  return LOOP_KINDS.has(node.kind) ? "loop" : null;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function countScans(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const counts = zeroCounts();
  const sites = [];
  function visit(node) {
    const kind = scanKindOf(node);
    if (kind !== null) {
      counts[kind] += 1;
      sites.push({ line: lineOf(sourceFile, node), kind });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { counts, sites };
}

function readScopeText(root, relativePath) {
  try {
    return fs.readFileSync(path.join(root, ...relativePath.split("/")), "utf8");
  } catch {
    throw new Error(`scan census: ${relativePath} is missing`);
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandScopeEntry(root, entry) {
  if (!entry.includes("*")) {
    return [entry];
  }
  const slash = entry.lastIndexOf("/");
  const directory = entry.slice(0, slash);
  const nameSource = entry.slice(slash + 1).split("*").map(escapeRegExp).join(".*");
  const namePattern = new RegExp(`^${nameSource}$`);
  const names = fs.readdirSync(path.join(root, ...directory.split("/")), { withFileTypes: true })
    .filter((dirent) => dirent.isFile() && namePattern.test(dirent.name))
    .map((dirent) => `${directory}/${dirent.name}`);
  if (names.length === 0) {
    throw new Error(`scan census: ${entry} matches no file`);
  }
  return names.sort();
}

function scopeOf(root, scope) {
  return [...new Set(scope.flatMap((entry) => expandScopeEntry(root, entry)))];
}

function censusOf(root, scope) {
  const census = {};
  for (const relativePath of scope) {
    census[relativePath] = countScans(readScopeText(root, relativePath), relativePath).counts;
  }
  return census;
}

function hasScans(counts) {
  return [...KINDS, "loop"].some((kind) => (counts[kind] ?? 0) > 0);
}

function reasonOf(entry) {
  return typeof entry?.reason === "string" && entry.reason.trim() !== "";
}

function countDifferences(filePath, expectedCounts, counts) {
  const differences = [];
  for (const kind of [...KINDS, "loop"]) {
    const expectedCount = expectedCounts[kind] ?? 0;
    const foundCount = counts[kind] ?? 0;
    if (expectedCount !== foundCount) {
      differences.push(`${filePath}: ${kind} expected ${expectedCount}, found ${foundCount}`);
    }
  }
  return differences;
}

function compare(expected, actual) {
  const differences = [];
  const paths = new Set([...Object.keys(expected.files), ...Object.keys(actual)]);
  for (const filePath of paths) {
    const entry = expected.files[filePath];
    const counts = actual[filePath];
    if (entry === undefined) {
      differences.push(`${filePath}: not in the census`);
    }
    if (counts === undefined) {
      differences.push(`${filePath}: in the census but not in scope`);
    }
    if (entry !== undefined && counts !== undefined) {
      differences.push(...countDifferences(filePath, entry.counts ?? {}, counts));
    }
    if (counts !== undefined && hasScans(counts) && !reasonOf(entry)) {
      differences.push(`${filePath}: raw scans remain but no reason is given`);
    }
  }
  return differences;
}

function listSites(root, scope) {
  for (const relativePath of scope) {
    const { sites } = countScans(readScopeText(root, relativePath), relativePath);
    for (const site of sites) {
      console.log(`${relativePath}:${site.line} ${site.kind}`);
    }
  }
}

function writeCensus(censusFile, census, actual) {
  const files = {};
  for (const relativePath of Object.keys(actual)) {
    files[relativePath] = {
      reason: census.files[relativePath]?.reason ?? "",
      counts: actual[relativePath],
    };
  }
  fs.writeFileSync(censusFile, `${JSON.stringify({ ...census, files }, null, 2)}\n`);
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const censusFile = path.join(root, "scripts", "scan-census.json");
  const census = JSON.parse(fs.readFileSync(censusFile, "utf8"));
  const scope = scopeOf(root, census.scope);
  const actual = censusOf(root, scope);

  if (process.argv[2] === "--list") {
    listSites(root, scope);
  } else if (process.argv[2] === "--write") {
    writeCensus(censusFile, census, actual);
  } else {
    const differences = compare(census, actual);
    if (differences.length > 0) {
      console.error(differences.join("\n"));
      process.exit(1);
    }
    console.log(`scan census: ${Object.keys(actual).length} files match`);
  }
}

module.exports = { KINDS, countScans, censusOf, compare, scopeOf };
