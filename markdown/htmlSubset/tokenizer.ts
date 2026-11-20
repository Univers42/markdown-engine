// Reads one HTML tag, comment or dropped element at a "<", for the README subset.
// Caveat: not a full HTML5 tokenizer — no foster parenting, no adoption agency, no
// foreign content, no end-tag attribute quoting, and a tag name ends at the first
// character outside [A-Za-z0-9-] (HTML5 would keep reading `<scr<script>` as one
// name). It can differ from GitHub on malformed markup but is never more
// permissive: what it cannot read is literal text or dropped, and only
// allowlisted attribute names are kept.

import { isAllowedAttributeName } from "./allowlist";
import { canScanHtml, chargeFailedScan } from "./session";
import { countSteps, countedIndexOf } from "../scanSteps";

export type HtmlTagToken =
  | { kind: "open"; tag: string; attrs: Map<string, string>; end: number }
  | { kind: "close"; tag: string; end: number };

export type HtmlToken = HtmlTagToken | { kind: "drop"; end: number };

// Their whole content is dropped: raw text in HTML5, or a foreign/embedding
// context the subset never renders.
const DROPPED_WITH_CONTENT: ReadonlySet<string> = new Set([
  "script", "style", "textarea", "title", "xmp", "noscript", "noembed", "noframes",
  "iframe", "template", "svg", "math", "object", "applet", "plaintext",
]);

const isLetter = (code: number): boolean => (code | 0x20) >= 97 && (code | 0x20) <= 122;
const isNameChar = (code: number): boolean => isLetter(code) || (code >= 48 && code <= 57) || code === 45;
// HTML5 whitespace: tab, LF, FF, CR, space (not VT, which HTML5 keeps in a name).
const isSpace = (code: number): boolean => code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
const endsName = (code: number): boolean => Number.isNaN(code) || isSpace(code) || code === 47 || code === 62;

export function scanHtmlAt(text: string, pos: number): HtmlToken | null {
  if (text.charCodeAt(pos) !== 60 || !canScanHtml()) return null;
  const next = text.charCodeAt(pos + 1);
  if (next === 63 || (next === 33 && isDeclaration(text, pos))) return { kind: "drop", end: declarationEnd(text, pos) };
  const closing = next === 47;
  const nameStart = closing ? pos + 2 : pos + 1;
  if (!isLetter(text.charCodeAt(nameStart))) return null;
  let nameEnd = nameStart;
  while (isNameChar(text.charCodeAt(nameEnd))) nameEnd++;
  countSteps(nameEnd - nameStart);
  if (!endsName(text.charCodeAt(nameEnd))) return null;
  const tag = text.slice(nameStart, nameEnd).toLowerCase();
  const attrs = new Map<string, string>();
  const end = scanAttributes(text, nameEnd, attrs);
  if (end === -1) {
    chargeFailedScan(text.length - pos);
    return null;
  }
  if (closing) return { kind: "close", tag, end };
  if (DROPPED_WITH_CONTENT.has(tag)) return { kind: "drop", end: droppedContentEnd(text, tag, end) };
  return { kind: "open", tag, attrs, end };
}

// CommonMark's raw-HTML forms: a comment, `<!` + letter, CDATA. Any other `<!` is text.
function isDeclaration(text: string, pos: number): boolean {
  return text.startsWith("<!--", pos) || text.startsWith("<![CDATA[", pos) || isLetter(text.charCodeAt(pos + 2));
}

// `<!-- -->` (also closed by `--!>`, and `<!-->` / `<!--->` are empty), `<!...>`
// and `<?...>`. Unterminated, they drop the rest of the text, as in HTML5.
function declarationEnd(text: string, pos: number): number {
  if (!text.startsWith("<!--", pos)) return endAfter(text, ">", pos + 2);
  const body = pos + 4;
  if (text.startsWith(">", body)) return body + 1;
  if (text.startsWith("->", body)) return body + 2;
  const closed = endAfter(text, "-->", body);
  const bang = endAfter(text, "--!>", body);
  return Math.min(closed, bang);
}

function endAfter(text: string, needle: string, from: number): number {
  const at = countedIndexOf(text, needle, from);
  return at === -1 ? text.length : at + needle.length;
}

// Returns the index after ">", or -1 when the text ends inside the tag (HTML5
// drops such a tag; here the "<" becomes literal text instead).
function scanAttributes(text: string, from: number, attrs: Map<string, string>): number {
  let pos = from;
  while (pos < text.length) {
    const code = text.charCodeAt(pos);
    if (code === 62) { countSteps(pos + 1 - from); return pos + 1; }
    if (isSpace(code) || code === 47) pos++;
    else pos = scanAttribute(text, pos, attrs);
  }
  countSteps(text.length - from);
  return -1;
}

function scanAttribute(text: string, from: number, attrs: Map<string, string>): number {
  let pos = from + 1;
  while (pos < text.length && !endsAttributeName(text.charCodeAt(pos))) pos++;
  const name = text.slice(from, pos).toLowerCase();
  let valueStart = pos;
  while (isSpace(text.charCodeAt(valueStart))) valueStart++;
  if (text.charCodeAt(valueStart) !== 61) {
    keepAttribute(attrs, name, "");
    return pos;
  }
  valueStart++;
  while (isSpace(text.charCodeAt(valueStart))) valueStart++;
  const value = readValue(text, valueStart);
  if (value.end !== -1) keepAttribute(attrs, name, value.text);
  return value.end === -1 ? text.length : value.end;
}

const endsAttributeName = (code: number): boolean => isSpace(code) || code === 47 || code === 62 || code === 61;

function readValue(text: string, from: number): { text: string; end: number } {
  const quote = text.charCodeAt(from);
  if (quote === 34 || quote === 39) {
    const close = text.indexOf(text[from], from + 1);
    return close === -1 ? { text: "", end: -1 } : { text: text.slice(from + 1, close), end: close + 1 };
  }
  let end = from;
  while (end < text.length && !isSpace(text.charCodeAt(end)) && text.charCodeAt(end) !== 62) end++;
  return { text: text.slice(from, end), end };
}

// The first occurrence wins, as in HTML5; names outside the subset are never stored.
function keepAttribute(attrs: Map<string, string>, name: string, value: string): void {
  if (isAllowedAttributeName(name) && !attrs.has(name)) attrs.set(name, value);
}

function droppedContentEnd(text: string, tag: string, from: number): number {
  if (tag === "plaintext") return text.length;
  for (let at = countedIndexOf(text, "</", from); at !== -1; at = countedIndexOf(text, "</", at + 2)) {
    const nameEnd = at + 2 + tag.length;
    if (text.slice(at + 2, nameEnd).toLowerCase() === tag && endsName(text.charCodeAt(nameEnd))) {
      return endAfter(text, ">", nameEnd);
    }
  }
  return text.length;
}
