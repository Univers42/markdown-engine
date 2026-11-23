// renderSource's inline tokens: code spans, emphasis, strikethrough, images, links
// and task boxes, leftmost first. The old scanner rebuilt seven regexes per token
// and each rescanned to the end of the line, and the link and image patterns read
// to the end from every "[" without a "]": "a" + 64 KiB of backticks took 1.6 s
// and "a " + "[ " repeated 0.6-1.8 s (osionos#240).
import { enterScan, leaveScan, nextIndexOf } from "../markdown/inlineScanMemo";

export interface InlineToken {
  index: number;
  token: string;
}

type TokenFinder = (line: string, from: number) => InlineToken | null;

function regexFinder(pattern: RegExp): TokenFinder {
  return (line, from) => {
    pattern.lastIndex = from;
    const match = pattern.exec(line);
    return match ? { index: match.index, token: match[0] } : null;
  };
}

/**
 * `!\[[^\]]*\]\([^)]+\)` (image) or `\[[^\]]+\]\([^)]+\)` (link), whichever starts
 * first at or after `from`. Every "[" before a "]" shares that "]" and the "(...)"
 * after it, so one failure there skips them all.
 */
function findBracketToken(line: string, from: number): InlineToken | null {
  let open = nextIndexOf(line, "[", from);
  while (open !== -1) {
    const close = nextIndexOf(line, "]", open + 1);
    if (close === -1) return null;
    const parenClose = line[close + 1] === "(" ? nextIndexOf(line, ")", close + 2) : close;
    if (parenClose === -1) return null;
    const start = open > from && line[open - 1] === "!" ? open - 1 : open;
    if (parenClose > close + 2 && (start < open || close > open + 1)) {
      return { index: start, token: line.slice(start, parenClose + 1) };
    }
    open = nextIndexOf(line, "[", close + 1);
  }
  return null;
}

// Order breaks ties: a link and a task box can both start at one "[".
const FINDERS: TokenFinder[] = [
  regexFinder(/`[^`]*`/g),
  regexFinder(/\*\*[^*]+\*\*/g),
  regexFinder(/\*[^*]+\*/g),
  regexFinder(/~~[^~]+~~/g),
  findBracketToken,
  regexFinder(/\[[ xX]\]/g),
];

// A finder's match at a given start does not depend on where its search began, so
// the leftmost match found from an earlier cursor stays leftmost until the cursor
// passes it, and a finder with no match has none further on: it searches again
// only from past its last match, not once per token.
function nextToken(line: string, cursor: number, found: (InlineToken | null | undefined)[]): InlineToken | null {
  let best: InlineToken | null = null;
  for (let slot = 0; slot < FINDERS.length; slot++) {
    let hit = found[slot];
    if (hit === undefined || (hit !== null && hit.index < cursor)) {
      hit = FINDERS[slot](line, cursor);
      found[slot] = hit;
    }
    if (hit && (best === null || hit.index < best.index)) best = hit;
  }
  return best;
}

/** The inline tokens of `line` in order; the text between them renders as plain. */
export function inlineTokens(line: string): InlineToken[] {
  const outer = enterScan(line);
  try {
    const found: (InlineToken | null | undefined)[] = [];
    const tokens: InlineToken[] = [];
    let token = nextToken(line, 0, found);
    while (token) {
      tokens.push(token);
      token = nextToken(line, token.index + token.token.length, found);
    }
    return tokens;
  } finally {
    leaveScan(outer);
  }
}
