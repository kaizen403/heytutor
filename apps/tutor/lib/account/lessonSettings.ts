import { STUNT_KINDS, type StuntKind } from "@heytutor/whiteboard";
import {
  DEFAULT_ACCENT,
  DEFAULT_AUDIO_LANGUAGE,
  DEFAULT_FAMILIARITY,
  type SubjectFamiliarity,
  type TutorAccent,
  type TutorAudioLanguage,
} from "@heytutor/tutor-core";

/**
 * Marker ink, not UI chrome. These are painted onto the night-light paper,
 * so they are chosen for contrast against paper rather than against the page.
 */
export const MARKER_COLORS = [
  { id: "navy", color: "#1B2A4A", label: "Navy" },
  { id: "black", color: "#222222", label: "Black" },
  { id: "blue", color: "#3E8FB4", label: "Blue" },
  { id: "red", color: "#D64545", label: "Red" },
  { id: "green", color: "#4CAF7D", label: "Green" },
  { id: "purple", color: "#9B7ED9", label: "Purple" },
  { id: "orange", color: "#E8913A", label: "Orange" },
] as const;

export type MarkerColorId = (typeof MARKER_COLORS)[number]["id"];

/** Containers the lecture download can actually encode. MP4 is the default. */
export const LECTURE_FILE_TYPES = ["mp4", "webm"] as const;

export type LectureFileType = (typeof LECTURE_FILE_TYPES)[number];

export const DEFAULT_LECTURE_FILE_TYPE: LectureFileType = "mp4";

export const LECTURE_FILE_TYPE_LABELS: Record<LectureFileType, string> = {
  mp4: "MP4",
  webm: "WebM",
};

export function isLectureFileType(value: unknown): value is LectureFileType {
  return typeof value === "string" && (LECTURE_FILE_TYPES as readonly string[]).includes(value);
}

export interface SettingsState {
  speedMultiplier: number;
  fastMode: boolean;
  familiarity: SubjectFamiliarity;
  audioLanguage: TutorAudioLanguage;
  accent: TutorAccent;
  narrationEnabled: boolean;
  lowLatencyVoice: boolean;
  subtitlesEnabled: boolean;
  markerColor: MarkerColorId;
  /**
   * Marker stunts: which tricks the hand may play while the tutor talks, on
   * top of the small fidgets it always plays. A selection rather than a
   * switch, so a student can keep the knuckle roll and drop the toss. An empty
   * list is the hand with no tricks at all.
   */
  markerStunts: StuntKind[];
  /** Lecture download container. MP4 unless the student picked WebM. */
  lectureFileType: LectureFileType;
}

export const DEFAULT_SETTINGS: Omit<SettingsState, "speedMultiplier"> = {
  fastMode: true,
  familiarity: DEFAULT_FAMILIARITY,
  audioLanguage: DEFAULT_AUDIO_LANGUAGE,
  accent: DEFAULT_ACCENT,
  narrationEnabled: true,
  lowLatencyVoice: false,
  subtitlesEnabled: false,
  markerColor: "navy",
  // Everything the hand can do, until the student narrows it.
  markerStunts: [...STUNT_KINDS],
  lectureFileType: DEFAULT_LECTURE_FILE_TYPE,
};

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 3;

export function getMarkerColorHex(id: MarkerColorId): string {
  return MARKER_COLORS.find((entry) => entry.id === id)?.color ?? "#1B2A4A";
}

export function isMarkerColorId(value: unknown): value is MarkerColorId {
  return typeof value === "string" && MARKER_COLORS.some((entry) => entry.id === value);
}

/**
 * Add or remove one trick from the selection.
 *
 * The result is re-ordered through `STUNT_KINDS`, so the stored list only ever
 * has one shape for a given selection and two people who picked the same two
 * tricks in a different order have the same setting.
 */
export function toggleMarkerStunt(
  selected: readonly StuntKind[],
  kind: StuntKind,
): StuntKind[] {
  const next = selected.includes(kind)
    ? selected.filter((entry) => entry !== kind)
    : [...selected, kind];
  return STUNT_KINDS.filter((entry) => next.includes(entry));
}
