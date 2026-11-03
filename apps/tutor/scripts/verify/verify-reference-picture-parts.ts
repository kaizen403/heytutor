/**
 * Reference picture part locator gate. Free and offline: SVGs are written
 * here and rasterised with sharp (librsvg, the renderer Commons uses), so the
 * truth for every located box is where the renderer actually put that text.
 *
 * Covers the SVG reader (markup, transforms, units, viewBox mapping, switch,
 * hidden and left out text), the matcher (whole lines, words in a line,
 * wrapped names, duplicates, longer names, marks and printed key rows), the
 * ink check, the locator's failure paths (budget, fetch failure), the
 * store's flag (off: no `parts` at all, and the locator never runs), the
 * store path's safety (a locator that throws, hangs, or outlives the
 * request still leaves the picture stored), the reader's ceilings against
 * hostile files (each timed, each failing closed), and the backfill's
 * idempotence.
 */
import sharp from "sharp";
import { parseReferencePictureParts, REFERENCE_PICTURE_PLAN_VERSION, type PicturePlacement, type ReferencePicturePart, type ReferencePicturePlan } from "@heytutor/drawing";
import { parseSvg, parseTransform, readSvgText, rootToPlan, SVG_MAX_BYTES, SVG_MAX_TEXTS } from "../../lib/reference-picture/partLocatorSvg";
import { joinLines, markSetHolds, markStylesMixed, matchLabels, matchMarks, partsFrom, wordKey, type TextLine } from "../../lib/reference-picture/partLocatorMatch";
import { boxOnInk, decodeInkMask, locateReferencePictureParts, recordWithParts, type LocatePartsInput } from "../../lib/reference-picture/partLocator";
import { buildStrokePlan } from "../../lib/reference-picture/strokePlan";
import { candidateFromPage, commonsFileInfo } from "../../lib/reference-picture/wikimediaSearch";
import { servedRecord } from "../../lib/reference-picture/pictureStore";
import { findReferencePicture, type FindPictureDeps } from "../../lib/reference-picture/findReferencePicture";

let failures = 0;
function check(condition: unknown, message: string): void {
  if (!condition) { failures++; console.error(`FAIL ${message}`); }
}

const near = (a: number, b: number, tolerance = 0.5) => Math.abs(a - b) <= tolerance;

function iou(a: PicturePlacement, b: PicturePlacement): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (a.width * a.height + b.width * b.height - w * h);
}

// ---------------------------------------------------------------------------
// Markup and geometry

async function markupChecks(): Promise<void> {
  const doc = await parseSvg(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY ns "http://www.w3.org/2000/svg">]><!-- c --><svg xmlns="&ns;" viewBox="0 0 10 10"><text x='1' y="2">A &amp; B<![CDATA[ C]]></text></svg>`);
  check(doc?.attrs.xmlns === "http://www.w3.org/2000/svg", "a DOCTYPE entity is expanded in attributes");
  const text = doc?.children.find((c) => typeof c !== "string" && c.name === "text");
  check(text && typeof text !== "string" && text.children.join("") === "A & B C", "entities and CDATA read as text");
  check((await parseSvg(`<svg><text>open</svg>`)) === null, "a mismatched close tag is malformed, not guessed");
  check((await parseSvg(`<svg><rect x=1/></svg>`)) === null, "an unquoted attribute is malformed");
  check((await parseSvg(`<svg>${" ".repeat(SVG_MAX_BYTES)}</svg>`)) === null, "an oversized SVG is not read");

  const t = parseTransform("translate(10,20) scale(2)");
  check(t && near(t[0], 2) && near(t[4], 10) && near(t[5], 20), "translate then scale composes");
  const r = parseTransform("rotate(90 10 10)");
  check(r && near(r[0] * 0 + r[2] * 0 + r[4], 20) && near(r[1] * 0 + r[3] * 0 + r[5], 0), "rotate about a point maps (0,0) to (20,0)");
  check(parseTransform("matrix(1,0,0,1)") === null && parseTransform("wobble(3)") === null, "an unreadable transform is refused");

  // viewBox onto plan: mm sizes, percentages, letterboxing, and an aspect the plan disagrees with.
  const plan = { width: 760, height: 380 };
  const m = rootToPlan({ attrs: { width: "200mm", height: "100mm", viewbox: "0 0 400 200" } }, plan);
  check(m && near(m[0], 1.9) && near(m[4], 0), "viewBox scales onto the plan");
  const pct = rootToPlan({ attrs: { width: "100%", height: "100%", viewbox: "10 0 400 200" } }, plan);
  check(pct && near(pct[0] * 10 + pct[4], 0), "percent sizes fall back to the viewBox, offset by its origin");
  const box = rootToPlan({ attrs: { width: "400", height: "200", viewbox: "0 0 100 100" } }, plan);
  check(box && near(box[0], 3.8) && near(box[0] * 0 + box[4], 190), "a square viewBox in a wide viewport is centred (xMidYMid meet)");
  const none = rootToPlan({ attrs: { width: "400", height: "200", viewbox: "0 0 100 100", preserveaspectratio: "none" } }, plan);
  check(none && near(none[0], 7.6) && near(none[3], 3.8), "preserveAspectRatio none stretches each axis");
  check(rootToPlan({ attrs: { width: "400", height: "300", viewbox: "0 0 400 300" } }, plan) === null, "a root whose aspect disagrees with the plan maps nothing");
  check(rootToPlan({ attrs: {} }, plan) === null, "a root with no size maps nothing");

  // Text layout: units, inheritance, anchors, stylesheet classes, switch, hidden and left out text.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
    <style>.big { font-size: 20px } text.mid { text-anchor: middle }</style>
    <g font-size="10" font-family="Arial">
      <text x="10" y="20">Aorta</text>
      <text x="10" y="50" font-size="2em">Atrium</text>
      <text x="200" y="80" class="big mid">Septum</text>
      <text x="390" y="110" text-anchor="end" font-size="15pt">Apex</text>
      <switch><text systemLanguage="de" x="10" y="140">Herz</text><text systemLanguage="en-GB,en" x="10" y="140">Heart</text><text x="10" y="140">Cardia</text></switch>
      <text x="10" y="170" display="none">Hidden</text>
      <g style="display:none"><text x="10" y="180">Gone</text></g>
      <text x="300" y="170" transform="rotate(-90 300 170)">Turned</text>
      <defs><text id="d" x="0" y="0">Kept</text></defs>
      <use href="#d" x="250" y="190"/>
      <text x="20" y="190"><tspan x="20" y="190">Two</tspan> <tspan x="20" dy="12">lines</tspan></text>
    </g>
  </svg>`;
  const read = await readSvgText(svg, { width: 800, height: 400 });
  const lines = read?.lines ?? [];
  const word = (text: string) => lines.flatMap((l) => l.words).find((w) => w.text === text);
  const aorta = word("Aorta");
  check(aorta && near(aorta.box.x, 20) && near(aorta.box.y, (20 - 7.6) * 2, 0.6) && near(aorta.box.width, 2 * 10 * (0.667 + 0.556 + 0.556 + 0.333 + 0.278), 0.6), "a word's box: position doubled onto the plan, Helvetica widths, ascent above the baseline");
  check(word("Atrium") && near(word("Atrium")!.box.height, 2 * 20 * 0.98, 0.6), "em font size is relative to the parent's");
  const septum = word("Septum");
  check(septum && near(septum.box.x + septum.box.width / 2, 400, 0.6) && near(septum.box.height, 2 * 20 * 0.98, 0.6), "a stylesheet class sets size and centres the word on its x");
  const apex = word("Apex");
  check(apex && near(apex.box.x + apex.box.width, 780, 0.6) && near(apex.box.height, 2 * 20 * 0.98, 0.6), "pt sizes convert and an end anchor ends on its x");
  check(word("Heart") && !word("Herz") && !word("Cardia"), "a switch renders its first English child only, not the fallback after it");
  check(!word("Hidden") && !word("Gone"), "hidden text, or text in a hidden group, is not printed");
  check(!word("Turned") && read?.unplaced.includes("Turned"), "rotated text is left out but remembered as printed");
  check(!word("Kept") && read?.unplaced.includes("Kept"), "text drawn through use is left out but remembered as printed");
  const two = lines.find((l) => l.words[0]?.text === "Two");
  const second = lines.find((l) => l.words[0]?.text === "lines");
  check(two && second && two.group === second.group && second.words[0]!.box.y > two.words[0]!.box.y, "tspans with their own position are separate lines of one text");
}

// ---------------------------------------------------------------------------
// Matching

const w = (text: string, x: number, y: number, width = text.length * 8, height = 14) => ({ text, box: { x, y, width, height } });
const L = (group: number, ...words: ReturnType<typeof w>[]): TextLine => ({ words, group, source: "svg" });

function matchChecks(): void {
  check(wordKey("(Aorta):") === "aorta" && wordKey("R1,") === "r1" && wordKey("Na+") === "na+", "wrapping punctuation is not part of a name");
  const lines = joinLines([
    L(1, w("Aorta:", 10, 10)),
    L(2, w("Left", 10, 40), w("ventricle", 50, 40)),
    L(3, w("Left", 10, 80), w("ventricle", 50, 80), w("wall", 130, 80)),
    L(4, w("Septum", 300, 10)),
    L(5, w("Septum", 300, 60)),
    L(6, w("Superior", 300, 100)),
    L(6, w("vena", 300, 116), w("cava", 340, 116)),
    L(7, w("Pulmonary", 500, 10)), L(8, w("artery", 577, 10)),
  ]);
  check(lines.some((l) => l.words.map((x) => x.text).join(" ") === "Pulmonary artery"), "two pieces of one printed line join");
  const out = matchLabels(lines, ["Aorta", "Left ventricle", "Left ventricle wall", "Septum", "Superior vena cava", "Pulmonary artery", "Missing"]);
  const at = (label: string) => out.located.find((n) => n.label === label);
  check(at("Aorta") && near(at("Aorta")!.box.x, 10), "a whole line matches its name");
  check(at("Left ventricle") && near(at("Left ventricle")!.box.y, 40), "a name inside a longer name's line does not count against it");
  check(at("Left ventricle wall") && near(at("Left ventricle wall")!.box.width, 152), "the longer name boxes all its words");
  check(!at("Septum") && out.ambiguous.includes("Septum"), "a name printed twice is not located");
  check(at("Superior vena cava") && near(at("Superior vena cava")!.box.height, 30), "a name wrapped onto two stacked lines is located across both");
  check(at("Pulmonary artery"), "a name split across two chunks of one line is located");
  check(out.missing.includes("Missing"), "a name not printed is missing");
  const inLine = matchLabels([L(1, w("Aorta", 10, 10), w("(to", 60, 10), w("body)", 90, 10))], ["Aorta"]);
  check(inLine.located.length === 0 && inLine.ambiguous.includes("Aorta"), "a name read inside a longer printed line is not located");
  const artery = matchLabels([L(1, w("Pulmonary", 10, 10), w("artery", 90, 10))], ["Artery", "Aorta"]);
  check(artery.located.length === 0, "a short name inside a longer printed name (\"Artery\" in \"Pulmonary artery\") is not located");
  const row = matchLabels([L(1, w("Left", 10, 10), w("atrium", 50, 10), w("–", 110, 10), w("Right", 130, 10), w("atrium", 180, 10))], ["Left atrium", "Right atrium"]);
  check(row.located.length === 2 && row.located[0] && near(row.located[0].box.width, 88), "a line made only of judged names (and punctuation) locates each name in it");
  const far = matchLabels([L(1, w("Superior", 10, 10)), L(2, w("vena", 300, 200), w("cava", 340, 200))], ["Superior vena cava"]);
  check(far.located.length === 0, "lines that are not stacked do not join into a name");
  const shared = matchLabels([L(1, w("Bundle", 10, 10), w("of", 70, 10), w("His", 90, 10))], ["Bundle of", "of His"]);
  check(shared.located.length === 0, "two names claiming the same printed word are both dropped");

  const legend = [{ mark: "1", label: "Aorta" }, { mark: "2", label: "Left atrium" }, { mark: "3", label: "Right atrium" }, { mark: "4", label: "Septum" }, { mark: "5", label: "Apex" }];
  const marks = matchMarks([
    L(1, w("1", 10, 10)),
    L(2, w("1", 400, 10), w("Aorta", 420, 10)),
    L(3, w("2", 10, 40)),
    L(4, w("Stage", 200, 40), w("2", 260, 40)),
    L(5, w("3.", 10, 80), w("4", 30, 80)),
    L(6, w("5", 10, 120)), L(7, w("(5)", 300, 120)),
  ], legend);
  const mark = (m: string) => marks.located.find((n) => n.mark === m);
  check(mark("1") && near(mark("1")!.box.x, 10), "a mark standing alone is located; the printed key row \"1 Aorta\" is passed over");
  check(!mark("2") && marks.ambiguous.includes("2"), "a mark also read inside other text is not located");
  check(mark("3") && mark("4"), "marks set side by side each stand alone");
  check(!mark("5") && marks.ambiguous.includes("5"), "a mark printed twice is not located");
  check(mark("1")?.label === "Aorta", "a located mark answers to its key name");
  const box = (height: number) => ({ box: { x: 0, y: 0, width: 8, height } });
  check(!markSetHolds([box(14)], 2) && !markSetHolds([box(14), box(14)], 5) && markSetHolds([box(14), box(14), box(15)], 5), "marks count only as a set: at least two, and at least half the key");
  check(!markSetHolds([box(14), box(14), box(6)], 4) && !markSetHolds([box(14), box(14), box(30)], 4) && markSetHolds([box(14), box(12), box(19)], 4), "a mark much smaller or larger than the others (a subscript, a heading) breaks the set");
  const placed = (x: number, y: number) => ({ box: { x, y, width: 8, height: 14 } });
  check(!markSetHolds([placed(100, 500), placed(200, 501), placed(300, 500)], 4) && !markSetHolds([placed(100, 500), placed(150, 500), placed(200, 500), placed(250, 500)], 4), "marks on one baseline at even spacing (scale bar or axis numbers) are not a set");
  check(markSetHolds([placed(100, 500), placed(140, 500), placed(300, 500)], 4) && markSetHolds([placed(100, 100), placed(200, 300), placed(300, 500)], 4) && markSetHolds([placed(100, 500), placed(200, 500)], 4), "uneven spacing, separate baselines, or only two marks still hold");
  const keyOf = (...marks: string[]) => marks.map((mark) => ({ mark, label: `Part ${mark}` }));
  check(markStylesMixed(keyOf("01", "1")) && markStylesMixed(keyOf("01", "02", "3")) && !markStylesMixed(keyOf("01", "02", "10")) && !markStylesMixed(keyOf("1", "2", "10", "a")), "a key mixing \"01\" and \"1\" marks is a misread; one style alone is not");

  const parts = partsFrom([{ label: "Septum", box: { x: -4, y: 10.2, width: 30, height: 10 }, source: "svg" }, { label: "Aorta", box: { x: 5, y: 5, width: 10, height: 10 }, source: "svg" }, { label: "Apex", box: { x: 790, y: 5, width: 40, height: 10 }, source: "svg" }], ["Heart", "Aorta", "Septum", "Apex"], { width: 800, height: 400 });
  check(parts.map((p) => p.label).join(",") === "Aorta,Septum", "parts follow the record's order; a box mostly off the picture is dropped");
  check(parts[0]?.id === "reference_picture.part.2" && parts[1]?.id === "reference_picture.part.3", "a part's id is its name's place in labels, not its place among the located");
  check(parts[1] && parts[1].box.x === 0 && parts[1].box.y === 10 && parts[1].box.width === 26 && parts[1].box.height === 11, "boxes clamp to the picture and round outward");
  const alone = partsFrom([{ label: "Septum", box: { x: 5, y: 5, width: 30, height: 10 }, source: "svg" }], ["Heart", "Aorta", "Septum", "Apex"], { width: 800, height: 400 });
  check(alone[0]?.id === parts[1]?.id, "locating one name more or less never renumbers the others");
  const keyed = partsFrom([{ label: "Left atrium", mark: "4", box: { x: 5, y: 5, width: 10, height: 10 }, source: "svg" }], ["Aorta", "Right atrium", "Left atrium"], { width: 800, height: 400 });
  check(keyed[0]?.id === "reference_picture.part.3" && keyed[0].mark === "4", "a mark's part is numbered by its key name's place in labels");
}

// ---------------------------------------------------------------------------
// End to end on a rendered SVG

const LAB = `font-family="Arial, Helvetica, sans-serif" font-size="28"`;
interface Printed { id: string; markup: string }
// The switch skips an extension it does not have (as Illustrator files do) rather than a language, so the truth render does not depend on the machine's locale.
const printed: Printed[] = [
  { id: "aorta", markup: `<text ${LAB} x="40" y="60">Aorta</text>` },
  { id: "atrium", markup: `<g transform="translate(560,40) scale(0.8)"><text ${LAB} x="0" y="60">Left atrium</text></g>` },
  { id: "ventricle", markup: `<text ${LAB} x="400" y="570" text-anchor="middle">Right ventricle</text>` },
  { id: "septum1", markup: `<text ${LAB} x="40" y="300">Septum</text>` },
  { id: "septum2", markup: `<text ${LAB} x="40" y="350">Septum</text>` },
  { id: "vena", markup: `<text ${LAB} x="40" y="500">Vena</text><rect x="30" y="470" width="150" height="45" fill="#ffffff"/>` },
  { id: "cava", markup: `<text ${LAB} x="560" y="400"><tspan x="560" y="400">Superior</tspan><tspan x="560" dy="32">vena cava</tspan></text>` },
  { id: "switch", markup: `<switch><g requiredExtensions="http://ns.adobe.com/AdobeIllustrator/10.0/"><text ${LAB} x="560" y="200">Aorta</text></g><text ${LAB} x="560" y="200">Pulmonary vein</text><text ${LAB} x="560" y="200">Aorta</text></switch>` },
  { id: "mitral", markup: `<text ${LAB} x="560" y="300">Mitral</text><defs><text id="m2" ${LAB}>Mitral</text></defs><use href="#m2" x="560" y="250"/>` },
  { id: "apex", markup: `<text ${LAB} x="40" y="420">Apex</text><text ${LAB} x="1200" y="420">Apex</text>` },
];
const LABELS = ["Aorta", "Left atrium", "Right ventricle", "Septum", "Vena", "Superior vena cava", "Pulmonary vein", "Mitral", "Apex"];

function scene(only?: string): string {
  const shapes = only ? "" : `<rect width="800" height="600" fill="#ffffff"/><circle cx="400" cy="300" r="110" fill="none" stroke="#202020" stroke-width="5"/>`;
  const body = printed.filter((p) => !only || p.id === only).map((p) => p.markup).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200mm" height="150mm" viewBox="0 0 800 600">${only ? `<rect width="800" height="600" fill="#ffffff"/>` : ""}${shapes}${body}</svg>`;
}

/** Where the renderer put one printed text, at plan size: the bounding box of its dark pixels. */
async function renderedBox(only: string, plan: { width: number; height: number }): Promise<PicturePlacement | null> {
  const { data } = await sharp(Buffer.from(scene(only)), { density: 96 }).resize({ width: plan.width, height: plan.height, fit: "fill" }).flatten({ background: "#ffffff" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let [left, top, right, bottom] = [Infinity, Infinity, -1, -1];
  for (let y = 0; y < plan.height; y++) for (let x = 0; x < plan.width; x++) {
    if (data[y * plan.width + x]! > 160) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

const svgResponse = (body: string): Response => new Response(body, { headers: { "content-type": "image/svg+xml" } });

async function endToEndChecks(): Promise<void> {
  const raster = await sharp(Buffer.from(scene()), { density: 96 }).png().toBuffer();
  const built = await buildStrokePlan(raster);
  const plan = built.plan;
  const input = (overrides: Partial<LocatePartsInput> = {}): LocatePartsInput => ({
    candidate: { mime: "image/svg+xml", originalUrl: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Heart.svg" },
    plan,
    picturePng: built.picturePng,
    labels: LABELS,
    fetchImpl: async () => svgResponse(scene()),
    ...overrides,
  });
  const result = await locateReferencePictureParts(input());
  const located = new Map(result.parts.map((part) => [part.label, part] as const));
  check(result.parts.length > 0 && result.parts.every((part) => part.source === "svg"), `the rendered SVG yields SVG parts (${result.step})`);
  check(JSON.stringify(parseReferencePictureParts(result.parts, { plan, labels: LABELS })) === JSON.stringify(result.parts), "every part the locator returns passes the shared parser unchanged");
  const truth: Array<[string, string]> = [["Aorta", "aorta"], ["Left atrium", "atrium"], ["Right ventricle", "ventricle"], ["Superior vena cava", "cava"], ["Pulmonary vein", "switch"], ["Apex", "apex"]];
  for (const [label, id] of truth) {
    const part = located.get(label);
    const rendered = await renderedBox(id, plan);
    check(part && rendered && iou(part.box, rendered) >= 0.4, `"${label}" is boxed where the renderer printed it (IoU ${part && rendered ? iou(part.box, rendered).toFixed(2) : "none"})`);
  }
  check(!located.has("Septum"), "a name printed twice gets no part");
  check(!located.has("Vena"), "a name covered by a shape drawn over it (no ink) gets no part");
  check(!located.has("Mitral"), "a name also drawn through use gets no part");
  check(result.step.includes("off ink"), "the step trail counts names dropped for having no ink");

  // A numbered picture: marks only, the printed key row passed over.
  const numbered = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#fff"/><circle cx="300" cy="300" r="150" fill="none" stroke="#000" stroke-width="5"/>
    <text ${LAB} x="100" y="100">1</text><text ${LAB} x="500" y="120">2</text><text ${LAB} x="480" y="480">3</text>
    <text ${LAB} x="600" y="560">1 Aorta</text><text ${LAB} x="100" y="560">Phase 3</text></svg>`;
  const nRaster = await sharp(Buffer.from(numbered)).png().toBuffer();
  const nBuilt = await buildStrokePlan(nRaster);
  const legend = [{ mark: "1", label: "Aorta" }, { mark: "2", label: "Left atrium" }, { mark: "3", label: "Right atrium" }, { mark: "4", label: "Septum" }];
  const nResult = await locateReferencePictureParts({ ...input(), plan: nBuilt.plan, picturePng: nBuilt.picturePng, labels: legend.map((e) => e.label), legend, fetchImpl: async () => svgResponse(numbered) });
  check(nResult.parts.map((p) => `${p.mark}:${p.label}:${p.id}`).join(",") === "1:Aorta:reference_picture.part.1,2:Left atrium:reference_picture.part.2", `a numbered picture locates marks 1 and 2; 3 is also read in "Phase 3"; 4 is not printed (${nResult.step})`);
  check(JSON.stringify(parseReferencePictureParts(nResult.parts, { plan: nBuilt.plan, labels: legend.map((e) => e.label), legend })) === JSON.stringify(nResult.parts), "mark parts pass the shared parser unchanged (ids by key name position)");
  // Only mark 1 on the drawing: one lone digit is not a set, so no mark is trusted.
  const lone = numbered.replace(`<text ${LAB} x="500" y="120">2</text>`, "");
  const loneResult = await locateReferencePictureParts({ ...input(), plan: nBuilt.plan, picturePng: nBuilt.picturePng, labels: legend.map((e) => e.label), legend, fetchImpl: async () => svgResponse(lone) });
  check(loneResult.parts.length === 0 && loneResult.step.includes("not a set"), `a lone located mark is not trusted (${loneResult.step})`);
  check(nResult.parts[0] && near(nResult.parts[0].box.x, 100 * nBuilt.plan.width / 800, 3), "mark 1 is the one on the drawing, not the one in the printed key row");
  // Marks 1, 2, 3 as the numbers of a scale bar: one baseline, even steps. Not a set of part marks.
  const scale = numbered.replace(`<text ${LAB} x="100" y="100">1</text><text ${LAB} x="500" y="120">2</text><text ${LAB} x="480" y="480">3</text>`, `<text ${LAB} x="200" y="420">1</text><text ${LAB} x="300" y="420">2</text><text ${LAB} x="400" y="420">3</text>`).replace("Phase 3", "Phase");
  const sBuilt = await buildStrokePlan(await sharp(Buffer.from(scale)).png().toBuffer());
  const scaleResult = await locateReferencePictureParts({ ...input(), plan: sBuilt.plan, picturePng: sBuilt.picturePng, labels: legend.map((e) => e.label), legend, fetchImpl: async () => svgResponse(scale) });
  check(scaleResult.parts.length === 0 && scaleResult.step.includes("3 marks not a set"), `marks set as a scale bar are not trusted (${scaleResult.step})`);
  // A key read as "01" and "2": a misread key gets no mark parts, though the drawing's marks would match.
  const mixed = [{ mark: "01", label: "Aorta" }, ...legend.slice(1)];
  const mixedSvg = numbered.replace(`x="100" y="100">1<`, `x="100" y="100">01<`);
  const mBuilt = await buildStrokePlan(await sharp(Buffer.from(mixedSvg)).png().toBuffer());
  const mixedResult = await locateReferencePictureParts({ ...input(), plan: mBuilt.plan, picturePng: mBuilt.picturePng, labels: mixed.map((e) => e.label), legend: mixed, fetchImpl: async () => svgResponse(mixedSvg) });
  check(mixedResult.parts.length === 0 && mixedResult.step.includes("mixes"), `a key mixing "01" and "2" marks gets no mark parts (${mixedResult.step})`);

  // Failure paths: none of them stores a part, none throws, except the caller's own abort.
  const wide = { ...plan, width: plan.width, height: Math.round(plan.height * 0.8) };
  check((await locateReferencePictureParts(input({ plan: wide }))).parts.length === 0, "a plan whose aspect differs from the SVG's locates nothing");
  check((await locateReferencePictureParts(input({ fetchImpl: async () => new Response("no", { status: 500 }) }))).parts.length === 0, "a failed SVG fetch stores no parts");
  check((await locateReferencePictureParts(input({ fetchImpl: async () => svgResponse("<svg><text>broken") }))).parts.length === 0, "malformed SVG stores no parts");
  check((await locateReferencePictureParts(input({ candidate: { mime: "image/png", originalUrl: "https://upload.wikimedia.org/a.png" } }))).step.startsWith("no source"), "a bitmap with no raster reader locates nothing");
  check((await locateReferencePictureParts(input({ candidate: null }))).parts.length === 0, "a generated picture locates nothing");
  check((await locateReferencePictureParts(input({ labels: [] }))).step === "no names", "a picture with no names is not read");
  const hanging = (_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  const started = Date.now();
  const late = await locateReferencePictureParts(input({ fetchImpl: hanging, budgetMs: 60 }));
  check(late.parts.length === 0 && late.step === "timed out" && Date.now() - started < 1000, "the budget running out stores no parts, promptly");
  check(!("signal" in input()) && (await locateReferencePictureParts(input({ fetchImpl: async () => { throw new Error("socket closed"); } })).then((r) => r.parts.length === 0, () => false)), "the locator takes no caller signal and never rejects");

  // The ink check on its own: paper is not text.
  const ink = await decodeInkMask(plan.inkMask, plan.width, plan.height);
  const aorta = located.get("Aorta");
  check(ink && aorta && boxOnInk(aorta.box, ink, plan.width, plan.height), "a printed word's box is on ink");
  check(ink && !boxOnInk({ x: plan.width - 60, y: plan.height / 2 - 10, width: 50, height: 20 }, ink, plan.width, plan.height), "a box on blank paper is not");
}

// ---------------------------------------------------------------------------
// Hostile files: each finishes fast, holds the event loop under 50 ms, and fails closed

/** Run `work` while a 5 ms timer watches the event loop; returns the result, wall time, and the longest stall. */
async function timed<T>(work: () => Promise<T>): Promise<{ value: T; ms: number; stallMs: number }> {
  let last = performance.now();
  let stallMs = 0;
  const watch = setInterval(() => {
    const now = performance.now();
    stallMs = Math.max(stallMs, now - last - 5);
    last = now;
  }, 5);
  const started = performance.now();
  try {
    const value = await work();
    const ms = performance.now() - started;
    stallMs = Math.max(stallMs, performance.now() - last - 5);
    return { value, ms, stallMs };
  } finally {
    clearInterval(watch);
  }
}

const SHEET = { width: 800, height: 600 };
const doc = (body: string, head = "") => `<?xml version="1.0"?>${head}<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">${body}</svg>`;

async function hostileChecks(): Promise<void> {
  const label = `<text x="40" y="60" font-size="28">Aorta</text>`;
  // A stylesheet with a long run and no brace: a backtracking scan took 3.2 s at 80 KB.
  const style = (css: string) => doc(`<style>${css}</style>${label}`);
  const bigSheet = await timed(() => readSvgText(style("a".repeat(80_000)), SHEET));
  check(bigSheet.value === null && bigSheet.ms < 200 && bigSheet.stallMs < 50, `an 80 KB stylesheet is declined fast (${bigSheet.ms.toFixed(0)} ms, stall ${bigSheet.stallMs.toFixed(0)} ms)`);
  const runOn = await timed(() => readSvgText(style(`.x{font-size:9px}${"a".repeat(60_000)}`), SHEET));
  check(runOn.value?.lines.length === 1 && runOn.ms < 100 && runOn.stallMs < 50, `a 60 KB stylesheet run with no brace reads in linear time (${runOn.ms.toFixed(1)} ms)`);
  const comments = await timed(() => readSvgText(style("/*a*/".repeat(2).concat("/*x".repeat(20_000))), SHEET));
  check(comments.value?.lines.length === 1 && comments.ms < 100, `20,000 unclosed comment openers read in linear time (${comments.ms.toFixed(1)} ms)`);
  const sheet = await readSvgText(style(".a{font-size:10px} /* c */ @media print { .b { font-size: 40px } } .big{font-size:56px}").replace(`font-size="28"`, `class="big" font-size="28"`), SHEET);
  check(sheet?.lines[0] && near(sheet.lines[0].words[0]!.box.height, 56 * 0.98, 0.6), "the linear stylesheet scan still reads rules after comments and at-rules");

  // Entity amplification: a 5,000 character entity used 10,000 times would be 50 million characters.
  const laughs = doc(`<text x="10" y="20">${"&a;".repeat(10_000)}</text>${label}`, `<!DOCTYPE svg [<!ENTITY a "${"x".repeat(5_000)}">]>`);
  const amplified = await timed(() => readSvgText(laughs, SHEET));
  check(amplified.value === null && amplified.ms < 200 && amplified.stallMs < 50, `entities that would grow the file past twice its size decline it (${amplified.ms.toFixed(0)} ms)`);
  const inAttribute = doc(`<g id="${"&a;".repeat(10_000)}">${label}</g>`, `<!DOCTYPE svg [<!ENTITY a "${"x".repeat(5_000)}">]>`);
  check((await readSvgText(inAttribute, SHEET)) === null, "the same amplification inside an attribute (no text ceiling there) declines the file too");
  const nested = doc(`<text x="10" y="20">&b;&b;&b;</text>${label}`, `<!DOCTYPE svg [<!ENTITY a "lol"><!ENTITY b "&a;&a;&a;&a;&a;&a;">]>`);
  const once = await readSvgText(nested, SHEET);
  check(once?.lines[0]?.words[0]?.text === "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;", "an entity's value is never expanded again (no nesting)");
  check((await readSvgText(doc(label, `<!DOCTYPE svg [<!ENTITY a "never closed>]>`), SHEET)) === null, "an entity value that never closes declines the file");
  check((await readSvgText(doc(`<text x="10" y="20">&ns;</text>`, `<!DOCTYPE svg [<!ENTITY ns "Aorta">]>`), SHEET))?.lines[0]?.words[0]?.text === "Aorta", "a small literal entity still reads");

  // Too many texts: 30,000 on distinct baselines (1.6 MB) held the loop for 2 s through the line joiner.
  const many = doc(Array.from({ length: 30_000 }, (_, i) => `<text x="${i % 700}" y="${(i * 0.02).toFixed(2)}">${i % 10}</text>`).join(""));
  const crowd = await timed(() => readSvgText(many, SHEET));
  check(crowd.value === null && crowd.ms < 1500 && crowd.stallMs < 50, `30,000 texts are declined (${crowd.ms.toFixed(0)} ms, stall ${crowd.stallMs.toFixed(0)} ms)`);
  const atCap = doc(Array.from({ length: SVG_MAX_TEXTS }, (_, i) => `<text x="${i % 700}" y="${(i * 0.19).toFixed(2)}" font-size="4">${i}</text>`).join(""));
  check((await readSvgText(atCap, SHEET))?.lines.length === SVG_MAX_TEXTS, "a file at the text ceiling still reads");
  check((await readSvgText(doc(`<text x="10" y="20">${"Aorta ".repeat(60)}</text>`), SHEET))?.unplaced[0]?.startsWith("Aorta Aorta"), "a text too long to be a label is printed but not boxed (it still counts as a copy)");
  const chars = doc(Array.from({ length: 400 }, (_, i) => `<text x="10" y="${i}">${"w".repeat(190)}</text>`).join(""));
  check((await readSvgText(chars, SHEET)) === null, "a file with more than 60,000 characters of text is declined");

  // Style matching and text layout under a full sheet: 2,000 rules against one element naming 300,000 classes
  // (898 ms at a stretch when every element scanned every rule), and against one text of 80,000 empty tspans
  // (561 ms; layout never yielded). Each must hold the loop under 20 ms: best of two runs, so one garbage
  // collection pause does not fail it.
  const rules = (from: number) => `<style>${Array.from({ length: 2_000 }, (_, i) => `.r${from + i}{font-size:${10 + (i % 5)}px}`).join("")}</style>`;
  const stretch = async (svg: string) => {
    const runs = [await timed(() => readSvgText(svg, SHEET)), await timed(() => readSvgText(svg, SHEET))];
    return { value: runs[1]!.value, ms: Math.min(...runs.map((r) => r.ms)), stallMs: Math.min(...runs.map((r) => r.stallMs)) };
  };
  const classBomb = await stretch(doc(`${rules(0)}<g class="${Array.from({ length: 300_000 }, () => "zz").join(" ")}">${label}</g><text x="40" y="200" class="r1 r1 r2" font-size="28">Apex</text>`));
  check(classBomb.stallMs < 20 && classBomb.value?.unplaced.includes("Aorta") && classBomb.value.lines.length === 1, `an element naming 300,000 classes is printed, not boxed, and holds the loop ${classBomb.stallMs.toFixed(0)} ms at most (${classBomb.ms.toFixed(0)} ms)`);
  const apex = classBomb.value?.lines.find((line) => line.words[0]?.text === "Apex");
  check(apex && near(apex.words[0]!.box.height, 12 * 0.98, 0.6), "repeated classes count once, and each class's rule still applies in sheet order (.r2 after .r1)");
  const tspanBomb = await stretch(doc(`${rules(1_000)}<text x="10" y="20" font-size="10">${`<tspan x="1" y="2"/>`.repeat(80_000)}</text>${label}`));
  check(tspanBomb.stallMs < 20 && tspanBomb.value?.lines.length === 1, `a text of 80,000 empty tspans holds the loop ${tspanBomb.stallMs.toFixed(0)} ms at most (${tspanBomb.ms.toFixed(0)} ms)`);
  const crowded = await readSvgText(doc(`<text x="10" y="20">Aorta${`<tspan dx="0"/>`.repeat(201)}</text>`), SHEET);
  check(crowded && crowded.lines.length === 0 && crowded.unplaced.includes("Aorta"), "a text of more parts than a label has characters is printed, not boxed (it still counts as a copy)");
  const fewer = await readSvgText(doc(`<text x="10" y="20">Aorta${`<tspan dx="0"/>`.repeat(199)}</text>`), SHEET);
  check(fewer?.lines[0]?.words[0]?.text === "Aorta", "a text just under the part ceiling still reads");

  // The joiner and the matcher on their own: line joining is near linear, matching has a step budget.
  const pieces: TextLine[] = Array.from({ length: 20_000 }, (_, i) => L(i, w(String(i), i * 10, (i % 50) * 20)));
  const started = performance.now();
  const joined = joinLines(pieces);
  const joinMs = performance.now() - started;
  check(joined.length === 20_000 && joinMs < 150, `20,000 separate pieces join in near linear time (${joinMs.toFixed(0)} ms)`);
  // Pieces that all overlap across the page never leave the active list: 3,000 of them took 26 to 40 ms.
  const overlapping: TextLine[] = Array.from({ length: SVG_MAX_TEXTS }, (_, i) => L(i, w(`w${i}`, 0, i * 20, 400, 10)));
  const overlapStart = performance.now();
  let joinRefused = false;
  try { joinLines(overlapping); } catch { joinRefused = true; }
  const overlapMs = performance.now() - overlapStart;
  check(joinRefused && overlapMs < 20, `3,000 pieces overlapping across the page give up within the join budget (${overlapMs.toFixed(0)} ms)`);
  const column: TextLine[] = Array.from({ length: 300 }, (_, i) => L(i, w(`w${i}`, 0, i * 20, 400, 10)));
  check(joinLines(column).length === 300, "a column of 300 labels still joins within the budget");
  const stack: TextLine[] = Array.from({ length: 3_000 }, (_, i) => L(i, w("a", 10, i * 0.5, 8, 10)));
  const matchStart = performance.now();
  let refused = false;
  try { matchLabels(stack, ["a a a b"]); } catch { refused = true; }
  const matchMs = performance.now() - matchStart;
  check(refused && matchMs < 50, `a pile of lines built to explode the wrapped name search gives up within its step budget (${matchMs.toFixed(0)} ms)`);
  const words = (n: number) => Array.from({ length: n }, (_, i) => w(String((i % 9) + 1), i * 10, 10));
  const markStart = performance.now();
  matchMarks([L(1, ...words(20_000))], Array.from({ length: 9 }, (_, i) => ({ mark: String(i + 1), label: `Part ${i + 1}` })));
  check(performance.now() - markStart < 50, `one line of 20,000 marks is matched in linear time (${(performance.now() - markStart).toFixed(0)} ms)`);

  // Through the locator: a hostile file costs no parts and no stall.
  const plan: ReferencePicturePlan = { version: REFERENCE_PICTURE_PLAN_VERSION, width: 800, height: 600, paper: "#ffffff", inkMask: "data:image/png;base64,AAAA", outline: { brushPx: 8, strokes: [], lengthPx: 0 }, fill: { brushPx: 30, strokes: [], lengthPx: 0 } };
  const viaLocator = await timed(() => locateReferencePictureParts({ candidate: { mime: "image/svg+xml", originalUrl: "https://upload.wikimedia.org/x.svg" }, plan, picturePng: Buffer.alloc(0), labels: ["Aorta"], fetchImpl: async () => svgResponse(laughs) }));
  check(viaLocator.value.parts.length === 0 && viaLocator.value.step.includes("svg unreadable") && viaLocator.stallMs < 50, `the locator turns a hostile file into no parts (${viaLocator.value.step})`);

  // What the reader cannot place is left out, and still counts as printed.
  check((await readSvgText(doc(label).replace("<svg ", `<svg transform="wobble(2)" `), SHEET)) === null, "an unreadable root transform declines the file");
  const css = await readSvgText(doc(`<style>.t{transform:translate(300px,0)}</style><text class="t" x="40" y="60">Aorta</text><text x="40" y="200" style="transform: rotate(10deg)">Apex</text><g style="transform:scale(2)"><text x="10" y="300">Septum</text></g>`), SHEET);
  check(css && css.lines.length === 0 && ["Aorta", "Apex", "Septum"].every((t) => css.unplaced.includes(t)), "text under a CSS transform is not boxed but counts as a copy");
  const repeated = await readSvgText(doc(`<defs><pattern id="p"><text x="0" y="10">Aorta</text></pattern><marker id="m"><text>Apex</text></marker><symbol id="s"><text>Septum</text></symbol></defs>${label}`), SHEET);
  check(repeated && ["Aorta", "Apex", "Septum"].every((t) => repeated.unplaced.includes(t)) && repeated.lines.length === 1, "text in a pattern, marker or symbol counts as a printed copy");
}

// ---------------------------------------------------------------------------
// The store path: the locator runs only with the flag, and never costs the picture

async function storePathChecks(): Promise<void> {
  const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const plan: ReferencePicturePlan = { version: REFERENCE_PICTURE_PLAN_VERSION, width: 400, height: 300, paper: "#ffffff", inkMask: "data:image/png;base64,AAAA", outline: { brushPx: 8, strokes: [[0, 0, 10, 10]], lengthPx: 14.1 }, fill: { brushPx: 30, strokes: [[0, 0, 0, 80]], lengthPx: 80 } };
  const stubPlan: FindPictureDeps["strokePlan"] = async () => ({ plan, picturePng: png, stats: { inkPixels: 1, outlineStrokes: 1, fillStrokes: 1, outlineCoverage: 1, fillCoverage: 1, planBytes: 100, ms: 1, longestSliceMs: 1 } });
  const accept = '{"use":true,"shows":"heart","labels":["Aorta","Left atrium"],"labelLanguage":"en","problems":[],"confidence":0.96}';
  const fetchImpl: FindPictureDeps["fetchImpl"] = async (url, init) => {
    if (url.includes("commons.wikimedia.org/w/api.php")) {
      return Response.json({ query: { pages: [{ title: "File:Heart diagram-en.svg", index: 1, imageinfo: [{ url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Heart.svg", thumburl: "https://upload.wikimedia.org/x.png", thumbwidth: 960, thumbheight: 720, mime: "image/svg+xml", descriptionurl: "https://commons.wikimedia.org/wiki/x", extmetadata: { LicenseShortName: { value: "CC0" } } }] }] } });
    }
    if (url.includes("upload.wikimedia.org")) return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
    const text = JSON.stringify((JSON.parse(String(init?.body ?? "{}")) as { messages?: unknown }).messages);
    if (text.includes("wantsPicture")) return Response.json({ choices: [{ message: { content: '{"wantsPicture":true,"mustShow":"human heart chambers","queries":["heart diagram"]}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    if (text.includes("You fact check a diagram")) return Response.json({ choices: [{ message: { content: '{"claims":[{"text":"Aorta label on the aorta","grade":"correct"}]}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    return Response.json({ choices: [{ message: { content: accept } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  };
  const run = async (flag: "on" | undefined, locateParts: FindPictureDeps["locateParts"], signal?: AbortSignal) => {
    const saved: Array<Record<string, unknown>> = [];
    const store: NonNullable<FindPictureDeps["store"]> = {
      readQueryCache: async () => null,
      writeQueryCache: async () => undefined,
      findPictureBySourceKey: async () => null,
      saveReferencePicture: async (input) => { saved.push(input.record as unknown as Record<string, unknown>); return { ...input.record, imageUrl: "", planUrl: "" }; },
    };
    const before = process.env.REFERENCE_PICTURE_PART_FOCUS;
    if (flag) process.env.REFERENCE_PICTURE_PART_FOCUS = flag; else delete process.env.REFERENCE_PICTURE_PART_FOCUS;
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hung = new Promise<{ status: "hung" }>((resolve) => { timer = setTimeout(() => resolve({ status: "hung" }), 5000); });
    try {
      const out = await Promise.race([hung, findReferencePicture("Explain the heart", "other", { apiKey: "k", fetchImpl, store, strokePlan: stubPlan, imageProvider: null, locateParts, locatePartsBudgetMs: 60, ...(signal ? { signal } : {}) }).catch((error: unknown) => ({ status: "threw", error }) as const)]);
      return { out, saved, ms: performance.now() - started };
    } finally {
      clearTimeout(timer);
      if (before === undefined) delete process.env.REFERENCE_PICTURE_PART_FOCUS; else process.env.REFERENCE_PICTURE_PART_FOCUS = before;
    }
  };
  const part: ReferencePicturePart = { id: "reference_picture.part.1", label: "Aorta", box: { x: 10, y: 10, width: 40, height: 12 }, source: "svg" };
  let calls = 0;
  const counting: FindPictureDeps["locateParts"] = async () => { calls++; return { parts: [part], step: "1 of 2 names" }; };

  const off = await run(undefined, counting);
  check(off.out.status === "ready" && calls === 0 && off.saved.length === 1 && !("parts" in off.saved[0]!), "with part focus off the locator never runs and the record is stored without parts");
  check(off.out.status === "ready" && !off.out.steps.some((step) => step.startsWith("parts")), "with part focus off the step trail is as before");
  const on = await run("on", counting);
  check(on.out.status === "ready" && calls === 1 && JSON.stringify(on.saved[0]?.parts) === JSON.stringify([part]) && on.out.steps.includes("parts: 1 of 2 names"), "with part focus on the located parts are stored");

  const throwing = await run("on", async () => { throw new Error("reader crashed"); });
  check(throwing.out.status === "ready" && throwing.saved.length === 1 && !("parts" in throwing.saved[0]!) && throwing.out.steps.some((step) => step.startsWith("parts: failed")), "a locator that throws costs the parts, never the picture");
  const hanging = await run("on", () => new Promise(() => undefined));
  check(hanging.out.status === "ready" && hanging.saved.length === 1 && !("parts" in hanging.saved[0]!) && hanging.out.steps.includes("parts: timed out") && hanging.ms < 2500, `a locator that hangs is cut at its budget and the picture is stored (${hanging.ms.toFixed(0)} ms)`);
  const controller = new AbortController();
  let sawSignal = true;
  const aborting = await run("on", async (input) => {
    sawSignal = "signal" in input;
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { parts: [part], step: "1 of 2 names" };
  }, controller.signal);
  check(!sawSignal && aborting.out.status === "ready" && aborting.saved.length === 1 && JSON.stringify(aborting.saved[0]?.parts) === JSON.stringify([part]), "a request aborted while parts are located still stores its picture, parts and all");

  // The backfill asks Commons for the revision's upload time and hash.
  let asked = "";
  const info = await commonsFileInfo("File:Heart.svg", { fetchImpl: async (url) => { asked = url; return Response.json({ query: { pages: [{ imageinfo: [{ url: "https://upload.wikimedia.org/h.svg", mime: "image/svg+xml", timestamp: "2026-10-29T10:00:00Z", sha1: "abc" }] }] } }); } });
  check(new URL(asked).searchParams.get("iiprop") === "url|mime|timestamp|sha1" && info?.timestamp === "2026-10-29T10:00:00Z" && info.sha1 === "abc", "the backfill's file lookup returns the current revision's upload time and hash");
}

// ---------------------------------------------------------------------------
// Store and backfill

function storeChecks(): void {
  const parts: ReferencePicturePart[] = [
    { id: "reference_picture.part.1", label: "Aorta", box: { x: 10, y: 10, width: 40, height: 12 }, source: "svg" },
    { id: "reference_picture.part.2", label: "Not a label", box: { x: 10, y: 30, width: 40, height: 12 }, source: "svg" },
  ];
  const stored = { id: "rp_0123456789abcdef01234567", source: "wikimedia" as const, title: "Heart", pageUrl: null, license: "CC0", licenseUrl: null, artist: "A", width: 100, height: 80, shows: "heart", labels: ["Aorta"], parts, plan: { width: 100, height: 80, outlineLengthPx: 1, fillLengthPx: 1 } };
  const off = servedRecord(stored, false);
  check(!("parts" in off), "with part focus off a served record has no parts key at all");
  const without: Omit<typeof stored, "parts"> & { parts?: ReferencePicturePart[] } = { ...stored };
  delete without.parts;
  check(JSON.stringify(off) === JSON.stringify(servedRecord(without, true)) && JSON.stringify(off) === JSON.stringify(servedRecord(without, false)), "with part focus off the record is byte for byte the record stored without parts");
  const on = servedRecord(stored, true);
  check(on.parts?.length === 1 && on.parts[0]!.label === "Aorta", "with part focus on, parts are served and a part whose name is not a label is dropped");
  check(!("parts" in servedRecord({ ...stored, parts: [parts[1]!] }, true)), "a record whose every part fails validation is served without the key");

  const once = recordWithParts(stored, [parts[0]!]);
  const twice = recordWithParts(once, [parts[0]!]);
  check(JSON.stringify(once) === JSON.stringify(twice), "the backfill's record update is idempotent");
  check(!("parts" in recordWithParts(stored, [])), "a backfill that locates nothing removes the key");

  const page = { title: "File:Heart.svg", index: 1, imageinfo: [{ url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Heart.svg", thumburl: "https://upload.wikimedia.org/x.png", thumbwidth: 960, thumbheight: 640, mime: "image/svg+xml", extmetadata: { LicenseShortName: { value: "CC0" } } }] };
  check(candidateFromPage(page)?.originalUrl === "https://upload.wikimedia.org/wikipedia/commons/a/ab/Heart.svg", "a Commons candidate keeps its original file URL");
}

async function main(): Promise<void> {
  await markupChecks();
  matchChecks();
  await endToEndChecks();
  await hostileChecks();
  await storePathChecks();
  storeChecks();
  if (failures) {
    console.error(`verify-reference-picture-parts: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("verify-reference-picture-parts: ok");
}

main().catch((error) => { console.error(error); process.exit(1); });
