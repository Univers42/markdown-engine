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

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^\w\s-]/g, '')
    .replaceAll(/\s+/g, '-')
    .replaceAll(/-+/g, '-')
    .trim();
}
