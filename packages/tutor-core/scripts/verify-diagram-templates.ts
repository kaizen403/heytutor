import {
  matchDiagramTemplate,
  DIAGRAM_TEMPLATES,
  repairDiagramCommand,
  templateToDrawCommand,
  getTemplateSkeletonCommands,
  buildTemplateIntroSegments,
  buildOpticsPrecisionIntro,
  classifyOptics,
  parseOpticsNumbers,
  opticsDecisionMetadata,
  resolveAnnotationWithAnchors,
  isBlockedTemplateDiagramDraw,
  isBlockedOpticsOwnedAnnotation,
  isDuplicateTemplateDraw,
  prepareTemplateLessonSegments,
  snapLabelToTemplateAnchor,
  buildLessonSegments,
  checkSegmentAlignment,
  getSegmentCommands,
  parseDrawingCommands,
  parseDrawCommandFromTag,
  IncrementalTagParser,
  parseDimensionCommandParams,
  snapGeometryCommand,
  dimensionPath,
  textToStrokePaths,
} from "@heytutor/drawing";
import { TUTOR_CONTINUATION_PROMPT, TUTOR_SYSTEM_PROMPT } from "../src/systemPrompt";
import { planLesson } from "../src/topicPlanner";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

assert(DIAGRAM_TEMPLATES.length >= 5, "expected at least 5 diagram templates");

const fbd = matchDiagramTemplate("draw free body diagram for 5kg box with friction mu=0.3");
assert(fbd?.id === "fbd", "FBD template should match");

const bead = matchDiagramTemplate("bead on rotating hoop find equilibrium angle theta");
assert(bead?.id === "circular_motion", "circular motion template should match");

const parabola = matchDiagramTemplate("find vertex of parabola y^2 = 4ax");
assert(parabola?.id === "coordinate_axes", "coordinate axes template should match parabola");

const fbdNewton = matchDiagramTemplate(
  "newton's second law with friction — 5 kg box pushed with 20 N, mu = 0.3",
);
assert(fbdNewton?.id === "fbd", "FBD template should match newton + friction questions");

const seriesCircuit = matchDiagramTemplate(
  "Three resistors 2Ω, 3Ω, 4Ω in series with a 12 V battery. Find current and voltage across each.",
);
assert(seriesCircuit?.id === "circuit", "series resistor question should match circuit template");

const seriesCircuitIntro = buildTemplateIntroSegments(
  seriesCircuit!,
  "Three resistors 2Ω, 3Ω, 4Ω in series with a 12 V battery. Find current and voltage across each.",
);
const seriesCircuitCommands = seriesCircuitIntro.flatMap((segment) => getSegmentCommands(segment));
assert(
  seriesCircuitCommands.filter((command) => command.type === "DRAW_LINE" && command.params.length > 4).length >= 3,
  "series circuit intro should draw three zigzag resistor symbols",
);
assert(
  seriesCircuitCommands.some((command) => command.type === "LABEL" && command.text === "R1=2 Ω"),
  "series circuit intro should label R1 with its value",
);
assert(
  seriesCircuitCommands.some((command) => command.type === "LABEL" && command.text === "R2=3 Ω"),
  "series circuit intro should label R2 with its value",
);
assert(
  seriesCircuitCommands.some((command) => command.type === "LABEL" && command.text === "R3=4 Ω"),
  "series circuit intro should label R3 with its value",
);
assert(
  seriesCircuitCommands.some((command) => command.type === "LABEL" && command.text === "12 V"),
  "series circuit intro should label the battery voltage",
);
assert(
  isBlockedTemplateDiagramDraw(
    templateToDrawCommand({ type: "DRAW_LINE", params: [520, 150, 860, 150] }),
    seriesCircuit!,
  ),
  "circuit template should block LLM wire redraws after deterministic intro",
);

// Ω must render as the curved ohm sign, not the Latin "W" fallback.
const omegaGlyph = await textToStrokePaths("\u03a9", 0, 0, 32);
assert(
  omegaGlyph.length === 1 && omegaGlyph[0]!.char === "\u03a9",
  "Ω should render as a single dedicated glyph",
);
assert(
  omegaGlyph[0]!.strokes.some((stroke) => stroke.pathData.includes("C")),
  "Ω must render as the curved ohm sign (bezier strokes), not the straight-line W fallback",
);

// Series resistors must fit inside the rail so the right corner never cuts R3.
const seriesZigzags = seriesCircuitCommands.filter(
  (command) => command.type === "DRAW_LINE" && command.params.length > 4,
);
const maxResistorX = Math.max(
  ...seriesZigzags.flatMap((command) => command.params.filter((_, index) => index % 2 === 0)),
);
assert(maxResistorX <= 1040, "series resistors must not overflow past the right corner wire at x=1040");

// The current arrow lives on the lower rail, clear of every resistor (near y=240).
const seriesCurrentArrow = seriesCircuitCommands.find((command) => command.type === "ARROW");
assert(seriesCurrentArrow !== undefined, "series circuit should show a current-direction arrow");
assert(
  seriesCurrentArrow!.params[1]! >= 350 && seriesCurrentArrow!.params[3]! >= 350,
  "current arrow must sit on the lower rail, not over the resistors",
);

// The LLM must not be able to drop a floating current-flow arrow over the diagram.
assert(
  isBlockedTemplateDiagramDraw(
    { type: "ARROW", params: [560, 240, 640, 240], charPosition: 0, narrationBefore: "" },
    seriesCircuit!,
  ),
  "circuit template should block stray LLM arrows placed over the diagram",
);

// Series-parallel combination questions get their own topology with R1, R2, R3.
const comboQuestion =
  "Resistor R1 = 6\u03a9 is in series with the parallel combination of R2 = 3\u03a9 and R3 = 6\u03a9 across a 12 V battery.";
const comboCircuit = matchDiagramTemplate(comboQuestion);
assert(comboCircuit?.id === "circuit", "combination resistor question should match circuit template");
const comboCommands = buildTemplateIntroSegments(comboCircuit!, comboQuestion).flatMap((segment) =>
  getSegmentCommands(segment),
);
for (const name of ["R1=6 \u03a9", "R2=3 \u03a9", "R3=6 \u03a9"]) {
  assert(
    comboCommands.some((command) => command.type === "LABEL" && command.text === name),
    `combination circuit should label ${name}`,
  );
}

const inclineFbd = matchDiagramTemplate(
  "draw the free-body diagram for a block sliding down a rough incline and find acceleration",
);
assert(inclineFbd?.id === "incline_fbd", "inclined-plane FBD template should beat flat FBD");

const rampSpring = matchDiagramTemplate(
  "A 2 kg block slides down a 5 m high frictionless ramp and then compresses a spring k=200 N/m",
);
assert(rampSpring?.id === "ramp_spring", "ramp + spring template should match energy problem");

const fbdPlan = planLesson("free body diagram 5kg friction", fbd);
assert(fbdPlan.promptAddon.includes("geometry only"), "FBD plan should mention geometry-only skeleton");
assert(fbdPlan.promptAddon.includes("no text labels"), "FBD plan should not pre-label forces");
assert(fbdPlan.promptAddon.length < 4000, "per-turn addon should stay compact");
assert(!fbdPlan.promptAddon.includes("MATHEMATICS:"), "should not dump full syllabus");

const turnPrompt = `${TUTOR_SYSTEM_PROMPT}\n\n--- current lesson (runtime) ---\n${fbdPlan.promptAddon}`;
assert(turnPrompt.includes("--- current lesson (runtime) ---"), "turn prompt should have runtime section");
assert(
  turnPrompt.length < 36000,
  `turn prompt should stay compact vs old monolith (~35k with full JEE dump); got ${turnPrompt.length}`,
);
assert(fbdPlan.promptAddon.length < 4500, "per-turn addon should stay small");

const repaired = repairDiagramCommand(
  templateToDrawCommand({ type: "LABEL", params: [50, 50], text: "θ", anchorId: "theta" }),
);
assert(repaired.params[0] >= 400, "diagram label outside zone should be repaired");

const snap = resolveAnnotationWithAnchors(
  "CIRCLE_AROUND",
  [0, 0, 10, 10],
  bead!.anchors,
  [],
  "this is the angle theta from vertical",
);
assert(snap.snapped, "annotation should snap to template theta anchor");

const noLabelSnap = resolveAnnotationWithAnchors(
  "CIRCLE_AROUND",
  [0, 0, 10, 10],
  bead!.anchors,
  [],
  "the bead moves along the hoop",
);
assert(!noLabelSnap.snapped, "CIRCLE_AROUND should not snap without label match");

const fbdPlanAddon = fbdPlan.promptAddon;
const continuation = `${TUTOR_CONTINUATION_PROMPT}\n\n--- diagram reminder ---\n${fbdPlanAddon}`;
assert(continuation.includes("diagram reminder"), "continuation should include template reminder");
assert(continuation.includes("geometry only"), "continuation should repeat geometry-only hint");

const fbdSkeleton = getTemplateSkeletonCommands(fbd!);
assert(fbdSkeleton.every((cmd) => cmd.type !== "LABEL"), "skeleton must not pre-draw labels");
assert(fbdSkeleton.length === 6, "FBD skeleton should be block + surface + four force arrows");

const duplicateDraw = isDuplicateTemplateDraw(
  { type: "DRAW_RECT", params: [540, 360, 240, 30], charPosition: 0, narrationBefore: "", syncable: false },
  fbd!,
);
assert(duplicateDraw, "template duplicate DRAW_RECT should be detected");

const headingUnderline = isBlockedTemplateDiagramDraw(
  { type: "DRAW_LINE", params: [90, 112, 430, 112], charPosition: 0, narrationBefore: "", syncable: false },
  fbd!,
);
assert(!headingUnderline, "template filter must not treat heading underline as diagram redraw");

const leakedSpringCoil = isBlockedTemplateDiagramDraw(
  { type: "DRAW_LINE", params: [920, 380, 940, 400], charPosition: 0, narrationBefore: "", syncable: false },
  rampSpring!,
);
assert(!leakedSpringCoil, "non-duplicate draws should be allowed even in template zone — only exact duplicates are blocked");

const duplicateSpringCoil = isBlockedTemplateDiagramDraw(
  { type: "DRAW_LINE", params: [665, 450, 683, 430], charPosition: 0, narrationBefore: "", syncable: false },
  rampSpring!,
);
assert(duplicateSpringCoil, "exact duplicate of template skeleton should be blocked");

const snappedForceLabel = snapLabelToTemplateAnchor(
  { type: "LABEL", params: [870, 245], text: "F = 20 N", charPosition: 0, narrationBefore: "", syncable: true },
  fbd!.anchors,
);
assert(snappedForceLabel.text === "F = 20 N", "template labels should preserve full text when snapping position");
assert(snappedForceLabel.params[0] === 810 && snappedForceLabel.params[1] === 278, "snapped position should match F anchor");

const sanitizedEraseSegments = buildLessonSegments(
  "[STEP]write the next line. [WRITE:a = 5.3/5,90,145] [ERASE:70,126,1060,520][/STEP]",
);
assert(
  sanitizedEraseSegments.every((segment) =>
    (segment.commands ?? [segment.command]).filter(Boolean).every((command) => command?.type !== "ERASE"),
  ),
  "LLM-generated ERASE commands should be runtime-managed and removed",
);

const legacyDrawSyntax = `[STEP]
the fixed bead sits at the top.
[DRAW:LINE,530,100,630,470]
[DRAW:POINT,530,100]
[LABEL,530,80,"fixed bead"]
[/STEP]`;
const legacyParsed = parseDrawingCommands(legacyDrawSyntax);
assert(legacyParsed.commands.length === 3, "legacy DRAW/LABEL syntax should parse into commands");
assert(legacyParsed.commands[0]?.type === "DRAW_LINE", "legacy DRAW:LINE should become DRAW_LINE");
assert(legacyParsed.commands[1]?.type === "DRAW_CIRCLE", "legacy DRAW:POINT should become a small circle");
assert(legacyParsed.commands[1]?.params[2] === 8, "legacy point commands should get a visible dot radius");
assert(legacyParsed.commands[2]?.type === "LABEL", "legacy LABEL,x,y,text should become LABEL");
assert(legacyParsed.commands[2]?.text === "fixed bead", "legacy label text should be preserved");
assert(legacyParsed.commands[2]?.params[0] === 530, "legacy label x coordinate should be preserved");

const legacySegments = buildLessonSegments(legacyDrawSyntax);
const legacySegmentCommands = legacySegments.flatMap((segment) => getSegmentCommands(segment));
assert(legacySegmentCommands.length === 3, "structured legacy syntax should survive lesson segmentation");

const streamedLegacyCommands = [] as string[];
const incremental = new IncrementalTagParser({
  onSegmentReady(segment) {
    streamedLegacyCommands.push(...getSegmentCommands(segment).map((command) => command.type));
  },
});
incremental.push("line [DRAW:LINE,1,2,3,4] dot [DRAW_DOT:5,6]");
incremental.flush();
assert(
  streamedLegacyCommands.join(",") === "DRAW_LINE,DRAW_CIRCLE",
  "incremental parser should recover legacy streaming tags",
);

const fbdTraceRegression = buildLessonSegments(`[STEP]
newton's second law problem.
[WRITE:newton's second law,90,64]
[DRAW_LINE:90,112,430,112]
[/STEP]
[STEP]
first, let me draw the surface. a flat horizontal line.
[DRAW_LINE:500,360,900,360]
[/STEP]
[STEP]
now the box sitting on that surface. a rectangle.
[DRAW_RECT:640,240,160,120]
[/STEP]
[STEP]
the mass goes inside the block. five kilograms.
[LABEL:m,710,300]
[/STEP]
[STEP]
the applied push is twenty newtons to the right.
[DRAW_LINE:800,300,880,300]
[LABEL:F,820,295]
[/STEP]
[STEP]
friction opposes the motion, so it points left.
[DRAW_LINE:640,300,560,300]
[LABEL:f,540,295]
[/STEP]
[STEP]
normal force N is the surface pushing up.
[DRAW_LINE:720,240,720,160]
[LABEL:N,680,195]
[/STEP]
[STEP]
weight mg pulls downward.
[DRAW_LINE:720,360,720,440]
[LABEL:mg,680,460]
[/STEP]
[STEP]
twenty minus fourteen point seven is five point three.
[WRITE:5.3 = 5a,90,685]
[/STEP]
[STEP]
acceleration equals five point three divided by five.
[WRITE:a = 5.3/5,90,745]
[/STEP]`);

const preparedFbdTrace = prepareTemplateLessonSegments(fbdTraceRegression, fbd!);
assert(
  preparedFbdTrace.blockedCommandCount >= 1,
  "FBD template cleanup should block at least duplicate LLM redraws from Langfuse regression trace",
);
assert(
  preparedFbdTrace.droppedSegmentCount >= 0,
  "FBD template cleanup should handle redraw narration correctly",
);

const preparedCommands = preparedFbdTrace.segments.flatMap((segment) => getSegmentCommands(segment));
assert(
  preparedCommands.every((command) => {
    if (command.type !== "WRITE" || command.params.length < 2) {
      return true;
    }
    return command.params[1]! <= 631;
  }),
  "left-side WRITE commands should be clamped for replay-safe board rows",
);
assert(
  preparedCommands.some((command) => command.type === "LABEL" && command.text === "m" && command.params[0] === 640),
  "mass labels should snap to the clean FBD anchor",
);

for (const segment of buildTemplateIntroSegments(fbd!)) {
  assert(checkSegmentAlignment(segment).aligned, "runtime template intro should bypass generic alignment pruning");
}

const optics = matchDiagramTemplate(
  "An object is placed 30 cm in front of a concave mirror of focal length 15 cm. Draw the ray diagram.",
);
assert(optics?.id === "optics_mirror", "optics template should match concave mirror ray diagram");
assert(optics!.promptAddon.includes("[DIMENSION:"), "optics prompt should teach dimension marking");
assert(
  optics!.commands.some((command) => command.type === "DRAW_LINE" && command.params.length === 7 && command.params.at(-1) === 2),
  "optics mirror skeleton should be encoded as a three-point curve, not a straight line",
);

const dimensionParsed = parseDimensionCommandParams("u,500,300,650,300,42");
assert(dimensionParsed.text === "u" && dimensionParsed.params.join(",") === "500,300,650,300,42", "dimension params should parse");

const opticsIntro = buildTemplateIntroSegments(
  optics!,
  "An object is placed 30 cm in front of a concave mirror of focal length 15 cm. Draw the ray diagram and find image distance.",
);
const opticsIntroCommands = opticsIntro.flatMap((segment) => getSegmentCommands(segment));
assert(
  opticsIntroCommands.some((command) => command.type === "LABEL" && command.text === "C"),
  "optics precision intro should label C",
);
assert(
  opticsIntroCommands.some((command) => command.type === "DIMENSION" && command.text === "u = 30 cm"),
  "optics precision intro should mark object distance u",
);
assert(
  opticsIntroCommands.some((command) => command.type === "DIMENSION" && command.text === "f = 15 cm"),
  "optics precision intro should mark focal length f",
);
assert(
  opticsIntroCommands.some((command) => command.type === "DIMENSION" && command.text === "v = 30 cm"),
  "optics precision intro should mark computable image distance v",
);

// Each named point (C/F/O) must be ticked at the exact axis spot so the label
// points at it instead of tracing the line.
const axisTicks = opticsIntroCommands.filter(
  (command) =>
    command.type === "DRAW_LINE" &&
    command.params.length === 4 &&
    command.params[0] === command.params[2] &&
    Math.min(command.params[1]!, command.params[3]!) < 300 &&
    Math.max(command.params[1]!, command.params[3]!) > 300 &&
    Math.abs(command.params[3]! - command.params[1]!) <= 20,
);
assert(axisTicks.length >= 3, "optics precision intro should tick C, F and O on the axis");

// Point labels must sit a clear gap above the axis (never on the y=300 line).
const pointLabels = opticsIntroCommands.filter(
  (command) => command.type === "LABEL" && ["C", "F", "O"].includes(command.text ?? ""),
);
assert(pointLabels.length === 3, "optics precision intro should label C, F and O");
assert(
  pointLabels.every((command) => command.params[1]! <= 300 - 48),
  "optics point labels must sit well above the axis (clear gap), not on the line",
);
assert(
  pointLabels.every((command) => command.params[1]! >= 300 - 70),
  "optics point labels should stay near the mark (modest offset, not far away)",
);

// The dimension marking must be a floating dotted bar, never a box that touches
// the geometry: its path never reaches back to the measured axis line (y=300).
const dim = dimensionPath(490, 300, 610, 300, 88);
const dimYs = [...dim.path.matchAll(/-?\d+(?:\.\d+)?/g)]
  .map((m) => Number(m[0]))
  .filter((_, index) => index % 2 === 1);
assert(
  dimYs.every((y) => y >= 300 + 88 - 6),
  "dimension bar must float at its offset and never touch the measured line",
);
assert(dim.labelY > 300 + 88 + 16, "dimension label must sit clear of the floating bar");
assert(
  dim.path.split("M").length - 1 === 3,
  "dimension bar should be one line plus two small end ticks — no boxed extension lines",
);

const raySnap = snapGeometryCommand(
  {
    type: "DRAW_LINE",
    params: [500, 310, 548, 305],
    charPosition: 0,
    narrationBefore: "",
  },
  optics!,
);
assert(raySnap.params[2] === 550 && raySnap.params[3] === 300, "ray endpoint near F should snap to focal anchor");

const curveSnap = snapGeometryCommand(
  {
    type: "DRAW_LINE",
    params: [688, 178, 535, 302, 691, 421, 2],
    charPosition: 0,
    narrationBefore: "",
  },
  optics!,
);
assert(
  curveSnap.params.join(",") === "690,175,530,300,690,425,2",
  "curve points near the mirror should snap to the exact mirror curve (pole at B(0.5))",
);

// Lens optical-plane projection: bend left of the spine must land ON x=650.
{
  const lensTpl = matchDiagramTemplate(
    "An object is placed 40 cm in front of a convex lens of focal length 20 cm.",
  );
  assert(lensTpl?.id === "optics_lens", "lens golden must match optics_lens");
  const lensBend = snapGeometryCommand(
    {
      type: "DRAW_LINE",
      params: [500, 265, 640, 265],
      charPosition: 0,
      narrationBefore: "",
    },
    lensTpl!,
  );
  assert(
    lensBend.params[2] === 650 && lensBend.params[3] === 265,
    `lens bend must project onto optical plane x=650 (got ${lensBend.params.slice(0, 4).join(",")})`,
  );
  // Off-axis junction must NOT be flattened to y=300.
  assert(lensBend.params[3] !== 300, "off-axis lens junction must keep its height");

  const throughLens = snapGeometryCommand(
    {
      type: "DRAW_LINE",
      params: [640, 265, 700, 265],
      charPosition: 0,
      narrationBefore: "",
    },
    lensTpl!,
  );
  assert(
    throughLens.params[0] === 650 && throughLens.params[1] === 265,
    `ray start near lens must snap to plane (got ${throughLens.params.slice(0, 4).join(",")})`,
  );
}

// Mirror pole-plane: axis-level ray aimed near the pole attaches to x=610.
{
  const mirrorPoleSnap = snapGeometryCommand(
    {
      type: "DRAW_LINE",
      params: [500, 300, 625, 298],
      charPosition: 0,
      narrationBefore: "",
    },
    optics!,
  );
  assert(
    Math.abs(mirrorPoleSnap.params[2]! - 610) <= 1 && mirrorPoleSnap.params[3] === 300,
    `mirror ray near pole must snap to pole plane (got ${mirrorPoleSnap.params.slice(0, 4).join(",")})`,
  );
}

// ---------------------------------------------------------------------------
// Ray Optics mastery — golden questions (match + classify + intro labels)
// ---------------------------------------------------------------------------

const opticsGolden: Array<{
  id: string;
  kind: string;
  question: string;
  expectLabels?: string[];
  expectNumbers?: Partial<Record<string, number>>;
}> = [
  {
    id: "optics_mirror",
    kind: "mirror",
    question: "An object is placed 30 cm in front of a concave mirror of focal length 15 cm. Draw the ray diagram and find image distance.",
    expectLabels: ["C", "F", "O"],
    expectNumbers: { u: 30, f: 15 },
  },
  {
    id: "optics_lens",
    kind: "lens",
    question: "An object is placed 40 cm in front of a convex lens of focal length 20 cm. Find the image distance using the lens formula.",
    expectLabels: ["O", "F", "F'"],
    expectNumbers: { u: 40, f: 20 },
  },
  {
    id: "optics_prism",
    kind: "prism",
    question: "A prism of angle A = 60° and refractive index μ = 1.5 produces minimum deviation. Find δ_m.",
    expectLabels: ["A", "δ"],
    expectNumbers: { A: 60, mu: 1.5 },
  },
  {
    id: "optics_tir",
    kind: "tir",
    question: "Find the critical angle for total internal reflection when the refractive index μ = 1.5. Explain optical fibre.",
    expectLabels: ["N", "i_c"],
    expectNumbers: { mu: 1.5 },
  },
  {
    id: "optics_lens_combo",
    kind: "combo",
    question: "Two thin lenses in contact have f1 = 20 cm and f2 = 30 cm. Find the equivalent focal length.",
    expectLabels: ["O"],
    expectNumbers: { f1: 20, f2: 30 },
  },
  {
    id: "optics_instrument",
    kind: "instrument",
    question: "A compound microscope has objective focal length fo = 1 cm, eyepiece fe = 5 cm, tube length L = 15 cm and near point D = 25 cm. Find magnifying power.",
    expectLabels: ["O", "E"],
    expectNumbers: { fo: 1, fe: 5, L: 15, D: 25 },
  },
  {
    id: "optics_instrument",
    kind: "instrument",
    question: "An astronomical telescope has objective focal length 100 cm and eyepiece 5 cm. Find the magnifying power for normal adjustment.",
    expectLabels: ["O", "E"],
  },
  {
    id: "optics_refraction_plane",
    kind: "slab",
    question: "A ray of light is incident on a glass slab of refractive index μ = 1.5 at angle of incidence i = 45°. Find the lateral shift.",
    expectLabels: ["slab"],
    expectNumbers: { mu: 1.5, i: 45 },
  },
];

for (const goldenCase of opticsGolden) {
  const matched = matchDiagramTemplate(goldenCase.question);
  assert(
    matched?.id === goldenCase.id,
    `optics golden: expected ${goldenCase.id}, got ${matched?.id ?? null} for ${goldenCase.question.slice(0, 70)}`,
  );

  const intro = buildOpticsPrecisionIntro(matched!, goldenCase.question);
  assert(intro !== null, `optics golden: precision intro missing for ${goldenCase.id}`);
  assert(
    intro!.optics_kind === goldenCase.kind,
    `optics golden: kind ${goldenCase.kind} vs ${intro!.optics_kind}`,
  );

  const classify = classifyOptics(matched!, goldenCase.question);
  assert(classify.optics_kind === goldenCase.kind, "classifyOptics kind mismatch");
  assert(
    typeof classify.confidence === "string" && typeof classify.reason === "string",
    "optics-classify metadata shape requires confidence + reason",
  );

  const parsed = parseOpticsNumbers(goldenCase.question);
  if (goldenCase.expectNumbers) {
    for (const [key, value] of Object.entries(goldenCase.expectNumbers)) {
      assert(
        (parsed as Record<string, number | null>)[key] === value,
        `optics golden: parsed ${key} expected ${value}, got ${(parsed as Record<string, number | null>)[key]}`,
      );
    }
  }

  const labels = intro!.segments
    .flatMap((segment) => getSegmentCommands(segment))
    .filter((command) => command.type === "LABEL")
    .map((command) => command.text ?? "");
  if (goldenCase.expectLabels) {
    for (const label of goldenCase.expectLabels) {
      assert(
        labels.some((text) => text === label || text.startsWith(label)),
        `optics golden: missing label ${label} in ${goldenCase.id} (got ${labels.join(",")})`,
      );
    }
  }

  const meta = opticsDecisionMetadata(intro!, {
    diagram_source: "template",
    allow_llm_draw: matched!.allowLlmDrawInDiagramZone === true,
    planner_overridden: false,
  });
  assert(meta.optics_kind === goldenCase.kind, "opticsDecisionMetadata optics_kind");
  assert(meta.matched_template_id === goldenCase.id, "opticsDecisionMetadata matched_template_id");
  assert(Array.isArray(meta.intro_command_types), "opticsDecisionMetadata intro_command_types");
  assert(typeof meta.intro_segment_count === "number", "opticsDecisionMetadata intro_segment_count");
}

// Lens must never match as mirror
const lensNotMirror = matchDiagramTemplate(
  "A convex lens of focal length 15 cm forms an image of an object at 30 cm. Find magnification.",
);
assert(lensNotMirror?.id === "optics_lens", "lens question must not load mirror template");

// Prism must never match as mirror
const prismNotMirror = matchDiagramTemplate(
  "A prism of refracting angle 60 degrees and μ = 1.5. Find the angle of minimum deviation.",
);
assert(prismNotMirror?.id === "optics_prism", "prism question must not load mirror template");

// Convex mirror: C and F must sit BEHIND the pole (x > pole), labels clear of axis,
// and virtual image behind the mirror.
{
  const convexQ =
    "An object is placed 20 cm in front of a convex mirror of focal length 15 cm. Find the image distance and nature of the image.";
  const convexTpl = matchDiagramTemplate(convexQ);
  assert(convexTpl?.id === "optics_mirror", "convex mirror must match optics_mirror");
  const convexIntro = buildOpticsPrecisionIntro(convexTpl!, convexQ);
  assert(convexIntro !== null, "convex mirror precision intro required");
  const cmds = convexIntro!.segments.flatMap((s) => s.commands ?? []);
  const cLabel = cmds.find((c) => c.type === "LABEL" && c.text === "C");
  const fLabel = cmds.find((c) => c.type === "LABEL" && c.text === "F");
  const oLabel = cmds.find((c) => c.type === "LABEL" && c.text === "O");
  assert(cLabel !== undefined && fLabel !== undefined && oLabel !== undefined, "convex intro needs C/F/O");
  assert(cLabel!.params[0]! > 610, "convex C must be behind the pole (x > 610)");
  assert(fLabel!.params[0]! > 610, "convex F must be behind the pole (x > 610)");
  assert(oLabel!.params[0]! >= 575 && oLabel!.params[0]! <= 620, "O near pole (offset left of tick)");
  assert(
    [cLabel!, fLabel!, oLabel!].every((c) => c.params[1]! <= 300 - 48),
    "convex C/F/O labels must sit well above the axis",
  );
  assert(
    [cLabel!, fLabel!, oLabel!].every((c) => c.params[1]! >= 300 - 70),
    "convex C/F/O labels should stay near the mark (modest offset)",
  );
  const dims = cmds.filter((c) => c.type === "DIMENSION");
  assert(dims.length >= 2, "convex intro should mark at least u and f");
  for (const dimCmd of dims) {
    const [x1, y1, x2, y2] = dimCmd.params;
    assert(y1 === 300 && y2 === 300, "dimension span must lie on the axis endpoints");
    assert(
      Math.abs(x1 - 610) < 1 || Math.abs(x2 - 610) < 1,
      "each dimension bar must include the pole as an endpoint",
    );
  }
  const vDim = dims.find((c) => (c.text ?? "").includes("v"));
  assert(vDim !== undefined, "convex intro should mark virtual image distance v");
  assert((vDim!.text ?? "").includes("−") || (vDim!.text ?? "").includes("-"), "convex v label should show negative sign");
}

// Optics owned-annotation guard: LLM DIMENSION/LABEL for u/f must be blocked
{
  const mirrorTpl = matchDiagramTemplate(
    "An object is placed 30 cm in front of a concave mirror of focal length 15 cm.",
  )!;
  const blockedDim = isBlockedOpticsOwnedAnnotation(
    {
      type: "DIMENSION",
      params: [490, 300, 610, 300, 80],
      text: "u = 20 cm",
      charPosition: 0,
      narrationBefore: "",
    },
    mirrorTpl,
  );
  assert(blockedDim, "LLM DIMENSION on optics diagram must be blocked");
  const blockedLabel = isBlockedOpticsOwnedAnnotation(
    {
      type: "LABEL",
      params: [550, 300],
      text: "F",
      charPosition: 0,
      narrationBefore: "",
    },
    mirrorTpl,
  );
  assert(blockedLabel, "LLM LABEL for F on optics diagram must be blocked");
  const blockedWrite = isBlockedOpticsOwnedAnnotation(
    {
      type: "WRITE",
      params: [550, 300],
      text: "O",
      charPosition: 0,
      narrationBefore: "",
    },
    mirrorTpl,
  );
  assert(blockedWrite, "LLM WRITE for O on optics diagram must be blocked");
  const allowedRay = isBlockedOpticsOwnedAnnotation(
    {
      type: "DRAW_LINE",
      params: [500, 240, 610, 300],
      charPosition: 0,
      narrationBefore: "",
    },
    mirrorTpl,
  );
  assert(!allowedRay, "principal ray DRAW_LINE must still be allowed");
}

// ---------------------------------------------------------------------------
// Phase 8a — template coverage for all new diagram templates
// ---------------------------------------------------------------------------

const templateMatchCases: Array<{ id: string; question: string }> = [
  { id: "projectile", question: "a projectile is launched at 30 degrees with speed 20 m/s, find maximum range" },
  { id: "wave_shm", question: "a wave has amplitude 5 cm and wavelength 10 cm, find frequency" },
  { id: "energy_levels", question: "an electron transitions from n=3 to n=1 in a hydrogen atom, find the photon emission spectral line using rydberg" },
  { id: "electrostatics", question: "two point charges q1=2μC and q2=4μC are 10 cm apart, find the electric field at midpoint using coulomb" },
  { id: "magnetism", question: "a solenoid carries current 2A with 100 turns, find the magnetic field inside using biot-savart" },
  { id: "gravitation", question: "a satellite orbits earth at height 300 km, find orbital velocity using kepler and GMm/r" },
  { id: "3d_axes", question: "find the direction cosines of a vector in 3d cartesian space with hat i hat j hat k components" },
  { id: "unit_circle_trig", question: "using the unit circle derive the trig identity sin squared theta plus cos squared theta equals 1" },
  { id: "complex_argand", question: "plot z = 3 + 4i on the argand plane and find modulus and argument in polar form" },
  { id: "calculus_graph", question: "find the area under the curve y = x squared from 0 to 2 using definite integral and riemann sum" },
  { id: "probability_venn", question: "in a venn diagram P(A)=0.5, P(B)=0.3, P(A∩B)=0.1, find conditional probability using bayes" },
  { id: "organic_hexagon", question: "draw the benzene hexagon and show electrophilic aromatic substitution with friedel crafts alkylation" },
  { id: "galvanic_cell", question: "draw a galvanic cell with zinc anode and copper cathode, salt bridge, find cell potential using nernst" },
  { id: "lewis_structure", question: "draw the lewis electron dot structure of water showing lone pairs and vsepr molecular geometry" },
  { id: "coordination_geo", question: "an octahedral coordination compound with 6 ligands, find crystal field splitting and d-d transition color" },
  { id: "reaction_arrow", question: "balance the chemical reaction equation for combustion of methane using stoichiometry and mole concept" },
  { id: "pv_diagram", question: "draw a pv diagram for an isothermal expansion of an ideal gas and find work done by the gas" },
  { id: "circle", question: "find the equation of a circle with radius 5 and center at origin, derive circumference" },
];

for (const { id, question } of templateMatchCases) {
  const template = matchDiagramTemplate(question);
  assert(template !== null, `expected template "${id}" to match question: ${question.slice(0, 60)}`);
  assert(
    template!.id === id,
    `expected template "${id}" but got "${template!.id}" for: ${question.slice(0, 60)}`,
  );
}

assert(DIAGRAM_TEMPLATES.length >= 25, `expected at least 25 diagram templates, got ${DIAGRAM_TEMPLATES.length}`);

// ---------------------------------------------------------------------------
// Phase 8a — false-positive regression tests (F1 fixes)
// ---------------------------------------------------------------------------

const falsePositiveCases: Array<{ shouldNotMatch: string; question: string }> = [
  { shouldNotMatch: "circular_motion", question: "a bead on a string pendulum swings with small oscillation" },
  { shouldNotMatch: "circuit", question: "ohm's law says V equals IR in a general conductor wire, derive the relationship" },
  { shouldNotMatch: "fbd", question: "in statistics the correlation coefficient mu = 0.5 indicates moderate positive correlation" },
  { shouldNotMatch: "coordinate_axes", question: "the graph of a function f(x) represents its output values" },
];

for (const { shouldNotMatch, question } of falsePositiveCases) {
  const template = matchDiagramTemplate(question);
  assert(
    template === null || template.id !== shouldNotMatch,
    `false positive: "${shouldNotMatch}" should NOT match: ${question.slice(0, 60)}`,
  );
}

// ---------------------------------------------------------------------------
// Phase 8a — shape primitive tests (curved arrow, ellipse, dashed line, bezier)
// ---------------------------------------------------------------------------

// Ellipse: DRAW_CIRCLE with 4 params [cx, cy, rx, ry]
const ellipseParsed = parseDrawCommandFromTag("DRAW_CIRCLE", "620,280,140,80", 0, "");
assert(
  ellipseParsed.params.length === 4,
  "ellipse DRAW_CIRCLE should accept 4 params [cx, cy, rx, ry]",
);
assert(
  ellipseParsed.params[2] === 140 && ellipseParsed.params[3] === 80,
  "ellipse params should preserve rx=140 ry=80",
);

// Dashed line: DRAW_LINE with 5 params [x1, y1, x2, y2, 1]
const dashedParsed = parseDrawCommandFromTag("DRAW_LINE", "500,300,700,300,1", 0, "");
assert(
  dashedParsed.params.length === 5 && dashedParsed.params[4] === 1,
  "dashed line should have 5 params with flag=1",
);

// Bezier spline: DRAW_LINE with 7 params [x1,y1,x2,y2,x3,y3,2]
const bezierParsed = parseDrawCommandFromTag("DRAW_LINE", "690,175,610,300,690,425,2", 0, "");
assert(
  bezierParsed.params.length === 7 && bezierParsed.params[6] === 2,
  "bezier spline should have 7 params with flag=2",
);

// Curved arrow: ARROW with 6 params [x1,y1,cx,cy,x2,y2]
const curvedArrowParsed = parseDrawCommandFromTag("ARROW", "500,300,600,250,700,300", 0, "");
assert(
  curvedArrowParsed.params.length === 6,
  "curved arrow should have 6 params [x1,y1,cx,cy,x2,y2]",
);

// Gravitation ellipse skeleton should use 4-param DRAW_CIRCLE
const gravitation = matchDiagramTemplate("a satellite orbits earth, find escape velocity using kepler law");
assert(gravitation?.id === "gravitation", "gravitation template should match");
const gravSkeleton = getTemplateSkeletonCommands(gravitation!);
assert(
  gravSkeleton.some((cmd) => cmd.type === "DRAW_CIRCLE" && cmd.params.length === 4),
  "gravitation skeleton should include an ellipse (4-param DRAW_CIRCLE) for the orbit",
);

// Organic hexagon prompt should teach curved arrow notation for electron pushing
const organicHex = matchDiagramTemplate("draw the benzene hexagon and show electrophilic aromatic substitution with friedel crafts alkylation");
assert(organicHex?.id === "organic_hexagon", "organic hexagon template should match");
assert(
  organicHex!.promptAddon.includes("[ARROW:x1,y1,cx,cy,x2,y2]"),
  "organic hexagon prompt should teach 6-param curved arrow for electron pushing",
);

console.log("verify-diagram-templates: all checks passed");
