// Markdown parser — link reference definitions (`[label]: url "title"`).
//
// One fence-aware pre-pass collects them and drops their lines from the block
// stream (they render nothing). `[^label]:` stays: that is a footnote. The
// `[//]: # (comment)` idiom is swallowed here for free.
import { closesFence, fenceRunAt, type FenceRun } from "./fence";
import { normalizeRefLabel, type InlineRefDefinition } from "./parserInlineMatchers";

const REF_DEFINITION_RE =
  /^ {0,3}\[([^\]]+)\]:\s*(\S+)(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/;

export function collectRefDefinitions(lines: string[]): {
  lines: string[];
  definitions: Map<string, InlineRefDefinition>;
} {
  const definitions = readDefinitions(lines);
  if (definitions.size === 0) return { lines, definitions };
  return { lines: dropDefinitionLines(lines), definitions };
}

function readDefinitions(lines: string[]): Map<string, InlineRefDefinition> {
  const definitions = new Map<string, InlineRefDefinition>();
  let fence: FenceRun | null = null;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (fence) {
      if (closesFence(trimmed, fence)) fence = null;
      continue;
    }
    fence = fenceRunAt(trimmed);
    if (fence || trimmed[0] !== "[" || trimmed[1] === "^") continue;
    const match = REF_DEFINITION_RE.exec(line);
    if (match) addDefinition(definitions, match);
  }
  return definitions;
}

// The first definition of a label wins.
function addDefinition(definitions: Map<string, InlineRefDefinition>, match: RegExpExecArray): void {
  const href = match[2].replace(/^<(.*)>$/, "$1");
  const title = match[3] ?? match[4] ?? match[5];
  const label = normalizeRefLabel(match[1]);
  if (!definitions.has(label)) definitions.set(label, { href, title });
}

function dropDefinitionLines(lines: string[]): string[] {
  const kept: string[] = [];
  let fence: FenceRun | null = null;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!fence && trimmed[0] === "[" && trimmed[1] !== "^" && REF_DEFINITION_RE.test(line)) {
      continue;
    }
    if (fence && closesFence(trimmed, fence)) fence = null;
    else if (!fence) fence = fenceRunAt(trimmed);
    kept.push(line);
  }
  return kept;
}
