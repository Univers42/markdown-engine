// One bundle for the inline step tests: the parser, the subset session and the
// counter share one scanSteps instance, so readSteps() sees every counted scan
// (two loaded entries would split the count, ADR 0068 D6). Test-only, like
// bench/scanEntry.ts: no package entry may re-export the counter (D5).
export { parseInline } from "../../markdown/parser";
export { runInHtmlSubsetSession } from "../../markdown/htmlSubset/session";
export { readSteps, resetSteps } from "../../markdown/scanSteps";
