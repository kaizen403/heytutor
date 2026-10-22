import assert from "node:assert/strict";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { prepareLessonOpening, shouldPrepareLessonOpening } from "../../features/tutor-session/lib/turn/lessonOpeningPreparation";
import { scenario, type FrozenStartupFixture, type FrozenStartupProjection } from "./verify-startup-turn";

const planFor = (question: string, visualRequirement: TurnPlanV3["visualRequirement"] = "none"): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, visualRequirement,
  givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
});
const concept = planFor("Explain the meaning of a chemical element.");
const projectile: TurnPlanV3 = {
  ...planFor("A projectile is launched at 20 m/s and an angle of 30 degrees on level ground. Find its range.", "required"),
  givens: [
    { id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given" },
    { id: "theta", symbol: "theta", value: 30, unit: "deg", provenance: "given" },
  ],
  unknowns: [{ id: "range", symbol: "R", unit: "m" }],
  derived: [{ id: "range", symbol: "R", value: 400 * Math.sin(Math.PI / 3) / 9.8, unit: "m", provenance: "derived", sourceText: "R = 20^2 * sin(pi / 3) / 9.8" }],
  lawIds: ["constant-acceleration"], assumptions: ["Air resistance is negligible"],
};
const qualitative: TurnPlanV3 = {
  ...planFor("Explain projectile motion on level ground and why its trajectory is parabolic.", "required"),
  unknowns: [{ id: "range", symbol: "R" }],
  qualitativeClaims: [{ id: "range", claim: "R = u^2 sin(2 theta) / g", expected: "u^2 sin(2 theta) / g", relatedQuantityIds: ["range"] }],
  lawIds: ["constant-acceleration"], assumptions: ["Air resistance is negligible"],
};

function projection(result: Awaited<ReturnType<typeof scenario>>): FrozenStartupProjection {
  assert("startup" in result && result.startup, "the actual-hook fixture must return a nonempty preparation trace");
  return result.startup;
}

function sameContent(off: FrozenStartupProjection, on: FrozenStartupProjection, id: string) {
  assert.deepEqual(on.requests, off.requests, `${id}: actual visual/planner/teaching request body bytes changed`);
  assert.deepEqual(on.output, off.output, `${id}: actual enqueue/playback/board output bytes changed`);
  assert.equal(on.planHash, off.planHash, `${id}: selected authoritative plan changed`);
  assert.equal(on.sceneHash, off.sceneHash, `${id}: selected scene document changed`);
  assert.equal(on.visualStatus, off.visualStatus, `${id}: figure admission changed`);
  assert.equal(on.errors, off.errors, `${id}: failure outcome changed`);
  assert.equal(on.errorOutputHash, off.errorOutputHash, `${id}: error message output changed`);
}

async function main() {
  const mutation = process.argv.includes("--mutate-opening-prefetch");
  const admission = { kind: "lesson" as const, isDsa: false, earlyAcknowledgement: false, current: true, paused: false };
  assert.equal(shouldPrepareLessonOpening(admission, false), false, "the experiment is explicitly default off");
  assert.equal(shouldPrepareLessonOpening(admission, true), true);
  for (const rejected of [
    { ...admission, kind: "doubt" as const }, { ...admission, kind: "resume" as const },
    { ...admission, isDsa: true }, { ...admission, earlyAcknowledgement: true },
    { ...admission, current: false }, { ...admission, paused: true },
  ]) assert.equal(shouldPrepareLessonOpening(rejected, true), false, "turn/language ownership exemptions retain admission");
  assert(prepareLessonOpening({ question: concept.question }), "a question-only concept has one exact opening");
  assert.equal(prepareLessonOpening({ question: projectile.question }), null, "unfinished Given-row presence cannot choose a problem opening");

  const fixtures: Array<{ id: string; fixture: FrozenStartupFixture; expectedStage: "question" | "authority" }> = [
    { id: "concept-text", fixture: { plan: concept }, expectedStage: "question" },
    { id: "concept-hinglish", fixture: { plan: concept, voiceKey: "hi-IN" }, expectedStage: "question" },
    { id: "qualitative-figure", fixture: { plan: qualitative }, expectedStage: "question" },
    { id: "numeric-scene", fixture: { plan: projectile, sceneResponseDelayMs: 250 }, expectedStage: "authority" },
    { id: "numeric-hinglish", fixture: { plan: projectile, sceneResponseDelayMs: 250, voiceKey: "hi-IN" }, expectedStage: "authority" },
  ];
  let figures = 0;
  for (const { id, fixture, expectedStage } of fixtures) {
    const frozenPlan = JSON.stringify(fixture.plan);
    const off = projection(await scenario("opening-prefetch-success", false, false, { ...fixture, openingPrefetchEnabled: false }));
    const on = projection(await scenario("opening-prefetch-success", false, false, {
      ...fixture, openingPrefetchEnabled: true, mutatePreparedOpeningWhenEnabled: mutation,
    }));
    assert.equal(JSON.stringify(fixture.plan), frozenPlan, `${id}: the frozen plan was mutated`);
    sameContent(off, on, id);
    assert(off.prefetched.length > 0 && on.prefetched.length > 0, `${id}: the real hook must prepare the opening`);
    const originalOpening = off.prefetched[0]!;
    const earlier = on.prefetched[0]!;
    assert.equal(earlier.textHash, originalOpening.textHash, `${id}: preparation must use the byte-identical original opening`);
    assert.equal(earlier.voiceSettingsHash, originalOpening.voiceSettingsHash, `${id}: preparation must preserve opening delivery`);
    assert.equal(earlier.voiceKey, originalOpening.voiceKey, `${id}: preparation must use the final turn voice`);
    assert(earlier.atMs < originalOpening.atMs, `${id}: preparation must start before the ordinary final prefetch`);
    const planResponse = on.stages.find((event) => event.name === "turn-plan-response");
    assert(planResponse);
    if (expectedStage === "question") assert(earlier.atMs < planResponse.atMs, `${id}: question-only preparation must overlap held planning`);
    else {
      const authorityResponse = on.stages.find((event) => event.name === "problem-authority-response");
      assert(authorityResponse && earlier.atMs >= authorityResponse.atMs, `${id}: problem preparation must wait for final numeric authority`);
      assert(on.stages.some((event) => event.name === "scene-model-request"), `${id}: the numeric case must exercise the scene wait`);
    }
    if (on.visualStatus === "validated") figures++;
  }
  assert(figures > 0, "content parity must include an actually verified figure, not only text-only outcomes");

  const acknowledgementOff = projection(await scenario("early-parity", false, true, { plan: concept, openingPrefetchEnabled: false }));
  const acknowledgementOn = projection(await scenario("early-parity", false, true, { plan: concept, openingPrefetchEnabled: true }));
  sameContent(acknowledgementOff, acknowledgementOn, "acknowledgement-exemption");
  assert.deepEqual(acknowledgementOn.prefetched, acknowledgementOff.prefetched,
    "the actual acknowledgement path must not add original-opening preparation when both flags are enabled");

  for (const mode of ["opening-prefetch-silent", "opening-prefetch-stop", "opening-prefetch-stop-scene"] as const) {
    const fixture = mode === "opening-prefetch-stop-scene" ? { plan: projectile, sceneResponseDelayMs: 250 } : { plan: concept };
    const off = projection(await scenario(mode, false, false, { ...fixture, openingPrefetchEnabled: false }));
    const on = projection(await scenario(mode, false, false, { ...fixture, openingPrefetchEnabled: true }));
    sameContent(off, on, mode);
    assert.equal(on.output.length, 0, `${mode}: speculative audio must never release narration or ink`);
    assert(on.prefetched.length > 0, `${mode}: the test must actually prepare before failure or Stop`);
    const cancelled = on.stages.find((event) => event.name === "cancel-requested");
    if (cancelled) assert(on.prefetched.every((entry) => entry.atMs <= cancelled.atMs), `${mode}: cancelled work must not start another prefetch`);
  }
  console.log(`verify-opening-preparation-hook: ${fixtures.length} successful OFF/ON pairs, acknowledgement exemption, silent failure and Stop before planning/during scene; earlier prefetch only, exact request/output hashes retained`);
  console.log("Limits: fake provider captures TTS text/delivery; no real audio timing, transport deduplication, network, paid calls, or builds measured.");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
