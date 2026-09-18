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
   * Marker stunts: whether the hand is allowed its loud repertoire while the
   * tutor talks — a thumb-around, a knuckle roll, a flat double turn, a toss
   * and catch — on top of the small fidgets it always plays.
   */
  markerStunts: boolean;
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
  markerStunts: true,
};

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 3;

export function getMarkerColorHex(id: MarkerColorId): string {
  return MARKER_COLORS.find((entry) => entry.id === id)?.color ?? "#1B2A4A";
}

export function isMarkerColorId(value: unknown): value is MarkerColorId {
  return typeof value === "string" && MARKER_COLORS.some((entry) => entry.id === value);
}
