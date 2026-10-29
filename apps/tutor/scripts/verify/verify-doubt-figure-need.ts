/**
 * DIAGRAM_DOUBT_FIGURES need check: an LLM judgment on the lesson's own
 * provider, 3 s deadline, and "point" on any failure.
 *
 *   A timeout, a thrown fetch, a bad status or an unreadable reply is "point".
 *   A mark on the figure's anchors skips the call. A code board skips it.
 *   Flag off skips it. The route answers "point" when the flag is off, makes
 *   one fast mode attempt bounded by the deadline, and never routes on words.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VerifiedDiagram } from "@heytutor/drawing";
import {
  DOUBT_FIGURE_NEED_DEADLINE_MS,
  buildDoubtFigureNeedMessages,
  parseDoubtFigureNeedInput,
  parseDoubtFigureNeedReply,
} from "../../lib/llm/doubtFigureNeed";
import {
  doubtFigureNeedInput,
  doubtFigureNeedSkip,
  requestDoubtFigureNeed,
  zoneInkOccupied,
} from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { DIAGRAM_ZONE } from "../../features/tutor-session/constants";
import { buildReferencePicturePresentation } from "../../features/tutor-session/lib/scene/referencePicturePresentation";
import partFocusFixture from "./fixtures/reference-picture-part-focus-off.json";

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");
function between(source: string, file: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert(from >= 0, `${file}: start anchor "${start}" is gone. Repoint this gate; do not relax it.`);
  const to = source.indexOf(end, from + start.length);
  assert(to > from, `${file}: end anchor "${end}" is gone after "${start}". Repoint this gate; do not relax it.`);
  return source.slice(from, to + end.length);
}

const figure = {
  id: "verified_scene",
  name: "projectile",
  commands: [],
  reveals: [],
  promptAddon: "",
  anchors: [
    { id: "launch_point", labels: ["O"], x: 500, y: 500, width: 10, height: 10 },
    { id: "range", labels: ["R"], x: 700, y: 520, width: 10, height: 10 },
  ],
} as unknown as VerifiedDiagram;
const body = doubtFigureNeedInput({ lessonQuestion: "Range of a projectile", doubtTitle: "Doubt: what if it is thrown off a cliff", zoneFigure: figure });
const url = "http://test.invalid/api/doubt-figure-need";
const ok = (payload: unknown) => (async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;

async function main(): Promise<void> {
  // 1. Timeout is "point", well inside the deadline it was given.
  {
    const hanging = ((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as unknown as typeof fetch;
    const startedAt = Date.now();
    const result = await requestDoubtFigureNeed({ url, body, fetchImpl: hanging, deadlineMs: 40 });
    assert.equal(result.decision, "point", "a need check that times out answers point");
    assert(Date.now() - startedAt < 1_000, "the deadline is enforced on the client, not left to the server");
    assert.equal(DOUBT_FIGURE_NEED_DEADLINE_MS, 3_000, "the need check deadline is 3 s");
  }

  // 2. Failure is "point".
  {
    const thrown = (async () => { throw new TypeError("network down"); }) as unknown as typeof fetch;
    assert.equal((await requestDoubtFigureNeed({ url, body, fetchImpl: thrown })).decision, "point", "a failed request answers point");
    const status = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    assert.equal((await requestDoubtFigureNeed({ url, body, fetchImpl: status })).decision, "point", "a bad status answers point");
    const garbled = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    assert.equal((await requestDoubtFigureNeed({ url, body, fetchImpl: garbled })).decision, "point", "an unreadable body answers point");
    assert.equal((await requestDoubtFigureNeed({ url, body, fetchImpl: ok({ decision: "maybe" }) })).decision, "point", "an unknown answer is point");
    const aborted = new AbortController();
    aborted.abort();
    assert.equal((await requestDoubtFigureNeed({ url, body, fetchImpl: ok({ decision: "new_figure" }), signal: aborted.signal })).decision,
      "point", "a cancelled turn answers point");
    assert.equal((await requestDoubtFigureNeed({ url, body, fetchImpl: ok({ decision: "new_figure", reason: "a cliff" }) })).decision,
      "new_figure", "the model's new_figure is passed through");
  }

  // 3. Skips: a ring on the figure, a code board, the flag off, a zone that cannot be returned.
  {
    const base = {
      granted: true, codeBoard: false, markedFigureIds: [] as string[], zoneFigure: figure as VerifiedDiagram | null,
      zoneReturnable: true, zoneEmpty: false, zoneOccupied: false,
    };
    assert.equal(doubtFigureNeedSkip(base), null, "a doubt on a returnable verified figure asks the need check");
    assert.equal(doubtFigureNeedSkip({ ...base, markedFigureIds: ["Range"] }), "marked_figure_part", "a mark on a figure anchor skips the call");
    assert.equal(doubtFigureNeedSkip({ ...base, markedFigureIds: ["row_3"] }), null, "a mark on a work row still asks");
    assert.equal(doubtFigureNeedSkip({ ...base, codeBoard: true }), "code_board", "a code board skips the call");
    assert.equal(doubtFigureNeedSkip({ ...base, granted: false }), "flag_off", "flag off skips the call");
    assert.equal(doubtFigureNeedSkip({ ...base, zoneReturnable: false }), "zone_not_returnable", "a figure that cannot be returned is pointed at");
    assert.equal(doubtFigureNeedSkip({ ...base, zoneFigure: null }), "zone_not_returnable",
      "no figure on a zone that is not an empty page zone (a fresh page, after a replay) is pointed at");
  }

  // 3b. The skip table with an empty zone: order flag_off, code_board,
  // marked_figure_part, zone_occupied (only when empty), zone_not_returnable.
  {
    const empty = {
      granted: true, codeBoard: false, markedFigureIds: [] as string[], zoneFigure: null as VerifiedDiagram | null,
      zoneReturnable: false, zoneEmpty: true, zoneOccupied: false,
    };
    const table: Array<[string, Partial<typeof empty>, string | null]> = [
      ["an empty, unoccupied zone asks the need check", {}, null],
      ["an empty zone that work ink reaches is refused", { zoneOccupied: true }, "zone_occupied"],
      ["flag off comes first, even on an occupied empty zone", { granted: false, zoneOccupied: true }, "flag_off"],
      ["a code board comes before the occupancy check", { codeBoard: true, zoneOccupied: true }, "code_board"],
      ["a mark on a work row of an empty zone still asks", { markedFigureIds: ["row_3"] }, null],
      ["an empty zone needs no returnable figure", { zoneReturnable: false }, null],
      ["occupancy only counts on an empty zone", { zoneFigure: figure, zoneEmpty: false, zoneOccupied: true, zoneReturnable: true }, null],
      ["a figure in the zone is never treated as empty", { zoneFigure: figure, zoneEmpty: true, zoneOccupied: true, zoneReturnable: false }, "zone_not_returnable"],
      ["a marked figure part comes before occupancy", { zoneFigure: figure, zoneEmpty: false, markedFigureIds: ["range"], zoneOccupied: true }, "marked_figure_part"],
      ["no figure and not an empty page zone is pointed at", { zoneEmpty: false }, "zone_not_returnable"],
    ];
    for (const [name, overrides, expected] of table) {
      assert.equal(doubtFigureNeedSkip({ ...empty, ...overrides }), expected, name);
    }

    // The occupancy guard reads the work column's rows against the zone.
    const rect = (x: number, width: number) => ({ x, y: 200, width, height: 30 });
    assert.equal(zoneInkOccupied({ rects: [], nextY: 120 }), false, "an empty page is not occupied");
    assert.equal(zoneInkOccupied({ rects: [rect(40, 300)], nextY: 240 }), false, "a row that ends short of the zone's gap leaves it free");
    assert.equal(zoneInkOccupied({ rects: [rect(40, 332)], nextY: 240 }), false, "a row ending exactly at the gap leaves it free");
    assert.equal(zoneInkOccupied({ rects: [rect(40, 333)], nextY: 240 }), true, "a row reaching into the gap occupies the zone");
    assert.equal(zoneInkOccupied({ rects: [rect(40, 900)], nextY: 240 }), true, "a long text only row across the zone occupies it");
    assert.equal(zoneInkOccupied({ rects: [rect(40, 200), rect(DIAGRAM_ZONE.x + 20, 80)], nextY: 240 }), true,
      "any row inside the zone occupies it, with no figure there to own it");

    // An empty zone's need body: no family, no parts; the prompt says so.
    const emptyBody = doubtFigureNeedInput({ lessonQuestion: "Explain Newton's third law.", doubtTitle: "Doubt: show me the forces on a book on a table", zoneFigure: null });
    assert.deepEqual(emptyBody.figure, { family: null, parts: [] }, "an empty zone sends no family and no parts");
    assert(parseDoubtFigureNeedInput(emptyBody), "an empty zone's body passes the route's validation");
    assert(buildDoubtFigureNeedMessages(emptyBody)[1]!.content.includes("Figure on the board:\n(no figure on the board)"),
      "the model is told the board has no figure");
  }

  // 3c. A reference picture in the zone (lane 3): swapped like a verified
  // figure when it can be stashed, pointed at otherwise; the need check reads
  // it as family reference_picture with its pointable parts.
  {
    const record = partFocusFixture.cases[0]!.record as Parameters<typeof buildReferencePicturePresentation>[0];
    for (const partFocus of [false, true]) {
      const picture = buildReferencePicturePresentation(record, { partFocus }).diagram as VerifiedDiagram;
      const onPicture = {
        granted: true, codeBoard: false, markedFigureIds: [] as string[], zoneFigure: picture as VerifiedDiagram | null,
        zoneReturnable: true, zoneEmpty: false, zoneOccupied: false,
      };
      assert.equal(doubtFigureNeedSkip(onPicture), null, `a picture with a stash asks the need check (part focus ${partFocus})`);
      assert.equal(doubtFigureNeedSkip({ ...onPicture, zoneReturnable: false }), "zone_not_returnable", "a picture with no stash is pointed at");
      assert.equal(doubtFigureNeedSkip({ ...onPicture, granted: false }), "flag_off", "flag off a picture is pointed at, as before");
      assert.equal(doubtFigureNeedSkip({ ...onPicture, codeBoard: true }), "code_board", "a code board comes first");
      assert.equal(doubtFigureNeedSkip({ ...onPicture, markedFigureIds: [picture.anchors.at(-1)!.id] }), "marked_figure_part",
        "a ring on a picture part is a question about that part");
      assert.equal(doubtFigureNeedSkip({ ...onPicture, zoneFigure: { ...picture, id: "some_other_figure" } as unknown as VerifiedDiagram }), "zone_not_returnable",
        "a zone figure that is neither a verified scene nor a picture is never swapped");
      const pictureBody = doubtFigureNeedInput({ lessonQuestion: "Explain the parts of a cell.", doubtTitle: "Doubt: show me osmosis", zoneFigure: picture });
      assert.equal(pictureBody.figure.family, "reference_picture", "a picture's need body names its family");
      assert.deepEqual(pictureBody.figure.parts.map((part) => part.id), picture.anchors.map((anchor) => anchor.id),
        "the need body lists the picture's pointable parts");
      assert.equal(pictureBody.figure.parts.length > 1, partFocus, "part focus on lists each part; off, the whole picture only");
      assert(parseDoubtFigureNeedInput(pictureBody), "a picture's need body passes the route's validation");
    }
    assert.equal(body.figure.family, null, "a verified scene's body still sends no family unless given one");
  }

  // 4. The classifier's input and output: parts, never keywords.
  {
    assert.deepEqual(body.figure.parts.map((part) => part.id), ["launch_point", "range"], "the zone's parts are what the model reads");
    assert.equal(body.doubt, "what if it is thrown off a cliff", "the doubt is sent without its title prefix");
    assert(parseDoubtFigureNeedInput(body), "the client body passes the route's validation");
    assert.equal(parseDoubtFigureNeedInput({ ...body, doubt: "" }), null, "an empty doubt is refused");
    const messages = buildDoubtFigureNeedMessages(body);
    assert(messages[1]!.content.includes("- range: R"), "the user message lists the figure's parts");
    assert(messages[0]!.content.includes("When unsure, answer \"point\"."), "the prompt defaults to point");
    assert(!/[—–]/.test(messages[0]!.content), "the prompt carries no dash punctuation");
    assert.deepEqual(parseDoubtFigureNeedReply('{"decision":"new_figure","reason":"cliff"}'), { decision: "new_figure", reason: "cliff" });
    assert.equal(parseDoubtFigureNeedReply("new_figure"), null, "a bare word is not a decision");
  }

  // 5. The route: flag first, one fast attempt inside the deadline, point on every failure.
  {
    const file = "app/api/doubt-figure-need/route.ts";
    const route = between(read(file), file, "export async function POST(", "\n}\n");
    const flag = route.indexOf("if (!resolveDoubtFiguresEnabled()) return Response.json(pointDecision(\"flag_off\"));");
    assert(flag >= 0 && flag < route.indexOf("requireLessonGrant("), "flag off answers point before any work");
    assert(route.includes("fastMode: true"), "the classifier runs in fast mode");
    assert(route.includes("resolveLlmEndpoint()"), "the classifier runs on the lesson's own provider");
    assert(route.includes("maxAttemptsPerModel: 1") && route.includes("attemptTimeoutMs: DOUBT_FIGURE_NEED_DEADLINE_MS"),
      "one attempt, bounded by the deadline");
    assert(route.includes("AbortSignal.timeout(DOUBT_FIGURE_NEED_DEADLINE_MS)"), "the whole call is bounded by the deadline");
    assert(/catch \{\s*return Response\.json\(pointDecision\(signal\.aborted \? "timeout" : "provider_error"\)\);/.test(route),
      "a thrown or timed out call answers point");
    assert(!/JEV|jev/.test(route), "the need check never uses Jev");
  }

  // 6. The live turn skips the call on a skip, and only calls with the flag.
  {
    const file = "features/tutor-session/hooks/turn/useQuestionHandler.ts";
    const plan = between(read(file), file, "if (doubt && doubtFiguresGranted) {\n        // doubt-figure-plan:begin", "// doubt-figure-plan:end");
    assert(/markedFigureIds: doubt\.markedFigureIds \?\? \[\]/.test(plan), "the doubt's marked figure parts reach the skip");
    assert(/const codeBoard = Boolean\(codeLessonControllerRef\?\.current\?\.getActivePlan\(\)\);/.test(plan) &&
      /doubtFigureNeedSkip\(\{\s*granted: doubtFiguresGranted,\s*codeBoard,/.test(plan), "a code board reaches the skip");
    assert(/const need = skip\s*\? \{ decision: "point" as const, reason: skip \}\s*: await awaitCurrentTurn\(requestDoubtFigureNeed\(/.test(plan),
      "a skip answers point without the call");
    const shell = read("features/tutor-session/TutorSessionShell.tsx");
    assert(shell.includes("handleAskDoubt(doubt, { prompt, title, markedFigureIds: markedEntityIds(marks) });"),
      "a marked doubt carries the figure parts its marks landed on");
  }
}

main().then(() => console.log("doubt figure need verification passed"), (error: unknown) => {
  console.error(error);
  process.exit(1);
});
