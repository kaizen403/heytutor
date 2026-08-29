import type { DifficultyState } from "./lectureState";
import type { SyllabusItem } from "./parseSyllabus";
import type { ProbeQuestion } from "./probes";
import type { ItemStatus } from "./progressStorage";

export type StatusFilter = "all" | ItemStatus;
/** Where a topic stands in the lecture pipeline, collapsed across its difficulties. */
export type LectureState = "none" | "queued" | "running" | "recorded";
export type LectureFilter = "all" | LectureState;

export interface TopicFilters {
  query: string;
  status: StatusFilter;
  lecture: LectureFilter;
}

export const DEFAULT_TOPIC_FILTERS: TopicFilters = {
  query: "",
  status: "all",
  lecture: "all",
};

export const STATUS_FILTER_OPTIONS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Any status" },
  { id: "pending", label: "Not reviewed" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
  { id: "needs-improvement", label: "Needs work" },
];

export const LECTURE_FILTER_OPTIONS: { id: LectureFilter; label: string }[] = [
  { id: "all", label: "Any lecture" },
  { id: "recorded", label: "Has recording" },
  { id: "running", label: "Recording now" },
  { id: "queued", label: "Queued" },
  { id: "none", label: "No recording" },
];

export function filtersAreActive(filters: TopicFilters): boolean {
  return (
    filters.query.trim().length > 0 || filters.status !== "all" || filters.lecture !== "all"
  );
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Matches the topic label and its probe questions. Reviewers usually remember
 * the wording of a question rather than the syllabus label, so both are searched.
 */
export function topicMatchesQuery(
  item: SyllabusItem,
  probes: readonly ProbeQuestion[],
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }
  if (item.text.toLowerCase().includes(normalizedQuery)) {
    return true;
  }
  return probes.some((probe) => probe.question.toLowerCase().includes(normalizedQuery));
}

export function topicMatchesFilters(
  item: SyllabusItem,
  probes: readonly ProbeQuestion[],
  status: ItemStatus,
  lecture: LectureState,
  filters: TopicFilters,
  normalizedQuery = normalizeQuery(filters.query),
): boolean {
  if (!topicMatchesQuery(item, probes, normalizedQuery)) {
    return false;
  }
  if (filters.status !== "all" && status !== filters.status) {
    return false;
  }
  if (filters.lecture !== "all" && lecture !== filters.lecture) {
    return false;
  }
  return true;
}

/**
 * Most advanced state across a topic's difficulties: recorded beats running
 * beats queued. `missing` and `idle` both collapse to `none`, since the filter
 * only cares whether a lecture exists, not whether a fixture was authored.
 */
export function collapseLectureState(states: readonly DifficultyState[]): LectureState {
  let best: LectureState = "none";
  for (const state of states) {
    if (state === "recorded") {
      return "recorded";
    }
    if (state === "running") {
      best = "running";
    } else if (state === "queued" && best === "none") {
      best = "queued";
    }
  }
  return best;
}
