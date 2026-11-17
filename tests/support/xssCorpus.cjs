"use strict";

// The U3-5 corpus (devil ruling, classes a-h). Shared by the engine suite and the
// host's Chromium spec so both outputs face the same inputs. A vector is
// [class, label, markdown]; the invariants live in htmlSubsetInvariants.cjs.

const KB200 = 200 * 1024;
const td = (body) => `<table>\n<tr>\n<td>\n\n${body}\n\n</td>\n</tr>\n</table>`;

const SCHEMES = [
  "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "java\rscript:alert(1)",
  "java&#x09;script:alert(1)", "java&#10;script:alert(1)", "java&#13;script:alert(1)",
  "&#106;avascript:alert(1)", "&#x6A;avascript:alert(1)", "&#0000106avascript:alert(1)",
  "&#106avascript:alert(1)", "javascript&colon;alert(1)", "java&Tab;script:alert(1)",
  "java&NewLine;script:alert(1)", "&amp;#106;avascript:alert(1)", "javascript%3Aalert(1)",
  "ｊａｖａｓｃｒｉｐｔ:alert(1)", "\u00a0javascript:alert(1)", "\u2028javascript:alert(1)",
  "\ufeffjavascript:alert(1)", "vbscript:msgbox(1)", "data:text/html;base64,PHNjcmlwdD4=",
  "blob:https://a.io/x", "file:///etc/passwd", " javascript:alert(1)", "\u0001javascript:alert(1)",
];

const SCHEME_VECTORS = SCHEMES.flatMap((url) => [
  ["a", `href ${JSON.stringify(url)}`, `<a href="${url}">x</a>`],
  ["a", `src ${JSON.stringify(url)}`, `<img src="${url}">`],
]);

const HANDLER_VECTORS = [
  ["b", "img onerror", "<img src=x onerror=alert(1)>"],
  ["b", "https img onerror", '<img src="https://a.io/x.png" onerror="alert(1)">'],
  ["b", "uppercase", "<IMG SRC=x ONERROR=alert(1)>"],
  ["b", "slash separators", "<img/src/onerror=alert(1)>"],
  ["b", "unterminated", "<img src=x onerror=alert(1)//"],
  ["b", "details ontoggle", "<details open ontoggle=alert(1)><summary>s</summary>b</details>"],
  ["b", "duplicate src", '<img src="https://a.io/x" src="javascript:alert(1)">'],
  ["b", "duplicate handler", "<img onerror=alert(1) onerror=alert(2) src=x>"],
  ["b", "anchor handler", '<a href="https://a.io" onmouseover="alert(1)">x</a>'],
  ["b", "div handler", '<div onclick="alert(1)">x</div>'],
  ["b", "NUL in name", "<img src=x on\u0000error=alert(1)>"],
];

const FORBIDDEN_TAG_VECTORS = [
  "<script>alert(1)</script>", "<scr<script>ipt>alert(1)</script>", "<svg onload=alert(1)>",
  "<svg><script>alert(1)</script></svg>",
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>', '<object data="javascript:alert(1)">',
  '<embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">x</button></form>',
  "<input autofocus onfocus=alert(1)>", '<base href="javascript:alert(1)//">',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<link rel="stylesheet" href="javascript:alert(1)">', '<style>@import "javascript:alert(1)";</style>',
  "<template><img src=x onerror=alert(1)></template>",
  "<noscript><img src=x onerror=alert(1)></noscript>", "<xmp><img src=x onerror=alert(1)></xmp>",
  "<plaintext><img src=x onerror=alert(1)>", "<textarea><img src=x onerror=alert(1)></textarea>",
  "<title><img src=x onerror=alert(1)></title>", "<!-- a --!><img src=x onerror=alert(1)>-->",
  "<![CDATA[<img src=x onerror=alert(1)>]]>", '<?xml version="1.0"?><img src=x onerror=alert(1)>',
  "<!DOCTYPE html><img src=x onerror=alert(1)>", "<scr\u0000ipt>alert(1)</script>",
  "<script>alert(1)</script", '<script src="https://a.io/x.js"></script>',
].map((markdown) => ["c", markdown.slice(0, 40), markdown]);

const MXSS_VECTORS = [
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
  "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
  "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>",
].map((markdown) => ["d", markdown.slice(0, 40), markdown]);

const CLOBBERING_VECTORS = [
  ["e", "img name", '<img name="getElementById" src="https://a.io/x.png">'],
  ["e", "anchor id", '<a id="config" href="https://a.io">x</a>'],
  ["e", "div id", '<div id="__proto__" name="x">x</div>'],
  ["e", "form name", '<form name="cookie"><img name="cookie" src="https://a.io/x"></form>'],
];

const MARKDOWN_IN_HTML_VECTORS = [
  ["f", "link in td", td("[x](javascript:alert(1))")],
  ["f", "image in td", td("![x](javascript:alert(1))")],
  ["f", "image in link", "[![a](javascript:alert(1))](javascript:alert(2))"],
  ["f", "autolink", "<javascript:alert(1)>"],
  ["f", "reference definition", "[x][r]\n\n[r]: javascript:alert(1)"],
  ["f", "fenced img in td", td("```html\n<img src=x onerror=alert(1)>\n```")],
];

const DETAILS_VECTORS = [
  ["g", "details", "<details><summary>S</summary>\n\nbody **b**\n\n</details>"],
  ["g", "kbd", "<kbd>Ctrl</kbd>+<kbd>C</kbd>"],
  ["g", "summary handler", "<details><summary onclick=alert(1)>s</summary></details>"],
];

const STRUCTURE_VECTORS = [
  ["g", "1000 stray closers", "</div>".repeat(1000)],
  ["g", "unclosed", "<div><span><b>unclosed"],
  ["g", "misnested", "<b><i>x</b></i>"],
  ["g", "a in a", '<a href="https://a.io"><a href="https://b.io">x</a></a>'],
  ["g", "div in table", "<table><div>x</div><tr><td>y</td></tr></table>"],
  ["g", "nesting bomb", "<div>".repeat(40000)],
  ["g", "200 KB of div", "<div>x</div>".repeat(Math.floor(KB200 / 12))],
  ["g", "200 KB attribute", `<img alt="${"a".repeat(KB200 - 20)}">`],
  ["g", "200 KB with no >", `<a href="https://a.io" ${"x ".repeat(KB200 / 2 - 20)}`],
  ["g", "10k img", "<img>".repeat(10000)],
];

const OVERSIZE_VECTORS = [["h", "over 200 KB", `<b>${"a".repeat(KB200)}</b>`]];

const XSS_CORPUS = [
  ...SCHEME_VECTORS, ...HANDLER_VECTORS, ...FORBIDDEN_TAG_VECTORS, ...MXSS_VECTORS,
  ...CLOBBERING_VECTORS, ...MARKDOWN_IN_HTML_VECTORS, ...DETAILS_VECTORS,
  ...STRUCTURE_VECTORS, ...OVERSIZE_VECTORS,
];

module.exports = { KB200, XSS_CORPUS };
