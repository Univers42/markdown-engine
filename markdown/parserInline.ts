/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   parserInline.ts                                    :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/05/18 21:19:17 by dlesieur          #+#    #+#             */
/*   Updated: 2026/05/18 21:19:17 by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

// Markdown parser — inline formatting parser
import type { InlineNode } from './ast';
import type { InlineMatchResult, InlineMatcher, InlineParser } from './parserInlineTypes';
import { handleNewline } from './parserInlineUtils';
import { createInlineDispatch } from './parserInlineMatchers';
import { matchHtmlSubsetAt } from './htmlSubset/inline';
import { htmlDepthBase, isHtmlSubsetActive, setHtmlDepthBase } from './htmlSubset/session';
import { inlineHtmlTree, unwrapAnchors, type HtmlTreeBuilder } from './htmlSubset/tree';
import { enterNesting, leaveNesting } from './nestingDepth';
import { enterScan, leaveScan } from './inlineScanMemo';

export { slugify } from './parserInlineUtils';

/** Attempt to match an inline pattern at the given position. */
function tryMatchInline(
  text: string,
  pos: number,
  matchers: InlineMatcher[],
): InlineMatchResult | null {
  for (const matcher of matchers) {
    const result = matcher(text, pos);
    if (result) return result;
  }
  return null;
}

function appendTextRun(nodes: InlineNode[], value: string): void {
  const lastNode = nodes.at(-1);
  if (lastNode?.type === 'text') {
    lastNode.value += value;
  } else {
    nodes.push({ type: 'text', value });
  }
}

function appendRun(nodes: InlineNode[], text: string, from: number, to: number): void {
  if (to > from) appendTextRun(nodes, text.slice(from, to));
}

// Every dispatch first-char is ASCII, so a 128-slot table answers "can this
// char start a match?" without materializing a single-char string per char —
// the plain-prose fast path scans on charCodes alone.
function findTextRunEnd(text: string, pos: number): number {
  let cursor = pos + 1;
  const length = text.length;
  while (cursor < length) {
    const code = text.charCodeAt(cursor);
    if (code === 10 || (code < 128 && DISPATCH_CODES[code] === 1)) break;
    cursor++;
  }
  return cursor;
}

// One parser per mode: the mode and its dispatch table live in the closure, and
// the matchers recurse into that same parser, so a nested span (bold, link text,
// a colour run) reads no module state. Bench mixed 10K paragraph, interleaved A/B
// against 69f143b (before the subset): reading the session on every call 1.058
// in the abGuard's vm realm; this shape 0.958-0.968 (same realm 0.958). A
// per-step helper carrying a state object was 16-18% slower.
export function parseInline(text: string): InlineNode[] {
  return isHtmlSubsetActive() ? parseHtmlInline(text) : parsePlainInline(text);
}

function createInlineParser(withHtml: boolean): InlineParser {
  const dispatch = createInlineDispatch(parseText);
  for (const key of Object.keys(dispatch)) DISPATCH_CODES[key.charCodeAt(0)] = 1;

  function parseText(text: string): InlineNode[] {
    if (!text) return [];
    if (!enterNesting()) return [{ type: 'text', value: text }];
    const outerScan = enterScan(text);
    try {
      return scanText(text);
    } finally {
      leaveScan(outerScan);
      leaveNesting();
    }
  }

  // Unmatched text since the last node is one run, appended as a single slice
  // when a node, a newline or the end comes. A concatenation per unmatched
  // character kept a chain of ~150,000 pieces alive for "[<x " x 51,200 (200 KB):
  // with linear closer scans, copying it in each young-generation GC still made
  // the parse 4.7x the 50 KB time (4.0-4.2x with --max-semi-space-size=64).
  function scanText(text: string): InlineNode[] {
    const root: InlineNode[] = [];
    const html = withHtml ? inlineHtmlTree(root) : null;
    let nodes = root;
    let pos = 0;
    let runStart = 0;
    const length = text.length;
    while (pos < length) {
      const code = text.charCodeAt(pos);
      if (code === 10) {
        appendRun(nodes, text, runStart, pos);
        handleNewline(nodes, text, pos);
        runStart = ++pos;
        continue;
      }

      if (code >= 128 || DISPATCH_CODES[code] === 0) {
        pos = findTextRunEnd(text, pos);
        continue;
      }

      if (code === 60 && html) {
        appendRun(nodes, text, runStart, pos);
        runStart = pos = applyHtmlMatch(text, pos, nodes, html);
        nodes = html.current();
        continue;
      }

      const matchers = dispatch[text[pos]];
      const result = html ? matchInsideHtml(text, pos, matchers, html) : tryMatchInline(text, pos, matchers);
      if (!result) {
        pos++;
        continue;
      }
      appendRun(nodes, text, runStart, result.start);
      if (result.node) nodes.push(result.node);
      runStart = pos = result.end;
    }
    appendRun(nodes, text, runStart, length);
    return html ? html.finish() : root;
  }

  return parseText;
}

// With the subset on, "<" is a subset tag, a dropped element, an autolink or text.
function applyHtmlMatch(text: string, pos: number, nodes: InlineNode[], html: HtmlTreeBuilder<InlineNode>): number {
  const match = matchHtmlSubsetAt(text, pos);
  if (match.start > pos) appendTextRun(nodes, text.slice(pos, match.start));
  if (match.tag && !html.apply(match.tag)) appendTextRun(nodes, text.slice(pos, match.end));
  if (match.node) nodes.push(match.node);
  return match.end;
}

// A matched span (bold, link text, a colour run) parses its content with a new
// inline tree, below the elements open here: the depth cap counts on from this
// tree's depth, as nest.ts does for blocks, or every span restarts at 0. A link
// whose text holds an HTML <a> would nest anchors, so they are unwrapped.
function matchInsideHtml(
  text: string,
  pos: number,
  matchers: InlineMatcher[],
  html: HtmlTreeBuilder<InlineNode>,
): InlineMatchResult | null {
  const outerBase = htmlDepthBase();
  setHtmlDepthBase(html.depth());
  try {
    const result = tryMatchInline(text, pos, matchers);
    if (result?.node?.type === 'link') unwrapAnchors(result.node.children);
    return result;
  } finally {
    setHtmlDepthBase(outerBase);
  }
}

const DISPATCH_CODES = new Uint8Array(128);
const parsePlainInline = createInlineParser(false);
const parseHtmlInline = createInlineParser(true);

