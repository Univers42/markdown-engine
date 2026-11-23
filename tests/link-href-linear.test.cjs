"use strict";

// osionos#240 S1: the schemeless-domain check in normalizeInlineLinkHref was the regex
// /^[^\s/]+\.[^\s/]+(?:[/?#].*)?$/, quadratic on `.`×N + ` x` and cubic on `.?`×N + `\rx`
// (26 s at 8 KiB through a link destination). Its replacement must answer exactly what the
// regex answered, so the regex stays here as the oracle and nowhere else.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");
const { createRandom } = require("./support/seededRandom.cjs");

const { normalizeInlineLinkHref } = loadMarkengine("inline.ts");
const { parse } = loadMarkengine("index.ts");

const ALPHABET = ["a", ".", "/", "?", "#", " ", "\t", "\r", "\n", "\u2028", "\u00a0", "-"];
const EXHAUSTIVE_MAX_LENGTH = 6;
const RANDOM_CASES = 1_000_000;
const RANDOM_MAX_LENGTH = 40;
const BUDGET_MS = 50;

function oracleNormalize(href) {
  const cleanHref = href.trim();
  if (!cleanHref) return cleanHref;
  if (/^[a-z][a-z\d+.-]*:/i.test(cleanHref) || cleanHref.startsWith("//")) {
    return cleanHref.startsWith("//") ? `https:${cleanHref}` : cleanHref;
  }
  if (/^[^\s/]+\.[^\s/]+(?:[/?#].*)?$/i.test(cleanHref) && !cleanHref.startsWith("/") && !cleanHref.startsWith("#")) {
    return `https://${cleanHref}`;
  }
  return cleanHref;
}

function* everyString(maxLength) {
  const digits = [];
  yield "";
  for (let length = 1; length <= maxLength; length++) {
    digits.length = length;
    digits.fill(0);
    for (;;) {
      yield digits.map((digit) => ALPHABET[digit]).join("");
      let index = length - 1;
      while (index >= 0 && ++digits[index] === ALPHABET.length) digits[index--] = 0;
      if (index < 0) break;
    }
  }
}

function differences(inputs) {
  const found = [];
  let count = 0;
  for (const input of inputs) {
    count++;
    const want = oracleNormalize(input);
    const got = normalizeInlineLinkHref(input);
    if (got !== want && found.length < 5) found.push({ input, want, got });
  }
  return { count, found };
}

function* randomStrings(seed, cases) {
  const random = createRandom(seed);
  for (let index = 0; index < cases; index++) {
    const length = Math.floor(random() * (RANDOM_MAX_LENGTH + 1));
    let text = "";
    for (let char = 0; char < length; char++) text += ALPHABET[Math.floor(random() * ALPHABET.length)];
    yield text;
  }
}

test("link-href-linear: answers the old regex on every string up to length 6 over the 12 symbols", () => {
  const { count, found } = differences(everyString(EXHAUSTIVE_MAX_LENGTH));
  assert.equal(count, (ALPHABET.length ** (EXHAUSTIVE_MAX_LENGTH + 1) - 1) / (ALPHABET.length - 1));
  assert.deepEqual(found, []);
});

test("link-href-linear: answers the old regex on 1,000,000 seeded random strings up to length 40", () => {
  const { count, found } = differences(randomStrings(0x5eed240, RANDOM_CASES));
  assert.equal(count, RANDOM_CASES);
  assert.deepEqual(found, []);
});

test("link-href-linear: keeps spaced hrefs external and leaves line breaks and local paths alone", () => {
  for (const href of ["example.com/my page", "google.com/search?q=hello world", "example.com#a b"]) {
    assert.equal(normalizeInlineLinkHref(href), `https://${href}`);
  }
  for (const href of ["example.com/a\rb", "/a.b", "#a.b"]) {
    assert.equal(normalizeInlineLinkHref(href), href);
  }
});

// Doubles the input up to the attack size and fails at the first step over budget, so the
// cubic regex this replaced fails in seconds here instead of running for hours.
// Caveat: wall-clock on a shared machine. Each step keeps the best of 3 runs, so one load
// spike cannot fail it, but sustained contention over 50 ms per run would (false failure).
function assertWithinBudget(name, run, make, maxUnits) {
  run(make(16));
  const steps = [];
  for (let units = 1024; units < maxUnits; units *= 2) steps.push(units);
  for (const units of [...steps, maxUnits]) {
    const input = make(units);
    let best = Infinity;
    for (let round = 0; round < 3 && best >= BUDGET_MS; round++) {
      const started = performance.now();
      run(input);
      best = Math.min(best, performance.now() - started);
    }
    assert.ok(best < BUDGET_MS, `${name}: ${input.length} chars took ${best.toFixed(1)} ms, budget ${BUDGET_MS} ms`);
  }
}

const HREF_SHAPES = {
  dots_space: (units) => ".".repeat(units) + " x",
  dotq_cr: (units) => ".?".repeat(units) + "\rx",
  dotq_u2028: (units) => ".?".repeat(units) + "\u2028x",
};

for (const [name, make] of Object.entries(HREF_SHAPES)) {
  const maxUnits = name === "dots_space" ? 65_536 : 32_768;
  test(`link-href-linear: normalizeInlineLinkHref on ${name} stays under ${BUDGET_MS} ms up to 64 KiB`, () => {
    assertWithinBudget(name, normalizeInlineLinkHref, make, maxUnits);
  });
}

// The same shapes as a document reaches them: a link destination, the reversed form, a title.
const PARSE_SHAPES = {
  link_dots_space: (units) => "[a](" + ".".repeat(units) + " x)",
  link_dotq_cr: (units) => "[a](" + ".?".repeat(units / 2) + "\rx)",
  link_title_dots: (units) => "[a](" + ".".repeat(units) + ' x "t")',
  link_dots_tab: (units) => "[a](" + ".".repeat(units) + "\tx)",
  link_dotq_u2028: (units) => "[a](" + ".?".repeat(units / 2) + "\u2028x)",
  reversed_link_dots_space: (units) => "(a)[" + ".".repeat(units) + " x]",
  reversed_link_dotq_cr: (units) => "(a)[" + ".?".repeat(units / 2) + "\rx]",
};

for (const [name, make] of Object.entries(PARSE_SHAPES)) {
  test(`link-href-linear: parse of ${name} stays under ${BUDGET_MS} ms up to 64 KiB`, () => {
    assertWithinBudget(name, parse, make, 65_536 - 16);
  });
}
