// Pandoc-style fenced div: `:::name [params]` … bare `:::` closes. Containers nest:
// an inner `:::name` opener deepens, each bare `:::` closes one level. The editor's
// column layout serializes as `:::columns` / `:::column <ratio>`.
//
// The scan is fence-aware (ADR 0064 F3/PS15): a `:::` line inside fenced code is code.
// It once closed the container, which split the code and left a stray `:::` paragraph.
// Caveat: a fence protects only when a closing run exists somewhere below it. A body
// whose own ``` line closed its fence early leaves a dangling opener; if a later code
// block's closer sits below, that opener swallows the container's `:::` (the writer's
// 3-backtick caveat, ADR FF-7 (e)). A fence that never closes protects nothing, so the
// container still ends at its `:::` and the code runs to that end, as before.
import type { BlockNode } from "./ast";
import { matchContainerOpen } from "./blockKind";
import { parseContainerAttributes } from "./containerAttributes";
import { closesFence, fenceRunAt, type FenceRun } from "./fence";
import { advance, type ParseContext } from "./parserBlockContext";

type ParseBlocksFn = (ctx: ParseContext, indent: number) => BlockNode[];

const CONTAINER_CLOSE_RE = /^:::\s*$/;

interface ContainerScan {
  depth: number;
  fence: FenceRun | null;
  /** Per fence char, the shortest run known to have no closer below the scan. */
  unclosed: Map<string, number>;
}

/**
 * Does a closer for `run` exist at or after `from`? A run of the same char at least
 * as long as one already known unclosed cannot close either (its closers are a subset),
 * so each char rescans only for a shorter run: O(L·√T) worst case, O(L) in practice.
 */
function closesBelow(lines: readonly string[], from: number, run: FenceRun, unclosed: Map<string, number>): boolean {
  const known = unclosed.get(run.char);
  if (known !== undefined && run.length >= known) return false;
  for (let index = from; index < lines.length; index++) {
    if (closesFence(lines[index].trimStart(), run)) return true;
  }
  unclosed.set(run.char, run.length);
  return false;
}

/** Feeds one line to the scan; true when it is the container's own closing `:::`. */
function closesContainer(scan: ContainerScan, trimmed: string, ctx: ParseContext): boolean {
  if (scan.fence !== null) {
    if (closesFence(trimmed, scan.fence)) scan.fence = null;
    return false;
  }
  if (matchContainerOpen(trimmed)) scan.depth += 1;
  else if (CONTAINER_CLOSE_RE.test(trimmed)) scan.depth -= 1;
  else {
    const run = fenceRunAt(trimmed);
    if (run !== null && closesBelow(ctx.lines, ctx.pos, run, scan.unclosed)) scan.fence = run;
  }
  return scan.depth === 0;
}

/** The lines between the opener and its closer; the closer is consumed. O(L). */
function containerBody(ctx: ParseContext): string[] {
  const scan: ContainerScan = { depth: 1, fence: null, unclosed: new Map() };
  const inner: string[] = [];
  while (ctx.pos < ctx.lines.length) {
    const line = advance(ctx);
    if (closesContainer(scan, line.trimStart(), ctx)) break;
    inner.push(line);
  }
  return inner;
}

export function parseContainer(ctx: ParseContext, parseFn: ParseBlocksFn): BlockNode {
  const open = matchContainerOpen(advance(ctx).trimStart());
  const kind = open?.kind.toLowerCase() ?? "div";
  const params = open?.params.trim() || undefined;
  const attributes = parseContainerAttributes(params);
  const innerCtx: ParseContext = { lines: containerBody(ctx), pos: 0 };
  const children = parseFn(innerCtx, 0);
  return attributes ? { type: "container", kind, params, attributes, children } : { type: "container", kind, params, children };
}
