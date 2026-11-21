// Markdown parser — a deterministic count of the characters native scans examine.
//
// ADR 0068 D: the linearity guard compares work, not wall-clock time. Every scan
// whose cost grows with the input goes through countedIndexOf / countedMatchIndex,
// or reports its loop with countSteps, so a parse+render's step total is the same
// on an idle laptop and a loaded CI runner. Read by bench/ only; no package entry
// re-exports it (D5).
//
// Caveat: only counted sites are counted (the census in scripts/ pins how many raw
// scans remain, not how far each runs). A regex exec counts its span only, never
// its backtracking. Renderer, allocation and GC work is not counted.
// Caveat: a sticky regex miss counts 0, not its span (under-report): execSticky in
// parserInlineMatchers.ts counts a match's length only, so `":" + "a".repeat(50000)`
// walks 50000 emoji-name characters and adds 0. It stays linear today because a
// later ':' ends the run. countedMatchIndex's sticky branch has no caller; a sticky
// miss there would be charged text.length - from for one examined position
// (over-report).

// A Float64Array slot, not a `let`: one 10K-char inline parse counts ~971K steps,
// so a never-reset count passes 2^31 - 1 after ~2,200 parses. Past that a `let`
// holds a heap number and every add allocates one: "parse inline mixed 10K chars"
// went from on par to +16 % at that parse (d4-ab +13.4 %, ADR 0068 D4). The slot
// adds in place and stays exact to 2^53.
const counter = new Float64Array(1);

// The clamp indexOf applies to `from` (NaN and negatives to 0, past the end to the
// end), as compares: Number.isNaN + Math.max + Math.min cost ~2 points of that case.
function scanStart(text: string, from: number): number {
  const length = text.length;
  return from > 0 ? (from < length ? from : length) : 0;
}

/** The span `text.indexOf(needle, from)` examined to answer `at`; counts nothing. */
export function indexOfSpan(text: string, needle: string, from: number, at: number): number {
  return (at === -1 ? text.length : at + needle.length) - scanStart(text, from);
}

/** Returns `text.indexOf(needle, from)` and counts the examined span. */
export function countedIndexOf(text: string, needle: string, from: number): number {
  const at = text.indexOf(needle, from);
  counter[0] += indexOfSpan(text, needle, from, at);
  return at;
}

/** Returns the global or sticky pattern's match index and counts its examined span. */
export function countedMatchIndex(text: string, pattern: RegExp, from: number): number {
  if (!pattern.global && !pattern.sticky) {
    throw new TypeError("countedMatchIndex needs a global or sticky pattern");
  }
  const start = scanStart(text, from);
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  if (match === null) {
    counter[0] += text.length - start;
    return -1;
  }
  counter[0] += match.index - start + match[0].length;
  return match.index;
}

// The throw lives in its own function so countSteps stays two compares and an add.
// The +14.4 % -> +3.1 % once credited to this move was measured at 300 ms per case,
// below the 2^31 crossing above; the crossing was the cost (ADR 0068 D4).
function refuseSteps(n: number): never {
  throw new RangeError(`countSteps needs a non-negative integer, got ${n}`);
}

/** Adds a native scan loop's explicitly reported step count. */
export function countSteps(n: number): void {
  if (!(n >= 0) || n % 1 !== 0) refuseSteps(n);
  counter[0] += n;
}

/** Returns the steps counted since the last reset. */
export function readSteps(): number {
  return counter[0];
}

/** Resets the step counter. */
export function resetSteps(): void {
  counter[0] = 0;
}
