// React output of the README HTML subset (devil ruling U3-1/U3-3/U3-7): an
// html_element becomes React.createElement with re-validated props, never markup.
// The AST type is public, so nothing here trusts that a node came from parse().

import React from "react";
import type { HtmlElementShape } from "../ast";
import { SUBSET_TAGS, VOID_TAGS, validateAttributes } from "../htmlSubset/allowlist";
import { sanitizeImageSrc } from "../htmlSubset/imageSrc";
import { isLinkMention, mentionFaviconSrc } from "../linkMention";
import { isExternalUrl, sanitizeUrl } from "../../renderCore";

export interface HtmlSubsetRenderOptions {
  /** Path prefixes of the app's own media, e.g. "/api/media/uploads/". */
  mediaPrefixes: readonly string[];
}

export interface HtmlElementRenderSettings {
  externalLinks: boolean;
  htmlSubset?: HtmlSubsetRenderOptions;
}

type Key = number | string;

/** What an <img> element or a markdown image may carry into the DOM. */
interface SubsetImage {
  src?: string;
  alt?: string;
  title?: string;
  width?: string;
  height?: string;
  align?: string;
}

// No crossOrigin and no srcset: a README image must not leak the viewer's page
// URL or pick a source the policy never checked (U3-7).
export const REMOTE_IMAGE_PROPS = {
  loading: "lazy",
  decoding: "async",
  referrerPolicy: "no-referrer",
} as const;

const NUMERIC_PROPS = new Map([["colspan", "colSpan"], ["rowspan", "rowSpan"]]);

export function externalLinkProps(href: string, externalLinks: boolean): Record<string, string> {
  return externalLinks && isExternalUrl(href) ? { target: "_blank", rel: "noopener noreferrer" } : {};
}

// README mode prefixes heading and footnote ids as GitHub does, so `# config`
// cannot shadow a `window.config` global through named element access.
export function userContentId(id: string | undefined, htmlSubset: HtmlSubsetRenderOptions | undefined): string | undefined {
  if (!id) return undefined;
  return htmlSubset ? `user-content-${id}` : id;
}

// A link mention's favicon. In README mode it is a remote image like any other: https only.
export function renderMentionFavicon(
  href: string,
  htmlSubset: HtmlSubsetRenderOptions | undefined,
): React.ReactElement | null {
  const src = htmlSubset ? sanitizeImageSrc(mentionFaviconSrc(href), []) : mentionFaviconSrc(href);
  if (!src) return null;
  return React.createElement("img", {
    key: "favicon",
    className: "editor-link-favicon",
    "data-link-favicon": "true",
    src,
    alt: "",
    loading: "lazy",
    ...(htmlSubset ? REMOTE_IMAGE_PROPS : {}),
  });
}

/** An image under the subset policy, or null when its source is refused. */
export function renderSubsetImage(
  image: Readonly<SubsetImage>,
  htmlSubset: HtmlSubsetRenderOptions | undefined,
  key: Key,
): React.ReactElement | null {
  const src = sanitizeImageSrc(image.src ?? "", htmlSubset?.mediaPrefixes ?? []);
  if (!src) return null;
  const { alt, title, width, height, align } = image;
  return React.createElement("img", {
    key, src, alt, title: title || undefined, width, height, align, ...REMOTE_IMAGE_PROPS,
  });
}

export function renderHtmlElement<C>(
  node: HtmlElementShape<C>,
  settings: HtmlElementRenderSettings,
  key: Key,
  renderChild: (child: C, key: number) => React.ReactNode,
): React.ReactNode {
  const children = VOID_TAGS.has(node.tag) ? [] : node.children.map((child, index) => renderChild(child, index));
  if (!SUBSET_TAGS.has(node.tag)) return React.createElement(React.Fragment, { key }, ...children);
  const attrs = validateAttributes(node.tag, node.attrs);
  if (node.tag === "img") return renderSubsetImage(attrs, settings.htmlSubset, key);
  if (node.tag === "a") return renderAnchor(attrs, settings, key, children);
  return React.createElement(node.tag, { key, ...elementProps(attrs) }, ...children);
}

// An HTML title never makes a mention chip: the marker is dropped, not obeyed.
function renderAnchor(
  attrs: Readonly<Record<string, string>>,
  settings: HtmlElementRenderSettings,
  key: Key,
  children: React.ReactNode[],
): React.ReactNode {
  const href = sanitizeUrl(attrs.href ?? "");
  if (!href) return React.createElement(React.Fragment, { key }, ...children);
  const title = isLinkMention(attrs.title) ? undefined : attrs.title;
  const props = { key, href, title, className: "editor-link", ...externalLinkProps(href, settings.externalLinks) };
  return React.createElement("a", props, ...children);
}

function elementProps(attrs: Readonly<Record<string, string>>): Record<string, string | number> {
  const props: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(attrs)) {
    const numeric = NUMERIC_PROPS.get(name);
    if (numeric) props[numeric] = Number(value);
    else props[name] = value;
  }
  return props;
}
