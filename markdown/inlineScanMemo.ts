// Markdown parser — what one inline scan has already learned about its text.
//
// The inline parser tries its matchers at every candidate position, and a
// matcher looks ahead for a closer (`]`, `>`, `[/color]`). With no closer in the
// text, every opener rescanned to its end: "[x " x 68,266 (200 KB) took 15x the
// 50 KB time, and a nested colour run was cubic. One frame per parseText call
// remembers, for that text only, the next occurrence of each closer, the
// bracket pairs and the emphasis openers that cannot close, so each is found
// once per scan. The frame replaced caches keyed by text content, which paid a
// full string compare on every lookup once the same text came back as a new
// string (the editor's next parse): "*a " x 68,267 parsed in 10 ms as the same
// string object and in 5,797 ms as an equal copy (node 22, 2026-11-18).
//
// Caveat: the next-closer memo keeps one answer per needle and assumes the
// positions asked about only grow. Two scans for one needle at once (an outer
// matcher and an inner closer loop, both looking for "]") replace each other's
// answer, and each lookup then costs one indexOf, as before the memo: never
// slower than without it, but not linear for such an input. A text that is not
// the current scan's gets a plain indexOf and nothing remembered.

interface NextOccurrence {
  from: number;
  at: number;
}

// The maps are made on first use: most paragraphs are prose and ask nothing.
export interface InlineScanFrame {
  readonly text: string;
  next: Map<string, NextOccurrence> | null;
  unclosable: Map<string, Set<number>> | null;
  brackets: Map<number, number> | null;
}

let frame: InlineScanFrame | null = null;

/** Starts remembering for `text`; pass the result to leaveScan when done. */
export function enterScan(text: string): InlineScanFrame | null {
  const outer = frame;
  frame = { text, next: null, unclosable: null, brackets: null };
  return outer;
}

export function leaveScan(outer: InlineScanFrame | null): void {
  frame = outer;
}

function frameFor(text: string): InlineScanFrame | null {
  return frame !== null && frame.text === text ? frame : null;
}

/** text.indexOf(needle, from), reused while `from` has not passed the answer. */
export function nextIndexOf(text: string, needle: string, from: number): number {
  const scan = frameFor(text);
  if (!scan) return text.indexOf(needle, from);
  const known = scan.next?.get(needle);
  if (known && from >= known.from && (known.at === -1 || from <= known.at)) return known.at;
  const at = text.indexOf(needle, from);
  if (known) {
    known.from = from;
    known.at = at;
  } else {
    (scan.next ??= new Map()).set(needle, { from, at });
  }
  return at;
}

/** The `]` that closes the `[` at openPos, or -1. */
export function findClosingBracket(text: string, openPos: number): number {
  const scan = frameFor(text);
  if (!scan) return pairBrackets(text).get(openPos) ?? -1;
  scan.brackets ??= pairBrackets(text);
  return scan.brackets.get(openPos) ?? -1;
}

function pairBrackets(text: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const open: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 91) open.push(index);
    else if (code === 93 && open.length > 0) pairs.set(open.pop()!, index);
  }
  return pairs;
}

/** The openers of one emphasis marker already known not to close in this scan. */
export function unclosableOpeners(text: string, marker: string): Set<number> {
  const scan = frameFor(text);
  if (!scan) return new Set();
  scan.unclosable ??= new Map();
  let openers = scan.unclosable.get(marker);
  if (!openers) {
    openers = new Set();
    scan.unclosable.set(marker, openers);
  }
  return openers;
}
