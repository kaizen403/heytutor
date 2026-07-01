import {
  buildJeePromptSection,
  findJeeTopicsByKeyword,
  JEE_SYLLABUS_TOPICS,
  JEE_NARRATION_LABEL_RULES,
} from "../src/jee";
import { buildTurnSystemPrompt } from "../src/systemPrompt";
import { planLesson } from "../src/topicPlanner";
import { matchDiagramTemplate } from "@heytutor/drawing";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

assert(JEE_SYLLABUS_TOPICS.length >= 45, "expected at least 45 JEE syllabus topics");
assert(
  JEE_SYLLABUS_TOPICS.filter((t) => t.subject === "math").length >= 15,
  "expected at least 15 math topics",
);
assert(
  JEE_SYLLABUS_TOPICS.filter((t) => t.subject === "physics").length >= 12,
  "expected at least 12 physics topics",
);
assert(
  JEE_SYLLABUS_TOPICS.filter((t) => t.subject === "chemistry").length >= 12,
  "expected at least 12 chemistry topics",
);

for (const topic of JEE_SYLLABUS_TOPICS) {
  assert(topic.drawProtocol.length > 20, `topic ${topic.title} missing draw protocol`);
  assert(topic.boardFormulas.length >= 3, `topic ${topic.title} needs at least 3 formulas`);
  assert(topic.keywords.length >= 3, `topic ${topic.title} needs keywords`);
}

const parabola = findJeeTopicsByKeyword("find the focus of the parabola y^2 = 4ax");
assert(parabola.some((t) => t.title.includes("parabola")), "parabola keyword match failed");

const fbd = findJeeTopicsByKeyword("draw free body diagram for block on incline");
assert(fbd.some((t) => t.title.includes("free-body") || t.title.includes("laws of motion")), "FBD keyword match failed");

const electrochem = findJeeTopicsByKeyword("nernst equation galvanic cell");
assert(electrochem.some((t) => t.title.includes("electrochemistry")), "electrochemistry keyword match failed");

const prompt = buildJeePromptSection();
assert(prompt.includes("MATHEMATICS"), "reference syllabus builder missing math section");

const beadTemplate = matchDiagramTemplate("bead on rotating hoop theta");
const beadPlan = planLesson("bead on rotating hoop small oscillation", beadTemplate);
const turnPrompt = buildTurnSystemPrompt(beadPlan.promptAddon);
assert(turnPrompt.includes("circular_motion") || turnPrompt.includes("ALREADY"), "bead turn should inject template addon");
assert(turnPrompt.length < 25000, "turn prompt should not include full syllabus dump");

assert(JEE_NARRATION_LABEL_RULES.length >= 60, "expected at least 60 label cue rules");
assert(
  JEE_NARRATION_LABEL_RULES.some((r) => r.labels.includes("θ")),
  "missing theta label cue",
);
assert(
  JEE_NARRATION_LABEL_RULES.some((r) => r.labels.includes("K_c")),
  "missing equilibrium constant cue",
);
assert(
  JEE_NARRATION_LABEL_RULES.some((r) => r.labels.includes("dy/dx")),
  "missing derivative cue",
);

console.log("verify-jee-syllabus: all checks passed");
console.log(`  topics: ${JEE_SYLLABUS_TOPICS.length}`);
console.log(`  label cues: ${JEE_NARRATION_LABEL_RULES.length}`);
console.log(`  prompt chars: ${prompt.length}`);
