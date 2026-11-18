// The kind of a callout (`> [!kind]`) or a container (`:::kind`), and the class
// it may add. A kind is author text: it becomes a class only when it is a word,
// so `> [!x" onclick=…]` adds no attribute to the HTML string and
// `> [!note fixed inset-0]` no class token in React (ADR 0062 CK-1..CK-3). The
// callout parser still keeps any kind: the host stores an emoji (`> [!💡]`) as
// the callout's colour, and a renderer that drops its class loses nothing styled.
const WORD_KIND = "[A-Za-z][A-Za-z0-9_-]*";
const WORD_KIND_RE = new RegExp(`^${WORD_KIND}$`);

/** `:::kind params`: the opener reads the same word grammar as isWordKind. */
export const CONTAINER_OPEN_RE = new RegExp(String.raw`^:::\s*(${WORD_KIND})\s*(.*)$`);

export function isWordKind(kind: string): boolean {
  return WORD_KIND_RE.test(kind);
}

/** `md-callout md-callout-note`, or `md-callout` alone when the kind is not a word. */
export function kindClassName(prefix: string, block: "callout" | "container", kind: string): string {
  const base = `${prefix}-${block}`;
  return isWordKind(kind) ? `${base} ${base}-${kind}` : base;
}
