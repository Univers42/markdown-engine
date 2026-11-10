/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   parserInlineUtils.ts                               :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/05/18 21:19:17 by dlesieur          #+#    #+#             */
/*   Updated: 2026/05/18 21:19:17 by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

// Markdown parser — inline formatting utilities
import type { InlineNode } from './ast';

export function handleNewline(nodes: InlineNode[], text: string, pos: number): void {
  const lastNode = nodes.at(-1);
  if (lastNode?.type === 'text' && lastNode.value.endsWith('  ')) {
    lastNode.value = lastNode.value.slice(0, -2);
    nodes.push({ type: 'line_break' });
  } else if (pos > 0 && text[pos - 1] === '\\') {
    if (lastNode?.type === 'text') {
      lastNode.value = lastNode.value.slice(0, -1);
    }
    nodes.push({ type: 'line_break' });
  } else {
    nodes.push({ type: 'text', value: ' ' });
  }
}

export function appendChar(nodes: InlineNode[], ch: string): void {
  const lastNode = nodes.at(-1);
  if (lastNode?.type === 'text') {
    lastNode.value += ch;
  } else {
    nodes.push({ type: 'text', value: ch });
  }
}

// Per-parse memo: if a scan from `openPos` finds no `]` at all in the tail,
// later openers cannot close either. Consecutive unclosed `[`×N used to be
// quadratic (each opener re-scanned the remainder). One failed scan with no
// `]` makes the rest O(1). Nested cases like "[[[a]" still re-scan because a
// `]` exists that a later opener can pair with.
let bracketScanText: string | null = null;
let bracketNoCloseFrom = Infinity;

export function findClosingBracket(text: string, openPos: number): number {
  if (text !== bracketScanText) {
    bracketScanText = text;
    bracketNoCloseFrom = Infinity;
  }
  if (openPos >= bracketNoCloseFrom) return -1;

  let depth = 0;
  let sawClose = false;
  for (let i = openPos; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 91) depth++; // [
    else if (ch === 93) {
      // ]
      sawClose = true;
      depth--;
      if (depth === 0) return i;
    }
  }
  // Only safe to memoize when the tail has no `]` at all.
  if (!sawClose) bracketNoCloseFrom = openPos;
  return -1;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^\w\s-]/g, '')
    .replaceAll(/\s+/g, '-')
    .replaceAll(/-+/g, '-')
    .trim();
}
