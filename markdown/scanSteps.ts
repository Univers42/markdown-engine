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

let steps = 0;

function scanStart(text: string, from: number): number {
  const nativeFrom = Number.isNaN(from) ? 0 : from;
  return Math.min(Math.max(nativeFrom, 0), text.length);
}

/** Returns `text.indexOf(needle, from)` and counts the examined span. */
export function countedIndexOf(text: string, needle: string, from: number): number {
  const start = scanStart(text, from);
  const at = text.indexOf(needle, from);
  steps += at === -1 ? text.length - start : at - start + needle.length;
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
    steps += text.length - start;
    return -1;
  }
  steps += match.index - start + match[0].length;
  return match.index;
}

// The throw lives in its own function and the check is two compares: with the
// throw and Number.isInteger in place, "parse inline mixed 10K chars" ran +14.4 % over the
// uncounted engine; moved out, +3.1 % (ADR 0068 D4, d4-ab, 2026-11-20).
function refuseSteps(n: number): never {
  throw new RangeError(`countSteps needs a non-negative integer, got ${n}`);
}

/** Adds a native scan loop's explicitly reported step count. */
export function countSteps(n: number): void {
  if (!(n >= 0) || n % 1 !== 0) refuseSteps(n);
  steps += n;
}

/** Returns the steps counted since the last reset. */
export function readSteps(): number {
  return steps;
}

/** Resets the step counter. */
export function resetSteps(): void {
  steps = 0;
}
