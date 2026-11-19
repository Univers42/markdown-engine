// `{k=v …}` at the end of a container opener (`:::columns {layout=grid cols=3}`,
// `:::column 0.5 {span=2}`). The engine reads raw strings and knows no scale: the host
// validates every value (ADR 0064 PS13). Nothing here throws; what is dropped is reported.
//
// Caveat: limits drop input, never reject it. Past 256 characters the rest of the block
// is ignored (the cut token too) and past 16 pairs the rest are ignored; each limit adds
// one `length` / `pairs` report. Values are bare tokens: a quoted value with a space in it
// is two malformed tokens. Escape hatch: shorter attributes, or the block's overlay style.

import type { ContainerAttributes } from "./ast";

const MAX_ATTRIBUTE_CHARS = 256;
const MAX_ATTRIBUTE_PAIRS = 16;

// Anchored, two disjoint classes split by `=`: linear, no backtracking.
const PAIR_RE = /^([A-Za-z][A-Za-z0-9_-]*)=([^\s{}"'=]+)$/;
const WHITESPACE_RE = /\s/;

/** The text inside the trailing `{…}`, or null when the opener has none. O(n). */
function attributeText(params: string): string | null {
  if (!params.endsWith("}")) return null;
  const open = params.lastIndexOf("{");
  return open < 0 ? null : params.slice(open + 1, -1);
}

/** Tokens within the length limit; a token the limit cuts is dropped whole. */
function boundedTokens(text: string, dropped: string[]): string[] {
  if (text.length <= MAX_ATTRIBUTE_CHARS) return text.split(/\s+/).filter(Boolean);
  dropped.push("length");
  const kept = text.slice(0, MAX_ATTRIBUTE_CHARS);
  const tokens = kept.split(/\s+/).filter(Boolean);
  const cutMidToken = !WHITESPACE_RE.test(text[MAX_ATTRIBUTE_CHARS]) && !WHITESPACE_RE.test(kept.at(-1) ?? " ");
  if (cutMidToken) tokens.pop();
  return tokens;
}

/** Adds one token to `values`; returns false when the pair limit is already reached. */
function addPair(token: string, out: ContainerAttributes, count: number): boolean {
  if (count >= MAX_ATTRIBUTE_PAIRS) return false;
  const pair = PAIR_RE.exec(token);
  if (pair === null) out.dropped.push("malformed");
  else if (Object.hasOwn(out.values, pair[1])) out.dropped.push("duplicate");
  else out.values[pair[1]] = pair[2];
  return true;
}

/** Parses the opener's trailing `{k=v …}`; undefined when there is none. O(n). */
export function parseContainerAttributes(params: string | undefined): ContainerAttributes | undefined {
  const text = params === undefined ? null : attributeText(params);
  if (text === null) return undefined;
  const out: ContainerAttributes = { values: Object.create(null) as Record<string, string>, dropped: [] };
  const tokens = boundedTokens(text, out.dropped);
  for (let index = 0; index < tokens.length; index++) {
    if (!addPair(tokens[index], out, Object.keys(out.values).length)) {
      out.dropped.push("pairs");
      break;
    }
  }
  return out;
}
