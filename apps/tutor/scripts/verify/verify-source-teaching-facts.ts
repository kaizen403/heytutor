import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { sourceTeachingFacts } from "../../features/tutor-session/lib/turn/sourceTeachingFacts";
import { buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/physics-audit/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as {
    question: string;
    turnPlan: TurnPlanV3;
  };
const mirror = fixture("mirror");
const facts = sourceTeachingFacts(mirror.question);
assert(facts.includes("SOURCE-COMPUTED FACTS"));
assert(
  facts.includes("between F and C"),
  "object at 30 cm is between F=20 cm and C=40 cm",
);
assert(!facts.includes("beyond C"));
assert(
  sourceTeachingFacts(
    mirror.question.replace("placed 30 cm", "placed 50 cm"),
  ).includes("beyond C"),
  "facts must be recomputed from changed source geometry",
);
const prompt = buildTurnTeachingPrompt({
  ...mirror,
  diagramPromptAddon: null,
  solverProjection: null,
  codeLesson: null,
  isDsa: false,
  familiarity: "normal",
  fastMode: true,
});
assert(
  prompt.systemPrompt.includes(facts),
  "the live teaching builder must carry source facts when the planner is unavailable",
);
assert.equal(
  sourceTeachingFacts("What is the difference between mass and weight?"),
  "",
  "no source model means no independently verified facts claim",
);
const mechanics = sourceTeachingFacts(fixture("incline").question);
assert(
  mechanics.includes("T + f_k"),
  "current downslope motion requires upslope friction in the equation",
);
assert(
  mechanics.includes("4.692820"),
  "known source acceleration survives an empty planner result",
);
assert(!mechanics.includes("3.307179"));
assert(!mechanics.includes("20.078460"));
assert(
  sourceTeachingFacts(
    fixture("incline").question.replaceAll("downslope", "upslope"),
  ).includes("T - f_k"),
  "friction sign must follow source velocity in a changed question",
);
console.log(
  "PASS source teaching facts: deterministic mirror regions and force balance reach the live prompt",
);
