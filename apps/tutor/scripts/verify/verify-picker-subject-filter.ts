/**
 * The strict example picker shows each turn only its own subject's library
 * entries (request 43: physics turns were picking heights and distances,
 * vector projection and ellipse foci from the maths shelf).
 *
 * The subject oracle here is independent of the library build: curated
 * entries by their directory, synthesized entries by recomputing which probe
 * file or question-bank unit their stem came from (the id carries the stem's
 * digest). Every check runs and reports, so a failure shows its full extent.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import * as pickerClient from "../../features/tutor-session/lib/scene/diagramExamplePickerClient";
import * as serverLibrary from "../../lib/scene/diagramExampleLibrary.server";
import * as examples from "../lecture-lab/diagramExamples";
import * as productionProfile from "../lecture-lab/productionLabProfile";
import { parseOptions } from "../lecture-lab/run";

type Subject = "physics" | "maths" | "chemistry";
const SUBJECTS: readonly Subject[] = ["physics", "maths", "chemistry"];
const QUESTION = "Unrelated public regression fixture.";

const appRoot = process.cwd();
const repoRoot = resolve(appRoot, "../..");
const libraryPath = resolve(repoRoot, "data/diagram-eval/v1/exemplars/_library.jsonl");
const rawLines = readFileSync(libraryPath, "utf8").split(/\r?\n/).filter((line) => line.trim())
  .map((line) => JSON.parse(line) as { id: string; family?: string | null; subject?: unknown });

function digest(question: string): string {
  return createHash("sha256").update(question).digest("hex").slice(0, 12);
}

/** Where each synthesized stem came from, in the build's own stem order. */
function stemOrigins(): Map<string, Subject> {
  const origins = new Map<string, Subject>();
  const record = (question: string, subject: Subject) => {
    if (!origins.has(digest(question))) origins.set(digest(question), subject);
  };
  const probesRoot = resolve(repoRoot, "data/syllabus-probes");
  for (const name of readdirSync(probesRoot).filter((file) => file.endsWith(".json")).sort()) {
    const subject = basename(name).split("-")[0] as Subject;
    assert.ok(SUBJECTS.includes(subject), `probe file ${name} names no subject`);
    const value = JSON.parse(readFileSync(resolve(probesRoot, name), "utf8")) as { questions?: Array<{ question?: unknown }> };
    for (const entry of value.questions ?? []) if (typeof entry.question === "string") record(entry.question, subject);
  }
  const taxonomy = JSON.parse(readFileSync(resolve(repoRoot, "data/question-bank/syllabus-taxonomy.json"), "utf8")) as {
    subjects: Array<{ subject_id: string; units: Array<{ name: string }> }>;
  };
  const unitSubject = new Map(taxonomy.subjects.flatMap((subject) =>
    subject.units.map((unit) => [unit.name, subject.subject_id as Subject] as const)));
  const bank = readFileSync(resolve(repoRoot, "data/question-bank/questions.jsonl"), "utf8")
    .split(/\r?\n/).filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { question_id?: string; text?: string; topic?: string })
    .sort((left, right) => String(left.question_id).localeCompare(String(right.question_id)));
  for (const entry of bank) {
    const subject = unitSubject.get(entry.topic ?? "");
    if (typeof entry.text === "string" && entry.text.trim() && subject) record(entry.text, subject);
  }
  return origins;
}

const origins = stemOrigins();
const oracle = new Map<string, Subject>(rawLines.map((line) => {
  const curated = /^curated:([a-z]+)\//.exec(line.id)?.[1] as Subject | undefined;
  const stem = /^synthesized:.+:([0-9a-f]{12})$/.exec(line.id)?.[1];
  const subject = curated ?? (stem ? origins.get(stem) : undefined) ??
    (line.family?.startsWith("chem_") ? "chemistry" : undefined);
  assert.ok(subject && SUBJECTS.includes(subject), `no independent subject for ${line.id}`);
  return [line.id, subject];
}));
const idsOf = (subject: Subject) => rawLines.map((line) => line.id).filter((id) => oracle.get(id) === subject);

const plan = { ...createFallbackTurnPlanV3(QUESTION), visualRequirement: "required" as const };
function pickerCatalogueIds(content: Record<string, unknown>): string[] {
  const body = JSON.parse(serverLibrary.buildLiveDiagramPickerBody(JSON.stringify({
    messages: [{ role: "user", content: JSON.stringify(content) }],
  }), QUESTION)) as { messages: Array<{ content: string }> };
  const prompt = body.messages[0]!.content;
  return prompt.slice(prompt.indexOf("CATALOGUE\n") + "CATALOGUE\n".length).split("\n")
    .filter(Boolean).map((line) => line.split("|")[0]!);
}

const results: Array<{ check: string; ok: boolean; detail?: string }> = [];
async function check(name: string, body: () => void | Promise<void>): Promise<void> {
  try {
    await body();
    results.push({ check: name, ok: true });
  } catch (error) {
    results.push({ check: name, ok: false, detail: error instanceof Error ? error.message.split("\n")[0] : String(error) });
  }
}

async function main(): Promise<void> {
  await check("every library line records its subject at build time", () => {
    const missing = rawLines.filter((line) => !SUBJECTS.includes(line.subject as Subject)).map((line) => line.id);
    assert.deepEqual(missing.slice(0, 3), [], `${missing.length} of ${rawLines.length} lines have no subject`);
  });

  await check("recorded subjects match the curated path or the stem's origin", () => {
    const library = examples.loadDiagramExemplarLibrary(libraryPath, []) as Array<{ id: string; subject?: unknown }>;
    const wrong = library.filter((entry) => entry.subject !== oracle.get(entry.id))
      .map((entry) => `${entry.id}=${String(entry.subject)} (origin ${oracle.get(entry.id)})`);
    assert.deepEqual(wrong.slice(0, 3), [], `${wrong.length} loaded entries carry the wrong subject`);
  });

  for (const subject of SUBJECTS) {
    await check(`a ${subject} turn's picker catalogue holds only ${subject} entries`, () => {
      const ids = pickerCatalogueIds({ plan, subject });
      assert.ok(ids.length > 0, `the ${subject} catalogue is empty`);
      const foreign = ids.filter((id) => oracle.get(id) !== subject);
      assert.deepEqual(foreign.slice(0, 3), [], `${foreign.length} of ${ids.length} catalogue entries belong to another subject`);
    });
  }

  await check("a cross-subject id is not resolved for the scene planner", () => {
    const one = Object.fromEntries(SUBJECTS.map((subject) => [subject, idsOf(subject)[0]!])) as Record<Subject, string>;
    for (const subject of SUBJECTS) {
      const resolved = serverLibrary.resolveLiveDiagramExamples(QUESTION, Object.values(one), subject as never);
      assert.deepEqual(resolved.map((entry) => entry.id), [one[subject]], `a ${subject} request resolved another subject's id`);
    }
    // The browser's URL transport carries the subject to the server parser.
    const url = new URL(pickerClient.scenePlannerUrlWithExampleIds("/api/chat", Object.values(one), "physics" as never), "http://localhost");
    const subject = serverLibrary.parseLiveDiagramExampleSubject(url.searchParams.get("diagramSubject"));
    const ids = serverLibrary.parseLiveDiagramExampleIds(url.searchParams.get("diagramExampleIds"));
    assert.deepEqual(serverLibrary.resolveLiveDiagramExamples(QUESTION, ids, subject).map((entry) => entry.id), [one.physics]);
  });

  await check("no subject (an old client, or a turn classified other) keeps the whole library", () => {
    for (const content of [{ plan }, { plan, subject: "other" }, { plan, subject: "biology" }]) {
      const seen = new Set(pickerCatalogueIds(content).map((id) => oracle.get(id)));
      assert.deepEqual([...seen].sort(), [...SUBJECTS].sort(), `${JSON.stringify(content.subject)} lost a subject`);
    }
    const all = SUBJECTS.map((subject) => idsOf(subject)[0]!);
    assert.deepEqual(serverLibrary.resolveLiveDiagramExamples(QUESTION, all).map((entry) => entry.id), all);
    assert.equal(serverLibrary.parseLiveDiagramExampleSubject?.("other") ?? null, null);
  });

  await check("the live client sends the turn's subject", async () => {
    let sent: Record<string, unknown> = {};
    await pickerClient.pickLiveDiagramExampleIds({ question: QUESTION, plan, subject: "physics",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
        sent = JSON.parse(body.messages[0]!.content) as Record<string, unknown>;
        return Response.json({ choices: [{ message: { content: '{"ids":[]}' } }] });
      } } as Parameters<typeof pickerClient.pickLiveDiagramExampleIds>[0]);
    assert.equal(sent.subject, "physics", "the picker request carries no subject");
    assert.equal(pickerClient.scenePlannerUrlWithExampleIds("/api/chat", ["one"], "maths" as never),
      "/api/chat?diagramExampleIds=one&diagramSubject=maths", "the scene planner URL carries no subject");
    const handler = readFileSync(resolve(appRoot, "features/tutor-session/hooks/turn/useQuestionHandler.ts"), "utf8");
    const pickerCall = handler.slice(handler.indexOf("pickLiveDiagramExampleIds({"), handler.indexOf("}).then((picked)"));
    assert.match(pickerCall, /subject: diagramSubject/, "the live handler does not pass its subject to the picker");
    assert.match(handler, /scenePlannerUrlWithExampleIds\(plannerUrl, pickedIds, diagramSubject\)/,
      "the live handler does not pass its subject to the scene planner");
    const route = readFileSync(resolve(appRoot, "app/api/chat/route.ts"), "utf8");
    assert.match(route, /parseLiveDiagramExampleSubject\(requestUrl\.searchParams\.get\("diagramSubject"\)\)/,
      "the chat route does not read the scene planner's subject");
    assert.match(route, /resolveLiveDiagramExamples\(question, diagramExampleIds, diagramExampleSubject\)/,
      "the chat route does not resolve ids within the subject");
  });

  await check("the lab production profile passes the subject the same way", async () => {
    const library = examples.loadDiagramExemplarLibrary(libraryPath, []);
    const physicsId = idsOf("physics")[0]!;
    const mathsId = idsOf("maths")[0]!;
    let sent: Record<string, unknown> = {};
    const picked = await productionProfile.pickProductionLabExamples(library, {
      origin: "http://127.0.0.1:3000", question: QUESTION, plan, subject: "physics",
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
        sent = JSON.parse(body.messages[0]!.content) as Record<string, unknown>;
        return Response.json({ choices: [{ message: { content: JSON.stringify({ ids: [mathsId, physicsId] }) } }] });
      },
    } as Parameters<typeof productionProfile.pickProductionLabExamples>[1]);
    assert.equal(sent.subject, "physics", "the lab picker request carries no subject");
    assert.deepEqual(picked.record.ids, [physicsId], "the lab admitted another subject's id");
    assert.equal(picked.record.catalogueEntries, idsOf("physics").length, "the lab records the whole library as its catalogue");
    const pipeline = readFileSync(resolve(appRoot, "scripts/lecture-lab/lecturePipeline.ts"), "utf8");
    const call = pipeline.slice(pipeline.indexOf("pickProductionLabExamples(examples, {"), pipeline.indexOf("}) : await pickDiagramExamples("));
    assert.match(call, /subject: classifiedSubject/, "the lab pipeline does not pass the classified subject");
  });

  await check("the lab flag takes maths or maths,physics on a strict evaluation", () => {
    const strict = ["--eval", "sample.jsonl", "--arm", "planner_examples_strict", "--max-usd", "30"];
    const subjects = (value: string) => parseOptions([...strict, "--production-strict-subjects", value]).productionStrictSubjects;
    assert.deepEqual(subjects("maths"), ["maths"]);
    assert.deepEqual(subjects("maths,physics"), ["maths", "physics"]);
    assert.deepEqual(subjects("physics, maths"), ["maths", "physics"]);
    for (const invalid of ["physics", "maths,chemistry", "maths,physics,physics", "maths,,physics", ""]) {
      assert.throws(() => subjects(invalid), /maths/, `--production-strict-subjects ${JSON.stringify(invalid)} must be rejected`);
    }
    assert.throws(() => parseOptions(["--production-strict-subjects", "maths,physics", "--max-usd", "30"]), /strict maths evaluation/);
    assert.throws(() => parseOptions([...strict, "--arm", "current", "--production-strict-subjects", "maths,physics"]), /strict maths evaluation/);
    assert.equal(parseOptions(["--eval", "sample.jsonl", "--max-usd", "30"]).productionStrictSubjects, null, "default unchanged");
  });

  const sizes = Object.fromEntries(SUBJECTS.map((subject) => {
    const entries = idsOf(subject).length;
    try {
      const library = examples.loadDiagramExemplarLibrary(libraryPath, []) as Array<{ subject?: unknown }>;
      const catalogue = examples.buildDiagramExampleCatalogue(library.filter((entry) => entry.subject === subject) as never);
      return [subject, { libraryEntries: entries, catalogueEntries: catalogue.entries.length, catalogueTokens: catalogue.estimatedTokens }];
    } catch {
      return [subject, { libraryEntries: entries }];
    }
  }));
  const whole = examples.buildDiagramExampleCatalogue(examples.loadDiagramExemplarLibrary(libraryPath, []));
  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.check}${result.detail ? `\n      ${result.detail}` : ""}`);
  console.log(JSON.stringify({ libraryEntries: rawLines.length, wholeCatalogue: { entries: whole.entries.length, tokens: whole.estimatedTokens }, bySubject: sizes }));
  const failed = results.filter((result) => !result.ok).length;
  if (failed > 0) {
    console.error(`picker subject filter: ${failed} of ${results.length} checks failed`);
    process.exitCode = 1;
    return;
  }
  console.log("picker subject filter: catalogue, id resolution, client, lab profile and lab flag PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
