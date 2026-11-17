// Nests subset tags the way an HTML5 parser would for the common README shapes:
// implied end tags (p, li, headings, table parts), implied table parents, no
// anchor inside an anchor, and the depth and element caps (devil ruling U3-5).
// Caveat: no foster parenting and no adoption agency. Text or markup a browser
// would move out of a table is dropped, a nested <a> is dropped instead of
// closing the outer one, and misnested formatting closes at the first matching
// end tag. It only ever drops or nests; it never creates a tag the input lacked
// beyond tbody/tr parents.

import { isInlineNode, type BlockNode, type HtmlElementShape, type InlineNode } from "../ast";
import { HEADINGS, PHRASING_TAGS, VOID_TAGS, filterAttributes } from "./allowlist";
import { MAX_HTML_DEPTH, htmlDepthBase, takeHtmlElements } from "./session";
import type { HtmlTagToken } from "./tokenizer";

export type HtmlChild = InlineNode | BlockNode;

interface OpenElement<C> {
  tag: string;
  children: C[];
}

interface HtmlTreeKit<C extends HtmlChild> {
  readonly inline: boolean;
  wrap(element: HtmlElementShape<C>): C;
}

const HEADING_LIST = [...HEADINGS];
const CLOSES_P = new Set([
  "div", "p", "blockquote", "details", "summary", "ul", "ol", "li", "pre", "table", "hr", ...HEADING_LIST,
]);
const TABLE_CONTEXT = new Set(["table", "thead", "tbody", "tr"]);
const NO_SCOPE: ReadonlySet<string> = new Set();
const TABLE_SCOPE: ReadonlySet<string> = new Set(["table"]);
const CELL_SCOPE: ReadonlySet<string> = new Set(["td", "th", "table"]);
const LIST_SCOPE: ReadonlySet<string> = new Set(["ul", "ol", "td", "th", "table"]);

const CELL_PARENTS = new Map([["tr", []], ["tbody", ["tr"]], ["thead", ["tr"]], ["table", ["tbody", "tr"]]]);
const IMPLIED_PARENTS = new Map<string, ReadonlyMap<string, readonly string[]>>([
  ["td", CELL_PARENTS], ["th", CELL_PARENTS],
  ["tr", new Map([["tbody", []], ["thead", []], ["table", ["tbody"]]])],
  ["tbody", new Map([["table", []]])], ["thead", new Map([["table", []]])],
]);

const CELL_CLOSE = { tags: ["td", "th"], scope: TABLE_SCOPE };
const SECTION_CLOSE = { tags: ["tbody", "thead"], scope: TABLE_SCOPE };
const IMPLIED_CLOSES = new Map([
  ["li", { tags: ["li"], scope: LIST_SCOPE }], ["td", CELL_CLOSE], ["th", CELL_CLOSE],
  ["tr", { tags: ["tr"], scope: TABLE_SCOPE }], ["tbody", SECTION_CLOSE], ["thead", SECTION_CLOSE],
]);
const CLOSE_SCOPES = new Map([
  ["td", TABLE_SCOPE], ["th", TABLE_SCOPE], ["tr", TABLE_SCOPE], ["tbody", TABLE_SCOPE],
  ["thead", TABLE_SCOPE], ["table", NO_SCOPE],
]);

export class HtmlTreeBuilder<C extends HtmlChild> {
  private readonly stack: OpenElement<C>[] = [];
  private readonly depthBase = htmlDepthBase();
  private suppressedAnchors = 0;

  constructor(
    private readonly root: C[],
    private readonly kit: HtmlTreeKit<C>,
  ) {}

  current(): C[] {
    return this.stack.at(-1)?.children ?? this.root;
  }

  /** Elements open around the next node, counting the enclosing builders. */
  depth(): number {
    return this.depthBase + this.stack.length;
  }

  // false only when a cap refuses the tag: the caller shows its source as text.
  apply(token: HtmlTagToken): boolean {
    if (token.kind === "open") return this.open(token.tag, token.attrs);
    this.close(token.tag);
    return true;
  }

  appendText(value: string): void {
    if (!TABLE_CONTEXT.has(this.topTag())) appendTextNode(this.current(), value);
  }

  // A markdown block parsed between HTML blocks: it closes an open <p> (a <p>
  // cannot hold a block) and an open <a>.
  appendBlock(node: C): void {
    this.closeWithin(["p"], CELL_SCOPE);
    this.closeWithin(["a"], NO_SCOPE);
    if (!TABLE_CONTEXT.has(this.topTag())) this.current().push(node);
  }

  finish(): C[] {
    this.popTo(0);
    return this.root;
  }

  private open(tag: string, attrs: ReadonlyMap<string, string>): boolean {
    if (this.kit.inline && !PHRASING_TAGS.has(tag)) return true;
    if (tag === "a" && this.indexOfOpen(["a"], NO_SCOPE) !== -1) {
      this.suppressedAnchors++;
      return true;
    }
    this.closeImplied(tag);
    const parents = this.impliedParents(tag);
    if (parents === null) return true;
    const count = parents.length + 1;
    if (this.depth() + count > MAX_HTML_DEPTH || !takeHtmlElements(count)) return false;
    for (const parent of parents) this.push(parent, {});
    this.push(tag, filterAttributes(tag, attrs));
    return true;
  }

  private close(tag: string): void {
    if (tag === "a" && this.suppressedAnchors > 0) {
      this.suppressedAnchors--;
      return;
    }
    const tags = HEADINGS.has(tag) ? HEADING_LIST : [tag];
    this.closeWithin(tags, CLOSE_SCOPES.get(tag) ?? CELL_SCOPE);
  }

  private closeImplied(tag: string): void {
    if (CLOSES_P.has(tag)) this.closeWithin(["p"], CELL_SCOPE);
    if (HEADINGS.has(tag) && HEADINGS.has(this.topTag())) this.popTo(this.stack.length - 1);
    const implied = IMPLIED_CLOSES.get(tag);
    if (implied) this.closeWithin(implied.tags, implied.scope);
  }

  // Table parts get their missing parents; null = the tag is dropped (a table
  // part outside a table, or other content directly inside table structure).
  private impliedParents(tag: string): readonly string[] | null {
    const top = this.topTag();
    const byTop = IMPLIED_PARENTS.get(tag);
    if (byTop) return byTop.get(top) ?? null;
    return TABLE_CONTEXT.has(top) ? null : [];
  }

  private push(tag: string, attrs: Record<string, string>): void {
    const children: C[] = [];
    this.current().push(this.kit.wrap({ type: "html_element", tag, attrs, children }));
    if (!VOID_TAGS.has(tag)) this.stack.push({ tag, children });
  }

  private indexOfOpen(tags: readonly string[], scope: ReadonlySet<string>): number {
    for (let index = this.stack.length - 1; index >= 0; index--) {
      const tag = this.stack[index].tag;
      if (tags.includes(tag)) return index;
      if (scope.has(tag)) return -1;
    }
    return -1;
  }

  private closeWithin(tags: readonly string[], scope: ReadonlySet<string>): void {
    const index = this.indexOfOpen(tags, scope);
    if (index !== -1) this.popTo(index);
  }

  private popTo(index: number): void {
    while (this.stack.length > index) {
      const element = this.stack.pop();
      if (element?.tag === "a") unwrapAnchors(element.children);
    }
  }

  private topTag(): string {
    return this.stack.at(-1)?.tag ?? "";
  }
}

export function inlineHtmlTree(root: InlineNode[]): HtmlTreeBuilder<InlineNode> {
  return new HtmlTreeBuilder(root, { inline: true, wrap: (element) => element });
}

export function blockHtmlTree(root: HtmlChild[]): HtmlTreeBuilder<HtmlChild> {
  return new HtmlTreeBuilder(root, { inline: false, wrap: (element) => element });
}

function appendTextNode(children: HtmlChild[], value: string): void {
  const last = children.at(-1);
  if (last?.type === "text") last.value += value;
  else children.push({ type: "text", value });
}

// Inside an anchor a link renders as its text: an <a> inside an <a> is invalid
// HTML and a browser would split it. A footnote marker is a link too.
export function unwrapAnchors(nodes: HtmlChild[]): void {
  const flat: HtmlChild[] = [];
  for (const node of nodes) appendUnwrapped(flat, node);
  nodes.length = 0;
  for (const node of flat) nodes.push(node);
}

function appendUnwrapped(out: HtmlChild[], node: HtmlChild): void {
  if (node.type === "link" || (node.type === "html_element" && node.tag === "a")) {
    for (const child of node.children) appendUnwrapped(out, child);
  } else if (node.type === "footnote_ref") {
    appendTextNode(out, `[${node.label}]`);
  } else {
    const children = childrenOf(node);
    if (children) unwrapAnchors(children);
    out.push(node);
  }
}

function childrenOf(node: HtmlChild): HtmlChild[] | null {
  if (node.type === "html_element") return node.children;
  return isInlineNode(node) && "children" in node ? node.children : null;
}
