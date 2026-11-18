// Markdown parser — the one nesting budget shared by block and inline recursion.
//
// Block containers (quotes, lists, callouts, toggles, footnotes, ::: containers)
// and inline spans (emphasis, links, colour runs) each parse their content with
// a recursive call, and every renderer recurses once per level again: "> " x 2000
// (4 KB) and [color=red] x 5000 overflowed the call stack (RangeError). Past the
// budget the source of that level is kept as plain text, so nothing throws.
//
// Caveat: block and inline levels are counted together, so the budget runs out
// at MAX_NESTING_DEPTH levels of any mix: a document nested deeper (a 20-deep
// list holding a 12-deep run of spans) shows its innermost part as source text
// instead of formatting. That is under-formatting, never lost text.
export const MAX_NESTING_DEPTH = 32;

let nestingDepth = 0;

/** Enters one level; false, with nothing entered, once the budget is spent. */
export function enterNesting(): boolean {
  if (nestingDepth >= MAX_NESTING_DEPTH) return false;
  nestingDepth++;
  return true;
}

export function leaveNesting(): void {
  nestingDepth--;
}
