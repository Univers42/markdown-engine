// Character references in HTML attribute values and text, decoded exactly once
// before anything is validated (devil ruling U3-3).
// Caveat: the named set covers the references READMEs and XSS payloads use, not
// HTML5's 2,231; an unknown name stays literal, so it shows as typed. Legacy
// names without ";" (`&amp` alone) are not decoded, and numeric 0x80-0x9F is not
// remapped to Windows-1252 as a browser does. Either way the decoded value is
// the one validated and rendered; nothing re-parses it.

const NAMED = new Map<string, string>([
  ["amp", "&"], ["AMP", "&"], ["lt", "<"], ["LT", "<"], ["gt", ">"], ["GT", ">"],
  ["quot", '"'], ["QUOT", '"'], ["apos", "'"], ["nbsp", "\u00a0"], ["colon", ":"],
  ["Tab", "\t"], ["NewLine", "\n"], ["sol", "/"], ["bsol", "\\"], ["lpar", "("],
  ["rpar", ")"], ["period", "."], ["comma", ","], ["excl", "!"], ["num", "#"],
  ["percnt", "%"], ["semi", ";"], ["equals", "="], ["quest", "?"], ["commat", "@"],
  ["lsqb", "["], ["rsqb", "]"], ["lbrack", "["], ["rbrack", "]"], ["lowbar", "_"],
  ["grave", "`"], ["lcub", "{"], ["rcub", "}"], ["lbrace", "{"], ["rbrace", "}"],
  ["verbar", "|"], ["vert", "|"], ["dollar", "$"], ["plus", "+"], ["ast", "*"],
  ["copy", "©"], ["COPY", "©"], ["reg", "®"], ["REG", "®"],
  ["trade", "™"], ["hellip", "…"], ["mdash", "—"], ["ndash", "–"],
  ["middot", "·"], ["bull", "•"], ["laquo", "«"], ["raquo", "»"],
  ["times", "×"], ["divide", "÷"], ["deg", "°"], ["sect", "§"],
  ["para", "¶"], ["ensp", "\u2002"], ["emsp", "\u2003"], ["thinsp", "\u2009"],
  ["zwj", "\u200d"], ["zwnj", "\u200c"], ["larr", "←"], ["rarr", "→"],
  ["uarr", "↑"], ["darr", "↓"], ["harr", "↔"], ["check", "✓"],
  ["hearts", "♥"], ["star", "☆"], ["starf", "★"], ["euro", "€"],
]);

const REFERENCE = /&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([A-Za-z][A-Za-z0-9]{1,31});)/g;

export function decodeHtmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(REFERENCE, decodeReference);
}

function decodeReference(match: string, decimal?: string, hex?: string, name?: string): string {
  if (name !== undefined) return NAMED.get(name) ?? match;
  const code = decimal === undefined ? Number.parseInt(hex ?? "", 16) : Number.parseInt(decimal, 10);
  return codePointText(code);
}

// NUL, surrogates and anything past U+10FFFF (including an overflowing digit run)
// become U+FFFD, as in the HTML5 tokenizer.
function codePointText(code: number): string {
  const isSurrogate = code >= 0xd800 && code <= 0xdfff;
  if (!(code > 0 && code <= 0x10ffff) || isSurrogate) return "\ufffd";
  return String.fromCodePoint(code);
}
