// Inline level of the README subset: what a "<" inside a paragraph is. Replaces
// the legacy "<" matchers only while a subset parse runs, so editor parsing is
// unchanged.

import type { InlineNode } from "../ast";
import { SUBSET_TAGS } from "./allowlist";
import { scanHtmlAt, type HtmlTagToken } from "./tokenizer";

export interface HtmlInlineMatch {
  start: number;
  end: number;
  node: InlineNode | null;
  tag?: HtmlTagToken;
}

export function matchHtmlSubsetAt(text: string, pos: number): HtmlInlineMatch {
  const token = scanHtmlAt(text, pos);
  if (token?.kind === "drop") return { start: pos, end: token.end, node: null };
  if (token && SUBSET_TAGS.has(token.tag)) return { start: pos, end: token.end, node: null, tag: token };
  if (token) return { start: token.end, end: token.end, node: null };
  return matchAngleAutolink(text, pos) ?? { start: pos + 1, end: pos + 1, node: null };
}

// `<https://…>` and `<name@host.tld>`. The scan stops at whitespace or "<", so it
// is linear, unlike the legacy matcher's indexOf(">") plus email regex.
function matchAngleAutolink(text: string, pos: number): HtmlInlineMatch | null {
  let end = pos + 1;
  while (end < text.length && !/[\s<>]/.test(text[end])) end++;
  if (text[end] !== ">") return null;
  const target = text.slice(pos + 1, end);
  const href = autolinkHref(target);
  if (href === null) return null;
  return { start: pos, end: end + 1, node: { type: "link", href, children: [{ type: "text", value: target }] } };
}

function autolinkHref(target: string): string | null {
  if (/^https?:\/\/./i.test(target)) return target;
  const at = target.indexOf("@");
  const isEmail = at > 0 && at === target.lastIndexOf("@") && target.indexOf(".", at + 2) > at + 1;
  return isEmail ? `mailto:${target}` : null;
}
