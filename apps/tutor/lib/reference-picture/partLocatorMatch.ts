/**
 * Part locator, matching: printed lines of words (from the SVG's text or from
 * reading the raster) against the names the judge accepted. Pure, so the
 * same lines always give the same parts.
 *
 * The rule is certainty over coverage. A name is located only when its words
 * are printed in exactly one place: as a whole line, as whole lines stacked
 * under each other (a name wrapped onto two lines), or as consecutive words
 * of a line made only of judged names ("Left atrium Right atrium"). A name
 * printed twice, or whose words could be read in two places, gets no part;
 * nor does a name read inside a longer printed name ("Artery" inside
 * "Pulmonary artery" names another structure). A numbered picture's mark is
 * located only when it stands alone in exactly one place; the same mark
 * beside its name in a key printed on the picture is the key, not the mark,
 * and is passed over.
 *
 * Every loop is linear in the printed words or counted against a step
 * budget, so a file built to make matching slow gives no parts instead of
 * holding the event loop.
 */
import { legendMarkKey, normalizeLegendMark, referencePicturePartId, referencePicturePartKey, type PicturePlacement, type ReferencePictureLegendEntry, type ReferencePicturePart } from "@heytutor/drawing";

export interface TextWord {
  text: string;
  /** Plan px. */
  box: PicturePlacement;
}

/** One printed line, left to right. `group` ties lines of one SVG `<text>` (or one OCR block) together. */
export interface TextLine {
  words: TextWord[];
  group: number;
  source: ReferencePicturePart["source"];
}

/** Punctuation that wraps a printed word without being part of the name: "Aorta:", "(3)", "R1,". */
const WRAPPING = /^[\s.,:;!?"'“”‘’()[\]{}*•·–—-]+|[\s.,:;!?"'“”‘’()[\]{}*•·–—-]+$/g;

export function wordKey(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(WRAPPING, "");
}

export function labelKeys(label: string): string[] {
  return label.split(/\s+/).map(wordKey).filter(Boolean);
}

function lineBox(words: readonly TextWord[]): PicturePlacement {
  const left = Math.min(...words.map((w) => w.box.x));
  const top = Math.min(...words.map((w) => w.box.y));
  const right = Math.max(...words.map((w) => w.box.x + w.box.width));
  const bottom = Math.max(...words.map((w) => w.box.y + w.box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function unionBox(boxes: readonly PicturePlacement[]): PicturePlacement {
  return lineBox(boxes.map((box) => ({ text: "", box })));
}

/**
 * Join pieces of one printed line: an SVG may set one line as several text
 * chunks (kerning, a coloured word), and OCR may split one. Pieces join when
 * they share a baseline and size and the gap between them is a word space.
 * Pieces arrive left to right, so a line that ends further than a word space
 * before the current piece can never take another: it leaves the active
 * list, which keeps a page of separate labels near linear. Pieces that
 * overlap across the page never leave it, so joining has a step budget too:
 * past it, it throws and the picture gets no parts.
 */
export function joinLines(lines: readonly TextLine[]): TextLine[] {
  const step = stepBudget(JOIN_STEPS, "too much text to join");
  const sorted = lines.filter((l) => l.words.length).map((l) => ({ ...l, box: lineBox(l.words) })).sort((a, b) => a.box.x - b.box.x);
  const out: Array<TextLine & { box: PicturePlacement }> = [];
  const active: Array<TextLine & { box: PicturePlacement }> = [];
  for (const line of sorted) {
    const h = line.box.height;
    let kept = 0;
    for (const o of active) {
      step();
      if (line.box.x - (o.box.x + o.box.width) < 0.6 * o.box.height) active[kept++] = o;
    }
    active.length = kept;
    const host = active.find((o) => {
      step();
      const oh = o.box.height;
      if (o.source !== line.source || Math.max(h, oh) / Math.min(h, oh) > 1.35) return false;
      const minH = Math.min(h, oh);
      const centreGap = Math.abs(o.box.y + oh / 2 - (line.box.y + h / 2));
      const gap = line.box.x - (o.box.x + o.box.width);
      return centreGap < 0.25 * minH && gap > -0.15 * minH && gap < 0.6 * minH;
    });
    if (host) {
      host.words = [...host.words, ...line.words];
      host.box = lineBox(host.words);
    } else {
      const fresh = { ...line, words: [...line.words] };
      out.push(fresh);
      active.push(fresh);
    }
  }
  return out.map((line) => ({ words: line.words, group: line.group, source: line.source }));
}

/**
 * Steps matching may take before it gives up (and the picture gets no
 * parts). A real diagram takes a few thousand; this many take under 20 ms.
 */
export const MATCH_STEPS = 300_000;
/** Comparisons joining may make before it gives up. A real diagram makes a few thousand; this many take about 10 ms. */
export const JOIN_STEPS = 1_000_000;

function stepBudget(limit = MATCH_STEPS, failure = "too much text to match"): () => void {
  let left = limit;
  return () => {
    if (--left < 0) throw new Error(failure);
  };
}

/** A place a name was read: which line, and which words of it. */
interface Match {
  cells: Array<[line: number, word: number]>;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/**
 * Lines that can continue a wrapped name below `upper`: the next line down,
 * at the same size, overlapping it or sharing its left edge or centre.
 */
function stackedBelow(upper: PicturePlacement, lower: PicturePlacement): boolean {
  const h = Math.min(upper.height, lower.height);
  if (Math.max(upper.height, lower.height) / Math.max(1e-6, h) > 1.35) return false;
  const gap = lower.y - (upper.y + upper.height);
  if (gap < -0.3 * h || gap > 0.6 * h) return false;
  const overlap = Math.min(upper.x + upper.width, lower.x + lower.width) - Math.max(upper.x, lower.x);
  const centres = Math.abs(upper.x + upper.width / 2 - (lower.x + lower.width / 2));
  return overlap >= 0.5 * Math.min(upper.width, lower.width) || centres < 0.75 * h || Math.abs(upper.x - lower.x) < 0.75 * h || Math.abs(upper.x + upper.width - lower.x - lower.width) < 0.75 * h;
}

/** Where each word key is printed, and which lines start with it, so a name is looked for only where its first word is. */
interface WordIndex {
  at: Map<string, Array<[line: number, word: number]>>;
  firsts: Map<string, number[]>;
}

function indexWords(lineKeys: readonly string[][]): WordIndex {
  const at = new Map<string, Array<[number, number]>>();
  const firsts = new Map<string, number[]>();
  lineKeys.forEach((words, li) => {
    words.forEach((key, wi) => {
      if (!key) return;
      (at.get(key) ?? at.set(key, []).get(key)!).push([li, wi]);
      if (wi === 0) (firsts.get(key) ?? firsts.set(key, []).get(key)!).push(li);
    });
  });
  return { at, firsts };
}

function findMatches(keys: readonly string[], lineKeys: readonly string[][], lineBoxes: readonly PicturePlacement[], sources: readonly TextLine["source"][], index: WordIndex, step: () => void): Match[] {
  const matches: Match[] = [];
  const n = keys.length;
  if (!n) return matches;
  for (const [li, s] of index.at.get(keys[0]!) ?? []) {
    step();
    const words = lineKeys[li]!;
    if (s + n <= words.length && keys.every((k, j) => words[s + j] === k)) matches.push({ cells: keys.map((_, k) => [li, s + k]) });
  }
  if (n < 2) return matches;
  // Wrapped names: two or three whole lines, stacked, that read as the name together.
  const walk = (chain: number[], used: number) => {
    if (used === n) {
      matches.push({ cells: chain.flatMap((li) => lineKeys[li]!.map((_, w) => [li, w] as [number, number])) });
      return;
    }
    if (chain.length >= 3) return;
    const last = chain[chain.length - 1]!;
    for (const li of index.firsts.get(keys[used]!) ?? []) {
      step();
      const words = lineKeys[li]!;
      if (chain.includes(li) || sources[li] !== sources[last] || used + words.length > n) continue;
      if (!sameKeys(words, keys.slice(used, used + words.length))) continue;
      if (stackedBelow(lineBoxes[last]!, lineBoxes[li]!)) walk([...chain, li], used + words.length);
    }
  };
  for (const li of index.firsts.get(keys[0]!) ?? []) {
    step();
    const words = lineKeys[li]!;
    if (words.length < n && sameKeys(words, keys.slice(0, words.length))) walk([li], words.length);
  }
  return matches;
}

const cellKey = (cell: readonly [number, number]) => `${cell[0]}:${cell[1]}`;

function within(inner: Match, outer: Match, cells: (match: Match) => Set<string>): boolean {
  if (inner.cells.length >= outer.cells.length) return false;
  const set = cells(outer);
  return inner.cells.every((c) => set.has(cellKey(c)));
}

/** A located name before ids: the label (or mark) and its box in plan px. */
export interface LocatedName {
  label: string;
  mark?: string;
  box: PicturePlacement;
  source: ReferencePicturePart["source"];
}

export interface MatchOutcome {
  located: LocatedName[];
  /** Names read in more than one place, so not pointable. */
  ambiguous: string[];
  /** Names not read at all. */
  missing: string[];
}

/**
 * Locate printed labels. A match inside a longer name's match does not count
 * ("Left ventricle" inside "Left ventricle wall"); a match that is only part
 * of its line counts only when every other word of that line is another
 * judged name; and two names whose matches share a word are both dropped.
 * Throws when the step budget runs out.
 */
export function matchLabels(lines: readonly TextLine[], labels: readonly string[]): MatchOutcome {
  const step = stepBudget();
  const lineKeys = lines.map((line) => line.words.map((w) => wordKey(w.text)));
  const lineBoxes = lines.map((line) => lineBox(line.words));
  const sources = lines.map((line) => line.source);
  const index = indexWords(lineKeys);
  const unique = [...new Map(labels.map((label) => [labelKeys(label).join(" "), label] as const)).entries()].filter(([key]) => key);
  const all = unique.map(([key, label]) => ({ label, keys: key.split(" "), matches: findMatches(key.split(" "), lineKeys, lineBoxes, sources, index, step) }));
  // Every match that covers each printed word, so containment and a line's other names are looked up, not searched for.
  const cover = new Map<string, Array<{ entry: number; match: Match }>>();
  all.forEach((entry, ei) => {
    for (const match of entry.matches) {
      for (const cell of match.cells) {
        step();
        const key = cellKey(cell);
        (cover.get(key) ?? cover.set(key, []).get(key)!).push({ entry: ei, match });
      }
    }
  });
  const cellSets = new Map<Match, Set<string>>();
  const cells = (match: Match) => cellSets.get(match) ?? cellSets.set(match, new Set(match.cells.map(cellKey))).get(match)!;
  const insideLonger = (match: Match, ei: number) => (cover.get(cellKey(match.cells[0]!)) ?? []).some((other) => {
    step();
    return all[other.entry]!.keys.length > all[ei]!.keys.length && within(match, other.match, cells);
  });
  // Part of a line counts only when the rest of the line is other names (or bare punctuation).
  const ownLine = (match: Match, ei: number) => {
    const li = match.cells[0]![0];
    if (match.cells.some((cell) => cell[0] !== li) || match.cells.length === lineKeys[li]!.length) return true;
    const mine = cells(match);
    return lineKeys[li]!.every((key, wi) => {
      step();
      if (!key || mine.has(cellKey([li, wi]))) return true;
      return (cover.get(cellKey([li, wi])) ?? []).some((other) => other.entry !== ei);
    });
  };
  const outcome: MatchOutcome = { located: [], ambiguous: [], missing: [] };
  const chosen: Array<{ label: string; match: Match }> = [];
  all.forEach((entry, ei) => {
    const kept = entry.matches.filter((m) => !insideLonger(m, ei) && ownLine(m, ei));
    if (kept.length === 0) outcome[entry.matches.length ? "ambiguous" : "missing"].push(entry.label);
    else if (kept.length > 1) outcome.ambiguous.push(entry.label);
    else chosen.push({ label: entry.label, match: kept[0]! });
  });
  const owners = new Map<string, number>();
  for (const c of chosen) for (const cell of c.match.cells) owners.set(cellKey(cell), (owners.get(cellKey(cell)) ?? 0) + 1);
  for (const c of chosen) {
    if (c.match.cells.some((cell) => owners.get(cellKey(cell))! > 1)) { outcome.ambiguous.push(c.label); continue; }
    const words = c.match.cells.map(([li, wi]) => lines[li]!.words[wi]!);
    outcome.located.push({ label: c.label, box: unionBox(words.map((w) => w.box)), source: lines[c.match.cells[0]![0]]!.source });
  }
  return outcome;
}

/**
 * Locate a numbered picture's marks. A mark counts where it stands alone
 * (its line holds only marks of this key); where its line also holds its own
 * name it is a printed key row and is passed over; anywhere else ("Stage 3")
 * it is another reading of the same text, and the mark is not located.
 */
export function matchMarks(lines: readonly TextLine[], legend: readonly ReferencePictureLegendEntry[]): MatchOutcome {
  const marks = new Set(legend.map((entry) => legendMarkKey(entry.mark)));
  // Each printed word read once: its key, the mark it reads as, and how many words of its line are this key's marks.
  const read = lines.map((line) => {
    const keys = line.words.map((w) => wordKey(w.text));
    const asMark = keys.map((key) => {
      const mark = normalizeLegendMark(key);
      return mark ? legendMarkKey(mark) : null;
    });
    return { keys, asMark, markWords: asMark.filter((m) => m !== null && marks.has(m)).length };
  });
  const where = new Map<string, Array<[line: number, word: number]>>();
  read.forEach((r, li) => r.asMark.forEach((m, wi) => { if (m !== null && marks.has(m)) (where.get(m) ?? where.set(m, []).get(m)!).push([li, wi]); }));
  const outcome: MatchOutcome = { located: [], ambiguous: [], missing: [] };
  for (const entry of legend) {
    const key = legendMarkKey(entry.mark);
    const name = labelKeys(entry.label);
    const alone: Array<[line: number, word: number]> = [];
    let elsewhere = 0;
    for (const [li, wi] of where.get(key) ?? []) {
      const r = read[li]!;
      // Every word of the line is a mark of this key: the mark stands alone.
      if (r.markWords === r.keys.length) { alone.push([li, wi]); continue; }
      const after = r.keys.slice(wi + 1, wi + 1 + name.length);
      const before = r.keys.slice(Math.max(0, wi - name.length), wi);
      const startsName = after.length > 0 && sameKeys(after, name.slice(0, after.length));
      const endsName = before.length > 0 && sameKeys(before, name.slice(name.length - before.length));
      if (!startsName && !endsName) elsewhere++;
    }
    if (alone.length === 1 && elsewhere === 0) {
      const [li, wi] = alone[0]!;
      outcome.located.push({ label: entry.label, mark: entry.mark, box: lines[li]!.words[wi]!.box, source: lines[li]!.source });
    } else if (alone.length + elsewhere === 0) outcome.missing.push(entry.mark);
    else outcome.ambiguous.push(entry.mark);
  }
  return outcome;
}

/** Located marks must agree on height within this factor of their median, or none is trusted. */
const MARK_HEIGHT_SPREAD = 1.6;
/** Marks whose bottoms differ by less than this share of their median height sit on one baseline. */
const BASELINE_SHARE = 0.2;
/** Gaps between neighbouring marks that differ by less than this share of their mean are even. */
const EVEN_SPACING_SHARE = 0.15;

/**
 * Marks are trusted only as a set. A lone digit that is not a mark (a
 * subscript set apart, an axis tick, a scale number) looks just like one; a
 * set of marks located together, at one size, does not happen by accident.
 * True when at least two marks and at least half the key's marks are
 * located, all within 1.6x of their median height, and they are not three
 * or more on one baseline at even spacing (the numbers of an axis or a
 * scale bar).
 */
export function markSetHolds(marks: readonly Pick<LocatedName, "box">[], keySize: number): boolean {
  if (marks.length < 2 || marks.length * 2 < keySize) return false;
  const heights = marks.map((m) => m.box.height).sort((a, b) => a - b);
  const mid = heights.length >> 1;
  const median = heights.length % 2 ? heights[mid]! : (heights[mid - 1]! + heights[mid]!) / 2;
  if (!heights.every((h) => h <= MARK_HEIGHT_SPREAD * median && median <= MARK_HEIGHT_SPREAD * h)) return false;
  return marks.length < 3 || !evenRow(marks.map((m) => m.box), median);
}

/** Boxes on one baseline whose centres step across at one even gap. */
function evenRow(boxes: readonly PicturePlacement[], height: number): boolean {
  const bottoms = boxes.map((b) => b.y + b.height);
  if (Math.max(...bottoms) - Math.min(...bottoms) > BASELINE_SHARE * height) return false;
  const centres = boxes.map((b) => b.x + b.width / 2).sort((a, b) => a - b);
  const gaps = centres.slice(1).map((c, i) => c - centres[i]!);
  const mean = gaps.reduce((n, g) => n + g, 0) / gaps.length;
  return mean > 0 && Math.max(...gaps) - Math.min(...gaps) <= EVEN_SPACING_SHARE * mean;
}

/**
 * A key that prints some marks zero padded ("01") and some not ("1") was
 * misread: the two styles do not mix on one drawing, and "01" and "1" would
 * be two marks for what is likely one. Such a key gets no mark parts.
 */
export function markStylesMixed(legend: readonly ReferencePictureLegendEntry[]): boolean {
  const padded = legend.some((entry) => /^0[0-9]/.test(entry.mark));
  const bare = legend.some((entry) => /^[1-9][a-z]?$/i.test(entry.mark));
  return padded && bare;
}

/**
 * Located names as parts, in the record's own order, boxes clamped to the
 * picture and rounded outward to whole pixels. A box mostly off the picture
 * is a misreading and is dropped. A part's id is its name's place in the
 * record's labels (a mark's name is the key name, which labels carry), so
 * locating one more name later never renumbers the others.
 */
export function partsFrom(located: readonly LocatedName[], labels: readonly string[], plan: { width: number; height: number }): ReferencePicturePart[] {
  const position = new Map<string, number>();
  labels.forEach((label, i) => { if (!position.has(referencePicturePartKey(label))) position.set(referencePicturePartKey(label), i); });
  const placed = located.map((name) => ({ name, at: position.get(referencePicturePartKey(name.label)) })).filter((p): p is { name: LocatedName; at: number } => p.at !== undefined);
  placed.sort((a, b) => a.at - b.at);
  const parts: ReferencePicturePart[] = [];
  for (const { name, at } of placed) {
    const left = Math.max(0, Math.floor(name.box.x));
    const top = Math.max(0, Math.floor(name.box.y));
    const right = Math.min(plan.width, Math.ceil(name.box.x + name.box.width));
    const bottom = Math.min(plan.height, Math.ceil(name.box.y + name.box.height));
    if (right <= left || bottom <= top || (right - left) * (bottom - top) < 0.7 * name.box.width * name.box.height) continue;
    parts.push({ id: referencePicturePartId(at), label: name.label, ...(name.mark ? { mark: name.mark } : {}), box: { x: left, y: top, width: right - left, height: bottom - top }, source: name.source });
  }
  return parts;
}
