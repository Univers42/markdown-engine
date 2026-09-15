"use strict";

// Shared loader: bundles the TS engine entry with esbuild and evaluates it in a
// fresh VM context (react stubbed) so .cjs tests can exercise the public API.
const { join, resolve } = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");

const MARKENGINE_ROOT = resolve(__dirname, "..", "..");

function loadMarkengine(entry = "index.ts") {
  const bundle = esbuild.buildSync({
    entryPoints: [join(MARKENGINE_ROOT, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["react"],
    write: false,
    tsconfig: join(MARKENGINE_ROOT, "tsconfig.json"),
  });

  const module = { exports: {} };
  const localRequire = (id) =>
    id === "react"
      ? {
          Fragment: Symbol.for("react.fragment"),
          createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
        }
      : require(id);

  vm.runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: localRequire,
    console,
    process,
    Buffer,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    crypto: globalThis.crypto,
  });
  return module.exports;
}

/**
 * The whole public surface merged into one object.
 *
 * The engine deliberately splits its entry points (the root barrel stays
 * React-free and DOM-free so a plain node runner can load it). Fuzz and parity
 * suites care about "no input makes anything throw", not about which subpath a
 * symbol lives on — so they take the union. The per-subpath CONTRACT is asserted
 * in markengine-index.test.cjs instead.
 */
function loadMarkengineAll() {
  const entries = ["index.ts", "blocks.ts", "inline.ts", "dom.ts", "terminal.ts"];
  return Object.assign({}, ...entries.map((entry) => loadMarkengine(entry)));
}

module.exports = { loadMarkengine, loadMarkengineAll };

