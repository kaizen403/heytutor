/**
 * Discrete-structure (DSA) scene synthesis: arrays, linked lists, trees,
 * graphs, and tables for code lessons.
 *
 * Geometry is composed exclusively from existing manifest operators (point,
 * rectangle, circle, segment, vector, label) with deterministic layout math,
 * and verified with existing predicates (exists, ordered_along,
 * equal_spacing). Structures come from a normalized diagram hint — values
 * appear only when the hint states them — so every diagram stays an honest
 * qualitative representation of the question, never a guessed one.
 *
 * Layout points (cell centers, arrow endpoints, grid corners, label anchors)
 * are deliberately left undeclared: they are `point` constructions consumed
 * by the visible shapes, which makes them implicit solver entities — never
 * rendered as dots, yet still legal proof targets. Asserting ordering and
 * spacing on the same centers the shapes are built from binds each proof to
 * the actual drawn geometry.
 */
import { compileSceneDocument } from "../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import {
  SCENE_DOCUMENT_VERSION,
  type CompileOptions,
  type RenderScene,
  type SceneAssertion,
  type SceneConstruction,
  type SceneDocument,
  type SceneEntity,
  type SceneRevealGroup,
  type ValidationReport,
} from "../types";

export const DSA_SCENE_STRUCTURES = [
  "array",
  "linked_list",
  "tree",
  "graph",
  "table",
] as const;

export type DsaSceneStructure = (typeof DSA_SCENE_STRUCTURES)[number];

export interface DsaDiagramPointer {
  name: string;
  /** 0-based cell index. */
  index: number;
}

export interface DsaDiagramNode {
  id: string;
  label: string;
}

export interface DsaDiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DsaDiagramGroup {
  values?: Array<string | number>;
  pointers?: DsaDiagramPointer[];
  nodes?: DsaDiagramNode[];
  edges?: DsaDiagramEdge[];
}

export interface DsaDiagramStep {
  id: string;
  caption?: string;
  values?: Array<string | number>;
  pointers?: DsaDiagramPointer[];
  nodes?: DsaDiagramNode[];
  edges?: DsaDiagramEdge[];
  groups?: DsaDiagramGroup[];
  /**
   * The table as it stands at this step.
   *
   * A dynamic programming lesson is a table being filled, so its steps are
   * table snapshots, and the planner has always sent them. They were dropped
   * here, which left the walk with nothing that changed between frames and is
   * why table hints were refused a walk-through at all.
   */
  rowLabels?: string[];
  colLabels?: string[];
  cells?: string[][];
}

export interface DsaDiagramHint {
  structure: DsaSceneStructure;
  caption?: string;
  values?: Array<string | number>;
  pointers?: DsaDiagramPointer[];
  nodes?: DsaDiagramNode[];
  edges?: DsaDiagramEdge[];
  rowLabels?: string[];
  colLabels?: string[];
  cells?: string[][];
  /** Worked-example frames revealed in order. */
  steps?: DsaDiagramStep[];
}

export interface SynthesizedDsaScene {
  document: SceneDocument;
  renderScene: RenderScene;
  validationReport: ValidationReport;
  tier: "qualitative_verified";
  nonMetric: true;
  reason: string;
  structure: DsaSceneStructure;
}

const MAX_LABEL_CHARS = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactLabel(value: unknown): string | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (text === "") return null;
  return text.length > MAX_LABEL_CHARS ? `${text.slice(0, MAX_LABEL_CHARS - 1)}…` : text;
}

/**
 * Coerce a planner matrix into rowLabels × colLabels, or decline.
 *
 * The previous version matched header rows by exact string equality and then
 * reshaped whatever survived with `Array.from`, padding or truncating into
 * place. On the most natural model output for a distance matrix — both
 * headers present, `[["","A","B","C"],["A",0,3,∞],…]` — neither strip rule
 * matched and the reshape silently slid every value one row and one column,
 * putting header letters in data cells and a 3 in the wrong column. It
 * compiled green because no assertion ever read a value.
 *
 * Now the *shape* decides which headers are present, not the text, and any
 * shape that is not one of the four legible layouts returns null so the
 * caller draws nothing. A ragged grid is never repaired into a rectangle.
 */
/**
 * Largest table the board can letter inside the diagram zone. Measured, not
 * guessed: 14 by 12 still compiles, and 12 by 12 covers a dynamic programming
 * table over two ten-character strings with room to spare.
 */
const MAX_TABLE_ROWS = 12;
const MAX_TABLE_COLUMNS = 12;

function normalizeTableCells(
  raw: unknown,
  rowLabels: string[],
  colLabels: string[],
): string[][] | null {
  const rows = rowLabels.length;
  const cols = colLabels.length;
  if (rows === 0 || cols === 0) return null;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  let grid: string[][];
  if (raw.every((row) => !Array.isArray(row))) {
    const flat = raw.map((cell) => compactLabel(cell) ?? "");
    // A flat list is only legible when its length names an exact layout.
    const width = flat.length === rows * cols ? cols : flat.length === (rows + 1) * (cols + 1) ? cols + 1 : null;
    if (width === null) return null;
    grid = [];
    for (let start = 0; start < flat.length; start += width) {
      grid.push(flat.slice(start, start + width));
    }
  } else {
    if (!raw.every((row) => Array.isArray(row))) return null;
    grid = (raw as unknown[][]).map((row) => row.map((cell) => compactLabel(cell) ?? ""));
  }

  const width = grid[0]?.length ?? 0;
  if (width === 0) return null;
  // A ragged grid means the model lost its place; repairing it would be a guess.
  if (!grid.every((row) => row.length === width)) return null;

  const hasHeaderRow = grid.length === rows + 1;
  const hasHeaderColumn = width === cols + 1;
  const dataRows = hasHeaderRow ? grid.length - 1 : grid.length;
  const dataCols = hasHeaderColumn ? width - 1 : width;
  if (dataRows !== rows || dataCols !== cols) return null;

  // Headers are identified by shape, not by text. Matching on text as well
  // would reject a legitimate DP table whose values happen to equal its
  // numeric column headers — and a missing figure is its own kind of wrong.
  return (hasHeaderRow ? grid.slice(1) : grid).map((row) => (hasHeaderColumn ? row.slice(1) : row));
}

/**
 * Coerce an untrusted hint (it crosses the package boundary from the code
 * lesson planner) into a bounded, well-formed shape, or reject it.
 */
export function normalizeDsaDiagramHint(value: unknown): DsaDiagramHint | null {
  if (!isRecord(value)) return null;
  const structure = value.structure;
  if (!DSA_SCENE_STRUCTURES.includes(structure as DsaSceneStructure)) return null;
  const caption = typeof value.caption === "string" && value.caption.trim() !== ""
    ? value.caption.trim().slice(0, 80)
    : undefined;

  const values = (Array.isArray(value.values) ? value.values : [])
    .flatMap((item) => {
      const label = compactLabel(item);
      return label === null ? [] : [label];
    })
    .slice(0, 12);
  const pointers = (Array.isArray(value.pointers) ? value.pointers : [])
    .flatMap((item): DsaDiagramPointer[] => {
      if (!isRecord(item)) return [];
      const name = compactLabel(item.name);
      const index = item.index;
      if (name === null || typeof index !== "number" || !Number.isInteger(index)) return [];
      if (index < 0 || index >= values.length) return [];
      return [{ name, index }];
    })
    .slice(0, 4);
  const nodes = (Array.isArray(value.nodes) ? value.nodes : [])
    .flatMap((item): DsaDiagramNode[] => {
      if (!isRecord(item) || typeof item.id !== "string" || item.id.trim() === "") return [];
      const label = compactLabel(item.label) ?? item.id.trim().slice(0, MAX_LABEL_CHARS);
      return [{ id: item.id.trim(), label }];
    })
    .slice(0, 12);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(value.edges) ? value.edges : [])
    .flatMap((item): DsaDiagramEdge[] => {
      if (!isRecord(item) || typeof item.from !== "string" || typeof item.to !== "string") return [];
      const from = item.from.trim();
      const to = item.to.trim();
      if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) return [];
      const label = compactLabel(item.label);
      return [{ from, to, ...(label === null ? {} : { label }) }];
    })
    .slice(0, 24);
  // A table is capped where the board stops being able to letter it, not
  // lower. These were 6 rows by 8 columns, and the cap was not a drawing
  // limit: a 14 by 12 table compiles and fits the zone. What it was, was
  // silent. A dynamic programming table over two strings is the commonest
  // figure in all of DSA, and Distinct Subsequences needs 8 rows: the labels
  // were truncated to 6, the cells then no longer matched the labels, and
  // `normalizeTableCells` returned null, which discards the entire hint. The
  // planner had produced a complete, correct table and the student watched a
  // blank board for the whole lesson.
  //
  // Past the cap it still fails closed rather than drawing a corner of the
  // table as though it were the whole thing.
  const rowLabels = (Array.isArray(value.rowLabels) ? value.rowLabels : [])
    .flatMap((item) => {
      const label = compactLabel(item);
      return label === null ? [] : [label];
    })
    .slice(0, MAX_TABLE_ROWS);
  const colLabels = (Array.isArray(value.colLabels) ? value.colLabels : [])
    .flatMap((item) => {
      const label = compactLabel(item);
      return label === null ? [] : [label];
    })
    .slice(0, MAX_TABLE_COLUMNS);
  const cells = normalizeTableCells(value.cells, rowLabels, colLabels);

  const steps = (Array.isArray(value.steps) ? value.steps : [])
    .flatMap((item, index): DsaDiagramStep[] => {
      if (!isRecord(item)) return [];
      const id = typeof item.id === "string" && item.id.trim() !== ""
        ? item.id.trim().slice(0, 24)
        : `step${index + 1}`;
      const stepCaption = typeof item.caption === "string" && item.caption.trim() !== ""
        ? item.caption.trim().slice(0, 60)
        : undefined;
      const stepValues = (Array.isArray(item.values) ? item.values : [])
        .flatMap((entry) => {
          const label = compactLabel(entry);
          return label === null ? [] : [label];
        })
        .slice(0, 12);
      const stepPointers = (Array.isArray(item.pointers) ? item.pointers : [])
        .flatMap((entry): DsaDiagramPointer[] => {
          if (!isRecord(entry)) return [];
          const name = compactLabel(entry.name);
          const pointerIndex = entry.index;
          if (name === null || typeof pointerIndex !== "number" || !Number.isInteger(pointerIndex)) {
            return [];
          }
          if (pointerIndex < 0 || pointerIndex >= Math.max(stepValues.length, 1)) return [];
          return [{ name, index: pointerIndex }];
        })
        .slice(0, 4);
      const stepNodes = (Array.isArray(item.nodes) ? item.nodes : [])
        .flatMap((entry): DsaDiagramNode[] => {
          if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.trim() === "") return [];
          const label = compactLabel(entry.label) ?? entry.id.trim().slice(0, MAX_LABEL_CHARS);
          return [{ id: entry.id.trim(), label }];
        })
        .slice(0, 12);
      const stepNodeIds = new Set(stepNodes.map((node) => node.id));
      const stepEdges = (Array.isArray(item.edges) ? item.edges : [])
        .flatMap((entry): DsaDiagramEdge[] => {
          if (!isRecord(entry) || typeof entry.from !== "string" || typeof entry.to !== "string") {
            return [];
          }
          const from = entry.from.trim();
          const to = entry.to.trim();
          if (!stepNodeIds.has(from) || !stepNodeIds.has(to) || from === to) return [];
          const label = compactLabel(entry.label);
          return [{ from, to, ...(label === null ? {} : { label }) }];
        })
        .slice(0, 24);
      const groups = (Array.isArray(item.groups) ? item.groups : [])
        .flatMap((group): DsaDiagramGroup[] => {
          if (!isRecord(group)) return [];
          const groupValues = (Array.isArray(group.values) ? group.values : [])
            .flatMap((entry) => {
              const label = compactLabel(entry);
              return label === null ? [] : [label];
            })
            .slice(0, 12);
          const groupPointers = (Array.isArray(group.pointers) ? group.pointers : [])
            .flatMap((entry): DsaDiagramPointer[] => {
              if (!isRecord(entry)) return [];
              const name = compactLabel(entry.name);
              const pointerIndex = entry.index;
              if (name === null || typeof pointerIndex !== "number" || !Number.isInteger(pointerIndex)) {
                return [];
              }
              if (pointerIndex < 0 || pointerIndex >= groupValues.length) return [];
              return [{ name, index: pointerIndex }];
            })
            .slice(0, 4);
          const groupNodes = (Array.isArray(group.nodes) ? group.nodes : [])
            .flatMap((entry): DsaDiagramNode[] => {
              if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.trim() === "") return [];
              const label = compactLabel(entry.label) ?? entry.id.trim().slice(0, MAX_LABEL_CHARS);
              return [{ id: entry.id.trim(), label }];
            })
            .slice(0, 12);
          const groupNodeIds = new Set(groupNodes.map((node) => node.id));
          const groupEdges = (Array.isArray(group.edges) ? group.edges : [])
            .flatMap((entry): DsaDiagramEdge[] => {
              if (!isRecord(entry) || typeof entry.from !== "string" || typeof entry.to !== "string") {
                return [];
              }
              const from = entry.from.trim();
              const to = entry.to.trim();
              if (!groupNodeIds.has(from) || !groupNodeIds.has(to) || from === to) return [];
              return [{ from, to }];
            })
            .slice(0, 24);
          if (groupValues.length === 0 && groupNodes.length === 0) return [];
          return [{
            ...(groupValues.length > 0 ? { values: groupValues } : {}),
            ...(groupPointers.length > 0 ? { pointers: groupPointers } : {}),
            ...(groupNodes.length > 0 ? { nodes: groupNodes } : {}),
            ...(groupEdges.length > 0 ? { edges: groupEdges } : {}),
          }];
        })
        .slice(0, 4);
      // A table step's content is its grid, so it is read with the same caps
      // and the same shape rules as the hint's own table.
      //
      // The labels fall back to the hint's. A step states the values that
      // changed, not the axes, which do not: the planner sends the row and
      // column headings once at the top and then three grids of numbers, and
      // requiring each step to repeat them threw every step away.
      const ownRowLabels = (Array.isArray(item.rowLabels) ? item.rowLabels : [])
        .flatMap((entry) => {
          const label = compactLabel(entry);
          return label === null ? [] : [label];
        })
        .slice(0, MAX_TABLE_ROWS);
      const ownColLabels = (Array.isArray(item.colLabels) ? item.colLabels : [])
        .flatMap((entry) => {
          const label = compactLabel(entry);
          return label === null ? [] : [label];
        })
        .slice(0, MAX_TABLE_COLUMNS);
      const stepRowLabels = ownRowLabels.length > 0 ? ownRowLabels : rowLabels;
      const stepColLabels = ownColLabels.length > 0 ? ownColLabels : colLabels;
      const stepCells = stepRowLabels.length > 0 && stepColLabels.length > 0
        ? normalizeTableCells(item.cells, stepRowLabels, stepColLabels)
        : null;

      if (
        stepValues.length === 0 &&
        stepNodes.length === 0 &&
        groups.length === 0 &&
        stepCells === null
      ) {
        return [];
      }
      return [{
        id,
        ...(stepCaption ? { caption: stepCaption } : {}),
        ...(stepCells
          ? { rowLabels: stepRowLabels, colLabels: stepColLabels, cells: stepCells }
          : {}),
        ...(stepValues.length > 0 ? { values: stepValues } : {}),
        ...(stepPointers.length > 0 ? { pointers: stepPointers } : {}),
        ...(stepNodes.length > 0 ? { nodes: stepNodes } : {}),
        ...(stepEdges.length > 0 ? { edges: stepEdges } : {}),
        ...(groups.length > 0 ? { groups } : {}),
      }];
    })
    .slice(0, 5);

  // A table whose grid could not be read unambiguously draws nothing. The
  // caller falls back to text, which beats a matrix of shifted numbers.
  if (structure === "table" && cells === null) return null;

  return {
    structure: structure as DsaSceneStructure,
    caption,
    values,
    pointers,
    nodes,
    edges,
    rowLabels,
    colLabels,
    ...(cells ? { cells } : {}),
    ...(steps.length > 0 ? { steps } : {}),
  };
}

interface StructureParts {
  entities: SceneEntity[];
  constructions: SceneConstruction[];
  assertions: SceneAssertion[];
  /** Structural skeleton revealed first. */
  structureIds: string[];
  /** Indices, pointers, headers, values revealed second. */
  markerIds: string[];
  reason: string;
}

function pointAt(id: string, x: number, y: number): SceneConstruction {
  return {
    id: `make_${id}`,
    operator: "point",
    inputs: { x, y, coordinateSpace: "world" },
    outputs: [id],
  };
}

function labelAt(id: string, targetId: string, text: string): SceneConstruction {
  return {
    id: `make_${id}`,
    operator: "label",
    inputs: { target: targetId, text },
    outputs: [id],
  };
}

function existsAssertion(id: string, entityIds: string[]): SceneAssertion {
  return { id, predicate: "exists", entities: entityIds, expected: true, severity: "fatal" };
}

function orderedAlong(
  id: string,
  entityIds: string[],
  axis: "x" | "y",
  direction: "increasing" | "decreasing",
): SceneAssertion {
  return { id, predicate: "ordered_along", entities: entityIds, expected: { axis, direction }, severity: "fatal" };
}

function equalSpacing(id: string, entityIds: string[]): SceneAssertion {
  return { id, predicate: "equal_spacing", entities: entityIds, expected: true, severity: "fatal" };
}

function buildArrayParts(
  hint: DsaDiagramHint,
  options: { showIndices?: boolean } = {},
): StructureParts | null {
  const values = hint.values ?? [];
  if (values.length < 2) return null;
  const showIndices = options.showIndices !== false;
  const entities: SceneEntity[] = [];
  const constructions: SceneConstruction[] = [];
  const structureIds: string[] = [];
  const markerIds: string[] = [];
  const centerIds: string[] = [];
  const cell = 1.42;
  const step = 1.58;
  const indexY = -(cell / 2 + 0.78);
  const pointerTipY = cell / 2 + 0.28;
  const pointerTailY = pointerTipY + 0.95;
  const pointerNameY = pointerTailY + 0.38;

  values.forEach((value, index) => {
    const centerId = `c${index}`;
    const cellId = `cell${index}`;
    const indexId = `idx${index}`;
    centerIds.push(centerId);
    entities.push(
      { id: cellId, kind: "rectangle", role: `array cell ${index}`, label: value === "" ? undefined : String(value) },
    );
    constructions.push(
      pointAt(centerId, index * step, 0),
      { id: `make_${cellId}`, operator: "rectangle", inputs: { center: centerId, width: cell, height: cell }, outputs: [cellId] },
    );
    structureIds.push(cellId);
    if (showIndices) {
      entities.push({ id: indexId, kind: "label", role: "cell index", label: String(index) });
      constructions.push(
        pointAt(`${indexId}_p`, index * step, indexY),
        labelAt(indexId, `${indexId}_p`, String(index)),
      );
      markerIds.push(indexId);
    }
  });

  // Pointers on the same cell share one arrow and read their names together.
  //
  // Drawing one arrow per pointer put two identical vectors and two identical
  // labels at the same point, and the compiler refused the figure: not the
  // pointer, the whole figure. Two pointers on one cell is not an edge case,
  // it is the normal state of half these algorithms — expand around centre
  // starts with left equal to right, a two pointer walk ends with them
  // meeting, slow and fast collide — so Longest Palindromic Substring drew a
  // blank board. One arrow with "l r" over it is what a teacher writes.
  const byCell = new Map<number, string[]>();
  for (const pointer of hint.pointers ?? []) {
    const names = byCell.get(pointer.index);
    if (names) {
      if (!names.includes(pointer.name)) names.push(pointer.name);
    } else {
      byCell.set(pointer.index, [pointer.name]);
    }
  }
  [...byCell.entries()].forEach(([index, names], order) => {
    const arrowId = `ptr${order}`;
    const nameId = `${arrowId}_lbl`;
    const x = index * step;
    const label = names.join(" ").slice(0, MAX_LABEL_CHARS);
    entities.push(
      { id: arrowId, kind: "vector", role: `pointer ${label}` },
      { id: nameId, kind: "label", role: `pointer name ${label}`, label },
    );
    constructions.push(
      pointAt(`${arrowId}_s`, x, pointerTailY),
      pointAt(`${arrowId}_e`, x, pointerTipY),
      { id: `make_${arrowId}`, operator: "vector", inputs: { start: `${arrowId}_s`, end: `${arrowId}_e` }, outputs: [arrowId] },
      pointAt(`${nameId}_p`, x, pointerNameY),
      labelAt(nameId, `${nameId}_p`, label),
    );
    markerIds.push(arrowId, nameId);
  });

  // The cells are constructed from these centers, so proving the centers
  // ordered and evenly spaced proves the drawn cells are too. Two points
  // have no spacing to prove (one interval is always "even").
  const assertions: SceneAssertion[] = [
    existsAssertion("cells_exist", structureIds),
    orderedAlong("cells_ordered", centerIds, "x", "increasing"),
    ...(centerIds.length >= 3 ? [equalSpacing("cells_evenly_spaced", centerIds)] : []),
  ];
  return {
    entities,
    constructions,
    assertions,
    structureIds,
    markerIds,
    reason: `array of ${values.length} cells with 0-based indices`,
  };
}

function buildLinkedListParts(hint: DsaDiagramHint): StructureParts | null {
  const nodes = (hint.nodes ?? []).slice(0, 8);
  if (nodes.length < 2) return null;
  const entities: SceneEntity[] = [];
  const constructions: SceneConstruction[] = [];
  const structureIds: string[] = [];
  const centerIds: string[] = [];
  const step = 2.2;
  const nodeWidth = 1.5;
  const nodeHeight = 1.25;

  nodes.forEach((node, index) => {
    const centerId = `c${index}`;
    const boxId = `node${index}`;
    centerIds.push(centerId);
    entities.push({ id: boxId, kind: "rectangle", role: `list node ${node.id}`, label: node.label });
    constructions.push(
      pointAt(centerId, index * step, 0),
      { id: `make_${boxId}`, operator: "rectangle", inputs: { center: centerId, width: nodeWidth, height: nodeHeight }, outputs: [boxId] },
    );
    structureIds.push(boxId);
  });

  for (let index = 0; index < nodes.length - 1; index += 1) {
    const linkId = `next${index}`;
    const startId = `${linkId}_s`;
    const endId = `${linkId}_e`;
    entities.push({ id: linkId, kind: "vector", role: `next pointer ${index}` });
    constructions.push(
      pointAt(startId, index * step + nodeWidth / 2, 0),
      pointAt(endId, (index + 1) * step - nodeWidth / 2, 0),
      { id: `make_${linkId}`, operator: "vector", inputs: { start: startId, end: endId }, outputs: [linkId] },
    );
    structureIds.push(linkId);
  }

  const assertions: SceneAssertion[] = [
    existsAssertion("nodes_exist", structureIds),
    orderedAlong("nodes_ordered", centerIds, "x", "increasing"),
    ...(centerIds.length >= 3 ? [equalSpacing("nodes_evenly_spaced", centerIds)] : []),
  ];
  return {
    entities,
    constructions,
    assertions,
    structureIds,
    markerIds: [],
    reason: `singly linked list of ${nodes.length} nodes with next pointers`,
  };
}

/** Deterministic tidy-tree layout: leaves get sequential x, parents center over children. */
function treePositions(
  nodes: DsaDiagramNode[],
  edges: DsaDiagramEdge[],
): Map<string, { x: number; y: number }> | null {
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of edges) {
    const children = childrenOf.get(edge.from) ?? [];
    children.push(edge.to);
    childrenOf.set(edge.from, children);
    if (hasParent.has(edge.to)) return null;
    hasParent.add(edge.to);
  }
  const root = nodes.find((node) => !hasParent.has(node.id)) ?? nodes[0];
  if (!root) return null;

  const positions = new Map<string, { x: number; y: number }>();
  const visited = new Set<string>();
  let nextLeafX = 0;
  const layout = (id: string, depth: number): number => {
    if (visited.has(id)) return nextLeafX;
    visited.add(id);
    const children = childrenOf.get(id) ?? [];
    let x: number;
    if (children.length === 0) {
      x = nextLeafX;
      nextLeafX += 1.6;
    } else {
      const childXs = children.map((child) => layout(child, depth + 1));
      x = childXs.reduce((sum, value) => sum + value, 0) / childXs.length;
    }
    positions.set(id, { x, y: -depth * 1.85 });
    return x;
  };
  layout(root.id, 0);
  // Orphan nodes (disconnected from the root) make the hint a graph, not a tree.
  if (positions.size !== nodes.length) return null;
  return positions;
}

function trimmedSegment(
  from: { x: number; y: number },
  to: { x: number; y: number },
  trim: number,
): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = Math.hypot(dx, dy);
  if (span <= trim * 2 + 1e-6) return null;
  const ux = dx / span;
  const uy = dy / span;
  return {
    start: { x: from.x + ux * trim, y: from.y + uy * trim },
    end: { x: to.x - ux * trim, y: to.y - uy * trim },
  };
}

function buildTreeParts(hint: DsaDiagramHint): StructureParts | null {
  const nodes = hint.nodes ?? [];
  const edges = hint.edges ?? [];
  if (nodes.length < 2) return null;
  const positions = treePositions(nodes, edges);
  if (!positions) return null;

  const entities: SceneEntity[] = [];
  const constructions: SceneConstruction[] = [];
  const assertions: SceneAssertion[] = [];
  const structureIds: string[] = [];
  const radius = 0.62;

  const centerIdOf = new Map<string, string>();
  nodes.forEach((node, index) => {
    const centerId = `c${index}`;
    const circleId = `node${index}`;
    const position = positions.get(node.id)!;
    centerIdOf.set(node.id, centerId);
    entities.push({ id: circleId, kind: "circle", role: `tree node ${node.id}`, label: node.label });
    constructions.push(
      pointAt(centerId, position.x, position.y),
      { id: `make_${circleId}`, operator: "circle", inputs: { center: centerId, radius }, outputs: [circleId] },
    );
    structureIds.push(circleId);
  });

  edges.forEach((edge, index) => {
    const from = positions.get(edge.from)!;
    const to = positions.get(edge.to)!;
    const trimmed = trimmedSegment(from, to, radius + 0.06);
    if (!trimmed) return;
    const edgeId = `edge${index}`;
    entities.push({ id: edgeId, kind: "segment", role: `edge ${edge.from}-${edge.to}` });
    constructions.push(
      pointAt(`${edgeId}_s`, trimmed.start.x, trimmed.start.y),
      pointAt(`${edgeId}_e`, trimmed.end.x, trimmed.end.y),
      { id: `make_${edgeId}`, operator: "segment", inputs: { start: `${edgeId}_s`, end: `${edgeId}_e` }, outputs: [edgeId] },
    );
    structureIds.push(edgeId);
    // Parent above child is the tree property this layout must prove.
    assertions.push(
      orderedAlong(`parent_above_${index}`, [centerIdOf.get(edge.from)!, centerIdOf.get(edge.to)!], "y", "decreasing"),
    );
  });

  assertions.unshift(existsAssertion("tree_exists", structureIds));
  return {
    entities,
    constructions,
    assertions,
    structureIds,
    markerIds: [],
    reason: `tree of ${nodes.length} nodes with parent-child edges`,
  };
}

function buildGraphParts(hint: DsaDiagramHint): StructureParts | null {
  const nodes = hint.nodes ?? [];
  const edges = hint.edges ?? [];
  if (nodes.length < 2) return null;

  const entities: SceneEntity[] = [];
  const constructions: SceneConstruction[] = [];
  const structureIds: string[] = [];
  const markerIds: string[] = [];
  const radius = 0.62;
  const ringRadius = Math.max(2.1, nodes.length * 0.68);
  const positions = new Map<string, { x: number; y: number }>();

  nodes.forEach((node, index) => {
    const angle = Math.PI / 2 - (index * Math.PI * 2) / nodes.length;
    const position = { x: Math.cos(angle) * ringRadius, y: Math.sin(angle) * ringRadius };
    positions.set(node.id, position);
    const centerId = `c${index}`;
    const circleId = `node${index}`;
    entities.push({ id: circleId, kind: "circle", role: `graph node ${node.id}`, label: node.label });
    constructions.push(
      pointAt(centerId, position.x, position.y),
      { id: `make_${circleId}`, operator: "circle", inputs: { center: centerId, radius }, outputs: [circleId] },
    );
    structureIds.push(circleId);
  });

  edges.forEach((edge, index) => {
    const trimmed = trimmedSegment(positions.get(edge.from)!, positions.get(edge.to)!, radius + 0.06);
    if (!trimmed) return;
    const edgeId = `edge${index}`;
    entities.push({ id: edgeId, kind: "segment", role: `edge ${edge.from}-${edge.to}` });
    constructions.push(
      pointAt(`${edgeId}_s`, trimmed.start.x, trimmed.start.y),
      pointAt(`${edgeId}_e`, trimmed.end.x, trimmed.end.y),
      { id: `make_${edgeId}`, operator: "segment", inputs: { start: `${edgeId}_s`, end: `${edgeId}_e` }, outputs: [edgeId] },
    );
    structureIds.push(edgeId);
    if (edge.label) {
      const labelId = `${edgeId}_lbl`;
      const mid = {
        x: (trimmed.start.x + trimmed.end.x) / 2,
        y: (trimmed.start.y + trimmed.end.y) / 2,
      };
      const dx = trimmed.end.x - trimmed.start.x;
      const dy = trimmed.end.y - trimmed.start.y;
      const span = Math.hypot(dx, dy) || 1;
      entities.push({ id: labelId, kind: "label", role: "edge weight", label: edge.label });
      constructions.push(
        pointAt(`${labelId}_p`, mid.x - (dy / span) * 0.42, mid.y + (dx / span) * 0.42),
        labelAt(labelId, `${labelId}_p`, edge.label),
      );
      markerIds.push(labelId);
    }
  });

  return {
    entities,
    constructions,
    assertions: [existsAssertion("graph_exists", structureIds)],
    structureIds,
    markerIds,
    reason: `graph of ${nodes.length} nodes and ${edges.length} edges`,
  };
}

function buildTableParts(hint: DsaDiagramHint): StructureParts | null {
  const rowLabels = hint.rowLabels ?? [];
  const colLabels = hint.colLabels ?? [];
  if (rowLabels.length < 1 || colLabels.length < 1) return null;
  const cells = hint.cells ?? [];

  const entities: SceneEntity[] = [];
  const constructions: SceneConstruction[] = [];
  const structureIds: string[] = [];
  const cellWidth = 1.85;
  const cellHeight = 1.35;
  const columns = colLabels.length;
  const rows = rowLabels.length;

  const putCell = (id: string, column: number, row: number, text: string, role: string) => {
    const centerId = `${id}_c`;
    entities.push({
      id,
      kind: "rectangle",
      role,
      ...(text === "" ? {} : { label: text }),
    });
    constructions.push(
      pointAt(centerId, (column + 0.5) * cellWidth, -(row + 0.5) * cellHeight),
      {
        id: `make_${id}`,
        operator: "rectangle",
        inputs: { center: centerId, width: cellWidth * 0.86, height: cellHeight * 0.8 },
        outputs: [id],
      },
    );
    structureIds.push(id);
  };

  putCell("corner", 0, 0, "", "header corner");
  colLabels.forEach((label, column) => putCell(`colh${column}`, column + 1, 0, label, "column header"));
  rowLabels.forEach((label, row) => putCell(`rowh${row}`, 0, row + 1, label, "row header"));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      putCell(`cell${row}_${column}`, column + 1, row + 1, cells[row]?.[column] ?? "", "cell value");
    }
  }

  // First-column centers are the points the header and data cells are built
  // from, so proving them ordered and evenly spaced proves the drawn rows.
  const firstColumnCenters = Array.from({ length: rows + 1 }, (_, row) =>
    row === 0 ? "corner_c" : `rowh${row - 1}_c`,
  );
  const firstDataRowCenters = [
    "rowh0_c",
    ...Array.from({ length: columns }, (_, column) => `cell0_${column}_c`),
  ];
  const assertions: SceneAssertion[] = [
    existsAssertion("grid_exists", structureIds),
    orderedAlong("rows_ordered", firstColumnCenters, "y", "decreasing"),
    ...(firstColumnCenters.length >= 3 ? [equalSpacing("rows_evenly_spaced", firstColumnCenters)] : []),
    orderedAlong("cols_ordered", firstDataRowCenters, "x", "increasing"),
    ...(firstDataRowCenters.length >= 3 ? [equalSpacing("cols_evenly_spaced", firstDataRowCenters)] : []),
  ];
  return {
    entities,
    constructions,
    assertions,
    structureIds,
    markerIds: [],
    reason: `table of ${rows} rows and ${columns} columns`,
  };
}

function renameId(id: string, prefix: string): string {
  return prefix === "" ? id : `${prefix}_${id}`;
}

/**
 * Re-home a built structure: prefix every id so stacked example frames cannot
 * collide, and shift world points so each frame sits on its own row.
 */
function relocateParts(parts: StructureParts, prefix: string, ox: number, oy: number): StructureParts {
  if (prefix === "" && ox === 0 && oy === 0) return parts;
  const rename = (id: string) => renameId(id, prefix);
  const rewriteInputs = (inputs: Record<string, unknown>): Record<string, unknown> => {
    const next: Record<string, unknown> = { ...inputs };
    for (const [key, value] of Object.entries(next)) {
      if (typeof value === "string" &&
          (key === "center" || key === "start" || key === "end" || key === "target")) {
        next[key] = rename(value);
      }
      if (key === "x" && typeof value === "number") next[key] = value + ox;
      if (key === "y" && typeof value === "number") next[key] = value + oy;
    }
    return next;
  };
  return {
    entities: parts.entities.map((entity) => ({ ...entity, id: rename(entity.id) })),
    constructions: parts.constructions.map((construction) => ({
      ...construction,
      id: construction.id.startsWith("make_")
        ? `make_${rename(construction.id.slice("make_".length))}`
        : rename(construction.id),
      outputs: construction.outputs.map(rename),
      inputs: rewriteInputs(construction.inputs),
    })),
    assertions: parts.assertions.map((assertion) => ({
      ...assertion,
      id: rename(assertion.id),
      entities: assertion.entities.map(rename),
    })),
    structureIds: parts.structureIds.map(rename),
    markerIds: parts.markerIds.map(rename),
    reason: parts.reason,
  };
}

function buildHintParts(
  hint: DsaDiagramHint,
  options: { showIndices?: boolean } = {},
): StructureParts | null {
  return hint.structure === "array" ? buildArrayParts(hint, options)
    : hint.structure === "linked_list" ? buildLinkedListParts(hint)
    : hint.structure === "tree" ? buildTreeParts(hint)
    : hint.structure === "graph" ? buildGraphParts(hint)
    : hint.structure === "table" ? buildTableParts(hint)
    : null;
}

function buildStepParts(hint: DsaDiagramHint, step: DsaDiagramStep, row: number): StructureParts | null {
  const originY = -row * 2.15;
  if (step.groups && step.groups.length > 0) {
    const built: StructureParts[] = [];
    let originX = 0;
    for (const [groupIndex, group] of step.groups.entries()) {
      const groupHint: DsaDiagramHint = {
        structure: hint.structure,
        values: group.values,
        pointers: group.pointers,
        nodes: group.nodes,
        edges: group.edges,
      };
      const groupParts = buildHintParts(groupHint, { showIndices: false });
      if (!groupParts) continue;
      const width = (group.values?.length ?? group.nodes?.length ?? 4) * 1.7;
      built.push(relocateParts(groupParts, `${step.id}_g${groupIndex}`, originX, originY));
      originX += width + 1.6;
    }
    if (built.length === 0) return null;
    return {
      entities: built.flatMap((part) => part.entities),
      constructions: built.flatMap((part) => part.constructions),
      assertions: built.flatMap((part) => part.assertions),
      structureIds: built.flatMap((part) => part.structureIds),
      markerIds: built.flatMap((part) => part.markerIds),
      reason: step.caption ?? built.map((part) => part.reason).join("; "),
    };
  }
  const stepHint: DsaDiagramHint = {
    structure: hint.structure,
    caption: step.caption,
    values: step.values ?? hint.values,
    pointers: step.pointers,
    nodes: step.nodes ?? hint.nodes,
    edges: step.edges ?? hint.edges,
    rowLabels: step.rowLabels ?? hint.rowLabels,
    colLabels: step.colLabels ?? hint.colLabels,
    cells: step.cells ?? hint.cells,
  };
  const parts = buildHintParts(stepHint, { showIndices: false });
  if (!parts) return null;
  return relocateParts(parts, step.id, 0, originY);
}

/** Build the scene-document/v2 for a DSA hint, or null when unsupported. */
export function synthesizeDsaSceneDocument(
  hint: DsaDiagramHint,
  context: { question?: string } = {},
): SceneDocument | null {
  // Table frames do not carry per-step cells today; stacking identical
  // matrices just shrinks every number. One honest grid is enough.
  const steps = hint.structure === "table"
    ? null
    : hint.steps && hint.steps.length > 0 ? hint.steps : null;
  let parts: StructureParts | null;
  let revealGroups: SceneRevealGroup[];

  if (steps) {
    const stepParts: StructureParts[] = [];
    const groups: SceneRevealGroup[] = [];
    for (const [index, step] of steps.entries()) {
      const built = buildStepParts(hint, step, index);
      if (!built) return null;
      stepParts.push(built);
      groups.push({
        id: step.id,
        entityIds: [...built.structureIds, ...built.markerIds],
        dependsOn: index === 0 ? [] : [steps[index - 1]!.id],
        narrationCue: step.caption ?? built.reason,
      });
    }
    parts = {
      entities: stepParts.flatMap((part) => part.entities),
      constructions: stepParts.flatMap((part) => part.constructions),
      assertions: stepParts.flatMap((part) => part.assertions),
      structureIds: stepParts.flatMap((part) => part.structureIds),
      markerIds: stepParts.flatMap((part) => part.markerIds),
      reason: steps.map((step) => step.caption ?? step.id).join(" → "),
    };
    revealGroups = groups;
  } else {
    parts = buildHintParts(hint);
    if (!parts) return null;
    revealGroups = [
      {
        id: "structure",
        entityIds: parts.structureIds,
        dependsOn: [],
        narrationCue: parts.reason,
      },
      ...(parts.markerIds.length > 0
        ? [{
            id: "markers",
            entityIds: parts.markerIds,
            dependsOn: ["structure"],
            narrationCue: "indices, pointers, and values on the structure",
          }]
        : []),
    ];
  }

  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason: parts.reason },
    source: {
      ...(context.question ? { question: context.question } : {}),
      synthesizedDsa: true,
      structure: hint.structure,
    },
    quantities: [],
    entities: parts.entities,
    constructions: parts.constructions,
    relations: [],
    assertions: parts.assertions,
    annotations: hint.caption
      ? [{ id: "caption", kind: "caption", targetIds: [], text: hint.caption }]
      : [],
    requiredEntityIds: [...parts.structureIds, ...parts.markerIds],
    revealGroups,
    teachingTimeline: revealGroups.map((group, index) => ({
      id: `reveal_${group.id}`,
      action: "reveal" as const,
      targetId: group.id,
      dependsOn: index === 0 ? [] : [`reveal_${revealGroups[index - 1]!.id}`],
      narrationIntent: group.narrationCue,
    })),
  };
}

/** One hint step compiled on its own, at the origin, filling the zone. */
export interface SynthesizedHintFrame {
  frameId: string;
  caption: string;
  narrationIntent: string;
  document: SceneDocument;
  renderScene: RenderScene;
  validationReport: ValidationReport;
  focusEntityIds: string[];
  expectedLabels: Record<string, string>;
}

export interface SynthesizedHintFrames {
  structure: DsaSceneStructure;
  frames: SynthesizedHintFrame[];
}

/** The single-step document behind one hint frame. */
function hintFrameDocument(
  hint: DsaDiagramHint,
  step: DsaDiagramStep,
  context: { question?: string } = {},
): SceneDocument | null {
  // Row 0 for every frame: a frame owns the whole zone, so nothing is offset
  // to make room for the frames around it.
  const parts = buildStepParts(hint, step, 0);
  if (!parts) return null;
  const revealGroups: SceneRevealGroup[] = [
    {
      id: "structure",
      entityIds: parts.structureIds,
      dependsOn: [],
      narrationCue: parts.reason,
    },
    ...(parts.markerIds.length > 0
      ? [{
          id: "markers",
          entityIds: parts.markerIds,
          dependsOn: ["structure"],
          narrationCue: step.caption ?? "the markers for this step",
        }]
      : []),
  ].filter((group) => group.entityIds.length > 0);

  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason: parts.reason },
    source: {
      ...(context.question ? { question: context.question } : {}),
      synthesizedDsa: true,
      structure: hint.structure,
      dsaHintFrame: step.id,
    },
    quantities: [],
    entities: parts.entities,
    constructions: parts.constructions,
    relations: [],
    assertions: parts.assertions,
    annotations: step.caption
      ? [{ id: "caption", kind: "caption", targetIds: [], text: step.caption }]
      : [],
    requiredEntityIds: [...parts.structureIds, ...parts.markerIds],
    revealGroups,
    teachingTimeline: revealGroups.map((group, index) => ({
      id: `reveal_${group.id}`,
      action: "reveal" as const,
      targetId: group.id,
      dependsOn: index === 0 ? [] : [`reveal_${revealGroups[index - 1]!.id}`],
      narrationIntent: group.narrationCue,
    })),
  };
}

/**
 * Compile a model-authored hint into one figure per step, the way a matched
 * algorithm family compiles a real trace.
 *
 * The alternative — what this replaces — stacked every step into a single
 * document offset row by row, so a four-step array walk drew the same array
 * four times down the zone with four sets of pointers. That reads as a
 * duplicated diagram rather than a walk-through, and it leaves the board
 * frozen: with one document there is nothing to advance to, so the figure
 * cannot move while the tutor talks.
 *
 * Fails closed the same way `compileTraceScenes` does: one bad frame refuses
 * the whole walk rather than teaching a hole in the middle of it. The caller
 * then falls back to the single stacked figure, which is still honest.
 */
export function synthesizeDsaHintFrames(
  hintInput: unknown,
  options: { question?: string; compile?: CompileOptions } = {},
): SynthesizedHintFrames | null {
  const hint = normalizeDsaDiagramHint(hintInput);
  if (!hint) return null;
  const steps = hint.steps ?? [];
  if (steps.length < 2) return null;
  // A table walk is only a walk if the grid changes. Without per-step cells
  // every frame is the same matrix, and one honest grid beats five identical
  // ones; with them, this is a dynamic programming table being filled, which
  // is the whole lesson.
  if (hint.structure === "table") {
    const grids = steps.map((step) => JSON.stringify(step.cells ?? null));
    if (grids.some((grid) => grid === "null")) return null;
    if (new Set(grids).size < 2) return null;
  }

  const frames: SynthesizedHintFrame[] = [];
  for (const step of steps) {
    const document = hintFrameDocument(hint, step, { question: options.question });
    if (!document) return null;
    const pruned = pruneDeadSceneEntities(document as unknown as Record<string, unknown>);
    const validated = validateSceneDocument(pruned);
    if (!validated.document) return null;
    const compiled = compileSceneDocument(validated.document, options.compile ?? {});
    if (
      !compiled.ok ||
      !compiled.renderScene ||
      compiled.renderScene.primitives.length === 0 ||
      compiled.report.issues.some((issue) => issue.severity === "fatal")
    ) {
      return null;
    }
    frames.push({
      frameId: step.id,
      caption: step.caption ?? "",
      // A hint step carries a caption, never a script. The caption is the
      // only thing the runtime knows this frame is about, so it is what the
      // narration is asked to cover — never an invented explanation.
      narrationIntent: step.caption ?? "",
      document: validated.document,
      renderScene: compiled.renderScene,
      validationReport: compiled.report,
      focusEntityIds: [],
      expectedLabels: {},
    });
  }
  return { structure: hint.structure, frames };
}

/**
 * Synthesize, validate, and compile a DSA scene. Fails closed: any invalid or
 * partially-compiled candidate returns null and nothing reaches the canvas.
 */
export function synthesizeDsaScene(
  hintInput: unknown,
  options: { question?: string; compile?: CompileOptions } = {},
): SynthesizedDsaScene | null {
  const hint = normalizeDsaDiagramHint(hintInput);
  if (!hint) return null;
  const document = synthesizeDsaSceneDocument(hint, { question: options.question });
  if (!document) return null;

  const pruned = pruneDeadSceneEntities(document as unknown as Record<string, unknown>);
  const validated = validateSceneDocument(pruned);
  if (!validated.document) return null;
  const compiled = compileSceneDocument(validated.document, options.compile ?? {});
  if (
    !compiled.ok ||
    !compiled.renderScene ||
    compiled.renderScene.primitives.length === 0 ||
    compiled.report.issues.some((issue) => issue.severity === "fatal")
  ) {
    return null;
  }
  return {
    document: validated.document,
    renderScene: compiled.renderScene,
    validationReport: compiled.report,
    tier: "qualitative_verified",
    nonMetric: true,
    reason: document.visualDecision.reason,
    structure: hint.structure,
  };
}
