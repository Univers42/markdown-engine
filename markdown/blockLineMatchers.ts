// Linear matchers for the lines whose regexes backtracked quadratically on one long
// line (osionos#240 M240-1: 13.2 s for a 128 KiB heading line, 8.0 s for a 128 KiB
// delimiter-like line; 1.2-2.7 s for a 64 KiB toggle opener, source heading, fence,
// quote or list line, or link title, whose `(.*)$` tail held a line terminator).
// Each accepts exactly what its regex accepted and returns the same captures;
// tests/block-line-linear.test.cjs and tests/line-tail-linear.test.cjs check them
// against the old regexes.

const WHITESPACE = /\s/;
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;
const HEADING_ID_CHAR = /[A-Za-z0-9_-]/;
const DELIMITER_CELL = /^:?-+:?$/;
const LIST_BULLET = /[-*+]/;
const DIGIT = /[0-9]/;
const TASK_BOX = /^\[[ xX]\]$/;

function isSpace(ch: string): boolean {
  return WHITESPACE.test(ch);
}

function skipSpaceForward(text: string, from: number): number {
  let index = from;
  while (index < text.length && isSpace(text[index])) index++;
  return index;
}

function skipSpaceBackward(text: string, from: number, floor: number): number {
  let index = from;
  while (index > floor && isSpace(text[index - 1])) index--;
  return index;
}

// Where the optional closing sequence `\s+#+` starts when the line ends with one
// past `start`, else null. The #-run must end where the trailing whitespace begins.
function closingSequenceStart(line: string, start: number, trailing: number): number | null {
  let hashes = trailing;
  while (hashes > start && line[hashes - 1] === "#") hashes--;
  if (hashes === trailing || hashes === start || !isSpace(line[hashes - 1])) return null;
  return skipSpaceBackward(line, hashes, start);
}

/**
 * `^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$` without backtracking. The lazy text is the
 * shortest run after the opening whitespace that leaves only whitespace, or a
 * closing `\s+#+\s*`, to the end; `.` cannot cross a line terminator, so a
 * terminator inside that run means no heading.
 */
export function matchAtxHeading(line: string): { level: number; text: string } | null {
  let level = 0;
  while (level < line.length && line[level] === "#") level++;
  if (level < 1 || level > 6 || level >= line.length || !isSpace(line[level])) return null;
  const start = skipSpaceForward(line, level);
  const trailing = skipSpaceBackward(line, line.length, start);
  const end = closingSequenceStart(line, start, trailing) ?? trailing;
  const text = line.slice(start, end);
  return LINE_TERMINATOR.test(text) ? null : { level, text };
}

/** `\s*\{#([A-Za-z0-9_-]+)\}\s*$` on a heading's text, scanned from the end. */
export function splitHeadingCustomId(text: string): { text: string; id?: string } {
  const close = skipSpaceBackward(text, text.length, 0) - 1;
  if (close < 0 || text[close] !== "}") return { text };
  let idStart = close;
  while (idStart > 0 && HEADING_ID_CHAR.test(text[idStart - 1])) idStart--;
  if (idStart === close || idStart < 2 || text[idStart - 1] !== "#" || text[idStart - 2] !== "{") {
    return { text };
  }
  const matchStart = skipSpaceBackward(text, idStart - 2, 0);
  return { text: text.slice(0, matchStart), id: text.slice(idStart, close) };
}

function charRunEnd(text: string, from: number, ch: string): number {
  let index = from;
  while (index < text.length && text[index] === ch) index++;
  return index;
}

// `(.*)$` from `from`: `.` matches everything but a line terminator.
function reachesLineEnd(text: string, from: number): boolean {
  return !LINE_TERMINATOR.test(text.slice(from));
}

/**
 * Where `\s*(.*)$` puts `.*` when it starts at `from`, or null when it fails. The
 * greedy `\s*` takes the whole run; `.` cannot match a line terminator, and giving
 * whitespace back never helps because the terminator stays inside what `.*` must
 * cover. The regexes rescanned the tail once per split of the run.
 */
export function lineTailStart(text: string, from: number): number | null {
  const start = skipSpaceForward(text, from);
  return reachesLineEnd(text, start) ? start : null;
}

/** `^(#{1,6})>\s*(.*)$`: the compact toggle heading `##> summary`. */
export function matchCompactToggle(line: string): { level: number; text: string } | null {
  const level = charRunEnd(line, 0, "#");
  if (level < 1 || level > 6 || line[level] !== ">") return null;
  const start = lineTailStart(line, level + 1);
  return start === null ? null : { level, text: line.slice(start) };
}

// Each `\s*` here is followed by a character `\s` cannot match, so the prefix has
// one way to match; only the `\s*(.*)$` tail had to move to lineTailStart.
const BRACKET_TOGGLE_PREFIX = /^>\s*(?:\[\s*>\s*\]|\[toggle\])/i;

/** `^>\s*(?:\[\s*>\s*\]|\[toggle\])\s*(.*)$` (case-insensitive): the summary. */
export function matchBracketToggle(line: string): string | null {
  const prefix = BRACKET_TOGGLE_PREFIX.exec(line);
  if (!prefix) return null;
  const start = lineTailStart(line, prefix[0].length);
  return start === null ? null : line.slice(start);
}

// `(#{1,6})\s+(.*)$` from `from`: a 1-6 #-run ends where whitespace starts, so a
// longer run, or none, has no match.
function matchMarkerAndTail(line: string, from: number): { markerEnd: number; tailStart: number } | null {
  const markerEnd = charRunEnd(line, from, "#");
  const level = markerEnd - from;
  if (level < 1 || level > 6) return null;
  const tailStart = lineTailStart(line, markerEnd);
  return tailStart === null || tailStart === markerEnd ? null : { markerEnd, tailStart };
}

/** `^>\s+(#{1,6})\s+(.*)$`: the quoted toggle heading `> ## summary`. */
export function matchQuotedHeadingToggle(line: string): { level: number; text: string } | null {
  if (line[0] !== ">") return null;
  const markerStart = skipSpaceForward(line, 1);
  if (markerStart === 1) return null;
  const marker = matchMarkerAndTail(line, markerStart);
  if (!marker) return null;
  return { level: marker.markerEnd - markerStart, text: line.slice(marker.tailStart) };
}

/** `^(\s{0,3})(#{1,6})(\s+)(.*)$`: a heading line split into its source parts. */
export function matchHeadingMarker(line: string): { indent: string; marker: string; space: string; text: string } | null {
  const markerStart = skipSpaceForward(line, 0);
  if (markerStart > 3) return null;
  const marker = matchMarkerAndTail(line, markerStart);
  if (!marker) return null;
  return {
    indent: line.slice(0, markerStart),
    marker: line.slice(markerStart, marker.markerEnd),
    space: line.slice(marker.markerEnd, marker.tailStart),
    text: line.slice(marker.tailStart),
  };
}

type SourceParts = { indent: string; marker: string; text: string };

function sourceParts(line: string, markerStart: number, markerEnd: number): SourceParts {
  return {
    indent: line.slice(0, markerStart),
    marker: line.slice(markerStart, markerEnd),
    text: line.slice(markerEnd),
  };
}

// The source-line regexes below open with `^(\s*)` and a marker `\s` cannot match, so
// the indent is the whole whitespace run. Each later quantifier is greedy and giving
// back only moves characters into the `(.*)$` tail, which keeps any terminator the
// greedy tail held: the greedy split is the only one that can match.

/** `^(\s*)(```+|~~~+)(.*)$`: a fence line split into its source parts. */
export function matchFenceMarker(line: string): SourceParts | null {
  const markerStart = skipSpaceForward(line, 0);
  const fence = line.charAt(markerStart);
  if (fence !== "`" && fence !== "~") return null;
  const markerEnd = charRunEnd(line, markerStart, fence);
  if (markerEnd - markerStart < 3 || !reachesLineEnd(line, markerEnd)) return null;
  return sourceParts(line, markerStart, markerEnd);
}

/** `^(\s*)(>+\s?)(.*)$`: a quote line split into its source parts. */
export function matchQuoteMarker(line: string): SourceParts | null {
  const markerStart = skipSpaceForward(line, 0);
  const runEnd = charRunEnd(line, markerStart, ">");
  if (runEnd === markerStart) return null;
  const markerEnd = isSpace(line.charAt(runEnd)) ? runEnd + 1 : runEnd;
  return reachesLineEnd(line, markerEnd) ? sourceParts(line, markerStart, markerEnd) : null;
}

// `[-*+]` or `\d+[.)]` at `from`: where the bullet ends, or null.
function listBulletEnd(line: string, from: number): number | null {
  if (LIST_BULLET.test(line.charAt(from))) return from + 1;
  let digitsEnd = from;
  while (DIGIT.test(line.charAt(digitsEnd))) digitsEnd++;
  const punctuation = line.charAt(digitsEnd);
  return digitsEnd > from && (punctuation === "." || punctuation === ")") ? digitsEnd + 1 : null;
}

// `(\[[ xX]\]\s+)?` at `from`: where the task box and its whitespace end, or `from`.
function taskBoxEnd(line: string, from: number): number {
  if (!TASK_BOX.test(line.slice(from, from + 3))) return from;
  const end = skipSpaceForward(line, from + 3);
  return end === from + 3 ? from : end;
}

/** `^(\s*)([-*+]\s+|\d+[.)]\s+)(\[[ xX]\]\s+)?(.*)$`; `task` is "" without a box. */
export function matchListMarker(line: string): (SourceParts & { task: string }) | null {
  const markerStart = skipSpaceForward(line, 0);
  const bulletEnd = listBulletEnd(line, markerStart);
  if (bulletEnd === null) return null;
  const markerEnd = skipSpaceForward(line, bulletEnd);
  if (markerEnd === bulletEnd) return null;
  const textStart = taskBoxEnd(line, markerEnd);
  if (!reachesLineEnd(line, textStart)) return null;
  const parts = sourceParts(line, markerStart, markerEnd);
  return { ...parts, task: line.slice(markerEnd, textStart), text: line.slice(textStart) };
}

/**
 * `^(.*?)\s+"([^"]*)"$`: a link destination's `url "title"`. The title opens at the
 * last quote before the closing one; the lazy url stops where the whitespace before
 * that quote starts, and `.` cannot cross a line terminator, so one in the url fails
 * every longer url too.
 */
export function splitQuotedTitle(text: string): { target: string; title: string } | null {
  const close = text.length - 1;
  if (close < 1 || text[close] !== '"') return null;
  const open = text.lastIndexOf('"', close - 1);
  if (open < 1) return null;
  const targetEnd = skipSpaceBackward(text, open, 0);
  if (targetEnd === open || LINE_TERMINATOR.test(text.slice(0, targetEnd))) return null;
  return { target: text.slice(0, targetEnd), title: text.slice(open + 1, close) };
}

/**
 * GFM delimiter row `^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$`, cell by cell:
 * a blank piece before the first pipe or after the last is an outer pipe, every
 * other piece is one `:?-+:?` cell. `trim` strips the same set `\s` matches.
 */
export function isTableDelimiterRow(line: string): boolean {
  const pieces = line.split("|");
  const first = pieces.length > 1 && pieces[0].trim() === "" ? 1 : 0;
  const last = pieces.length > first + 1 && pieces[pieces.length - 1].trim() === ""
    ? pieces.length - 1
    : pieces.length;
  if (first >= last) return false;
  for (let index = first; index < last; index++) {
    if (!DELIMITER_CELL.test(pieces[index].trim())) return false;
  }
  return true;
}
