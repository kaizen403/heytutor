/** Capture a public demo from the current, verified tutor pipeline. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { IncrementalTagParser, prepareVerifiedLessonSegments, type TutorSegment } from "@heytutor/drawing";
import { normalizeSegmentForAlignment } from "../../features/tutor-session/lib/turn/segmentPlanning";
import { runLecture, type RunLectureOptions } from "./lecturePipeline";
import { applyLectureLabHeaders } from "./labAuth";
import { gradeLecture } from "./grade";

async function main() {
  const origin = process.env.HERO_TUTOR_ORIGIN ?? "http://127.0.0.1:3001";
  const question = "A pyramid has a square base of side 6 cm and a perpendicular height of 4 cm. Find its volume and total surface area.";
  const landing = await fetch(`${origin}/`, { redirect: "manual" });
  const cookie = landing.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
  if (!cookie) throw new Error("The local tutor must enable anonymous dev sessions");
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(origin)) return nativeFetch(input, init);
    const headers = new Headers(init?.headers);
    headers.set("cookie", cookie);
    applyLectureLabHeaders(headers);
    return nativeFetch(input, { ...init, headers });
  }) as typeof fetch;

  let presentation: Parameters<NonNullable<RunLectureOptions["onPresentation"]>>[0] | undefined;
  const run = await runLecture(question, {
    origin, cookie, familiarity: "normal", fastMode: true,
    onPresentation: (value) => { presentation = value; },
  });
  mkdirSync(resolve(process.cwd(), ".lecture-lab"), { recursive: true });
  writeFileSync(resolve(process.cwd(), ".lecture-lab/landing-hero-run.json"), JSON.stringify(run, null, 2));
  if (run.error || !presentation?.diagram || !run.diagram.committed || run.diagram.declinedUnreadable) {
    throw new Error(run.error ?? "The demo requires a verified, readable, committed figure");
  }
  const teaching: TutorSegment[] = [];
  const parser = new IncrementalTagParser({ preserveStepSpeech: true, onSegmentReady: (segment) => teaching.push(segment) });
  parser.push(run.teaching.rawText);
  parser.flush();
  const prepared = prepareVerifiedLessonSegments(teaching, presentation.diagram);
  const segments = [
    ...(presentation.opening ? [presentation.opening] : []),
    ...presentation.givens,
    ...presentation.intro,
    ...prepared.segments,
  ].map((segment) => ({ ...normalizeSegmentForAlignment(segment), verifiedDiagramIntro: presentation!.intro.includes(segment) }));
  const output = resolve(process.cwd(), "../landing/src/components/hero-lesson/lessonAsset.json");
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, JSON.stringify({
    schema: 1, tier: run.diagram.tier, title: "Volume & surface area of a square pyramid", question,
    generatedAt: new Date().toISOString(), sourceCommit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
    diagram: presentation.diagram, solver: run.solver, grade: gradeLecture(run),
    segments,
  }, null, 2) + "\n");

  console.log(`Captured ${segments.length} segments; ${run.diagram.tier}; ${run.teaching.writes.length} work rows.`);

}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
