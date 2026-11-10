"use strict";

// Shared loader: bundles the TS engine entry with esbuild to disk cache
// so .cjs tests can exercise the public API safely in the current realm.
const { join, resolve } = require("node:path");
const { mkdirSync, writeFileSync } = require("node:fs");
const esbuild = require("esbuild");

const MARKENGINE_ROOT = resolve(__dirname, "..", "..");
const CACHE_DIR = join(MARKENGINE_ROOT, "node_modules/.cache/loadMarkengine");
mkdirSync(CACHE_DIR, { recursive: true });

const reactStubPath = join(CACHE_DIR, "react-stub.cjs");
writeFileSync(
  reactStubPath,
  `"use strict";
module.exports = {
  Fragment: Symbol.for("react.fragment"),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
};
`
);

function bundleToDisk(entry) {
  const fullPath = resolve(MARKENGINE_ROOT, entry);
  if (!fullPath.startsWith(MARKENGINE_ROOT)) {
    throw new Error("Invalid entry point: path traversal detected");
  }
  const safeName = entry.replace(/[/\\.]/g, "_");
  const outfile = join(CACHE_DIR, `${safeName}.cjs`);

  esbuild.buildSync({
    entryPoints: [fullPath],
    bundle: true,
    platform: "node",
    format: "cjs",
    alias: { react: reactStubPath },
    outfile,
    tsconfig: join(MARKENGINE_ROOT, "tsconfig.json"),
  });

  return outfile;
}

function loadMarkengine(entry = "index.ts") {
  const outfile = bundleToDisk(entry);
  delete require.cache[require.resolve(outfile)];
  return require(outfile);
}

function loadMarkengineInRealm(entry = "index.ts") {
  return loadMarkengine(entry);
}

function loadMarkengineAll() {
  const entries = ["index.ts", "blocks.ts", "inline.ts", "dom.ts", "terminal.ts"];
  return Object.assign({}, ...entries.map((entry) => loadMarkengine(entry)));
}

module.exports = { loadMarkengine, loadMarkengineAll, loadMarkengineInRealm };
