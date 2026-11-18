// Markdown parser — where a `[tag]…[/tag]` (or `[tag=value]…[/tag]`) span closes.
//
// The close is found by counting nested opens of the same tag. Each opener used
// to walk every token after it, so a colour nest with half its closers, which
// fails at every opener, took 15.7x the 50 KB time at 200 KB (12 s). The close
// depends only on where the content starts (the tokens after a cursor are the
// same whoever asks), so the answer for every content start passed on the way
// is kept for the scan, and each token is read once per scan and tag.
import { nextIndexOf, positionAnswers } from "./inlineScanMemo";

type TaggedSpan = {
  readonly text: string;
  readonly tag: string;
  readonly closeTag: string;
  readonly hasAttribute: boolean;
};

type TaggedToken = { kind: "open"; nextCursor: number } | { kind: "close"; index: number };

/** The `[/tag]` that closes content starting at `start`, or -1. */
export function findMatchingTaggedClose(
  text: string,
  start: number,
  tag: string,
  hasAttribute: boolean,
): number {
  const span: TaggedSpan = { text, tag, closeTag: `[/${tag}]`, hasAttribute };
  const known = positionAnswers(text, hasAttribute ? `[${tag}=` : `[${tag}]`);
  // waiting[i] holds the content starts that close where the i-th open does.
  const waiting: number[][] = [[start]];
  let cursor = start;
  for (;;) {
    const close = known.get(cursor) ?? closeOrInnerStart(span, cursor, waiting);
    if (close === null) {
      cursor = waiting[waiting.length - 1][0];
      continue;
    }
    for (const at of waiting.pop()!) known.set(at, close);
    if (waiting.length === 0) return close;
    if (close === -1) return settleUnclosed(waiting, known);
    cursor = close + span.closeTag.length;
    waiting[waiting.length - 1].push(cursor);
  }
}

// A close index (-1 for none), or null after pushing the content start of an inner open.
function closeOrInnerStart(span: TaggedSpan, cursor: number, waiting: number[][]): number | null {
  const token = findNextTaggedToken(span, cursor);
  if (token === null) return -1;
  if (token.kind === "close") return token.index;
  waiting.push([token.nextCursor]);
  return null;
}

// An inner span that never closes leaves every span around it unclosed too.
function settleUnclosed(waiting: number[][], known: Map<number, number>): number {
  for (const group of waiting) for (const at of group) known.set(at, -1);
  return -1;
}

function findNextTaggedToken(span: TaggedSpan, cursor: number): TaggedToken | null {
  const closeIndex = nextIndexOf(span.text, span.closeTag, cursor);
  if (closeIndex === -1) return null;
  const nextOpenCursor = findNextTaggedOpen(span, cursor, closeIndex);
  return nextOpenCursor === -1
    ? { kind: "close", index: closeIndex }
    : { kind: "open", nextCursor: nextOpenCursor };
}

function findNextTaggedOpen(span: TaggedSpan, cursor: number, closeIndex: number): number {
  const openTag = span.hasAttribute ? `[${span.tag}=` : `[${span.tag}]`;
  const candidate = nextIndexOf(span.text, openTag, cursor);
  if (candidate === -1 || candidate >= closeIndex) return -1;
  if (!span.hasAttribute) return candidate + openTag.length;
  const bracketEnd = nextIndexOf(span.text, "]", candidate + openTag.length);
  return bracketEnd === -1 ? -1 : bracketEnd + 1;
}
