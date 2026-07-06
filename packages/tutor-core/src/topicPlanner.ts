import { findJeeTopicsByKeyword } from "./jee/jeeSyllabus";
import { DIAGRAM_MARKING_GUIDANCE } from "@heytutor/drawing";

interface DiagramTemplate {
  id: string;
  promptAddon: string;
}

export interface LessonPlan {
  template: DiagramTemplate | null;
  /** Compact per-question injection — NOT a monolithic syllabus dump. */
  promptAddon: string;
  matchedTopicTitles: string[];
}

const MAX_TOPIC_HINTS = 2;
const MAX_FORMULAS_PER_TOPIC = 4;

/**
 * Clicky-style separation: runtime picks template + topic hints per question.
 * The base system prompt stays thin; this addon is appended for one turn only.
 */
export function planLesson(
  question: string,
  template: DiagramTemplate | null,
): LessonPlan {
  const parts: string[] = [];
  const matchedTopics = findJeeTopicsByKeyword(question).slice(0, MAX_TOPIC_HINTS);
  const matchedTopicTitles = matchedTopics.map((t) => t.title);

  if (template) {
    const addon = template.promptAddon.includes("diagram marking rules")
      ? template.promptAddon
      : `${template.promptAddon}\n\n${DIAGRAM_MARKING_GUIDANCE}`;
    parts.push(addon);
  }

  for (const topic of matchedTopics) {
    const formulas = topic.boardFormulas.slice(0, MAX_FORMULAS_PER_TOPIC).join("; ");
    parts.push(
      `topic hint (${topic.subject}/${topic.unit} — ${topic.title}): key formulas — ${formulas}. ` +
        `if no template is on the board yet: ${topic.drawProtocol}`,
    );
  }

  if (parts.length === 0) {
    parts.push(
      "no diagram template matched. if the topic is visual, draw a complete diagram in the diagram zone (x 400–900) before writing algebra on the left.",
    );
  }

  return {
    template,
    promptAddon: parts.join("\n\n"),
    matchedTopicTitles,
  };
}
