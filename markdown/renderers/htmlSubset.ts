// HTML-string output of the README HTML subset, for renderHtml and the clipboard
// (devil ruling U3-1): attributes are re-validated and escaped, never copied, and
// a raw html_block is re-read through the subset instead of being emitted.
// The string renderer knows no media prefix, so only https images survive.

import type { HtmlElementShape } from "../ast";
import { SUBSET_TAGS, VOID_TAGS, validateAttributes } from "../htmlSubset/allowlist";
import { sanitizeImageSrc } from "../htmlSubset/imageSrc";
import { isLinkMention } from "../linkMention";
import { escapeHtml, isExternalUrl, sanitizeUrl } from "../../renderCore";

const REMOTE_IMAGE_ATTRIBUTES = ' loading="lazy" decoding="async" referrerpolicy="no-referrer"';

export function renderHtmlElementToHtml<C>(
  node: HtmlElementShape<C>,
  renderChild: (child: C) => string,
  externalLinks: boolean,
): string {
  const inner = VOID_TAGS.has(node.tag) ? "" : node.children.map(renderChild).join("");
  if (!SUBSET_TAGS.has(node.tag)) return inner;
  const attrs = validateAttributes(node.tag, node.attrs);
  if (node.tag === "img") return imageHtml(attrs);
  if (node.tag === "a") return anchorHtml(attrs, inner, externalLinks);
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attributesHtml(attrs)} />`;
  return `<${node.tag}${attributesHtml(attrs)}>${inner}</${node.tag}>`;
}

function imageHtml(attrs: Readonly<Record<string, string>>): string {
  const src = sanitizeImageSrc(attrs.src ?? "", []);
  if (!src) return "";
  return `<img${attributesHtml({ ...attrs, src })}${REMOTE_IMAGE_ATTRIBUTES} />`;
}

// An HTML title never makes a mention chip: the marker is dropped, not obeyed.
function anchorHtml(attrs: Readonly<Record<string, string>>, inner: string, externalLinks: boolean): string {
  const href = sanitizeUrl(attrs.href ?? "");
  if (!href) return inner;
  const kept: Record<string, string> = { href };
  if (attrs.title && !isLinkMention(attrs.title)) kept.title = attrs.title;
  const external = externalLinks && isExternalUrl(href) ? ' target="_blank" rel="noopener noreferrer"' : "";
  return `<a${attributesHtml(kept)}${external}>${inner}</a>`;
}

// Names come from the allowlist, never from the input; values are escaped.
function attributesHtml(attrs: Readonly<Record<string, string>>): string {
  return Object.entries(attrs).map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join("");
}
