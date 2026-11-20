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
import type { HtmlTagToken } from './htmlSubset/tokenizer';
import { htmlDepthBase, isHtmlSubsetActive, setHtmlDepthBase } from './htmlSubset/session';
import { inlineHtmlTree, unwrapAnchors, type HtmlTreeBuilder } from './htmlSubset/tree';
import { enterNesting, leaveNesting } from './nestingDepth';
import { enterScan, leaveScan } from './inlineScanMemo';
import { countSteps } from './scanSteps';

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

// One parser per mode: the mode and its dispatch table are fixed when the
// parser is made, and the matchers recurse into that same parser, so a nested
// span (bold, link text, a colour run) reads no module state. Bench mixed 10K
// paragraph, interleaved A/B against 69f143b (before the subset): reading the
// session on every call 1.058 in the abGuard's vm realm; this shape 0.958-0.968.
export function parseInline(text: string): InlineNode[] {
  return isHtmlSubsetActive() ? parseHtmlInline(text) : parsePlainInline(text);
}

type InlineMode = { readonly withHtml: boolean; dispatch: Record<string, InlineMatcher[]> };

function createInlineParser(withHtml: boolean): InlineParser {
  const mode: InlineMode = { withHtml, dispatch: {} };
  const parseText = (text: string): InlineNode[] => parseInMode(text, mode);
  mode.dispatch = createInlineDispatch(parseText);
  for (const key of Object.keys(mode.dispatch)) DISPATCH_CODES[key.charCodeAt(0)] = 1;
  return parseText;
}

function parseInMode(text: string, mode: InlineMode): InlineNode[] {
  if (!text) return [];
  if (!enterNesting()) return [{ type: 'text', value: text }];
  const outerScan = enterScan(text);
  try {
    return scanText(text, mode);
  } finally {
    leaveScan(outerScan);
    leaveNesting();
  }
}

// What one scan has built: the open node list and where the unmatched run began.
// Unmatched text since the last node is one run, appended as a single slice
// when a node, a newline or the end comes. A concatenation per unmatched
// character kept a chain of ~150,000 pieces alive for "[<x " x 51,200 (200 KB):
// with linear closer scans, copying it in each young-generation GC still made
// the parse 4.7x the 50 KB time (4.0-4.2x with --max-semi-space-size=64).
type InlineScan = {
  readonly text: string;
  nodes: InlineNode[];
  runStart: number;
  tagStart: number;
  treeChanged: boolean;
};

// The position stays a local of the loop; the scan object is touched only when
// a newline, a tag or a match ends a run.
function scanText(text: string, mode: InlineMode): InlineNode[] {
  const root: InlineNode[] = [];
  const scan: InlineScan = { text, nodes: root, runStart: 0, tagStart: 0, treeChanged: false };
  const html = mode.withHtml ? inlineHtmlTree(root, () => flushBeforeTag(scan)) : null;
  let pos = 0;
  while (pos < text.length) {
    const code = text.charCodeAt(pos);
    if (code === 10) pos = takeNewline(scan, pos);
    else if (code >= 128 || DISPATCH_CODES[code] === 0) pos = findTextRunEnd(text, pos);
    else if (code === 60 && html) pos = takeHtmlTag(scan, pos, html);
    else pos = takeMatch(scan, pos, mode.dispatch[text[pos]], html);
  }
  countSteps(text.length);
  appendRun(scan.nodes, text, scan.runStart, text.length);
  // finish() closes the open elements through the flush hook: nothing is left to flush.
  scan.runStart = scan.tagStart = text.length;
  return html ? html.finish() : root;
}

function takeNewline(scan: InlineScan, pos: number): number {
  appendRun(scan.nodes, scan.text, scan.runStart, pos);
  handleNewline(scan.nodes, scan.text, pos);
  return (scan.runStart = pos + 1);
}

// With the subset on, "<" is a subset tag, a dropped element, an autolink or text.
function takeHtmlTag(scan: InlineScan, pos: number, html: HtmlTreeBuilder<InlineNode>): number {
  const match = matchHtmlSubsetAt(scan.text, pos);
  if (match.tag) return takeSubsetTag(scan, pos, match.tag, html);
  if (match.start > pos) return match.end; // "<" or an unknown tag reads as text: the run goes on
  appendRun(scan.nodes, scan.text, scan.runStart, pos);
  if (match.node) scan.nodes.push(match.node);
  return (scan.runStart = match.end);
}

// A tag the tree refuses (past a cap) without changing anything is text, so it
// stays in the run. Appended on its own, one "<b>" at a time past the depth cap,
// it built a string of ~63,000 pieces that young-generation GC kept copying:
// "<b>" x 68,266 parsed in 5.05x the 50 KB time (3.78x with a 64 MB semi-space).
function takeSubsetTag(scan: InlineScan, pos: number, tag: HtmlTagToken, html: HtmlTreeBuilder<InlineNode>): number {
  scan.tagStart = pos;
  scan.treeChanged = false;
  const applied = html.apply(tag);
  if (!applied && !scan.treeChanged) return tag.end;
  appendRun(scan.nodes, scan.text, scan.runStart, applied ? pos : tag.end);
  scan.runStart = tag.end;
  scan.nodes = html.current();
  return tag.end;
}

// The tree is about to change around the tag at tagStart: the text read before
// it goes in first, into the list it was read in.
function flushBeforeTag(scan: InlineScan): void {
  appendRun(scan.nodes, scan.text, scan.runStart, scan.tagStart);
  scan.runStart = scan.tagStart;
  scan.treeChanged = true;
}

function takeMatch(
  scan: InlineScan,
  pos: number,
  matchers: InlineMatcher[],
  html: HtmlTreeBuilder<InlineNode> | null,
): number {
  const result = html ? matchInsideHtml(scan.text, pos, matchers, html) : tryMatchInline(scan.text, pos, matchers);
  if (!result) return pos + 1;
  appendRun(scan.nodes, scan.text, scan.runStart, result.start);
  if (result.node) scan.nodes.push(result.node);
  return (scan.runStart = result.end);
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

