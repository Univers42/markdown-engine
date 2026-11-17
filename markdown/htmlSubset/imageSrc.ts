// Image sources a README may load: an absolute https URL, or a path under one of
// the app's own media prefixes. Deliberately narrower than sanitizeUrl (devil
// ruling U3-3): an image loads with no click, so http (mixed content), data:,
// blob:, protocol-relative and traversing paths are refused.

const ASCII_WHITESPACE = new Set([9, 10, 12, 13, 32]);
const UNSAFE_CHARACTER = /[\u0000- \u007f\\]/;
const ENCODED_SEPARATOR = /%(?:2e|2f|5c)/i;

export function sanitizeImageSrc(src: string, mediaPrefixes: readonly string[]): string {
  const value = trimAsciiWhitespace(src);
  if (value === "" || UNSAFE_CHARACTER.test(value)) return "";
  if (/^https:\/\//i.test(value)) return absoluteHttps(value);
  return mediaPath(value, mediaPrefixes);
}

// String.prototype.trim also strips U+00A0 and U+FEFF, which a browser keeps in
// a src; only the ASCII whitespace the URL parser strips is trimmed here.
function trimAsciiWhitespace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && ASCII_WHITESPACE.has(value.charCodeAt(start))) start++;
  while (end > start && ASCII_WHITESPACE.has(value.charCodeAt(end - 1))) end--;
  return value.slice(start, end);
}

function absoluteHttps(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  const hasCredentials = url.username !== "" || url.password !== "";
  return url.protocol === "https:" && url.hostname !== "" && !hasCredentials ? url.href : "";
}

const isUsablePrefix = (prefix: string): boolean => prefix.startsWith("/") && !prefix.startsWith("//");

function mediaPath(value: string, mediaPrefixes: readonly string[]): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "";
  const underPrefix = mediaPrefixes.some((prefix) => isUsablePrefix(prefix) && value.startsWith(prefix));
  return underPrefix && !escapesPrefix(value) ? value : "";
}

// Checked on the raw and on the once-decoded path, so `%2e%2e` and `%252e` are
// both refused whatever the media server decodes.
function escapesPrefix(path: string): boolean {
  if (ENCODED_SEPARATOR.test(path)) return true;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true;
  }
  return decoded.includes("..") || ENCODED_SEPARATOR.test(decoded) || UNSAFE_CHARACTER.test(decoded);
}
