// The README HTML subset: which tags exist, which attributes each keeps, and the
// value each attribute accepts (devil ruling U3-1/U3-3). A failing value is
// dropped, never clamped; style, id, name, class and every on* are never kept.

import { sanitizeUrl } from "../../renderCore";
import { decodeHtmlEntities } from "./entities";
import { sanitizeImageSrc } from "./imageSrc";

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

export const SUBSET_TAGS: ReadonlySet<string> = new Set([
  "div", "p", "span", "a", "img", "br", "hr", "sub", "sup", "b", "i", "em", "strong",
  "code", "pre", "kbd", "details", "summary", "table", "thead", "tbody", "tr", "td",
  "th", "ul", "ol", "li", "blockquote", ...HEADING_TAGS,
]);

export const PHRASING_TAGS: ReadonlySet<string> = new Set([
  "span", "a", "img", "br", "sub", "sup", "b", "i", "em", "strong", "code", "kbd",
]);

export const VOID_TAGS: ReadonlySet<string> = new Set(["img", "br", "hr"]);

export const HEADINGS: ReadonlySet<string> = new Set(HEADING_TAGS);

type Validator = (value: string) => string | null;

const oneOf = (allowed: readonly string[]): Validator => (value) => {
  const lower = value.toLowerCase();
  return allowed.includes(lower) ? lower : null;
};

// 1-2048 px or 1-100 %: digits only, no leading zero, no unit but "%".
const size: Validator = (value) => {
  const match = /^[1-9]\d{0,3}(%?)$/.exec(value);
  if (!match) return null;
  return Number.parseInt(value, 10) <= (match[1] ? 100 : 2048) ? value : null;
};

const span = (max: number): Validator => (value) =>
  /^[1-9]\d{0,2}$/.test(value) && Number(value) <= max ? value : null;

const shortText: Validator = (value) => (value.length <= 512 ? value : null);

// Parse time keeps any single-slash path; the renderer narrows it to the app's
// media prefixes, which only the host knows.
const imageSource: Validator = (value) => sanitizeImageSrc(value, ["/"]) || null;

const align = oneOf(["left", "center", "right", "justify"]);
const aligned = new Map([["align", align]]);
const cell = new Map([
  ["align", align], ["valign", oneOf(["top", "middle", "bottom", "baseline"])],
  ["width", size], ["height", size], ["colspan", span(64)], ["rowspan", span(256)],
]);

const TAG_ATTRIBUTES: ReadonlyMap<string, ReadonlyMap<string, Validator>> = new Map([
  ["a", new Map([["href", (value: string) => sanitizeUrl(value) || null], ["title", shortText]])],
  ["img", new Map([
    ["src", imageSource], ["alt", shortText], ["title", shortText],
    ["width", size], ["height", size], ["align", align],
  ])],
  ["td", cell], ["th", cell], ["div", aligned], ["p", aligned], ["table", aligned],
  ...HEADING_TAGS.map((tag): [string, ReadonlyMap<string, Validator>] => [tag, aligned]),
]);

const ATTRIBUTE_NAMES: ReadonlySet<string> = new Set(
  [...TAG_ATTRIBUTES.values()].flatMap((rules) => [...rules.keys()]),
);

export function isAllowedAttributeName(name: string): boolean {
  return ATTRIBUTE_NAMES.has(name);
}

// Raw tokenizer values: decoded once, then validated.
export function filterAttributes(tag: string, raw: ReadonlyMap<string, string>): Record<string, string> {
  return validated(tag, [...raw].map(([name, value]) => [name, decodeHtmlEntities(value)]));
}

// Already-decoded values from an AST, re-checked by every renderer: the AST type
// is public, so a renderer never trusts that a node came from this parser.
export function validateAttributes(tag: string, attrs: Readonly<Record<string, string>>): Record<string, string> {
  return validated(tag, Object.entries(attrs));
}

function validated(tag: string, entries: readonly (readonly [string, string])[]): Record<string, string> {
  const rules = TAG_ATTRIBUTES.get(tag);
  const attrs: Record<string, string> = {};
  for (const [name, value] of entries) {
    const accepted = typeof value === "string" ? rules?.get(name)?.(value) : null;
    if (accepted !== null && accepted !== undefined) attrs[name] = accepted;
  }
  return attrs;
}
