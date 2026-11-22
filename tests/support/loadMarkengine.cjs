"use strict";

// Shared loader: bundles the TS engine entry with esbuild to disk cache
// so .cjs tests can exercise the public API safely in the current realm.
const { join, resolve } = require("node:path");
const { mkdirSync, writeFileSync, existsSync, renameSync, readdirSync, readFileSync, unlinkSync } = require("node:fs");
const { createHash } = require("node:crypto");
const esbuild = require("esbuild");

const MARKENGINE_ROOT = resolve(__dirname, "..", "..");
const CACHE_DIR = join(MARKENGINE_ROOT, "node_modules/.cache/loadMarkengine");
mkdirSync(CACHE_DIR, { recursive: true });

const reactStubPath = join(CACHE_DIR, "react-stub.cjs");
if (!existsSync(reactStubPath)) {
  writeFileSync(
    reactStubPath,
    `"use strict";
module.exports = {
  Fragment: Symbol.for("react.fragment"),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
};
`
  );
}

let cachedSourceTreeHash = null;

function computeSourceTreeHash() {
  if (cachedSourceTreeHash) return cachedSourceTreeHash;
  const hash = createHash("sha256");
  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (
        ent.name === "node_modules" ||
        ent.name === ".git" ||
        ent.name === "dist" ||
        ent.name === ".cache" ||
        ent.name === "coverage"
      ) {
        continue;
      }
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (/\.(tsx?|json)$/.test(ent.name)) {
        hash.update(ent.name);
        hash.update(readFileSync(full));
      }
    }
  }
  walk(MARKENGINE_ROOT);
  cachedSourceTreeHash = hash.digest("hex").slice(0, 16);
  return cachedSourceTreeHash;
}

const memoized = new Map();

function bundleToDisk(entry) {
  const fullPath = resolve(MARKENGINE_ROOT, entry);
  if (!fullPath.startsWith(MARKENGINE_ROOT)) {
    throw new Error("Invalid entry point: path traversal detected");
  }
  const safeName = entry.replace(/[/\\.]/g, "_");
  const treeHash = computeSourceTreeHash();
  const outfile = join(CACHE_DIR, `${safeName}.${treeHash}.cjs`);

  if (!existsSync(outfile)) {
    const tmpFile = `${outfile}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    esbuild.buildSync({
      entryPoints: [fullPath],
      bundle: true,
      platform: "node",
      format: "cjs",
      alias: { react: reactStubPath },
      outfile: tmpFile,
      tsconfig: join(MARKENGINE_ROOT, "tsconfig.json"),
    });
    try {
      renameSync(tmpFile, outfile);
    } catch {
      try {
        unlinkSync(tmpFile);
      } catch {}
    }
  }

  return outfile;
}

function loadMarkengine(entry = "index.ts") {
  if (memoized.has(entry)) {
    return memoized.get(entry);
  }
  const outfile = bundleToDisk(entry);
  delete require.cache[require.resolve(outfile)];
  const mod = require(outfile);
  memoized.set(entry, mod);
  return mod;
}

function loadMarkengineInRealm(entry = "index.ts") {
  return loadMarkengine(entry);
}

function loadMarkengineAll() {
  const entries = ["index.ts", "blocks.ts", "inline.ts", "dom.ts", "terminal.ts"];
  return Object.assign({}, ...entries.map((entry) => loadMarkengine(entry)));
}

module.exports = { loadMarkengine, loadMarkengineAll, loadMarkengineInRealm, bundleToDisk, computeSourceTreeHash };
