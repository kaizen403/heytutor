/**
 * Reference picture part locator gate. Free and offline: SVGs are written
 * here and rasterised with sharp (librsvg, the renderer Commons uses), so the
 * truth for every located box is where the renderer actually put that text.
 *
 * Covers the SVG reader (markup, transforms, units, viewBox mapping, switch,
 * hidden and left out text), the matcher (whole lines, words in a line,
 * wrapped names, duplicates, longer names, marks and printed key rows), the
 * ink check, the locator's failure paths (budget, fetch failure, abort), the
 * store's flag (off: no `parts` at all), and the backfill's idempotence.
 */
import sharp from "sharp";
import { parseReferencePictureParts, type PicturePlacement, type ReferencePicturePart } from "@heytutor/drawing";
import { parseSvg, parseTransform, readSvgText, rootToPlan, SVG_MAX_BYTES } from "../../lib/reference-picture/partLocatorSvg";
import { joinLines, matchLabels, matchMarks, partsFrom, wordKey, type TextLine } from "../../lib/reference-picture/partLocatorMatch";
import { boxOnInk, decodeInkMask, locateReferencePictureParts, recordWithParts, type LocatePartsInput } from "../../lib/reference-picture/partLocator";
import { buildStrokePlan } from "../../lib/reference-picture/strokePlan";
import { candidateFromPage } from "../../lib/reference-picture/wikimediaSearch";
import { servedRecord } from "../../lib/reference-picture/pictureStore";

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
  check(inLine.located[0] && near(inLine.located[0].box.width, 40), "a name that is the first words of a longer line boxes only those words");
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

  const parts = partsFrom([{ label: "Septum", box: { x: -4, y: 10.2, width: 30, height: 10 }, source: "svg" }, { label: "Aorta", box: { x: 5, y: 5, width: 10, height: 10 }, source: "svg" }, { label: "Apex", box: { x: 790, y: 5, width: 40, height: 10 }, source: "svg" }], ["Aorta", "Septum", "Apex"], { width: 800, height: 400 });
  check(parts.map((p) => p.label).join(",") === "Aorta,Septum", "parts follow the record's order; a box mostly off the picture is dropped");
  check(parts[0]?.id === "reference_picture.part.1" && parts[1]?.id === "reference_picture.part.2", "ids follow the kept order");
  check(parts[1] && parts[1].box.x === 0 && parts[1].box.y === 10 && parts[1].box.width === 26 && parts[1].box.height === 11, "boxes clamp to the picture and round outward");
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
  check(nResult.parts.map((p) => `${p.mark}:${p.label}`).join(",") === "1:Aorta,2:Left atrium", `a numbered picture locates marks 1 and 2; 3 is also read in "Phase 3"; 4 is not printed (${nResult.step})`);
  check(nResult.parts[0] && near(nResult.parts[0].box.x, 100 * nBuilt.plan.width / 800, 3), "mark 1 is the one on the drawing, not the one in the printed key row");

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
  const controller = new AbortController();
  const pending = locateReferencePictureParts(input({ fetchImpl: hanging, signal: controller.signal }));
  controller.abort();
  check(await pending.then(() => false, () => true), "the caller's abort is thrown, not swallowed");

  // The ink check on its own: paper is not text.
  const ink = await decodeInkMask(plan.inkMask, plan.width, plan.height);
  const aorta = located.get("Aorta");
  check(ink && aorta && boxOnInk(aorta.box, ink, plan.width, plan.height), "a printed word's box is on ink");
  check(ink && !boxOnInk({ x: plan.width - 60, y: plan.height / 2 - 10, width: 50, height: 20 }, ink, plan.width, plan.height), "a box on blank paper is not");
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
  storeChecks();
  if (failures) {
    console.error(`verify-reference-picture-parts: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("verify-reference-picture-parts: ok");
}

main().catch((error) => { console.error(error); process.exit(1); });
