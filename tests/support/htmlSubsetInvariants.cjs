"use strict";

// What no README may ever produce, checked on both outputs of the HTML subset:
// the React element tree (stubbed createElement) and the renderHtml string.
// Caveat: the string check reads tags with a regex over OUR serializer's output
// (always name="value", values escaped). It is not an HTML5 parse; the host's
// Chromium spec re-parses the real markup for that.

const SUBSET_TAGS = (
  "div p span a img br hr sub sup b i em strong code pre kbd details summary " +
  "table thead tbody tr td th h1 h2 h3 h4 h5 h6 ul ol li blockquote"
).split(" ");
// Elements the engine's own markdown renderers emit (strikethrough, underline,
// highlight, definition lists, footnote markers).
const MARKDOWN_TAGS = ["del", "u", "mark", "dl", "dt", "dd"];
const ALLOWED_TAGS = new Set([...SUBSET_TAGS, ...MARKDOWN_TAGS]);
const MEDIA_PREFIXES = ["/api/media/uploads/"];
const BAD_SCHEME = /^(?:javascript|vbscript|data|blob|file):/;
const IMAGE_SRC = /^(?:https:\/\/|\/api\/media\/uploads\/)/;
const SAFE_ID = /^(?:user-content-|fn-)/;

function schemeView(url) {
  return String(url).trim().replace(/[\u0000- \u007f]/g, "").toLowerCase();
}

function attributeProblems(tag, name, value) {
  const problems = [];
  const lower = name.toLowerCase();
  if (lower.startsWith("on")) problems.push(`${tag}: handler ${name}`);
  if (lower === "dangerouslysetinnerhtml") problems.push(`${tag}: innerHTML`);
  if ((lower === "href" || lower === "src") && BAD_SCHEME.test(schemeView(value))) {
    problems.push(`${tag}: ${name}=${value}`);
  }
  if (lower === "src" && !IMAGE_SRC.test(String(value))) problems.push(`${tag}: src=${value}`);
  if ((lower === "id" || lower === "name") && !SAFE_ID.test(String(value))) {
    problems.push(`${tag}: ${name}=${value}`);
  }
  if (lower === "style" && /url\(|expression|javascript/i.test(JSON.stringify(value))) {
    problems.push(`${tag}: style ${JSON.stringify(value)}`);
  }
  return problems;
}

function collectElements(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  out.push(node);
  collectElements(node.children, out);
  return out;
}

function reactProblems(tree) {
  const problems = [];
  for (const element of collectElements(tree)) {
    const tag = element.type;
    if (typeof tag === "string" && !ALLOWED_TAGS.has(tag)) problems.push(`tag ${tag}`);
    for (const [name, value] of Object.entries(element.props ?? {})) {
      // An absent prop (value undefined) never reaches the DOM.
      if (name === "children" || name === "key" || value === undefined) continue;
      problems.push(...attributeProblems(String(tag), name, value));
    }
  }
  return problems;
}

function unescapeAttribute(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function htmlProblems(html) {
  const problems = [];
  for (const tagMatch of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    const tag = tagMatch[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) problems.push(`tag ${tag}`);
    const attributes = tagMatch[2];
    const rest = attributes.replace(/([^\s=]+)="([^"]*)"/g, (_, name, value) => {
      problems.push(...attributeProblems(tag, name, unescapeAttribute(value)));
      return "";
    });
    if (rest.trim() !== "" && rest.trim() !== "/") problems.push(`${tag}: stray "${rest.trim()}"`);
  }
  return problems;
}

function elementsOfType(tree, type) {
  return collectElements(tree).filter((element) => element.type === type);
}

function maxDepth(node, tags, depth = 0) {
  if (Array.isArray(node)) {
    return node.reduce((deepest, child) => Math.max(deepest, maxDepth(child, tags, depth)), depth);
  }
  if (!node || typeof node !== "object") return depth;
  const own = tags.has(node.type) ? depth + 1 : depth;
  return maxDepth(node.children, tags, own);
}

// html_element levels on any path through a parsed AST, whatever markdown sits between.
function htmlElementDepth(value) {
  if (Array.isArray(value)) return value.reduce((deepest, item) => Math.max(deepest, htmlElementDepth(item)), 0);
  if (!value || typeof value !== "object") return 0;
  const below = Object.values(value).reduce((deepest, item) => Math.max(deepest, htmlElementDepth(item)), 0);
  return below + (value.type === "html_element" ? 1 : 0);
}

module.exports = {
  ALLOWED_TAGS,
  MEDIA_PREFIXES,
  SUBSET_TAGS,
  collectElements,
  elementsOfType,
  htmlElementDepth,
  htmlProblems,
  maxDepth,
  reactProblems,
};
