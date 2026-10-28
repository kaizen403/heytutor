/**
 * Part locator, matching: printed lines of words (from the SVG's text or from
 * reading the raster) against the names the judge accepted. Pure, so the
 * same lines always give the same parts.
 *
 * The rule is certainty over coverage. A name is located only when its words
 * are printed in exactly one place: as a whole line, as consecutive words of
 * one line, or as whole lines stacked under each other (a name wrapped onto
 * two lines). A name printed twice, or whose words could be read in two
 * places, gets no part. A numbered picture's mark is located only when it
 * stands alone in exactly one place; the same mark beside its name in a key
 * printed on the picture is the key, not the mark, and is passed over.
 */
import { legendMarkKey, normalizeLegendMark, referencePicturePartId, type PicturePlacement, type ReferencePictureLegendEntry, type ReferencePicturePart } from "@heytutor/drawing";

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
 */
export function joinLines(lines: readonly TextLine[]): TextLine[] {
  const sorted = lines.filter((l) => l.words.length).map((l) => ({ ...l, box: lineBox(l.words) })).sort((a, b) => a.box.x - b.box.x);
  const out: Array<TextLine & { box: PicturePlacement }> = [];
  for (const line of sorted) {
    const h = line.box.height;
    const host = out.find((o) => {
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
      out.push({ ...line, words: [...line.words] });
    }
  }
  return out.map((line) => ({ words: line.words, group: line.group, source: line.source }));
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

function findMatches(keys: readonly string[], lineKeys: readonly string[][], lineBoxes: readonly PicturePlacement[], sources: readonly TextLine["source"][]): Match[] {
  const matches: Match[] = [];
  const n = keys.length;
  if (!n) return matches;
  lineKeys.forEach((words, li) => {
    for (let s = 0; s + n <= words.length; s++) {
      if (sameKeys(words.slice(s, s + n), keys)) matches.push({ cells: keys.map((_, k) => [li, s + k]) });
    }
  });
  if (n < 2) return matches;
  // Wrapped names: two or three whole lines, stacked, that read as the name together.
  const walk = (chain: number[], used: number) => {
    if (used === n) {
      matches.push({ cells: chain.flatMap((li) => lineKeys[li]!.map((_, w) => [li, w] as [number, number])) });
      return;
    }
    if (chain.length >= 3) return;
    const last = chain[chain.length - 1]!;
    lineKeys.forEach((words, li) => {
      if (chain.includes(li) || sources[li] !== sources[last] || used + words.length > n) return;
      if (!sameKeys(words, keys.slice(used, used + words.length))) return;
      if (stackedBelow(lineBoxes[last]!, lineBoxes[li]!)) walk([...chain, li], used + words.length);
    });
  };
  lineKeys.forEach((words, li) => {
    if (words.length < n && words.length > 0 && sameKeys(words, keys.slice(0, words.length))) walk([li], words.length);
  });
  return matches;
}

const cellKey = (cell: readonly [number, number]) => `${cell[0]}:${cell[1]}`;

function within(inner: Match, outer: Match): boolean {
  const set = new Set(outer.cells.map(cellKey));
  return inner.cells.length < outer.cells.length && inner.cells.every((c) => set.has(cellKey(c)));
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
 * ("Left ventricle" inside "Left ventricle wall"), and two names whose
 * matches share a word are both dropped.
 */
export function matchLabels(lines: readonly TextLine[], labels: readonly string[]): MatchOutcome {
  const lineKeys = lines.map((line) => line.words.map((w) => wordKey(w.text)));
  const lineBoxes = lines.map((line) => lineBox(line.words));
  const sources = lines.map((line) => line.source);
  const unique = [...new Map(labels.map((label) => [labelKeys(label).join(" "), label] as const)).entries()].filter(([key]) => key);
  const all = unique.map(([key, label]) => ({ label, keys: key.split(" "), matches: findMatches(key.split(" "), lineKeys, lineBoxes, sources) }));
  const outcome: MatchOutcome = { located: [], ambiguous: [], missing: [] };
  const chosen: Array<{ label: string; match: Match }> = [];
  for (const entry of all) {
    const longer = all.filter((other) => other !== entry && other.keys.length > entry.keys.length).flatMap((other) => other.matches);
    const kept = entry.matches.filter((m) => !longer.some((outer) => within(m, outer)));
    if (kept.length === 0) outcome[entry.matches.length ? "ambiguous" : "missing"].push(entry.label);
    else if (kept.length > 1) outcome.ambiguous.push(entry.label);
    else chosen.push({ label: entry.label, match: kept[0]! });
  }
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
  const bare = (text: string) => {
    const mark = normalizeLegendMark(wordKey(text));
    return mark ? legendMarkKey(mark) : null;
  };
  const outcome: MatchOutcome = { located: [], ambiguous: [], missing: [] };
  for (const entry of legend) {
    const key = legendMarkKey(entry.mark);
    const name = labelKeys(entry.label);
    const alone: TextWord[] = [];
    let elsewhere = 0;
    for (const line of lines) {
      line.words.forEach((word, wi) => {
        if (bare(word.text) !== key) return;
        const others = line.words.filter((_, i) => i !== wi);
        if (others.every((w) => { const m = bare(w.text); return m !== null && marks.has(m); })) { alone.push(word); return; }
        const after = line.words.slice(wi + 1).map((w) => wordKey(w.text));
        const before = line.words.slice(0, wi).map((w) => wordKey(w.text));
        const startsName = after.length > 0 && sameKeys(after.slice(0, Math.min(after.length, name.length)), name.slice(0, Math.min(after.length, name.length)));
        const endsName = before.length > 0 && sameKeys(before.slice(-Math.min(before.length, name.length)), name.slice(-Math.min(before.length, name.length)));
        if (!startsName && !endsName) elsewhere++;
      });
    }
    if (alone.length === 1 && elsewhere === 0) outcome.located.push({ label: entry.label, mark: entry.mark, box: alone[0]!.box, source: lines.find((l) => l.words.includes(alone[0]!))!.source });
    else if (alone.length + elsewhere === 0) outcome.missing.push(entry.mark);
    else outcome.ambiguous.push(entry.mark);
  }
  return outcome;
}

/**
 * Located names as parts, in the record's own order (labels, or the key),
 * boxes clamped to the picture and rounded outward to whole pixels. A box
 * mostly off the picture is a misreading and is dropped. Ids follow the
 * kept order, so the same record always gets the same ids.
 */
export function partsFrom(located: readonly LocatedName[], order: readonly string[], plan: { width: number; height: number }): ReferencePicturePart[] {
  const rank = new Map(order.map((name, i) => [name, i] as const));
  const sorted = [...located].sort((a, b) => (rank.get(a.mark ?? a.label) ?? 1e9) - (rank.get(b.mark ?? b.label) ?? 1e9));
  const parts: ReferencePicturePart[] = [];
  for (const name of sorted) {
    const left = Math.max(0, Math.floor(name.box.x));
    const top = Math.max(0, Math.floor(name.box.y));
    const right = Math.min(plan.width, Math.ceil(name.box.x + name.box.width));
    const bottom = Math.min(plan.height, Math.ceil(name.box.y + name.box.height));
    if (right <= left || bottom <= top || (right - left) * (bottom - top) < 0.7 * name.box.width * name.box.height) continue;
    parts.push({ id: referencePicturePartId(parts.length), label: name.label, ...(name.mark ? { mark: name.mark } : {}), box: { x: left, y: top, width: right - left, height: bottom - top }, source: name.source });
  }
  return parts;
}
