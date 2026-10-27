/**
 * Block and flow diagrams for lessons outside maths, physics and chemistry:
 * labelled boxes joined by labelled directed arrows (a payment's path through
 * the banks, an interrupt's sequence, the services a container platform uses).
 *
 * The planner names the parts; the engine owns everything that is drawn. Each
 * box and each arrow must be grounded in the authoritative turn plan's own
 * claims (`validateBlockFlowGrounding`), never in the question's words, and
 * the layout is computed here in board pixels and then checked again by an
 * independent pass (`verifyBlockFlowLayout`). Any miss refuses the whole
 * figure: there is no partial block diagram.
 */
import { BOARD_TYPE_SCALE, measureTextInkBounds, measureTextWidth } from "@heytutor/drawing";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import type { RenderPoint, RenderPrimitive, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const BLOCK_FLOW_OPERATORS = ["block_flow"] as const;

export interface BlockFlowNode { id: string; label: string; claimIds: string[] }
export interface BlockFlowEdge { from: string; to: string; label: string; claimId: string }
export interface BlockFlowBox { id: string; x: number; y: number; width: number; height: number; lines: string[] }
export interface BlockFlowLabelLine { text: string; x: number; y: number; fontPx: number; ink: Bounds; owner: string }
export interface BlockFlowArrow { from: string; to: string; points: RenderPoint[]; labelLines: BlockFlowLabelLine[] }
export interface BlockFlowDefinition {
  direction: "right" | "down";
  nodes: BlockFlowNode[];
  edges: BlockFlowEdge[];
  boxes: BlockFlowBox[];
  boxLines: BlockFlowLabelLine[];
  arrows: BlockFlowArrow[];
  nonmetric: true;
}
export interface BlockFlowGeometry { kind: "block_flow"; blockFlow: BlockFlowDefinition }

interface Bounds { x: number; y: number; width: number; height: number }

/** The board's diagram zone (AGENTS.md rule 1), inset by the compile viewport. */
export const BLOCK_FLOW_ZONE: Readonly<Bounds> = Object.freeze({ x: 410, y: 55, width: 740, height: 555 });
const LIMITS = { minNodes: 3, maxNodes: 8, minEdges: 2, maxEdges: 10, nodeChars: 40, edgeChars: 32 } as const;
/** The renderer drops any label run over 16 characters, so every line is at most this long. */
export const BLOCK_FLOW_LINE_CHARS = 16;
const BOX_FONT = BOARD_TYPE_SCALE.label;
const EDGE_FONT = BOARD_TYPE_SCALE.annotation;
const BOX_LINE_HEIGHT = BOX_FONT + 8;
const EDGE_LINE_HEIGHT = EDGE_FONT + 7;
const BOX_PAD_X = 14;
const BOX_PAD_Y = 10;
const BOX_GAP = 28;
const MIN_RANK_GAP = 64;
/** Clearance kept between any two parts the verifier compares. */
const CLEAR = 4;
const INPUT_KEYS = ["direction", "nodes", "edges"] as const;

class BlockFlowInputError extends Error {
  constructor(readonly key: string, message: string) { super(message); }
}
function fail(key: string, message: string): never { throw new BlockFlowInputError(key, message); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, key: string, max: number): string {
  if (typeof value !== "string") fail(key, `${key} must be text`);
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) fail(key, `${key} must not be empty`);
  if (normalized.length > max) fail(key, `${key} "${normalized}" is longer than ${max} characters`);
  return normalized;
}
function identifier(value: unknown, key: string): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(value)) fail(key, `${key} must be an identifier`);
  return value;
}

/** Parse and check the planner's inputs. Structure only; grounding needs the plan. */
export function parseBlockFlowInputs(inputs: Record<string, unknown>): { direction: "right" | "down" | null; nodes: BlockFlowNode[]; edges: BlockFlowEdge[] } {
  const unknown = Object.keys(inputs).filter((key) => !(INPUT_KEYS as readonly string[]).includes(key));
  if (unknown.length) fail("inputs", `block_flow has unsupported inputs: ${unknown.join(", ")}`);
  const direction = inputs.direction === undefined ? null
    : inputs.direction === "right" || inputs.direction === "down" ? inputs.direction
      : fail("direction", "direction must be right or down");
  if (!Array.isArray(inputs.nodes)) fail("nodes", "block_flow requires a nodes array");
  if (!Array.isArray(inputs.edges)) fail("edges", "block_flow requires an edges array");
  if (inputs.nodes.length < LIMITS.minNodes || inputs.nodes.length > LIMITS.maxNodes) fail("nodes", `block_flow needs ${LIMITS.minNodes} to ${LIMITS.maxNodes} nodes`);
  if (inputs.edges.length < LIMITS.minEdges || inputs.edges.length > LIMITS.maxEdges) fail("edges", `block_flow needs ${LIMITS.minEdges} to ${LIMITS.maxEdges} edges`);
  const nodes = inputs.nodes.map((raw, index): BlockFlowNode => {
    const key = `nodes[${index}]`;
    if (!isRecord(raw)) fail(key, `${key} must be an object`);
    if (Object.keys(raw).some((name) => !["id", "label", "claimIds"].includes(name))) fail(key, `${key} has unsupported fields`);
    if (!Array.isArray(raw.claimIds) || raw.claimIds.length === 0 || raw.claimIds.length > 4) fail(`${key}.claimIds`, `${key} must cite 1 to 4 plan claims`);
    return {
      id: identifier(raw.id, `${key}.id`),
      label: text(raw.label, `${key}.label`, LIMITS.nodeChars),
      claimIds: raw.claimIds.map((id, item) => identifier(id, `${key}.claimIds[${item}]`)),
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length) fail("nodes", "node ids must be unique");
  const labels = new Set(nodes.map((node) => node.label.toLowerCase()));
  if (labels.size !== nodes.length) fail("nodes", "two boxes carry the same label");
  const edges = inputs.edges.map((raw, index): BlockFlowEdge => {
    const key = `edges[${index}]`;
    if (!isRecord(raw)) fail(key, `${key} must be an object`);
    if (Object.keys(raw).some((name) => !["from", "to", "label", "claimId"].includes(name))) fail(key, `${key} has unsupported fields`);
    const edge = {
      from: identifier(raw.from, `${key}.from`),
      to: identifier(raw.to, `${key}.to`),
      label: text(raw.label, `${key}.label`, LIMITS.edgeChars),
      claimId: identifier(raw.claimId, `${key}.claimId`),
    };
    if (!ids.has(edge.from) || !ids.has(edge.to)) fail(key, `${key} joins a node that is not declared`);
    if (edge.from === edge.to) fail(key, `${key} is a self loop`);
    return edge;
  });
  const pairs = new Set(edges.map((edge) => `${edge.from}>${edge.to}`));
  if (pairs.size !== edges.length) fail("edges", "two arrows join the same boxes in the same direction");
  // Weakly connected: every box is reached, so none is an orphan.
  const adjacent = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) { adjacent.get(edge.from)!.add(edge.to); adjacent.get(edge.to)!.add(edge.from); }
  const seen = new Set<string>([nodes[0]!.id]);
  const queue = [nodes[0]!.id];
  while (queue.length) for (const next of adjacent.get(queue.shift()!)!) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  if (seen.size !== nodes.length) fail("edges", `boxes ${nodes.filter((node) => !seen.has(node.id)).map((node) => node.id).join(", ")} are not connected to the rest of the diagram`);
  return { direction, nodes, edges };
}

// ---------------------------------------------------------------- grounding

const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "and", "or", "for", "in", "on", "at", "by", "via", "with", "from", "into", "onto",
  "is", "are", "be", "its", "it", "as", "that", "this", "then", "than", "per", "each",
]);

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && /(?:s|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** Lower case word tokens, punctuation removed, plurals folded. */
export function blockFlowTokens(value: string): string[] {
  return value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean).map(stem);
}
function contentTokens(value: string): string[] {
  return blockFlowTokens(value).filter((token) => !STOPWORDS.has(token));
}

type Claim = TurnPlanV3["qualitativeClaims"][number];
/** What the claim says in words. Its entity hints name parts, never how they relate. */
function claimProse(claim: Claim): string[] {
  return [claim.claim, typeof claim.expected === "string" ? claim.expected : ""].filter(Boolean);
}
function claimTexts(claim: Claim): string[] {
  return [...claimProse(claim), ...(claim.relatedEntityHints ?? [])];
}
function contains(haystack: ReadonlySet<string>, needle: readonly string[]): boolean {
  return needle.length > 0 && needle.every((token) => haystack.has(token));
}

/**
 * Where a label sits in a claim written as a chain ("tap → terminal → bank"):
 * the first segment holding all of its tokens, or null when no single
 * segment does or the text is not a chain.
 */
function chainPosition(claimText: string, label: string): number | null {
  const segments = claimText.split(/→|->|⟶|⇒|=>/);
  if (segments.length < 2) return null;
  const needle = contentTokens(label);
  for (let index = 0; index < segments.length; index++) {
    if (contains(new Set(blockFlowTokens(segments[index]!)), needle)) return index;
  }
  return null;
}

/**
 * Every box label is in a cited claim (its words or its entity hints); every
 * arrow's claim states, in its own words, both of its boxes and its label; an
 * arrow cited to a claim written as a chain may not run against the chain.
 * Issues are fatal: the caller refuses the figure.
 */
export function validateBlockFlowGrounding(
  inputs: { nodes: readonly BlockFlowNode[]; edges: readonly BlockFlowEdge[] },
  plan: Pick<TurnPlanV3, "qualitativeClaims">,
): string[] {
  const claims = new Map(plan.qualitativeClaims.map((claim) => [claim.id, claim]));
  const tokensOf = (claim: Claim) => new Set(claimTexts(claim).flatMap(blockFlowTokens));
  const proseTokensOf = (claim: Claim) => new Set(claimProse(claim).flatMap(blockFlowTokens));
  const problems: string[] = [];
  const nodes = new Map(inputs.nodes.map((node) => [node.id, node]));
  for (const node of inputs.nodes) {
    const label = contentTokens(node.label);
    if (label.length === 0) { problems.push(`box ${node.id} "${node.label}" has no content word`); continue; }
    const cited = node.claimIds.map((id) => claims.get(id));
    if (cited.some((claim) => !claim)) { problems.push(`box ${node.id} cites a claim the plan does not have`); continue; }
    if (!cited.some((claim) => contains(tokensOf(claim!), label))) {
      problems.push(`box ${node.id} "${node.label}" is not named in its cited claims`);
    }
  }
  for (const edge of inputs.edges) {
    const name = `arrow ${edge.from} to ${edge.to}`;
    const claim = claims.get(edge.claimId);
    if (!claim) { problems.push(`${name} cites a claim the plan does not have`); continue; }
    const from = nodes.get(edge.from)!;
    const to = nodes.get(edge.to)!;
    const tokens = proseTokensOf(claim);
    if (!contains(tokens, contentTokens(from.label)) || !contains(tokens, contentTokens(to.label))) {
      problems.push(`${name}: claim ${edge.claimId} does not state both "${from.label}" and "${to.label}" in its words`);
      continue;
    }
    const label = contentTokens(edge.label);
    if (!contains(tokens, label)) problems.push(`${name} label "${edge.label}" is not stated in claim ${edge.claimId}`);
    for (const value of claimProse(claim)) {
      const a = chainPosition(value, from.label);
      const b = chainPosition(value, to.label);
      if (a !== null && b !== null && a > b) problems.push(`${name} runs against the order claim ${edge.claimId} states`);
    }
  }
  return problems;
}

/**
 * The plan itself describes a structure: at least three of its named
 * components (`relatedEntityHints`) are joined, through claims that each name
 * two or more of them, into one connected group held by two or more such
 * claims. Read from the plan's structure only, never from the question.
 */
export function planDescribesLinkedComponents(plan: Pick<TurnPlanV3, "qualitativeClaims">): boolean {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const up = parent.get(id) ?? id;
    if (up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  const links: string[][] = [];
  for (const claim of plan.qualitativeClaims) {
    const hints = [...new Set((claim.relatedEntityHints ?? []).map((hint) => contentTokens(hint).join(" ")).filter(Boolean))];
    if (hints.length < 2) continue;
    links.push(hints);
    for (const hint of hints) if (!parent.has(hint)) parent.set(hint, hint);
    for (const hint of hints.slice(1)) parent.set(find(hint), find(hints[0]!));
  }
  const groups = new Map<string, { members: Set<string>; claims: number }>();
  for (const hints of links) {
    const root = find(hints[0]!);
    const group = groups.get(root) ?? { members: new Set<string>(), claims: 0 };
    hints.forEach((hint) => group.members.add(hint));
    group.claims++;
    groups.set(root, group);
  }
  for (const [root, group] of groups) {
    // Merge members whose roots moved after this group was first recorded.
    if (find(root) !== root) continue;
    if (group.members.size >= 3 && group.claims >= 2) return true;
  }
  return false;
}

// ---------------------------------------------------------------- layout

/** Word wrap to lines of at most `BLOCK_FLOW_LINE_CHARS`; null when a word is longer or too many lines. */
export function wrapBlockFlowLabel(label: string, maxLines: number): string[] | null {
  const lines: string[] = [];
  // A slash is a break opportunity: "approves/declines" wraps after the slash.
  const words = label.split(" ").flatMap((word) => word.split(/(?<=\/)(?=.)/));
  for (const [index, word] of words.entries()) {
    if (word.length > BLOCK_FLOW_LINE_CHARS) return null;
    const joinedBySlash = index > 0 && words[index - 1]!.endsWith("/") && !label.includes(`${words[index - 1]!} `);
    const last = lines.at(-1);
    const gap = joinedBySlash ? "" : " ";
    if (last !== undefined && last.length + gap.length + word.length <= BLOCK_FLOW_LINE_CHARS) lines[lines.length - 1] = `${last}${gap}${word}`;
    else lines.push(word);
  }
  return lines.length <= maxLines ? lines : null;
}

/** An arrow label of two or more words longer than 10 characters splits at the space nearest its middle. */
function balancedArrowLabel(label: string): string[] | null {
  const lines = wrapBlockFlowLabel(label, 2);
  if (!lines || lines.length > 1 || label.length <= 10 || !label.includes(" ")) return lines;
  const spaces = [...label.matchAll(/ /g)].map((match) => match.index!);
  const split = spaces.reduce((best, index) => Math.abs(index - label.length / 2) < Math.abs(best - label.length / 2) ? index : best);
  return [label.slice(0, split), label.slice(split + 1)];
}

function inkOf(textValue: string, x: number, y: number, fontPx: number): Bounds {
  const ink = measureTextInkBounds(textValue, x, y, fontPx);
  const width = measureTextWidth(textValue, fontPx);
  const box = { x, y, width, height: fontPx };
  if (!ink) return box;
  const x0 = Math.min(ink.x, box.x), y0 = Math.min(ink.y, box.y);
  return { x: x0, y: y0, width: Math.max(ink.x + ink.width, box.x + box.width) - x0, height: Math.max(ink.y + ink.height, box.y + box.height) - y0 };
}
function round(value: number): number { return Math.round(value * 100) / 100; }

/** Ranks by longest path after reversing the arrows that close a cycle (depth first, declared order). */
function ranks(nodes: readonly BlockFlowNode[], edges: readonly BlockFlowEdge[]): Map<string, number> {
  const out = new Map(nodes.map((node) => [node.id, [] as string[]]));
  edges.forEach((edge) => out.get(edge.from)!.push(edge.to));
  const state = new Map<string, 1 | 2>();
  const back = new Set<string>();
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const next of out.get(id)!) {
      if (state.get(next) === 1) back.add(`${id}>${next}`);
      else if (!state.has(next)) visit(next);
    }
    state.set(id, 2);
  };
  nodes.forEach((node) => { if (!state.has(node.id)) visit(node.id); });
  const forward = edges.map((edge) => back.has(`${edge.from}>${edge.to}`) ? { from: edge.to, to: edge.from } : edge);
  const rank = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    for (const edge of forward) rank.set(edge.to, Math.max(rank.get(edge.to)!, rank.get(edge.from)! + 1));
  }
  return rank;
}

interface Segment { a: RenderPoint; b: RenderPoint }
function segmentsOf(points: readonly RenderPoint[]): Segment[] {
  return points.slice(1).map((b, index) => ({ a: points[index]!, b }));
}
function inflate(bounds: Bounds, by: number): Bounds {
  return { x: bounds.x - by, y: bounds.y - by, width: bounds.width + 2 * by, height: bounds.height + 2 * by };
}
function boxesOverlap(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function segmentHitsBox(segment: Segment, box: Bounds): boolean {
  // Liang Barsky clip: the segment enters the open box.
  let t0 = 0, t1 = 1;
  const dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y;
  const edges: Array<[number, number]> = [
    [-dx, segment.a.x - box.x], [dx, box.x + box.width - segment.a.x],
    [-dy, segment.a.y - box.y], [dy, box.y + box.height - segment.a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) { if (q <= 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 1e-9;
}
function segmentsCross(s: Segment, t: Segment): boolean {
  const cross = (o: RenderPoint, p: RenderPoint, q: RenderPoint) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(t.a, t.b, s.a), d2 = cross(t.a, t.b, s.b), d3 = cross(s.a, s.b, t.a), d4 = cross(s.a, s.b, t.b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Where the ray from the box centre toward `toward` leaves the box. */
function borderPoint(box: Bounds, toward: RenderPoint): RenderPoint {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  const scale = 1 / Math.max(Math.abs(dx) / (box.width / 2), Math.abs(dy) / (box.height / 2));
  return { x: round(cx + dx * scale), y: round(cy + dy * scale) };
}
function centre(box: Bounds): RenderPoint { return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }

function layout(nodes: readonly BlockFlowNode[], edges: readonly BlockFlowEdge[], direction: "right" | "down"): BlockFlowDefinition {
  const rank = ranks(nodes, edges);
  const rankCount = Math.max(...rank.values()) + 1;
  const sized = nodes.map((node) => {
    const lines = wrapBlockFlowLabel(node.label, 3) ?? fail("nodes", `box label "${node.label}" cannot wrap into 3 lines of ${BLOCK_FLOW_LINE_CHARS} characters`);
    const width = Math.ceil(Math.max(...lines.map((line) => measureTextWidth(line, BOX_FONT))) + 2 * BOX_PAD_X);
    const height = lines.length * BOX_LINE_HEIGHT + 2 * BOX_PAD_Y;
    return { node, lines, width, height };
  });
  const edgeLines = edges.map((edge) => balancedArrowLabel(edge.label) ?? fail("edges", `arrow label "${edge.label}" cannot wrap into 2 lines of ${BLOCK_FLOW_LINE_CHARS} characters`));
  const edgeLabelSize = edgeLines.map((lines) => ({
    width: Math.ceil(Math.max(...lines.map((line) => measureTextWidth(line, EDGE_FONT)))),
    height: lines.length * EDGE_LINE_HEIGHT,
  }));
  // Order inside a rank: declared order, then two barycentre sweeps over neighbours.
  const byRank = Array.from({ length: rankCount }, (_, r) => sized.filter((item) => rank.get(item.node.id) === r));
  const position = new Map<string, number>();
  const reindex = () => byRank.forEach((items) => items.forEach((item, index) => position.set(item.node.id, index)));
  reindex();
  for (let sweep = 0; sweep < 2; sweep++) {
    for (const items of byRank) {
      const key = (id: string) => {
        const neighbours = edges.filter((edge) => edge.from === id || edge.to === id).map((edge) => edge.from === id ? edge.to : edge.from)
          .filter((other) => rank.get(other) !== rank.get(id));
        return neighbours.length ? neighbours.reduce((sum, other) => sum + position.get(other)!, 0) / neighbours.length : position.get(id)!;
      };
      items.sort((a, b) => key(a.node.id) - key(b.node.id) || position.get(a.node.id)! - position.get(b.node.id)!);
      reindex();
    }
  }
  const along = (item: { width: number; height: number }) => direction === "right" ? item.width : item.height;
  const across = (item: { width: number; height: number }) => direction === "right" ? item.height : item.width;
  const rankDepth = byRank.map((items) => Math.max(...items.map(along)));
  // Each gap holds the labels of the arrows that cross only that gap; an
  // arrow spanning more ranks detours outside and labels its own long leg.
  const gaps = Array.from({ length: Math.max(0, rankCount - 1) }, (_, gap) => Math.max(MIN_RANK_GAP, ...edges.map((edge, index) => {
    const a = rank.get(edge.from)!, b = rank.get(edge.to)!;
    if (Math.abs(a - b) !== 1 || Math.min(a, b) !== gap) return 0;
    const size = edgeLabelSize[index]!;
    return (direction === "right" ? size.width : size.height) + 2 * 14;
  })));
  const rankSpan = (items: typeof sized) => items.reduce((sum, item) => sum + across(item), 0) + BOX_GAP * (items.length - 1);
  const totalAlong = rankDepth.reduce((sum, depth) => sum + depth, 0) + gaps.reduce((sum, gap) => sum + gap, 0);
  const totalAcross = Math.max(...byRank.map(rankSpan));
  const zoneAlong = direction === "right" ? BLOCK_FLOW_ZONE.width : BLOCK_FLOW_ZONE.height;
  const zoneAcross = direction === "right" ? BLOCK_FLOW_ZONE.height : BLOCK_FLOW_ZONE.width;
  if (totalAlong > zoneAlong || totalAcross > zoneAcross) fail("nodes", `the diagram does not fit the board flowing ${direction}`);
  const startAlong = (zoneAlong - totalAlong) / 2;
  const boxes: BlockFlowBox[] = [];
  let cursor = startAlong;
  byRank.forEach((items, r) => {
    let acrossCursor = (zoneAcross - rankSpan(items)) / 2;
    for (const item of items) {
      const a = cursor + (rankDepth[r]! - along(item)) / 2;
      const [x, y] = direction === "right" ? [a, acrossCursor] : [acrossCursor, a];
      boxes.push({ id: item.node.id, x: round(BLOCK_FLOW_ZONE.x + x), y: round(BLOCK_FLOW_ZONE.y + y), width: item.width, height: item.height, lines: item.lines });
      acrossCursor += across(item) + BOX_GAP;
    }
    cursor += rankDepth[r]! + (gaps[r] ?? 0);
  });
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  const boxLines = boxes.flatMap((box) => box.lines.map((line, index): BlockFlowLabelLine => {
    const width = measureTextWidth(line, BOX_FONT);
    const x = round(box.x + (box.width - width) / 2);
    const y = round(box.y + BOX_PAD_Y + index * BOX_LINE_HEIGHT + (BOX_LINE_HEIGHT - BOX_FONT) / 2);
    return { text: line, x, y, fontPx: BOX_FONT, ink: inkOf(line, x, y, BOX_FONT), owner: box.id };
  }));
  const pairOffset = (edge: BlockFlowEdge) => edges.some((other) => other.from === edge.to && other.to === edge.from) ? 9 : 0;
  const arrows: BlockFlowArrow[] = [];
  const placedLabels: Bounds[] = [];
  edges.forEach((edge, index) => {
    const source = boxById.get(edge.from)!, target = boxById.get(edge.to)!;
    const others = boxes.filter((box) => box.id !== edge.from && box.id !== edge.to).map((box) => inflate(box, CLEAR));
    const offset = pairOffset(edge);
    const straight = (): RenderPoint[] => {
      const a = centre(source), b = centre(target);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const nx = -(b.y - a.y) / length * offset, ny = (b.x - a.x) / length * offset;
      const from = borderPoint(source, { x: b.x + nx, y: b.y + ny });
      const to = borderPoint(target, { x: a.x + nx, y: a.y + ny });
      return [{ x: round(from.x + nx), y: round(from.y + ny) }, { x: round(to.x + nx), y: round(to.y + ny) }];
    };
    // A detour runs outside every box, past the far edge of the layout.
    const detour = (side: 1 | -1, lane: number): RenderPoint[] => {
      const extent = side < 0
        ? Math.min(...boxes.map((box) => direction === "right" ? box.y : box.x)) - 18 - 14 * lane
        : Math.max(...boxes.map((box) => direction === "right" ? box.y + box.height : box.x + box.width)) + 18 + 14 * lane;
      if (direction === "right") {
        const sx = source.x + source.width / 2 + offset, tx = target.x + target.width / 2 - offset;
        const sy = side < 0 ? source.y : source.y + source.height, ty = side < 0 ? target.y : target.y + target.height;
        return [{ x: round(sx), y: round(sy) }, { x: round(sx), y: round(extent) }, { x: round(tx), y: round(extent) }, { x: round(tx), y: round(ty) }];
      }
      const sy = source.y + source.height / 2 + offset, ty = target.y + target.height / 2 - offset;
      const sx = side < 0 ? source.x : source.x + source.width, tx = side < 0 ? target.x : target.x + target.width;
      return [{ x: round(sx), y: round(sy) }, { x: round(extent), y: round(sy) }, { x: round(extent), y: round(ty) }, { x: round(tx), y: round(ty) }];
    };
    const clear = (points: RenderPoint[]) => segmentsOf(points).every((segment) => others.every((box) => !segmentHitsBox(segment, box))) &&
      segmentsOf(points).every((segment) => arrows.every((arrow) => segmentsOf(arrow.points).every((other) => !segmentsCross(segment, other)))) &&
      points.every((point) => point.x >= BLOCK_FLOW_ZONE.x && point.x <= BLOCK_FLOW_ZONE.x + BLOCK_FLOW_ZONE.width &&
        point.y >= BLOCK_FLOW_ZONE.y && point.y <= BLOCK_FLOW_ZONE.y + BLOCK_FLOW_ZONE.height);
    const routes = [straight(), detour(-1, index % 3), detour(1, index % 3)];
    const points = routes.find(clear) ?? fail("edges", `arrow ${edge.from} to ${edge.to} cannot be drawn without crossing a box or another arrow`);
    const lines = edgeLines[index]!;
    const size = edgeLabelSize[index]!;
    const longest = segmentsOf(points).reduce((best, segment) =>
      Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) > Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y) ? segment : best);
    const candidates: Bounds[] = [];
    for (const t of [0.5, 0.35, 0.65]) {
      const mx = longest.a.x + (longest.b.x - longest.a.x) * t, my = longest.a.y + (longest.b.y - longest.a.y) * t;
      const length = Math.hypot(longest.b.x - longest.a.x, longest.b.y - longest.a.y) || 1;
      const nx = -(longest.b.y - longest.a.y) / length, ny = (longest.b.x - longest.a.x) / length;
      for (const side of [-1, 1]) {
        const reach = Math.abs(nx) * size.width / 2 + Math.abs(ny) * size.height / 2 + 8;
        const cx = mx + side * nx * reach, cy = my + side * ny * reach;
        candidates.push({ x: round(cx - size.width / 2), y: round(cy - size.height / 2), width: size.width, height: size.height });
      }
    }
    const everySegment = [...arrows.flatMap((arrow) => segmentsOf(arrow.points)), ...segmentsOf(points)];
    const spot = candidates.find((candidate) => {
      const padded = inflate(candidate, CLEAR);
      return candidate.x >= BLOCK_FLOW_ZONE.x && candidate.x + candidate.width <= BLOCK_FLOW_ZONE.x + BLOCK_FLOW_ZONE.width &&
        candidate.y >= BLOCK_FLOW_ZONE.y && candidate.y + candidate.height <= BLOCK_FLOW_ZONE.y + BLOCK_FLOW_ZONE.height &&
        boxes.every((box) => !boxesOverlap(padded, box)) &&
        placedLabels.every((other) => !boxesOverlap(padded, other)) &&
        everySegment.every((segment) => !segmentHitsBox(segment, padded));
    }) ?? fail("edges", `arrow ${edge.from} to ${edge.to} has no clear place for its label`);
    placedLabels.push(spot);
    arrows.push({
      from: edge.from, to: edge.to, points,
      labelLines: lines.map((line, row) => {
        const width = measureTextWidth(line, EDGE_FONT);
        const x = round(spot.x + (spot.width - width) / 2);
        const y = round(spot.y + row * EDGE_LINE_HEIGHT + (EDGE_LINE_HEIGHT - EDGE_FONT) / 2);
        return { text: line, x, y, fontPx: EDGE_FONT, ink: inkOf(line, x, y, EDGE_FONT), owner: `${edge.from}>${edge.to}` };
      }),
    });
  });
  const definition: BlockFlowDefinition = { direction, nodes: [...nodes], edges: [...edges], boxes, boxLines, arrows, nonmetric: true };
  const problems = verifyBlockFlowLayout(definition);
  if (problems.length) fail("layout", problems[0]!);
  return definition;
}

/**
 * Independent of the layout code: every part inside the diagram zone, no two
 * boxes touching, every box line inside its box, every arrow clear of every
 * other box, every arrow ending on its own boxes, and no label touching any
 * box, arrow or other label.
 */
export function verifyBlockFlowLayout(definition: BlockFlowDefinition): string[] {
  const problems: string[] = [];
  const zone = BLOCK_FLOW_ZONE;
  const inZone = (bounds: Bounds) => bounds.x >= zone.x && bounds.y >= zone.y && bounds.x + bounds.width <= zone.x + zone.width && bounds.y + bounds.height <= zone.y + zone.height;
  const boxById = new Map(definition.boxes.map((box) => [box.id, box]));
  if (definition.boxes.length !== definition.nodes.length || definition.nodes.some((node) => !boxById.has(node.id))) problems.push("every node needs exactly one box");
  if (definition.arrows.length !== definition.edges.length) problems.push("every edge needs exactly one arrow");
  definition.boxes.forEach((box, index) => {
    if (!inZone(box)) problems.push(`box ${box.id} leaves the diagram zone`);
    for (const other of definition.boxes.slice(index + 1)) if (boxesOverlap(inflate(box, BOX_GAP / 2 - 1), other)) problems.push(`boxes ${box.id} and ${other.id} are too close`);
  });
  for (const line of definition.boxLines) {
    const box = boxById.get(line.owner);
    const inside = box && line.ink.x >= box.x + CLEAR && line.ink.y >= box.y + CLEAR / 2 &&
      line.ink.x + line.ink.width <= box.x + box.width - CLEAR && line.ink.y + line.ink.height <= box.y + box.height - CLEAR / 2;
    if (!inside) problems.push(`box text "${line.text}" is not inside its box`);
    if (line.text.length > BLOCK_FLOW_LINE_CHARS) problems.push(`box text "${line.text}" is too long to render`);
  }
  const edgeLabels = definition.arrows.flatMap((arrow) => arrow.labelLines);
  const segments = definition.arrows.flatMap((arrow) => segmentsOf(arrow.points).map((segment) => ({ segment, arrow })));
  definition.arrows.forEach((arrow, index) => {
    const edge = definition.edges[index];
    if (!edge || edge.from !== arrow.from || edge.to !== arrow.to) problems.push(`arrow ${index} does not match its edge`);
    if (arrow.labelLines.length === 0) problems.push(`arrow ${arrow.from} to ${arrow.to} has no label`);
    const source = boxById.get(arrow.from), target = boxById.get(arrow.to);
    const onBorder = (point: RenderPoint, box: Bounds | undefined) => box !== undefined &&
      point.x >= box.x - 0.5 && point.x <= box.x + box.width + 0.5 && point.y >= box.y - 0.5 && point.y <= box.y + box.height + 0.5 &&
      (Math.abs(point.x - box.x) < 0.6 || Math.abs(point.x - box.x - box.width) < 0.6 || Math.abs(point.y - box.y) < 0.6 || Math.abs(point.y - box.y - box.height) < 0.6);
    if (!onBorder(arrow.points[0]!, source) || !onBorder(arrow.points.at(-1)!, target)) problems.push(`arrow ${arrow.from} to ${arrow.to} does not join its boxes`);
    for (const segment of segmentsOf(arrow.points)) {
      for (const box of definition.boxes) {
        if (box.id === arrow.from || box.id === arrow.to) continue;
        if (segmentHitsBox(segment, inflate(box, CLEAR))) problems.push(`arrow ${arrow.from} to ${arrow.to} crosses box ${box.id}`);
      }
      for (const point of [segment.a, segment.b]) if (!inZone({ ...point, width: 0, height: 0 })) problems.push(`arrow ${arrow.from} to ${arrow.to} leaves the diagram zone`);
    }
  });
  segments.forEach(({ segment, arrow }, index) => {
    for (const other of segments.slice(index + 1)) {
      if (other.arrow !== arrow && segmentsCross(segment, other.segment)) problems.push(`arrows ${arrow.from} to ${arrow.to} and ${other.arrow.from} to ${other.arrow.to} cross`);
    }
  });
  edgeLabels.forEach((line, index) => {
    const padded = inflate(line.ink, CLEAR / 2);
    if (!inZone(line.ink)) problems.push(`arrow label "${line.text}" leaves the diagram zone`);
    if (line.text.length > BLOCK_FLOW_LINE_CHARS) problems.push(`arrow label "${line.text}" is too long to render`);
    for (const box of definition.boxes) if (boxesOverlap(padded, box)) problems.push(`arrow label "${line.text}" touches box ${box.id}`);
    for (const { segment } of segments) if (segmentHitsBox(segment, padded)) problems.push(`arrow label "${line.text}" touches an arrow`);
    for (const other of edgeLabels.slice(index + 1)) if (other.owner !== line.owner && boxesOverlap(padded, other.ink)) problems.push(`arrow labels "${line.text}" and "${other.text}" overlap`);
  });
  return [...new Set(problems)];
}

/** Lay the diagram out flowing the planner's direction, else the other one; refuse when neither fits cleanly. */
export function evaluateBlockFlowConstruction(operator: string, inputs: Record<string, unknown>): BlockFlowGeometry[] {
  if (operator !== "block_flow") fail("operator", `unsupported block flow operator ${operator}`);
  const parsed = parseBlockFlowInputs(inputs);
  const order: Array<"right" | "down"> = parsed.direction === "down" ? ["down", "right"] : ["right", "down"];
  let lastError: unknown = null;
  for (const direction of order) {
    try { return [{ kind: "block_flow", blockFlow: layout(parsed.nodes, parsed.edges, direction) }]; }
    catch (error) { lastError = error; }
  }
  throw lastError;
}

/** Board pixel primitives. The figure is nonmetric: no transform applies. */
export function blockFlowPrimitives(geometry: BlockFlowGeometry, entityId: string, groupId: string): RenderPrimitive[] {
  const { boxes, boxLines, arrows } = geometry.blockFlow;
  const label = (line: BlockFlowLabelLine, id: string, role: string): RenderPrimitive => ({
    id, entityId, groupId, kind: "label", text: line.text,
    points: [{ x: round(line.x + measureTextWidth(line.text, line.fontPx) / 2), y: round(line.y + line.fontPx / 2) }],
    labelPlacement: "absolute",
    provenance: {
      blockFlowRole: role, blockFlowNonmetric: true, fontPx: line.fontPx, labelPad: 0, usesLeader: false,
      labelBounds: { x: line.x, y: line.y, width: round(measureTextWidth(line.text, line.fontPx)), height: line.fontPx },
      labelCollisionBounds: line.ink,
    },
  });
  return [
    ...boxes.map((box): RenderPrimitive => ({
      id: `primitive_${entityId}_box_${box.id}`, entityId, groupId, kind: "rectangle",
      points: [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }],
      provenance: { blockFlowRole: "box", blockFlowNode: box.id, blockFlowNonmetric: true },
    })),
    ...boxLines.map((line, index) => label(line, `primitive_${entityId}_box_text_${index}`, "box_text")),
    ...arrows.flatMap((arrow, index): RenderPrimitive[] => [
      {
        id: `primitive_${entityId}_arrow_${index}`, entityId, groupId, kind: "vector", points: arrow.points,
        provenance: { blockFlowRole: "arrow", blockFlowEdge: `${arrow.from}>${arrow.to}`, blockFlowNonmetric: true },
      },
      ...arrow.labelLines.map((line, row) => label(line, `primitive_${entityId}_arrow_${index}_label_${row}`, "arrow_label")),
    ]),
  ];
}

/** Document validation: the inputs parse and lay out, and the construction has exactly one output. */
export function validateBlockFlowConstruction(construction: SceneConstruction, index: number, issues: SceneIssue[]): void {
  if (construction.operator !== "block_flow") return;
  const add = (key: string, message: string) => issues.push({
    code: `invalid_block_flow_${key.replace(/\[.*$/, "").replace(/\..*$/, "")}`, severity: "fatal", message,
    path: `constructions[${index}].${key === "outputs" ? "outputs" : `inputs.${key}`}`,
  });
  if (!Array.isArray(construction.outputs) || construction.outputs.length !== 1) add("outputs", "block_flow has exactly one output: the diagram entity");
  if (!isRecord(construction.inputs)) { add("inputs", "block_flow requires nodes and edges"); return; }
  try { evaluateBlockFlowConstruction(construction.operator, construction.inputs); }
  catch (error) {
    if (error instanceof BlockFlowInputError) add(error.key, error.message);
    else add("inputs", error instanceof Error ? error.message : "block_flow cannot be laid out");
  }
}

/**
 * Admission for a document that carries a block_flow: the diagram is the only
 * construction, entity and mark in it, and every box and arrow is grounded in
 * the authoritative plan. A document without one passes untouched.
 */
export function blockFlowGroundingIssues(
  document: Pick<SceneDocument, "constructions" | "entities" | "annotations">,
  plan: Pick<TurnPlanV3, "qualitativeClaims">,
): SceneIssue[] {
  const flows = document.constructions.filter((construction) => construction.operator === "block_flow");
  if (flows.length === 0) return [];
  const issue = (message: string): SceneIssue => ({ code: "block_flow_ungrounded", severity: "fatal", message, path: "constructions", entityIds: flows.flatMap((flow) => flow.outputs) });
  if (flows.length !== 1 || document.constructions.length !== 1 || document.entities.length !== 1 || document.annotations.length !== 0) {
    return [issue("a block_flow figure is one block_flow construction with one entity and nothing else")];
  }
  let parsed: ReturnType<typeof parseBlockFlowInputs>;
  try { parsed = parseBlockFlowInputs(flows[0]!.inputs); }
  catch (error) { return [issue(error instanceof Error ? error.message : "block_flow inputs are invalid")]; }
  return validateBlockFlowGrounding(parsed, plan).map(issue);
}
