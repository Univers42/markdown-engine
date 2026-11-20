# scan-differential

ADR 0068 D3: the differential gate. The D branch (the working tree, HEAD) must
produce byte-identical output to base `b6dc3fd`; any difference in a parse AST
or a render tree is a behaviour change hiding inside the perf work.

## What it compares

`scripts/scan-differential.cjs` extracts the base tree `b6dc3fd` into
`node_modules/.cache/scan-diff/base` (`git archive | tar -x`, rebuilt every
run), bundles `index.ts` and `react.tsx` from BOTH roots with the loader's
exact esbuild options (`tests/support/loadMarkengine.cjs` — bundle, platform
node, format cjs, the same react stub alias, the root's `tsconfig.json`, plus
`nodePaths` so the base tree resolves this repo's `node_modules`), loads each
bundle with `require`, and prints each bundle's path and sha256.

Every input then runs on both engines in both modes — plain: `parse(src)` then
`renderReact(ast)`; subset: `parse(src, { htmlSubset: true })` then
`renderReact(ast, { htmlSubset: { mediaPrefixes: [] } })` (the bench's calls,
`bench/html-subset-linear.test.cjs:79-82`) — and each side serialises:

- `ast`: `JSON.stringify(ast)`;
- `render`: `JSON.stringify(tree, replacer)`, the replacer mapping a function
  to `"fn:" + (fn.name || "anonymous")` and a symbol to `String(sym)`, because
  the react stub's `createElement` returns `{ type, props, children }` and
  `type` may be a component function;
- a thrown error on either side serialises as `throw:name:message`; both
  sides must throw identically to count as equal.

The two strings are compared with `===`. A difference prints the input name,
mode, part (`ast`/`render`), the first differing character offset, and 40
characters of context from each side. The last line is always
`scan differential: <D> differences over <N> comparisons (<I> inputs x 2 modes x 2 parts)`;
the exit code is 1 when D > 0, else 0.

The inputs, same text fed to both sides:

- the 9 `INPUTS` and 13 `SPAN_SHAPES` copied verbatim from
  `bench/html-subset-linear.test.cjs` (with `README_UNIT` and
  `repeatToBytes`), each expanded at 50 KB and 200 KB, plus the 2
  `DEEP_INPUTS` — the file's 37 bench tests are 9 + 13x2 modes + 2 deep, and
  the script stops and reports if those counts ever drift from the file;
- every string in the corpora exported by `tests/support/*.cjs` (numbers,
  functions and Sets are skipped), named `<file>#<key>#<index>...` by their
  path, so `xssCorpus.cjs#XSS_CORPUS#28#2` is the third string of vector 28;
- `README.md`, `docs.md`, `testing_markdown.md` read from the working tree.

Sanity: with `markdown/htmlSubset/entities.ts` temporarily mutated so `&amp;`
decodes to `&&`, the same command reports 10 differences and exits 1 (the
readme and entity-soup shapes plus the scheme vectors), then the tree restored
to clean.

## Command

Not wired into `npm test` or `npm run quality`; it runs on demand:

    timeout 1800 node scripts/scan-differential.cjs

## Last run

2026-11-20, node 26.13.0, that command, ~5 s:

```
base index.ts -> node_modules/.cache/scan-diff/base-index.cjs sha256:c08b5f2ec77221a14f9a0a799a790aafe37816cfaa41bd021596d70dafbaa4fd
base react.tsx -> node_modules/.cache/scan-diff/base-react.cjs sha256:6a02495421a6b9bad94a5fd876a81e776e4021b84e84c05d8095a22e1cdb9f4b
D index.ts -> node_modules/.cache/scan-diff/d-index.cjs sha256:ee41e7645db741dd2a50efc1e7f68a048078aa8595e84134ee240110b45fa3bb
D react.tsx -> node_modules/.cache/scan-diff/d-react.cjs sha256:d0dd57347301e63c1b6dea6f35c369a3af7e808e1e96b03f9df2e993caa40c4f
scan differential: 0 differences over 1752 comparisons (438 inputs x 2 modes x 2 parts)
```

## Caveat:

Equal output on these inputs is not proof for all inputs: the input list is
finite and mostly known to the branch's authors, so a difference on a shape
nobody listed goes unreported (under-report). The render is compared through
the react stub, so React's own reconciliation, prop diffing and DOM effects
are not exercised. A thrown error is compared by name and message only, in
one process and one V8, so a crash that only agrees under this runtime still
passes. The sha256 lines pin the bundles, not the trees: an unexercised export
of the engine is not compared at all.
