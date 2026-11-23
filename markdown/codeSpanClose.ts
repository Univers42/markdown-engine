// Markdown parser: where an inline code span closes.
//
// A span opened by n backticks closes at the first later run of at least n, and
// only if that run has exactly n. The matcher measured the run and searched for n
// backticks from every position of a run that never closed: "a" + 8 KiB of
// backticks parsed in 56 ms, 1 KiB in 0.9 ms (osionos#240), and runs of m, m-1,
// ..., 1 backticks each read every shorter run after them. A scan now reads its
// runs once, each linked to the next longer run after it: the first run of at
// least n is found by following those links, and every position of one run
// shares the answer.
import { nextMatchIndex, scanTable } from "./inlineScanMemo";
import { countSteps, countedIndexOf } from "./scanSteps";

interface BacktickRuns {
  readonly starts: number[];
  readonly lengths: number[];
  // The first later run longer than this one, or -1.
  readonly longer: number[];
  // A run's end to the index of the run after it.
  readonly after: Map<number, number>;
  // A run's end to the longest opener asked about, and the last run on its
  // "longer" path no longer than that opener (-1 for none).
  readonly asked: Map<number, number>;
  readonly settled: Map<number, number>;
}

const NOT_BACKTICK = /[^`]/g;

/** Where the backtick run at `pos` ends: its first non-backtick, or the text's end. */
export function backtickRunEnd(text: string, pos: number): number {
  const end = nextMatchIndex(text, NOT_BACKTICK, pos);
  return end === -1 ? text.length : end;
}

/**
 * Where the closer of the `ticks` backticks ending at `runEnd` starts, or -1: the
 * first later run of at least `ticks`, if it has exactly that many.
 */
export function findCodeSpanClose(text: string, runEnd: number, ticks: number): number {
  if (ticks === 1) {
    const close = countedIndexOf(text, "`", runEnd);
    return close !== -1 && text.charCodeAt(close + 1) !== 96 ? close : -1;
  }
  const runs = scanTable(text, "`", readBacktickRuns);
  const run = settledRun(runs, runEnd, ticks);
  return run !== -1 && runs.lengths[run] === ticks ? runs.starts[run] : -1;
}

// The "longer" path from the next run passes the first run of each new length,
// so for every opener between the last length on it no longer than `ticks` and
// `ticks` itself, the first run at least that long is that last one or longer.
function settledRun(runs: BacktickRuns, runEnd: number, ticks: number): number {
  const asked = runs.asked.get(runEnd);
  const known = runs.settled.get(runEnd) ?? -1;
  const floor = known === -1 ? 0 : runs.lengths[known];
  if (asked !== undefined && ticks <= asked && ticks >= floor) return known;
  let settled = -1;
  let run = runs.after.get(runEnd) ?? -1;
  while (run !== -1 && run < runs.lengths.length && runs.lengths[run] <= ticks) {
    countSteps(1);
    settled = run;
    run = runs.longer[run];
  }
  runs.asked.set(runEnd, ticks);
  runs.settled.set(runEnd, settled);
  return settled;
}

function readBacktickRuns(text: string): BacktickRuns {
  const runs: BacktickRuns = {
    starts: [], lengths: [], longer: [], after: new Map(), asked: new Map(), settled: new Map(),
  };
  let start = countedIndexOf(text, "`", 0);
  while (start !== -1) {
    let end = start + 1;
    while (end < text.length && text.charCodeAt(end) === 96) end++;
    countSteps(end - start);
    runs.after.set(end, runs.starts.length + 1);
    runs.starts.push(start);
    runs.lengths.push(end - start);
    start = countedIndexOf(text, "`", end);
  }
  linkLongerRuns(runs);
  return runs;
}

// Right to left, the stack holds the runs that are longer than every run between
// them and the cursor; each run is pushed and popped once.
function linkLongerRuns(runs: BacktickRuns): void {
  const stack: number[] = [];
  for (let run = runs.lengths.length - 1; run >= 0; run--) {
    while (stack.length > 0 && runs.lengths[stack[stack.length - 1]] <= runs.lengths[run]) stack.pop();
    runs.longer[run] = stack.length > 0 ? stack[stack.length - 1] : -1;
    stack.push(run);
  }
  countSteps(2 * runs.lengths.length);
}
