// Markdown parser — what one inline scan has already learned about its text.
//
// The inline parser tries its matchers at every candidate position, and a
// matcher looks ahead for a closer (`]`, `>`, `[/color]`). With no closer in the
// text, every opener rescanned to its end: "[x " x 68,266 (200 KB) took 15x the
// 50 KB time, and a nested colour run was cubic. One frame per parseText call
// remembers, for that text only, the next occurrence of each closer (a string
// or a regex), the bracket and parenthesis pairs, the emphasis openers that
// cannot close and the closes of tagged spans (taggedSpanClose.ts), so each is
// found once per scan. The frame replaced caches keyed by text content, which paid a
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
import { countSteps, countedIndexOf, countedMatchIndex } from "./scanSteps";

interface NextOccurrence {
  from: number;
  at: number;
}

// The maps are made on first use: most paragraphs are prose and ask nothing.
export interface InlineScanFrame {
  readonly text: string;
  next: Map<string | RegExp, NextOccurrence> | null;
  unclosable: Map<string, Set<number>> | null;
  brackets: Map<number, number> | null;
  parens: Map<number, number> | null;
  positions: Map<string, Map<number, number>> | null;
}

let frame: InlineScanFrame | null = null;

/** Starts remembering for `text`; pass the result to leaveScan when done. */
export function enterScan(text: string): InlineScanFrame | null {
  const outer = frame;
  frame = { text, next: null, unclosable: null, brackets: null, parens: null, positions: null };
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
  return nextOccurrence(text, needle, from, indexOfIn);
}

/** Where the global `pattern` next matches text at or after `from`, or -1. */
export function nextMatchIndex(text: string, pattern: RegExp, from: number): number {
  return nextOccurrence(text, pattern, from, matchIndexIn);
}

function indexOfIn(text: string, needle: string, from: number): number {
  return countedIndexOf(text, needle, from);
}

function matchIndexIn(text: string, pattern: RegExp, from: number): number {
  return countedMatchIndex(text, pattern, from);
}

function nextOccurrence<Needle extends string | RegExp>(
  text: string,
  needle: Needle,
  from: number,
  find: (text: string, needle: Needle, from: number) => number,
): number {
  const scan = frameFor(text);
  if (!scan) return find(text, needle, from);
  const known = scan.next?.get(needle);
  if (known && from >= known.from && (known.at === -1 || from <= known.at)) return known.at;
  const at = find(text, needle, from);
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
  countSteps(text.length);
  return pairs;
}

// A link destination ends at the ")" that brings its depth back to 0, a backslash
// hiding the next character. Walked from each "](", an unclosed "[a](" x n read to
// the end of the text every time: 2,147,418,112 of 2,147,811,324 steps at 128K
// chars. The ")" that closes a "(" depends only on the text after it, so one walk
// pairs every "(" of the scan. A link's "(" follows its "]", so it is never
// escaped; an escaped "(" is skipped by the walk and reads -1.
/** The ")" that closes the unescaped "(" at openPos, or -1. */
export function findClosingParen(text: string, openPos: number): number {
  const scan = frameFor(text);
  if (!scan) return pairParens(text).get(openPos) ?? -1;
  scan.parens ??= pairParens(text);
  return scan.parens.get(openPos) ?? -1;
}

function pairParens(text: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const open: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 92) index++;
    else if (code === 40) open.push(index);
    else if (code === 41 && open.length > 0) pairs.set(open.pop()!, index);
  }
  countSteps(text.length);
  return pairs;
}

// CommonMark allows no whitespace, "<" or ">" inside an autolink, so the first of
// them ends one: a ">" closes it, anything else means there is no autolink here.
const AUTOLINK_STOP = /[\s<>]/g;

/** The ">" closing an autolink whose content starts at `from`, or -1. */
export function findAutolinkClose(text: string, from: number): number {
  const stop = nextMatchIndex(text, AUTOLINK_STOP, from);
  return stop !== -1 && text.charCodeAt(stop) === 62 ? stop : -1;
}

/** The openers of one emphasis marker already known not to close in this scan. */
export function unclosableOpeners(text: string, marker: string): Set<number> {
  const scan = frameFor(text);
  if (!scan) return new Set();
  return entryOf((scan.unclosable ??= new Map()), marker, () => new Set<number>());
}

/** Position-to-position answers one matcher (`key`) keeps for this scan. */
export function positionAnswers(text: string, key: string): Map<number, number> {
  const scan = frameFor(text);
  if (!scan) return new Map();
  return entryOf((scan.positions ??= new Map()), key, () => new Map<number, number>());
}

function entryOf<Entry>(table: Map<string, Entry>, key: string, make: () => Entry): Entry {
  let entry = table.get(key);
  if (entry === undefined) {
    entry = make();
    table.set(key, entry);
  }
  return entry;
}
