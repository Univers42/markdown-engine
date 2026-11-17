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
import type { InlineMatchResult, InlineMatcher } from './parserInlineTypes';
import { handleNewline, appendChar } from './parserInlineUtils';
import { createInlineDispatch } from './parserInlineMatchers';
import { matchHtmlSubsetAt } from './htmlSubset/inline';
import { isHtmlSubsetActive } from './htmlSubset/session';
import { inlineHtmlTree, unwrapAnchors, type HtmlTreeBuilder } from './htmlSubset/tree';

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

// One loop over locals, as before the subset: a per-step helper carrying a state
// object measured 16-18% slower on the bench's mixed 10K paragraph (abGuard
// "parse inline mixed 10K chars" -18.9% against 923924cc), with the subset off.
export function parseInline(text: string): InlineNode[] {
  if (!text) return [];
  const root: InlineNode[] = [];
  const html = isHtmlSubsetActive() ? inlineHtmlTree(root) : null;
  let nodes = root;
  let pos = 0;
  const length = text.length;
  while (pos < length) {
    const code = text.charCodeAt(pos);
    if (code === 10) {
      handleNewline(nodes, text, pos);
      pos++;
      continue;
    }

    if (code >= 128 || DISPATCH_CODES[code] === 0) {
      const end = findTextRunEnd(text, pos);
      appendTextRun(nodes, text.slice(pos, end));
      pos = end;
      continue;
    }

    if (code === 60 && html) {
      pos = applyHtmlMatch(text, pos, nodes, html);
      nodes = html.current();
      continue;
    }

    const result = tryMatchInline(text, pos, INLINE_DISPATCH[text[pos]]);
    if (result) {
      if (result.start > pos) {
        appendTextRun(nodes, text.slice(pos, result.start));
      }
      if (result.node) nodes.push(html ? withoutNestedAnchors(result.node) : result.node);
      pos = result.end;
    } else {
      appendChar(nodes, text[pos]);
      pos++;
    }
  }
  return html ? html.finish() : root;
}

// With the subset on, "<" is a subset tag, a dropped element, an autolink or text.
function applyHtmlMatch(text: string, pos: number, nodes: InlineNode[], html: HtmlTreeBuilder<InlineNode>): number {
  const match = matchHtmlSubsetAt(text, pos);
  if (match.start > pos) appendTextRun(nodes, text.slice(pos, match.start));
  if (match.tag && !html.apply(match.tag)) appendTextRun(nodes, text.slice(pos, match.end));
  if (match.node) nodes.push(match.node);
  return match.end;
}

// A markdown link whose text holds an HTML <a> would nest anchors.
function withoutNestedAnchors(node: InlineNode): InlineNode {
  if (node.type === 'link') unwrapAnchors(node.children);
  return node;
}

const INLINE_DISPATCH: Record<string, InlineMatcher[]> = createInlineDispatch(parseInline);

const DISPATCH_CODES = new Uint8Array(128);
for (const key of Object.keys(INLINE_DISPATCH)) {
  DISPATCH_CODES[key.charCodeAt(0)] = 1;
}

