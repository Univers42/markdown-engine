// The kind of a callout (`> [!kind]`) or a container (`:::kind`), and the class
// it may add. A kind is author text: it becomes a class only when it is a word,
// so `> [!x" onclick=…]` adds no attribute to the HTML string and
// `> [!note fixed inset-0]` no class token in React (ADR 0062 CK-1..CK-3). The
// callout parser still keeps any kind: the host stores an emoji (`> [!💡]`) as
// the callout's colour, and a renderer that drops its class loses nothing styled.
import { lineTailStart } from "./blockLineMatchers";

const WORD_KIND = "[A-Za-z][A-Za-z0-9_-]*";
const WORD_KIND_RE = new RegExp(`^${WORD_KIND}$`);
// The greedy word ends where nothing follows it in this prefix, so it never
// backtracks; the `\s*(.*)$` tail goes to lineTailStart, which is linear.
const CONTAINER_OPEN_PREFIX_RE = new RegExp(String.raw`^:::\s*(${WORD_KIND})`);

/**
 * `^:::\s*(WORD)\s*(.*)$` — `:::kind params`, read with the same word grammar as
 * isWordKind. `params` is the untrimmed rest of the line after the whitespace.
 */
export function matchContainerOpen(line: string): { kind: string; params: string } | null {
  const prefix = CONTAINER_OPEN_PREFIX_RE.exec(line);
  if (!prefix) return null;
  const start = lineTailStart(line, prefix[0].length);
  return start === null ? null : { kind: prefix[1], params: line.slice(start) };
}

export function isWordKind(kind: string): boolean {
  return WORD_KIND_RE.test(kind);
}

/** `md-callout md-callout-note`, or `md-callout` alone when the kind is not a word. */
export function kindClassName(prefix: string, block: "callout" | "container", kind: string): string {
  const base = `${prefix}-${block}`;
  return isWordKind(kind) ? `${base} ${base}-${kind}` : base;
}
