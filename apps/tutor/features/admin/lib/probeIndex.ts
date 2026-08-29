import { PROBE_DIFFICULTIES, unitIdFromTopicId, type ProbeDifficulty, type ProbeQuestion } from "./probes";

/**
 * Precomputed probe lookups.
 *
 * The playground renders every topic in a subject at once (342 for physics).
 * Calling `questionsForTopic` per row scanned all ~1000 probes each time, so a
 * single render cost ~350k comparisons - and that render repeats four times a
 * second while lectures run, because the queue ticks `now` for progress bars.
 * Building these maps once per probe set keeps every row lookup O(1).
 */
export interface ProbeIndex {
  /** Probes for a topic, ordered easy -> medium -> hard. */
  byTopic: ReadonlyMap<string, ProbeQuestion[]>;
  /** Probes for a unit id (`physics|2`), including every topic under it. */
  byUnit: ReadonlyMap<string, ProbeQuestion[]>;
  /** Single probe by `topicId` + difficulty. */
  byTopicDifficulty: ReadonlyMap<string, ProbeQuestion>;
  /** Probe by its own id. */
  byId: ReadonlyMap<string, ProbeQuestion>;
}

const EMPTY: ProbeQuestion[] = [];

function difficultyRank(difficulty: ProbeDifficulty): number {
  return PROBE_DIFFICULTIES.indexOf(difficulty);
}

export function topicDifficultyKey(topicId: string, difficulty: ProbeDifficulty): string {
  return `${topicId}::${difficulty}`;
}

export function buildProbeIndex(questions: readonly ProbeQuestion[]): ProbeIndex {
  const byTopic = new Map<string, ProbeQuestion[]>();
  const byUnit = new Map<string, ProbeQuestion[]>();
  const byTopicDifficulty = new Map<string, ProbeQuestion>();
  const byId = new Map<string, ProbeQuestion>();

  for (const question of questions) {
    const topic = byTopic.get(question.topicId);
    if (topic) {
      topic.push(question);
    } else {
      byTopic.set(question.topicId, [question]);
    }

    const unitId = unitIdFromTopicId(question.topicId);
    const unit = byUnit.get(unitId);
    if (unit) {
      unit.push(question);
    } else {
      byUnit.set(unitId, [question]);
    }

    byTopicDifficulty.set(topicDifficultyKey(question.topicId, question.difficulty), question);
    byId.set(question.id, question);
  }

  for (const list of byTopic.values()) {
    list.sort((left, right) => difficultyRank(left.difficulty) - difficultyRank(right.difficulty));
  }

  return { byTopic, byUnit, byTopicDifficulty, byId };
}

export function probesForTopic(index: ProbeIndex, topicId: string): ProbeQuestion[] {
  return index.byTopic.get(topicId) ?? EMPTY;
}

export function probesForUnit(index: ProbeIndex, unitId: string): ProbeQuestion[] {
  return index.byUnit.get(unitId) ?? EMPTY;
}

export function probeFor(
  index: ProbeIndex,
  topicId: string,
  difficulty: ProbeDifficulty,
): ProbeQuestion | undefined {
  return index.byTopicDifficulty.get(topicDifficultyKey(topicId, difficulty));
}

export function probesByIds(index: ProbeIndex, ids: Iterable<string>): ProbeQuestion[] {
  const picked: ProbeQuestion[] = [];
  for (const id of ids) {
    const question = index.byId.get(id);
    if (question) {
      picked.push(question);
    }
  }
  return picked;
}
