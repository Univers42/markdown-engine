// Linear matchers for the block lines whose regexes backtracked quadratically on
// one long line (osionos#240 M240-1: 13.2 s for a 128 KiB heading line, 8.0 s for
// a 128 KiB delimiter-like line). Each accepts exactly what its regex accepted and
// returns the same captures; tests/block-line-linear.test.cjs checks both against
// the old regexes.

const WHITESPACE = /\s/;
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;
const HEADING_ID_CHAR = /[A-Za-z0-9_-]/;
const DELIMITER_CELL = /^:?-+:?$/;

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
