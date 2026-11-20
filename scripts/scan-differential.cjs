/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   scan-differential.cjs                              :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/11/20          by dlesieur          #+#    #+#             */
/*   Updated: 2026/11/20          by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

// ADR 0068 D3: the differential gate — the D branch (HEAD) must produce
// byte-identical output to base b6dc3fd on the shapes the branch touched.
// Both trees are bundled with the loader's esbuild options
// (tests/support/loadMarkengine.cjs) and loaded in one process; every input
// runs through parse and renderReact in plain and subset mode, and each
// side's AST and stub-render tree is serialised and compared with ===.
// A thrown error is serialised as throw:name:message on both sides, so a
// crash only counts as equal when both sides crash the same way.
// Caveat: equal output on these inputs is not proof for all inputs
// (under-report); the render is compared through the react stub, so React's
// own reconciliation is not exercised.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const CACHE_DIR = path.join(ROOT, "node_modules", ".cache", "scan-diff");
const BASE_DIR = path.join(CACHE_DIR, "base");
const BASE_COMMIT = "b6dc3fd";
const SIZES = [50 * 1024, 200 * 1024];
const DOC_FILES = ["README.md", "docs.md", "testing_markdown.md"];
const TAR_CAP = 1 << 28;
// Requiring the loader creates the react stub both bundles alias, so base
// and D render through the exact same createElement.
require(path.join(ROOT, "tests", "support", "loadMarkengine.cjs"));
const REACT_STUB = path.join(ROOT, "node_modules", ".cache", "loadMarkengine", "react-stub.cjs");

function extractBase() {
  fs.rmSync(BASE_DIR, { recursive: true, force: true });
  fs.mkdirSync(BASE_DIR, { recursive: true });
  const archive = execFileSync("git", ["archive", BASE_COMMIT], { cwd: ROOT, maxBuffer: TAR_CAP });
  execFileSync("tar", ["-x", "-f", "-", "-C", BASE_DIR], { input: archive, maxBuffer: TAR_CAP });
}

// The loader's options (tests/support/loadMarkengine.cjs:38-46) plus
// nodePaths, so the extracted base tree resolves the repo's node_modules.
function bundleOf(rootDir, entry, outName, label) {
  const outfile = path.join(CACHE_DIR, outName);
  esbuild.buildSync({
    entryPoints: [path.join(rootDir, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    alias: { react: REACT_STUB },
    outfile,
    tsconfig: path.join(rootDir, "tsconfig.json"),
    nodePaths: [path.join(ROOT, "node_modules")],
  });
  const sha = crypto.createHash("sha256").update(fs.readFileSync(outfile)).digest("hex");
  console.log(`${label} ${entry} -> ${path.relative(ROOT, outfile)} sha256:${sha}`);
  return require(outfile);
}

const README_UNIT = [
  '<div align="center">',
  '  <img src="https://a.io/banner.png" width="100%" alt="banner"/>',
  '  <h1 align="center">Hi &amp; welcome</h1>',
  "</div>",
  "",
  "## Stack",
  "",
  '<table><tr><td align="center" width="50%">',
  "",
  "**C** and [docs](https://a.io/d) &mdash; <kbd>Ctrl</kbd>+<kbd>K</kbd>",
  "",
  "```c",
  "int main(void) { return 0; }",
  "```",
  "",
  '</td><td valign="top"><img src="https://a.io/x.svg" height="20"/> <sub>v1</sub></td></tr></table>',
  "",
  "<details><summary>More</summary>",
  "",
  "- one <b>two</b>",
  "- <a href=\"https://a.io/\" title=\"t\">three</a>",
  "",
  "</details>",
  "<!-- a comment -->",
  "",
].join("\n");

// Adversarial shapes from the U3-5 structure class: what an O(n^2) tokenizer or
// a rescanning block parser chokes on.
const INPUTS = {
  readme: README_UNIT,
  "div soup": "<div>",
  "stray closers": "</div>",
  "no closing >": '<img src="https://a.io/x.png" alt="',
  "unclosed quote": '<a href="https://a.io/ title=x>t</a> ',
  "entity soup": '<a href="https://a.io/&#x41;&amp;" title="&amp;&#x41;&#106&colon;&Tab;&bogus &">&lt;&#65;</a> ',
  "comment opens": "<!-- x ",
  "less-than soup": "a < b <c <",
  "attribute soup": '<p align="left" align=right x="y" onclick="z" ',
};

function repeatToBytes(unit, bytes) {
  const copies = Math.floor(bytes / Buffer.byteLength(unit, "utf8"));
  return unit.repeat(Math.max(copies, 1));
}

const SPAN_SHAPES = {
  "colour nest": (bytes) => {
    const depth = Math.floor(bytes / 19);
    return "[color=red]".repeat(depth) + "x" + "[/color]".repeat(depth);
  },
  "emphasis openers": (bytes) => repeatToBytes("*a ", bytes),
  "link of tags": (bytes) => repeatToBytes("[<x ", bytes),
  "link brackets": (bytes) => repeatToBytes("[x ", bytes),
  "link of less-thans": (bytes) => repeatToBytes("[< ", bytes),
  "quote nest": (bytes) => "> ".repeat(Math.floor((bytes - 1) / 2)) + "x",
  // Found after the review by the same probe: 14.3-16.0 at 200 KB / 50 KB, the
  // half-closed nests 12 s (colour) and 88 s (underline). With each closer
  // answer kept for the scan, and a refused tag left in the text run, 3 runs:
  // 3.78-4.47 (the subset run of inline tags was 4.60-5.24 while each refused
  // tag's text was appended on its own).
  "colour nest, half closed": (bytes) => {
    const depth = Math.floor((bytes - 1) / 15);
    return "[color=red]".repeat(depth) + "x" + "[/color]".repeat(depth >> 1);
  },
  "underline nest, half closed": (bytes) => {
    const depth = Math.floor((bytes - 1) / 5);
    return "[u]".repeat(depth) + "x" + "[/u]".repeat(depth >> 1);
  },
  "colour openers": (bytes) => repeatToBytes("[color=x ", bytes),
  "footnote refs": (bytes) => repeatToBytes("[^a ", bytes),
  "inline tags": (bytes) => repeatToBytes("<b>", bytes),
  "reversed links": (bytes) => repeatToBytes("(a)[b ", bytes),
  "page link ids": (bytes) => repeatToBytes("[[page:a ", bytes),
};

// Both overflowed the call stack (RangeError) before the nesting budget; the
// colour run took 160-178 s to get there (logs/shapes-rebased.log, 2026-11-18).
const DEEP_INPUTS = {
  "quote x2000 (4 KB)": "> ".repeat(2000) + "x",
  "colour x5000": "[color=red]".repeat(5000) + "x" + "[/color]".repeat(5000),
};

function pushSized(out, name, build) {
  for (const bytes of SIZES) out.push({ name: `${name} @${bytes / 1024} KB`, source: build(bytes) });
}

// The bench file has 13 SPAN_SHAPES, not the ADR's 14: its 37 tests are
// 9 + 13x2 modes + 2 DEEP_INPUTS (the ADR's 9 + 14x2 folds the deep pair in).
// The copy stays verbatim, so these pins are the file's own counts.
function benchInputs(out) {
  const inputCount = Object.keys(INPUTS).length;
  const shapeCount = Object.keys(SPAN_SHAPES).length;
  const deepCount = Object.keys(DEEP_INPUTS).length;
  if (inputCount !== 9 || shapeCount !== 13 || deepCount !== 2) {
    console.error(`scan differential: bench shape drift, INPUTS ${inputCount} + SPAN_SHAPES ${shapeCount} + DEEP_INPUTS ${deepCount} is not 9 + 13 + 2 (37 bench tests = 9 + 13x2 + 2); recopy bench/html-subset-linear.test.cjs`);
    return false;
  }
  for (const [name, unit] of Object.entries(INPUTS)) pushSized(out, name, (bytes) => repeatToBytes(unit, bytes));
  for (const [name, build] of Object.entries(SPAN_SHAPES)) pushSized(out, name, build);
  for (const [name, source] of Object.entries(DEEP_INPUTS)) out.push({ name, source });
  return true;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Every string in the corpora exported by tests/support/*.cjs, named by its
// path: <file>#<key>#<index>... Non-strings (numbers, functions, Sets) are
// skipped, so only values that can be parsed are ever fed to an engine.
function walkStrings(value, file, where, out) {
  if (typeof value === "string") {
    out.push({ name: [file, ...where].join("#"), source: value });
    return;
  }
  const descend = (key, item) => walkStrings(item, file, [...where, key], out);
  if (Array.isArray(value)) value.forEach((item, index) => descend(`${index}`, item));
  else if (isPlainObject(value)) for (const [key, item] of Object.entries(value)) descend(key, item);
}

function corpusInputs(out) {
  const support = path.join(ROOT, "tests", "support");
  const files = fs.readdirSync(support).filter((name) => name.endsWith(".cjs")).sort();
  for (const file of files) walkStrings(require(path.join(support, file)), file, "", out);
}

// The react stub's createElement returns { type, props, children } and type
// may be a component function, so a function serialises as its name and a
// symbol as its description, keeping the JSON comparable across both sides.
const serialiseValue = (key, value) =>
  typeof value === "function" ? "fn:" + (value.name || "anonymous") :
  typeof value === "symbol" ? String(value) : value;

// The bench's calls (bench/html-subset-linear.test.cjs:79-82): plain mode
// parses bare and renders bare; subset mode parses and renders with the
// subset on, media prefixes cleared.
function serialised(engine, source, subset, part) {
  try {
    const ast = subset ? engine.parse(source, { htmlSubset: true }) : engine.parse(source);
    if (part === "ast") return JSON.stringify(ast);
    const tree = subset ?
      engine.renderReact(ast, { htmlSubset: { mediaPrefixes: [] } }) :
      engine.renderReact(ast);
    return JSON.stringify(tree, serialiseValue);
  } catch (err) {
    return "throw:" + err.name + ":" + err.message;
  }
}

function reportDifference(name, subset, part, base, head) {
  const shared = Math.min(base.length, head.length);
  let offset = 0;
  while (offset < shared && base[offset] === head[offset]) offset += 1;
  console.log(`DIFF ${name} mode=${subset ? "subset" : "plain"} part=${part} offset=${offset}`);
  console.log(`  base: ${JSON.stringify(base.slice(offset, offset + 40))}`);
  console.log(`  D:    ${JSON.stringify(head.slice(offset, offset + 40))}`);
}

function buildInputs() {
  const inputs = [];
  if (!benchInputs(inputs)) return null;
  corpusInputs(inputs);
  for (const name of DOC_FILES) {
    inputs.push({ name, source: fs.readFileSync(path.join(ROOT, name), "utf8") });
  }
  return inputs;
}

function runDifferential(base, head, inputs) {
  let differences = 0;
  let comparisons = 0;
  for (const input of inputs) {
    for (const subset of [false, true]) {
      for (const part of ["ast", "render"]) {
        comparisons += 1;
        const baseOut = serialised(base, input.source, subset, part);
        const headOut = serialised(head, input.source, subset, part);
        if (baseOut !== headOut) {
          differences += 1;
          reportDifference(input.name, subset, part, baseOut, headOut);
        }
      }
    }
  }
  return { differences, comparisons };
}

function engineOf(rootDir, indexName, reactName, label) {
  return {
    parse: bundleOf(rootDir, "index.ts", indexName, label).parse,
    renderReact: bundleOf(rootDir, "react.tsx", reactName, label).renderReact,
  };
}

function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  extractBase();
  const base = engineOf(BASE_DIR, "base-index.cjs", "base-react.cjs", "base");
  const head = engineOf(ROOT, "d-index.cjs", "d-react.cjs", "D");
  const inputs = buildInputs();
  if (inputs === null) {
    process.exitCode = 1;
    return;
  }
  const { differences, comparisons } = runDifferential(base, head, inputs);
  console.log(`scan differential: ${differences} differences over ${comparisons} comparisons (${inputs.length} inputs x 2 modes x 2 parts)`);
  process.exitCode = differences > 0 ? 1 : 0;
}

main();
