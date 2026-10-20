import assert from "node:assert/strict";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { prepareLessonOpening, shouldPrepareLessonOpening } from "../../features/tutor-session/lib/turn/lessonOpeningPreparation";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

const eligible = { kind: "lesson", isDsa: false, earlyAcknowledgement: false, current: true, paused: false } as const;
assert.equal(shouldPrepareLessonOpening(eligible, false), false);
assert.equal(shouldPrepareLessonOpening(eligible, true), true);
for (const changes of [{ kind: "doubt" }, { kind: "resume" }, { isDsa: true },
  { earlyAcknowledgement: true }, { current: false }, { paused: true }] as const) {
  assert.equal(shouldPrepareLessonOpening({ ...eligible, ...changes }, true), false);
}

let pairs = 0;
for (const question of ["Explain magnetic flux.", "Draw the Lewis structure of CO2.",
  "A 12 V battery is connected across a 6 ohm resistor. Find the current.", "Find x if 2x + 3 = 7."]) {
  const turnPlan = createFallbackTurnPlanV3(question);
  const frozen = JSON.stringify(turnPlan);
  for (const narrationLanguage of ["english", "hinglish"] as const) {
    const early = prepareLessonOpening({ question, narrationLanguage });
    const settled = prepareLessonOpening({ question, turnPlan, authoritySettled: true, narrationLanguage });
    assert(settled, "the recorded final opening must be independent of board width");
    for (const diagramPromptAddon of [null, "Verified figure: retain its focus ids."]) {
      const prompt = buildTurnTeachingPrompt({ question, turnPlan, diagramPromptAddon,
        solverProjection: null, codeLesson: null, isDsa: false, familiarity: "normal", fastMode: true,
        narrationLanguage });
      assert.equal(JSON.stringify(settled), JSON.stringify(prompt.openingSegment));
      if (early) assert.equal(JSON.stringify(early), JSON.stringify(prompt.openingSegment));
      pairs++;
    }
    if (question.startsWith("Find x")) assert.equal(early, null, "do not guess the final Given-row presence");
  }
  assert.equal(JSON.stringify(turnPlan), frozen, "preparation never changes numeric authority");
}
assert.equal(prepareLessonOpening({ question: "" }), null);
console.log(`verify-opening-preparation: ${pairs} prompt/opening byte comparisons; no playback or model calls`);
