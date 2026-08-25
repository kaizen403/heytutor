export const PROBE_DIFFICULTIES = ["easy", "medium", "hard"] as const;

export type ProbeDifficulty = (typeof PROBE_DIFFICULTIES)[number];

export type ProbeQuestion = {
  id: string;
  topicId: string;
  difficulty: ProbeDifficulty;
  question: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isProbeDifficulty(value: string): value is ProbeDifficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

/** `physics|1|units-systems-and-si` → `physics|1`. */
export function unitIdFromTopicId(topicId: string): string {
  const parts = topicId.split("|");
  if (parts.length < 2) {
    return topicId;
  }
  return `${parts[0]}|${parts[1]}`;
}

export function unitIdFor(subject: string, unitNumber: number): string {
  return `${subject}|${unitNumber}`;
}

export function parseProbeFile(raw: unknown): ProbeQuestion[] {
  if (!isRecord(raw) || !Array.isArray(raw.questions)) {
    throw new Error("syllabus probe file is missing questions");
  }

  const questions: ProbeQuestion[] = [];
  for (const entry of raw.questions) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.topicId !== "string" ||
      typeof entry.difficulty !== "string" ||
      typeof entry.question !== "string"
    ) {
      throw new Error("syllabus probe question is malformed");
    }
    if (!isProbeDifficulty(entry.difficulty)) {
      throw new Error(`syllabus probe ${entry.id} has invalid difficulty`);
    }
    const question = entry.question.trim();
    if (!entry.id || !entry.topicId || !question) {
      throw new Error(`syllabus probe ${entry.id || "(missing id)"} is incomplete`);
    }
    questions.push({
      id: entry.id,
      topicId: entry.topicId,
      difficulty: entry.difficulty,
      question,
    });
  }
  return questions;
}

export function questionsForUnit(
  questions: ProbeQuestion[],
  unitId: string,
  difficulty?: ProbeDifficulty | "all",
): ProbeQuestion[] {
  const prefix = `${unitId}|`;
  return questions.filter((question) => {
    if (question.topicId !== unitId && !question.topicId.startsWith(prefix)) {
      return false;
    }
    if (!difficulty || difficulty === "all") {
      return true;
    }
    return question.difficulty === difficulty;
  });
}

export function questionsForTopic(
  questions: ProbeQuestion[],
  topicId: string,
  difficulty?: ProbeDifficulty,
): ProbeQuestion[] {
  return questions.filter((question) => {
    if (question.topicId !== topicId) {
      return false;
    }
    return difficulty === undefined || question.difficulty === difficulty;
  });
}

export function questionsByIds(questions: ProbeQuestion[], ids: Iterable<string>): ProbeQuestion[] {
  const wanted = new Set(ids);
  return questions.filter((question) => wanted.has(question.id));
}
