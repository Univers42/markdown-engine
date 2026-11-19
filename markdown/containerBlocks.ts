// `:::` containers -> column blocks. `columns` / `column <ratio>` are what the host writes.
// `row | stack | grid | section` are input sugar (ADR 0064 PS11): they read as a
// column_list, so a sugar block wrapping `:::column`s keeps its structure instead of
// leaving orphan columns (F2). Blocks between its columns are grouped into one column
// per run, so nothing inside a sugar block is lost and the list holds only columns.
//
// With `containerAttributes` on, a column_list/column also carries its opener's kind and
// raw `{k=v}` attributes as `containerAttributes`. The engine knows no scale: the host
// maps them to its own style and removes the field (PS13). Off (the default), the
// blocks are what they were before attributes existed.
import type { MarkEngineBlock as Block } from "../blockContract";
import type { BlockNode } from "./ast";

type ContainerNode = Extract<BlockNode, { type: "container" }>;
type ToBlocks = (node: BlockNode) => Block[];

const LAYOUT_SUGAR: ReadonlySet<string> = new Set(["row", "stack", "grid", "section"]);

let attachAttributes = false;

/** Runs `parse` with `containerAttributes` attached or not; restores the previous mode. */
export function withContainerAttributes<T>(attach: boolean, parse: () => T): T {
  const previous = attachAttributes;
  attachAttributes = attach;
  try {
    return parse();
  } finally {
    attachAttributes = previous;
  }
}

// Key order is the one these blocks always had, so stored JSON does not change.
function columnBlock(type: "column_list" | "column", children: Block[], widthRatio?: number): Block {
  if (widthRatio === undefined) return { id: crypto.randomUUID(), type, content: "", children };
  return { id: crypto.randomUUID(), type, content: "", widthRatio, children };
}

function withAttributes(block: Block, node: ContainerNode): Block {
  if (!attachAttributes || (node.attributes === undefined && !LAYOUT_SUGAR.has(node.kind))) return block;
  const values = node.attributes?.values ?? (Object.create(null) as Record<string, string>);
  block.containerAttributes = { kind: node.kind, values, dropped: node.attributes?.dropped ?? [] };
  return block;
}

/** Sugar children: each `:::column` stays a column, each run of other blocks becomes one. */
function sugarColumns(node: ContainerNode, toBlocks: ToBlocks): Block[] {
  const columns: Block[] = [];
  let run: Block[] = [];
  for (const child of node.children) {
    if (child.type !== "container" || child.kind !== "column") {
      run.push(...toBlocks(child));
      continue;
    }
    if (run.length > 0) columns.push(columnBlock("column", run));
    run = [];
    columns.push(...toBlocks(child));
  }
  if (run.length > 0) columns.push(columnBlock("column", run));
  return columns;
}

function column(node: ContainerNode, toBlocks: ToBlocks): Block {
  const ratio = Number.parseFloat(node.params ?? "");
  return columnBlock("column", node.children.flatMap(toBlocks), Number.isFinite(ratio) ? ratio : undefined);
}

export function containerToBlocks(node: ContainerNode, toBlocks: ToBlocks): Block[] {
  if (node.kind === "columns") return [withAttributes(columnBlock("column_list", node.children.flatMap(toBlocks)), node)];
  if (node.kind === "column") return [withAttributes(column(node, toBlocks), node)];
  if (LAYOUT_SUGAR.has(node.kind)) return [withAttributes(columnBlock("column_list", sugarColumns(node, toBlocks)), node)];
  // Unknown container kinds flatten to their children — nothing is lost.
  return node.children.flatMap(toBlocks);
}
