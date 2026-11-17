// Fenced-code boundaries, shared by the block parser and the line pre-passes that
// must agree with it (reference definitions, empty-paragraph sentinels). A pre-pass
// that closed on any 3-char run cut a 4-backtick block at its first ``` line.

export interface FenceRun {
  char: string;
  length: number;
}

/** A run of 3+ backticks or tildes at the start of a trimStart()-ed line. O(run). */
export function fenceRunAt(trimmed: string): FenceRun | null {
  const char = trimmed[0];
  if (char !== "`" && char !== "~") return null;
  let length = 1;
  while (trimmed[length] === char) length += 1;
  return length >= 3 ? { char, length } : null;
}

/** CommonMark close: same char, at least as long as the opener, nothing after it. */
export function closesFence(trimmed: string, open: FenceRun): boolean {
  const run = fenceRunAt(trimmed);
  if (run === null || run.char !== open.char || run.length < open.length) return false;
  return trimmed.slice(run.length).trim() === "";
}
