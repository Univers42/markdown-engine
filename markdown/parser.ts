/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   parser.ts                                          :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/05/18 21:19:17 by dlesieur          #+#    #+#             */
/*   Updated: 2026/05/18 21:19:17 by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

// Markdown Parser — full CommonMark + GFM parser, zero dependencies

import type { BlockNode, DefinitionItem } from "./ast";
import { parseInline, slugify } from "./parserInline";
import { setInlineRefDefinitions } from "./parserInlineMatchers";
import { collectRefDefinitions } from "./refDefinitions";
import type { ParseContext } from "./parserBlockHelpers";
import { matchContainerOpen } from "./blockKind";
import { matchAtxHeading, splitHeadingCustomId } from "./blockLineMatchers";
import { parseContainer } from "./parserBlockContainer";
import {
  peek,
  advance,
  isThematicBreak,
  isSetextHeading,
  parseFencedCode,
  parseMathBlock,
  startsHtmlBlock,
  parseHtmlBlock,
  isTableStart,
  parseTable,
  parseIndentedCode,
  parseParagraph,
} from "./parserBlockHelpers";
import {
  parseBlockquote,
  parseCallout,
  parseTaskList,
  parseUnorderedList,
  parseOrderedList,
  parseFootnoteDef,
  parseToggle,
} from "./parserBlockNested";

import { restAsSourceText } from "./parserBlockContext";
import { enterNesting, leaveNesting } from "./nestingDepth";
import { nestHtmlBlocks } from "./htmlSubset/nest";
import {
  MAX_SUBSET_INPUT_BYTES,
  exceedsUtf8Bytes,
  isHtmlSubsetActive,
  runInHtmlSubsetSession,
} from "./htmlSubset/session";

export { parseInline } from "./parserInline";

export interface RichParseOptions {
  /** Parse GitHub's README HTML subset into html_element nodes (devil ruling U3). */
  htmlSubset?: boolean;
}

// The subset parse refuses input over 200 KB whole (UTF-8 bytes): a partial
// README would render as something its author never wrote.
export function parse(markdown: string, options?: RichParseOptions): BlockNode[] {
  if (!options?.htmlSubset) return parseDocument(markdown);
  if (exceedsUtf8Bytes(markdown, MAX_SUBSET_INPUT_BYTES)) return [];
  return runInHtmlSubsetSession(markdown.length, () => parseDocument(markdown));
}

function parseDocument(markdown: string): BlockNode[] {
  const allLines = markdown.split("\n");
  const frontMatter = parseFrontMatter(allLines);
  const { lines, definitions } = collectRefDefinitions(
    frontMatter ? allLines.slice(frontMatter.consumed) : allLines,
  );
  setInlineRefDefinitions(definitions.size > 0 ? definitions : null);
  try {
    const ctx: ParseContext = { lines, pos: 0 };
    const blocks = parseBlocks(ctx, 0);
    return frontMatter ? [frontMatter.node, ...blocks] : blocks;
  } finally {
    setInlineRefDefinitions(null);
  }
}

// YAML/TOML front matter — only at the very top of the document, fenced by a
// matching `---`/`+++` pair. Without a closing fence the opener stays what it
// always was: a thematic break.
function parseFrontMatter(
  lines: string[],
): { node: BlockNode; consumed: number } | null {
  const fence = lines[0]?.trim();
  if (fence !== "---" && fence !== "+++") return null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === fence || (fence === "---" && line === "...")) {
      return {
        node: { type: "front_matter", value: lines.slice(1, i).join("\n") },
        consumed: i + 1,
      };
    }
  }
  return null;
}

function tryParseHeading(ctx: ParseContext, trimmed: string): BlockNode | null {
  const hm = matchAtxHeading(trimmed);
  if (!hm) return null;
  advance(ctx);
  const level = hm.level as 1 | 2 | 3 | 4 | 5 | 6;
  const { text, id } = splitHeadingCustomId(hm.text);
  return {
    type: "heading",
    level,
    children: parseInline(text),
    id: id ?? slugify(text),
  };
}

function tryParseSetextHeading(ctx: ParseContext): BlockNode | null {
  if (!isSetextHeading(ctx)) return null;
  const textLine = advance(ctx);
  const ml = advance(ctx);
  const lv = ml.trim().startsWith("=") ? 1 : 2;
  return {
    type: "heading",
    level: lv,
    children: parseInline(textLine.trim()),
    id: slugify(textLine.trim()),
  };
}

type ParseBlocksFn = (ctx: ParseContext, indent: number) => BlockNode[];

/** `<!-- … -->` block comment — consumed silently, renders nothing anywhere. */
function skipHtmlCommentBlock(ctx: ParseContext): void {
  while (ctx.pos < ctx.lines.length) {
    const line = advance(ctx);
    if (line.includes("-->")) return;
  }
}

const DEFINITION_MARKER_RE = /^:\s+/;

function startsDefinitionList(ctx: ParseContext, trimmed: string): boolean {
  if (trimmed === "" || DEFINITION_MARKER_RE.test(trimmed)) return false;
  const next = ctx.lines[ctx.pos + 1];
  return next !== undefined && DEFINITION_MARKER_RE.test(next.trimStart());
}

/** `Term` + one or more `: definition` lines; groups may repeat back-to-back. */
function parseDefinitionList(ctx: ParseContext): BlockNode {
  const items: DefinitionItem[] = [];
  while (ctx.pos < ctx.lines.length) {
    const termLine = ctx.lines[ctx.pos].trim();
    if (termLine === "" || DEFINITION_MARKER_RE.test(termLine)) break;
    const next = ctx.lines[ctx.pos + 1];
    if (next === undefined || !DEFINITION_MARKER_RE.test(next.trimStart())) break;
    advance(ctx);
    const definitions: DefinitionItem["definitions"] = [];
    while (ctx.pos < ctx.lines.length) {
      const defLine = ctx.lines[ctx.pos].trimStart();
      if (!DEFINITION_MARKER_RE.test(defLine)) break;
      advance(ctx);
      definitions.push(parseInline(defLine.replace(DEFINITION_MARKER_RE, "")));
    }
    items.push({ term: parseInline(termLine), definitions });
  }
  return { type: "definition_list", items };
}

/** Try to parse a primary (non-nested) block from the current line. */
function tryParsePrimaryBlock(
  ctx: ParseContext,
  trimmed: string,
): BlockNode | null {
  const first = trimmed[0];
  if (first === "`" || first === "~") {
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~"))
      return parseFencedCode(ctx);
    return null;
  }
  if (first === "$") {
    if (trimmed.startsWith("$$")) return parseMathBlock(ctx);
    return null;
  }
  if (first === "<") return startsHtmlBlock(trimmed) ? parseHtmlBlock(ctx) : null;
  if (trimmed.includes("|") && isTableStart(ctx)) return parseTable(ctx);
  return null;
}

/** Try to parse a nested/list-type block from the current line. */
function tryParseNestedBlock(
  ctx: ParseContext,
  trimmed: string,
  lineIndent: number,
  indent: number,
  parseFn: ParseBlocksFn,
): BlockNode | null {
  const first = trimmed[0];
  if (first === ">" || first === "#") {
    if (/^>\s*(?:\[\s*>\s*\]|\[toggle\])\s*/i.test(trimmed) || /^#{1,6}>/.test(trimmed))
      return parseToggle(ctx, parseFn);
  }
  if (first === ">") {
    if (/^>\s*\[!([^\]]+?)\]/.test(trimmed)) return parseCallout(ctx, parseFn);
    if (trimmed.startsWith("> ") || trimmed === ">")
      return parseBlockquote(ctx, parseFn);
  }
  if (first === "-" || first === "*" || first === "+") {
    if (/^[-*+]\s+\[([ xX])\]\s/.test(trimmed))
      return parseTaskList(ctx, parseFn);
    if (/^[-*+]\s+/.test(trimmed) && !isThematicBreak(trimmed))
      return parseUnorderedList(ctx, parseFn);
  }
  if (first >= "0" && first <= "9" && /^\d{1,9}[.)]\s+/.test(trimmed))
    return parseOrderedList(ctx, parseFn);
  if (first === "[" && /^\[\^([^\]]+)\]:\s/.test(trimmed))
    return parseFootnoteDef(ctx, parseFn);
  if (lineIndent >= 4 && indent === 0) return parseIndentedCode(ctx);
  return null;
}

/** Parse a single block node from the current position. */
function parseNextBlock(ctx: ParseContext, indent: number): BlockNode | null {
  const line = peek(ctx) ?? "";
  const trimmed = line.trimStart();
  const lineIndent = line.length - trimmed.length;

  if (trimmed === "") {
    advance(ctx);
    return null;
  }
  if (trimmed.startsWith("<!--")) {
    skipHtmlCommentBlock(ctx);
    return null;
  }
  if (trimmed.startsWith(":::") && matchContainerOpen(trimmed)) {
    return parseContainer(ctx, parseBlocks);
  }
  if (isThematicBreak(trimmed)) {
    advance(ctx);
    return { type: "thematic_break" };
  }

  const heading = tryParseHeading(ctx, trimmed);
  if (heading) return heading;

  return (
    tryParsePrimaryBlock(ctx, trimmed) ??
    tryParseNestedBlock(ctx, trimmed, lineIndent, indent, parseBlocks) ??
    (startsDefinitionList(ctx, trimmed) ? parseDefinitionList(ctx) : null) ??
    tryParseSetextHeading(ctx) ??
    parseParagraph(ctx)
  );
}

/** One block, or null for a consumed blank/comment line. */
function parseBlockStep(ctx: ParseContext, indent: number): BlockNode | null {
  const before = ctx.pos;
  const node = parseNextBlock(ctx, indent);
  // Hard progress guarantee: no parser may return without consuming input.
  // This can only trip on a parser bug — degrade to skipping one line
  // instead of looping forever on it.
  if (ctx.pos === before) advance(ctx);
  return node;
}

function parseBlocks(ctx: ParseContext, indent: number): BlockNode[] {
  if (!enterNesting()) return restAsSourceText(ctx);
  try {
    return parseBlockRun(ctx, indent);
  } finally {
    leaveNesting();
  }
}

function parseBlockRun(ctx: ParseContext, indent: number): BlockNode[] {
  const hasMore = (): boolean => ctx.pos < ctx.lines.length;
  if (isHtmlSubsetActive()) return nestHtmlBlocks(hasMore, () => parseBlockStep(ctx, indent));
  const blocks: BlockNode[] = [];
  while (hasMore()) {
    const node = parseBlockStep(ctx, indent);
    if (node) blocks.push(node);
  }
  return blocks;
}
