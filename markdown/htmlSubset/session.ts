// Per-parse limits of the README HTML subset (devil ruling U3-5). A README is
// untrusted, so one parse() call gets a bounded element count and a bounded
// amount of tag scanning that found no tag. parse() is synchronous, which is
// why the slot is module state; a nested run restores the outer slot.
import { countSteps } from "../scanSteps";

export const MAX_HTML_DEPTH = 16;
export const MAX_HTML_ELEMENTS = 5000;
export const MAX_SUBSET_INPUT_BYTES = 200 * 1024;

interface HtmlSubsetSession {
  elements: number;
  scanBudget: number;
  // Elements already open around the block being parsed: markdown inside a
  // <div> is parsed before the div's tree is built, so the cap of 16 must be
  // handed down to the builders that block creates.
  depthBase: number;
}

let active: HtmlSubsetSession | null = null;

export function runInHtmlSubsetSession<T>(sourceLength: number, run: () => T): T {
  const outer = active;
  active = { elements: 0, scanBudget: sourceLength * 8 + 1024, depthBase: 0 };
  try {
    return run();
  } finally {
    active = outer;
  }
}

export function isHtmlSubsetActive(): boolean {
  return active !== null;
}

export function htmlDepthBase(): number {
  return active?.depthBase ?? 0;
}

export function setHtmlDepthBase(depth: number): void {
  if (active !== null) active.depthBase = depth;
}

export function takeHtmlElements(count: number): boolean {
  if (active === null || active.elements + count > MAX_HTML_ELEMENTS) return false;
  active.elements += count;
  return true;
}

// Caveat: the budget is spent only by scans that read to the end of the text and
// found no tag (an unterminated tag or quote). Once spent, every later "<" in the
// same parse is literal text, valid tags included — a document built from many
// unterminated tags loses its later markup rather than going quadratic.
export function chargeFailedScan(cost: number): void {
  if (active !== null) active.scanBudget -= cost;
}

export function canScanHtml(): boolean {
  return active !== null && active.scanBudget > 0;
}

function utf8Width(code: number): number {
  if (code < 0x80) return 1;
  return code < 0x800 ? 2 : 3;
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

// UTF-8 length as TextEncoder counts it (a lone surrogate becomes U+FFFD, 3 bytes),
// stopping as soon as the cap is passed. No skip for short text: a length*3 <= cap
// skip made 50 KB free and 200 KB not, a 7.5x step the U3-6 bench reads as superlinear.
export function exceedsUtf8Bytes(text: string, cap: number): boolean {
  if (text.length > cap) return true;
  let bytes = 0;
  let i = 0;
  for (; i < text.length && bytes <= cap; i++) {
    const code = text.charCodeAt(i);
    if (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(i + 1))) {
      bytes += 4;
      i++;
    } else {
      bytes += utf8Width(code);
    }
  }
  countSteps(i);
  return bytes > cap;
}
