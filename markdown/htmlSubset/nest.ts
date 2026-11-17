// Block level of the README subset: the html_block chunks of one block list are
// fed, in order, to one tree builder, with the markdown blocks between them
// appended where the open tags put them. That is how markdown after a blank line
// inside a <td> or <div> ends up inside it, as on GitHub.

import { isBlockNode, type BlockNode } from "../ast";
import { SUBSET_TAGS } from "./allowlist";
import { decodeHtmlEntities } from "./entities";
import { htmlDepthBase, runInHtmlSubsetSession, setHtmlDepthBase } from "./session";
import { scanHtmlAt } from "./tokenizer";
import { blockHtmlTree, type HtmlChild, type HtmlTreeBuilder } from "./tree";

// Blocks are fed as they are parsed, so a block's own HTML (a paragraph's inline
// tags, a quote's nested tree) is parsed knowing how deep it will sit.
export function nestHtmlBlocks(hasMore: () => boolean, next: () => BlockNode | null): BlockNode[] {
  const builder = blockHtmlTree([]);
  const outerBase = htmlDepthBase();
  try {
    while (hasMore()) {
      setHtmlDepthBase(builder.depth());
      const block = next();
      if (block?.type === "html_block") feedHtml(builder, block.value);
      else if (block) builder.appendBlock(block);
    }
  } finally {
    setHtmlDepthBase(outerBase);
  }
  return wrapTopLevel(builder.finish());
}

// One raw HTML string (an html_block from a parse without the subset) as subset
// elements, for renderers that must never emit the raw string.
export function parseHtmlFragment(html: string): BlockNode[] {
  return runInHtmlSubsetSession(html.length, () => {
    const builder = blockHtmlTree([]);
    feedHtml(builder, html);
    return wrapTopLevel(builder.finish());
  });
}

function feedHtml(builder: HtmlTreeBuilder<HtmlChild>, html: string): void {
  let pos = 0;
  while (pos < html.length) {
    const lt = html.indexOf("<", pos);
    const textEnd = lt === -1 ? html.length : lt;
    if (textEnd > pos) builder.appendText(decodeHtmlEntities(html.slice(pos, textEnd)));
    if (lt === -1) return;
    pos = feedTag(builder, html, lt);
  }
}

// An unknown tag, or one a cap refuses, is shown as its source text.
function feedTag(builder: HtmlTreeBuilder<HtmlChild>, html: string, at: number): number {
  const token = scanHtmlAt(html, at);
  if (token === null) {
    builder.appendText("<");
    return at + 1;
  }
  if (token.kind === "drop") return token.end;
  if (!SUBSET_TAGS.has(token.tag) || !builder.apply(token)) builder.appendText(html.slice(at, token.end));
  return token.end;
}

// Caveat: text left at the top level (outside any element) becomes a paragraph
// of its trimmed text, so its line breaks collapse; GitHub keeps it as an
// anonymous inline run. Whitespace-only text is dropped.
function wrapTopLevel(nodes: HtmlChild[]): BlockNode[] {
  const blocks: BlockNode[] = [];
  for (const node of nodes) {
    if (isBlockNode(node)) blocks.push(node);
    else if (node.type === "text" && node.value.trim() !== "") {
      blocks.push({ type: "paragraph", children: [{ type: "text", value: node.value.trim() }] });
    }
  }
  return blocks;
}
