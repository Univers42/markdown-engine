/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   parserBlockContext.ts                              :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/05/18 21:19:17 by dlesieur          #+#    #+#             */
/*   Updated: 2026/05/18 21:19:17 by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

// Markdown parser — parse context and cursor utilities
import type { BlockNode } from './ast';

export interface ParseContext {
  lines: string[];
  pos: number;
}

export function peek(ctx: ParseContext): string | null {
  return ctx.pos < ctx.lines.length ? ctx.lines[ctx.pos] : null;
}

export function advance(ctx: ParseContext): string {
  return ctx.lines[ctx.pos++];
}

/** Consumes every line left and keeps them as one paragraph of source text. */
export function restAsSourceText(ctx: ParseContext): BlockNode[] {
  const value = ctx.lines.slice(ctx.pos).join('\n');
  ctx.pos = ctx.lines.length;
  return value ? [{ type: 'paragraph', children: [{ type: 'text', value }] }] : [];
}
