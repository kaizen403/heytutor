/**
 * Mark & Ask correctness.
 *
 * The interesting failure of this feature is not a bad state machine — it is a
 * mark that resolves to the *wrong* line, or to only one line of a block the
 * student circled, because then the tutor confidently re-teaches something
 * they never asked about. So this gate is almost entirely about resolution:
 * which board objects each stroke encloses, and what the prompt ends up
 * quoting. Gesture classification and the ownership boundary are checked too,
 * but the row-picking assertions are the point.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VerifiedDiagram } from "@heytutor/drawing";
import type { BoardTextRect } from "../../features/tutor-session/types";
import {
  MAX_MARKS,
  buildMarkedDoubtPrompt,
  classifyMarkGesture,
  collectMarkCandidates,
  createBoardMark,
  describeMark,
  hasGroundedMark,
  markedEntityIds,
  resampleStroke,
  type BoardMark,
  type MarkPoint,
} from "../../features/tutor-session/lib/board/boardMarking";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** A board mid-lesson: five work rows on the left, a ray diagram on the right. */
const WORK_ROWS: BoardTextRect[] = [
  { x: 90, y: 124, width: 210, height: 42, text: "want v = image distance", workIndex: 1, workId: "w1" },
  { x: 90, y: 184, width: 240, height: 42, text: "1/f = 1/u + 1/v", workIndex: 2, workId: "w2" },
  { x: 90, y: 244, width: 240, height: 42, text: "1/v = 1/f - 1/u", workIndex: 3, workId: "w3" },
  { x: 90, y: 304, width: 250, height: 42, text: "1/v = 1/15 - 1/20", workIndex: 4, workId: "w4" },
  { x: 90, y: 364, width: 160, height: 42, text: "v = 60 cm", workIndex: 5, workId: "w5" },
];

const HEADING: BoardTextRect = {
  x: 90, y: 64, width: 380, height: 40, text: "Given: f = 15 cm, u = 20 cm",
};

const DIAGRAM: VerifiedDiagram = {
  id: "verified_scene",
  name: "concave mirror ray diagram",
  commands: [],
  anchors: [
    { id: "object_base", labels: ["O"], x: 620, y: 300, width: 24, height: 26 },
    { id: "focal_point", labels: ["F"], x: 780, y: 300, width: 22, height: 26 },
    { id: "image_base", labels: ["I"], x: 900, y: 300, width: 22, height: 26 },
  ],
  reveals: [],
  promptAddon: "",
  labelGlossary: {
    F: { symbol: "F", title: "Focal point", value: "15 cm" },
    O: { symbol: "O", title: "Object" },
  },
};

const CANDIDATES = collectMarkCandidates([HEADING, ...WORK_ROWS], DIAGRAM);

/** A ring drawn round a rect, sampled the way a hand draws it. */
function ringAround(
  rect: { x: number; y: number; width: number; height: number },
  pad = 10,
): MarkPoint[] {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = rect.width / 2 + pad;
  const ry = rect.height / 2 + pad;
  const points: MarkPoint[] = [];
  for (let i = 0; i <= 28; i++) {
    const angle = (i / 28) * Math.PI * 2;
    points.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry });
  }
  return points;
}

function horizontalStroke(x1: number, x2: number, y: number): MarkPoint[] {
  const points: MarkPoint[] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    points.push({ x: x1 + ((x2 - x1) * i) / steps, y: y + Math.sin(i) * 1.2 });
  }
  return points;
}

function mark(points: MarkPoint[], id = "m"): BoardMark {
  const built = createBoardMark(id, points, CANDIDATES);
  assert(built, "stroke should have produced a mark");
  return built;
}

// -- Gesture reading -------------------------------------------------------

assert(
  classifyMarkGesture(ringAround(WORK_ROWS[3])) === "circle",
  "a closed loop with area on both axes is a circle",
);
assert(
  classifyMarkGesture(horizontalStroke(88, 340, 350)) === "underline",
  "a flat wide stroke is an underline",
);
assert(
  classifyMarkGesture([{ x: 200, y: 200 }, { x: 203, y: 202 }]) === "point",
  "a tap is a point, not a gesture",
);
{
  // Back and forth over one row: a cross-out, not a ring.
  const zigzag: MarkPoint[] = [];
  for (let i = 0; i <= 24; i++) {
    zigzag.push({ x: 100 + (i % 2 === 0 ? 0 : 200), y: 320 + i * 0.6 });
  }
  assert(classifyMarkGesture(zigzag) === "scribble", "a back-and-forth pass is a scribble");
}

// -- Resolution: the assertions that matter --------------------------------

{
  const circled = mark(ringAround(WORK_ROWS[3]));
  assert(circled.gesture === "circle", "ring round a work row stays a circle");
  assert(
    circled.target.kind === "work" && circled.target.workId === "w4",
    `a ring round row 4 must resolve to w4, got ${circled.target.kind}/${circled.target.workId}`,
  );
  assert(
    circled.target.text === "1/v = 1/15 - 1/20",
    "the resolved text must be the board's own text, character for character",
  );
}

// Every row must be reachable, and each ring must take its own row -- an
// off-by-one here quotes the wrong step of the derivation back at the student.
for (const row of WORK_ROWS) {
  const resolved = mark(ringAround(row)).target;
  assert(
    resolved.kind === "work" && resolved.workId === row.workId,
    `a ring round ${row.workId} resolved to ${resolved.workId ?? resolved.kind}`,
  );
}

{
  // A rule under row 3's baseline is about row 3, not row 4 below it.
  const bottom = WORK_ROWS[2].y + WORK_ROWS[2].height;
  const underlined = mark(horizontalStroke(88, 330, bottom + 6));
  assert(
    underlined.gesture === "underline" && underlined.target.workId === "w3",
    `an underline under w3 must take w3, got ${underlined.gesture}/${underlined.target.workId}`,
  );
}

{
  // The same stroke through the row's middle means "this is wrong / confusing",
  // and must read as a strike so the prompt says so.
  const middle = WORK_ROWS[2].y + WORK_ROWS[2].height / 2;
  const struck = mark(horizontalStroke(88, 330, middle));
  assert(
    struck.gesture === "strike" && struck.target.workId === "w3",
    `a line through w3 must read as a strike on w3, got ${struck.gesture}/${struck.target.workId}`,
  );
}

{
  // Coverage, not proximity, decides. This ring's centre sits in the blank
  // margin to the right of every row, so nothing wins on nearness -- it must
  // resolve to w4 because that is the row it actually encloses.
  const offCentreRing = mark(ringAround({ x: 200, y: 300, width: 360, height: 46 }, 0));
  assert(
    offCentreRing.target.workId === "w4",
    `a ring whose centre misses every row must still take the row it covers, got ${
      offCentreRing.target.workId ?? offCentreRing.target.kind
    }`,
  );
}

{
  // The other half of the same rule: a small ring drawn round one term inside a
  // long row covers very little of it, and is rescued by sitting inside it.
  const inner = mark(ringAround({ x: 170, y: 312, width: 46, height: 26 }, 4));
  assert(
    inner.target.workId === "w4",
    `a small ring inside w4 must take w4, got ${inner.target.workId ?? inner.target.kind}`,
  );
  assert(
    inner.targets.length === 1,
    `a small ring inside one row must not pick up neighbours, got ${inner.targets.length} targets`,
  );
}

{
  // A ring drawn round the whole working is about every line it encloses, not
  // the one nearest the centre. Picking only the middle row is the failure
  // students hit: they circle the derivation and the chip quotes one sentence.
  const block = {
    x: 70,
    y: HEADING.y - 12,
    width: 430,
    height: WORK_ROWS[4].y + WORK_ROWS[4].height - (HEADING.y - 12) + 12,
  };
  const circled = mark(ringAround(block, 18));
  assert(circled.gesture === "circle", "a large oval around the working is a circle");
  const texts = circled.targets.map((target) => target.text);
  const expected = [HEADING, ...WORK_ROWS].map((row) => row.text ?? "");
  for (const line of expected) {
    assert(
      texts.includes(line),
      `a ring round the whole working must keep "${line}"; got ${JSON.stringify(texts)}`,
    );
  }
  assert(
    circled.targets.length === expected.length,
    `expected ${expected.length} enclosed lines, got ${circled.targets.length}: ${JSON.stringify(texts)}`,
  );
  assert(
    texts[0] === HEADING.text,
    "enclosed lines must be quoted top-to-bottom, the way they sit on the board",
  );
  const prompt = buildMarkedDoubtPrompt([circled], "", "mirror question");
  for (const line of expected) {
    assert(
      prompt.includes(`"${line}"`),
      `the doubt prompt must quote enclosed line "${line}"`,
    );
  }
}

{
  // Two neighbouring rows, and only those two — the row above the pair and
  // the row below it stay out.
  const pairBox = {
    x: 80,
    y: WORK_ROWS[1].y - 6,
    width: 280,
    height: WORK_ROWS[2].y + WORK_ROWS[2].height - (WORK_ROWS[1].y - 6) + 6,
  };
  const pair = mark(ringAround(pairBox, 8));
  const ids = pair.targets.map((target) => target.workId).sort();
  assert(
    ids.length === 2 && ids[0] === "w2" && ids[1] === "w3",
    `a ring round two rows must keep both, got ${JSON.stringify(ids)}`,
  );
}

{
  // The live failure: a hand-drawn oval around a block whose middle row is
  // taller (a boxed sentence). Winner-take-all used to quote only that row
  // because its centre sat nearest the ring's centre.
  const projectile: BoardTextRect[] = [
    { x: 88, y: 72, width: 260, height: 40, text: "Given: v0 = 20 m/s" },
    { x: 88, y: 128, width: 430, height: 40, text: "v0 = 20 m/s, θ = 30°, g = 9.8 m/s²" },
    {
      x: 80,
      y: 184,
      width: 470,
      height: 56,
      text: "projectile motion: split into x and y",
      workId: "w_mid",
    },
    { x: 88, y: 256, width: 400, height: 40, text: "v0x = v0 cos θ, v0y = v0 sin θ" },
    { x: 88, y: 312, width: 390, height: 40, text: "v0x = 20 × 0.866 = 17.32 m/s" },
  ];
  const projectileCandidates = collectMarkCandidates(projectile, null);
  const oval = ringAround(
    {
      x: 60,
      y: 50,
      width: 520,
      height: 330,
    },
    16,
  );
  const built = createBoardMark("projectile", oval, projectileCandidates);
  assert(built, "the projectile oval should have produced a mark");
  const texts = built.targets.map((target) => target.text);
  for (const row of projectile) {
    assert(
      texts.includes(row.text ?? ""),
      `the oval must keep "${row.text}"; got ${JSON.stringify(texts)}`,
    );
  }
  assert(
    texts.length === projectile.length,
    `expected every projectile line, got ${texts.length}: ${JSON.stringify(texts)}`,
  );

  // A slightly open oval (the hand did not quite meet) must still keep the
  // block — enclosure is what the ring contains, not a perfect close.
  const open = oval.slice(0, oval.length - 5);
  open.push({ x: oval[0]!.x + 55, y: oval[0]!.y + 30 });
  const openMark = createBoardMark("projectile-open", open, projectileCandidates);
  assert(openMark, "an open oval should still produce a mark");
  assert(
    openMark.targets.length === projectile.length,
    `an open oval round the working must keep every line, got ${openMark.targets.length}`,
  );
}

{
  // An underline belongs to the row above it, not the row below.
  const between = mark(horizontalStroke(95, 320, WORK_ROWS[2].y + WORK_ROWS[2].height + 6));
  assert(
    between.target.workId === "w3",
    `a rule in the gap must take the row above it, got ${between.target.workId ?? between.target.kind}`,
  );
}

{
  // ...and its reach is short. A rule well below the last row is under nothing.
  const stranded = mark(
    horizontalStroke(95, 320, WORK_ROWS[4].y + WORK_ROWS[4].height + 100),
  );
  assert(
    stranded.target.kind === "region",
    `a rule far below every row must stay a region, got ${
      stranded.target.workId ?? stranded.target.kind
    }`,
  );
}

{
  const heading = mark(ringAround(HEADING));
  assert(
    heading.target.kind === "board_text" && heading.target.text.startsWith("Given:"),
    "board text without a work id is still exact, just not a numbered row",
  );
}

{
  const figure = mark(ringAround(DIAGRAM.anchors[1], 14));
  assert(
    figure.target.kind === "diagram" && figure.target.entityId === "focal_point",
    `a ring round F must resolve to its entity, got ${figure.target.kind}/${figure.target.entityId}`,
  );
  assert(figure.target.text === "F", "the figure target carries the symbol as drawn");
  assert(
    figure.target.meaning === "Focal point, 15 cm",
    `the glossary meaning must ride along, got ${String(figure.target.meaning)}`,
  );
  assert(
    markedEntityIds([figure]).includes("focal_point"),
    "a marked figure part must expose its entity id so the re-teach can trace it again",
  );
}

// -- Honesty: a mark on nothing invents nothing ----------------------------

{
  const empty = mark(ringAround({ x: 470, y: 560, width: 90, height: 40 }));
  assert(
    empty.target.kind === "region",
    `a ring round blank board must stay a region, got ${empty.target.kind}`,
  );
  assert(!hasGroundedMark([empty]), "a region-only mark is not grounded");
  const description = describeMark(empty);
  for (const row of [...WORK_ROWS, HEADING]) {
    assert(
      !description.includes(row.text ?? " "),
      "a mark on blank board must never quote a line it did not touch",
    );
  }
  const prompt = buildMarkedDoubtPrompt([empty], "", "mirror question");
  assert(
    prompt.includes("nothing written is under that mark"),
    "the prompt must say the mark landed on nothing rather than guess a line",
  );
  assert(
    prompt.includes("ask what it is about before assuming"),
    "an ungrounded, untyped doubt must ask rather than pick a step",
  );
}

{
  // A stroke far from everything must not be dragged onto the nearest row by
  // proximity alone.
  const far = mark(horizontalStroke(700, 900, 660));
  assert(
    far.target.kind === "region",
    `a rule across empty board must stay a region, got ${far.target.kind}`,
  );
}

{
  // A region may only ever say *where* it is. Naming what a region "is" is the
  // one way this feature could invent content, so the vocabulary is closed:
  // three place names, and nothing a board line could ever match.
  const REGION_NAMES = new Set(["the figure area", "the work column", "the board"]);
  const blankSpots = [
    { x: 150, y: 560, width: 80, height: 36 },   // below the work column
    { x: 700, y: 200, width: 80, height: 36 },   // inside the figure zone
    { x: 1050, y: 620, width: 80, height: 36 },  // bottom-right of the board
  ];
  for (const spot of blankSpots) {
    const stray = mark(ringAround(spot));
    assert(stray.target.kind === "region", `blank board at ${spot.x},${spot.y} must be a region`);
    assert(
      REGION_NAMES.has(stray.target.text),
      `a region may only name a place, got "${stray.target.text}"`,
    );
  }
}

// -- The prompt the turn actually runs -------------------------------------

{
  const marks = [mark(ringAround(WORK_ROWS[3]), "a"), mark(ringAround(DIAGRAM.anchors[1], 14), "b")];
  const typed = buildMarkedDoubtPrompt(
    marks,
    "why does the sign flip?",
    "Concave mirror, f = 15 cm, object at 20 cm.",
  );
  assert(typed.includes('"1/v = 1/15 - 1/20"'), "the prompt quotes the exact marked line");
  assert(typed.includes("entity focal_point"), "the prompt names the marked figure entity");
  assert(typed.includes("Focal point, 15 cm"), "the prompt carries what the symbol means");
  assert(typed.includes("why does the sign flip?"), "the typed doubt survives verbatim");
  assert(
    typed.includes("Concave mirror, f = 15 cm"),
    "the lesson question rides along as context, or a doubt like 'why' plans nothing",
  );
  assert(
    typed.includes("do not re-teach the whole lesson"),
    "a marked doubt is a re-teach of one part, not the lesson again",
  );

  // The commonest doubt is the one the student cannot word.
  const untyped = buildMarkedDoubtPrompt(marks, "", "Concave mirror, f = 15 cm, object at 20 cm.");
  assert(
    untyped.includes('"1/v = 1/15 - 1/20"'),
    "an untyped marked doubt still names what it is about",
  );
  assert(
    untyped.includes("in a different and simpler way"),
    "an untyped marked doubt must ask for a different explanation, not a replay",
  );
  assert(
    !untyped.includes("my doubt:"),
    "an empty typed doubt must not produce an empty 'my doubt:' line",
  );
  assert(hasGroundedMark(marks), "marks landing on real content are grounded");
}

// -- Stroke handling -------------------------------------------------------

{
  const dense: MarkPoint[] = [];
  for (let i = 0; i < 4000; i++) {
    dense.push({ x: 100 + i * 0.05, y: 300 + Math.sin(i / 50) * 4 });
  }
  const resampled = resampleStroke(dense);
  assert(resampled.length <= 240, `a flick must be thinned, got ${resampled.length} points`);
  assert(
    resampled[0].x === dense[0].x &&
      resampled[resampled.length - 1].x === dense[dense.length - 1].x,
    "resampling must keep both ends -- they decide where the stroke starts and stops",
  );
}

assert(MAX_MARKS >= 3 && MAX_MARKS <= 10, "the mark budget stays a question, not a drawing");

// -- The ownership boundary ------------------------------------------------
//
// Student ink is not board content. It is drawn on its own DOM canvas, so it
// cannot reach a Konva layer, a snapshot, the notes PDF, the MP4 export, or a
// persisted turn -- all of which read the whiteboard handle. These assertions
// are what keep that structural, rather than a thing someone remembers.

const root = resolve(process.cwd(), "features/tutor-session");
const layer = readFileSync(resolve(root, "components/BoardMarkingLayer.tsx"), "utf8");
const hook = readFileSync(resolve(root, "hooks/useBoardMarking.ts"), "utf8");

for (const [name, source] of [
  ["BoardMarkingLayer", layer],
  ["useBoardMarking", hook],
] as const) {
  assert(
    !source.includes("whiteboardRef") && !source.includes("WhiteboardHandle"),
    `${name} must not touch the whiteboard handle -- student ink never becomes board content`,
  );
  assert(
    !source.includes("executeCommand") && !source.includes("DrawCommand"),
    `${name} must not emit draw commands -- marking is student input, not a teaching stream`,
  );
}
assert(
  layer.includes('getContext("2d")'),
  "the marker must render on its own 2D canvas, not on a Konva layer",
);
assert(
  layer.includes("markTargets"),
  "the halo must light up every enclosed line, not only the first",
);

const bar = readFileSync(resolve(root, "components/MarkedDoubtBar.tsx"), "utf8");
assert(
  bar.includes("markTargets") && bar.includes("flatMap"),
  "the chip row must list every enclosed line, not collapse a block to one pill",
);

const canvas = readFileSync(resolve(root, "components/SessionBoardCanvas.tsx"), "utf8");
const CAN_RETRACE_ANCHOR = "const canRetrace =";
const canRetraceAt = canvas.indexOf(CAN_RETRACE_ANCHOR);
assert(
  canRetraceAt >= 0,
  `this gate reads SessionBoardCanvas.tsx by slicing from "${CAN_RETRACE_ANCHOR}", which is gone — repoint it at whatever now decides retrace`,
);
// The END anchor needs guarding too, not just the start. `indexOf` returning
// -1 here would make `slice` run to the second-to-last character of the file,
// and the regex below could then match an unrelated `!markingArmed` elsewhere
// and pass while the real guard was gone — a false pass, which is worse than a
// misleading failure.
const canRetraceEnd = canvas.indexOf(";", canRetraceAt);
assert(
  canRetraceEnd > canRetraceAt,
  `the canRetrace declaration starting at ${canRetraceAt} has no terminating ";" — repoint this gate at whatever now decides retrace`,
);
// Match the ingredients, not one exact spelling: reformatting the expression
// must not read as the guard having been deleted.
const canRetraceExpr = canvas.slice(canRetraceAt, canRetraceEnd);
assert(
  /!\s*markingArmed/.test(canRetraceExpr),
  "an armed marker must suppress retrace, or one stroke also fires a diagram trace",
);

const turnControl = readFileSync(resolve(root, "hooks/turn/useTurnControl.ts"), "utf8");
// Check the anchor before slicing from it. `indexOf` returns -1 when the
// declaration is renamed, `slice(-1)` then hands back the file's last
// character, and every assertion below fails describing an invariant that is
// working perfectly. A stale anchor must report itself as a stale anchor.
const ASK_DOUBT_ANCHOR = "const handleAskDoubt";
const askDoubtAt = turnControl.indexOf(ASK_DOUBT_ANCHOR);
assert(
  askDoubtAt >= 0,
  `this gate reads useTurnControl.ts by slicing from "${ASK_DOUBT_ANCHOR}", which is gone — repoint it at whatever now owns the doubt handler, do not relax the assertions below`,
);
const askDoubt = turnControl.slice(askDoubtAt);
assert(
  askDoubt.includes("options?.prompt"),
  "a pre-composed, board-grounded doubt must reach the turn without being wrapped twice",
);

const shell = readFileSync(resolve(root, "TutorSessionShell.tsx"), "utf8");
assert(
  shell.includes("buildMarkedDoubtPrompt"),
  "the shell must compose the marked doubt from the resolved marks",
);
assert(
  shell.includes("onArm: quietTutorForMarking"),
  "picking up the marker must quiet the tutor -- a doubt is composed in silence",
);

console.log("board marking verification passed");
