"use strict";

// U3-3: an <img> or markdown image source is an absolute https: URL or a path
// under one of the app's own media prefixes. Everything else renders no image.
const test = require("node:test");
const assert = require("node:assert");
const { loadMarkengine } = require("./support/loadMarkengine.cjs");

const { sanitizeImageSrc } = loadMarkengine("index.ts");
const MEDIA = ["/api/media/uploads/"];

const ACCEPTED = [
  ["https://a.io/x.png", "https://a.io/x.png"],
  ["HTTPS://A.IO/x.png", "https://a.io/x.png"],
  ["  https://a.io/x.png\n", "https://a.io/x.png"],
  ["https://a.io/x.png?w=1&h=2", "https://a.io/x.png?w=1&h=2"],
  ["https://a.io:8443/x.png", "https://a.io:8443/x.png"],
  ["https://a.io/a%2Fb.png", "https://a.io/a%2Fb.png"],
  ["https://img.shields.io/badge/C-00599C?style=flat", "https://img.shields.io/badge/C-00599C?style=flat"],
  ["https://a.io/../x.png", "https://a.io/x.png"],
  ["/api/media/uploads/u1/avatar.png", "/api/media/uploads/u1/avatar.png"],
  ["/api/media/uploads/a.png?v=2", "/api/media/uploads/a.png?v=2"],
  ["\t/api/media/uploads/a.png ", "/api/media/uploads/a.png"],
];

const REJECTED = [
  "http://a.io/x.png",
  "HTTP://a.io/x.png",
  "data:image/png;base64,iVBORw0KGgo=",
  "data:image/svg+xml,<svg onload=alert(1)>",
  "blob:https://a.io/uuid",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "java\tscript:alert(1)",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "ftp://a.io/x.png",
  "//a.io/x.png",
  "///a.io/x.png",
  "/\\a.io/x.png",
  "\\\\a.io\\x.png",
  "https:\\\\a.io\\x.png",
  "https:/a.io/x.png",
  "https:a.io/x.png",
  "https://",
  "https://user:pass@a.io/x.png",
  "https://user@a.io/x.png",
  "https://a.io/x\u0000.png",
  "https://a.io/x\n.png",
  "https://a.io/x .png",
  "/api/media/uploads/../secret",
  "/api/media/uploads/a/../../secret",
  "/api/media/uploads/%2e%2e/secret",
  "/api/media/uploads/%2E%2E/secret",
  "/api/media/uploads/a%2fb",
  "/api/media/uploads/a%2Fb",
  "/api/media/uploads/a%5cb",
  "/api/media/uploads/%252e%252e/secret",
  "/api/media/uploads\\a.png",
  "/api/media/uploadsX/a.png",
  "/API/MEDIA/UPLOADS/a.png",
  "/api/media/a.png",
  "api/media/uploads/a.png",
  "./x.png",
  "x.png",
  "",
  "   ",
  "\u00a0https://a.io/x.png",
  "&#104;ttps://a.io/x.png",
  "https%3A//a.io/x.png",
];

test("U3-3 sanitizeImageSrc covers at least 40 vectors", () => {
  assert.ok(ACCEPTED.length + REJECTED.length >= 40, String(ACCEPTED.length + REJECTED.length));
});

for (const [input, expected] of ACCEPTED) {
  test(`accepts ${JSON.stringify(input)}`, () => {
    assert.strictEqual(sanitizeImageSrc(input, MEDIA), expected);
  });
}

for (const input of REJECTED) {
  test(`rejects ${JSON.stringify(input)}`, () => {
    assert.strictEqual(sanitizeImageSrc(input, MEDIA), "");
  });
}

test("the prefixes are a parameter: none given means https only", () => {
  assert.strictEqual(sanitizeImageSrc("/api/media/uploads/a.png", []), "");
  assert.strictEqual(sanitizeImageSrc("https://a.io/x.png", []), "https://a.io/x.png");
});

test("a prefix that is not a single-slash path is ignored, never trusted", () => {
  assert.strictEqual(sanitizeImageSrc("//cdn.io/a.png", ["//cdn.io/"]), "");
  assert.strictEqual(sanitizeImageSrc("cdn/a.png", ["cdn/"]), "");
  assert.strictEqual(sanitizeImageSrc("/a.png", [""]), "");
});
