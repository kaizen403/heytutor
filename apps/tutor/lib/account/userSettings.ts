import {
  STUNT_KINDS,
  parseStuntKinds,
  serializeStuntKinds,
  type StuntKind,
} from "@heytutor/whiteboard";
import {
  DEFAULT_ACCENT,
  DEFAULT_AUDIO_LANGUAGE,
  DEFAULT_FAMILIARITY,
  isSubjectFamiliarity,
  isTutorAccent,
  isTutorAudioLanguage,
} from "@heytutor/tutor-core";
import {
  DEFAULT_LECTURE_FILE_TYPE,
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_SETTINGS,
  isLectureFileType,
  isMarkerColorId,
  SPEED_MAX,
  SPEED_MIN,
  type MarkerColorId,
  type SettingsState,
} from "@/lib/account/lessonSettings";

export const SETTINGS_CACHE_KEYS = {
  fastMode: "htutor_fast_mode",
  subtitles: "htutor_subtitles",
  speed: "htutor_speed",
  markerColor: "htutor_marker_color",
  familiarity: "htutor_lesson_depth",
  audioLanguage: "htutor_audio_language",
  accent: "htutor_accent",
  narration: "htutor_narration",
  lowLatency: "htutor_low_latency_voice",
  markerStunts: "htutor_marker_stunts",
  lectureFileType: "htutor_lecture_file_type",
} as const;

export const TEACHING_NOTE_MAX = 400;

export type AccountSettings = SettingsState & {
  uiLanguage: "en";
  showHomeSuggestions: boolean;
  reducedMotion: boolean;
  teachingNote: string;
  alwaysShowUnits: boolean;
  alwaysStateLawFirst: boolean;
  rememberWeakTopics: boolean;
  emailWeeklyRecap: boolean;
  emailGuardianNotice: boolean;
};

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  speedMultiplier: DEFAULT_PLAYBACK_SPEED,
  ...DEFAULT_SETTINGS,
  uiLanguage: "en",
  showHomeSuggestions: true,
  reducedMotion: false,
  teachingNote: "",
  alwaysShowUnits: false,
  alwaysStateLawFirst: false,
  rememberWeakTopics: true,
  emailWeeklyRecap: false,
  emailGuardianNotice: true,
};

/**
 * Read the stored selection of marker stunts.
 *
 * The column started life as a boolean, so a row written before the setting
 * became a selection still says `true` or `false`. `true` means the student
 * never narrowed it, which is everything; `false` means they switched the
 * tricks off, which is nothing. A row that has never been written at all is
 * `undefined`, and that is everything too.
 */
export function parseMarkerStunts(value: unknown): StuntKind[] {
  if (value === undefined || value === null) return [...STUNT_KINDS];
  // Both the column and the local cache began as a boolean, before the setting
  // became a selection. `true` is a student who never narrowed it, which is
  // every trick; `false` is one who switched them off, which is none.
  if (value === true || value === "1" || value === "true") return [...STUNT_KINDS];
  if (value === false || value === "0" || value === "false") return [];
  return parseStuntKinds(value);
}

export function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ACCOUNT_SETTINGS.speedMultiplier;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
}

export function sanitizeTeachingNote(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, TEACHING_NOTE_MAX);
}

export function lessonSettingsFromAccount(settings: AccountSettings): SettingsState {
  return {
    speedMultiplier: settings.speedMultiplier,
    fastMode: settings.fastMode,
    familiarity: settings.familiarity,
    audioLanguage: settings.audioLanguage,
    accent: settings.accent,
    narrationEnabled: settings.narrationEnabled,
    lowLatencyVoice: settings.lowLatencyVoice,
    subtitlesEnabled: settings.subtitlesEnabled,
    markerColor: settings.markerColor,
    markerStunts: settings.markerStunts,
    lectureFileType: settings.lectureFileType,
  };
}

/** The stored form of the selection, for the row and the local cache. */
export function markerStuntsColumn(kinds: readonly StuntKind[]): string {
  return serializeStuntKinds(kinds);
}

export function parseAccountSettings(value: unknown): AccountSettings {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const familiarity = isSubjectFamiliarity(row.familiarity)
    ? row.familiarity
    : DEFAULT_FAMILIARITY;
  const audioLanguage = isTutorAudioLanguage(row.audioLanguage)
    ? row.audioLanguage
    : DEFAULT_AUDIO_LANGUAGE;
  const accent = isTutorAccent(row.accent) ? row.accent : DEFAULT_ACCENT;
  const markerColor: MarkerColorId = isMarkerColorId(row.markerColor)
    ? row.markerColor
    : DEFAULT_SETTINGS.markerColor;

  return {
    speedMultiplier: clampSpeed(Number(row.speedMultiplier)),
    fastMode: row.fastMode !== false,
    familiarity,
    audioLanguage,
    accent,
    narrationEnabled: row.narrationEnabled !== false,
    lowLatencyVoice: row.lowLatencyVoice === true,
    subtitlesEnabled: row.subtitlesEnabled === true,
    markerColor,
    markerStunts: parseMarkerStunts(row.markerStunts),
    lectureFileType: isLectureFileType(row.lectureFileType)
      ? row.lectureFileType
      : DEFAULT_LECTURE_FILE_TYPE,
    uiLanguage: "en",
    showHomeSuggestions: row.showHomeSuggestions !== false,
    reducedMotion: row.reducedMotion === true,
    teachingNote: sanitizeTeachingNote(row.teachingNote),
    alwaysShowUnits: row.alwaysShowUnits === true,
    alwaysStateLawFirst: row.alwaysStateLawFirst === true,
    rememberWeakTopics: row.rememberWeakTopics !== false,
    emailWeeklyRecap: row.emailWeeklyRecap === true,
    emailGuardianNotice: row.emailGuardianNotice !== false,
  };
}

export function accountSettingsPatch(value: unknown): Partial<AccountSettings> {
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  const next: Partial<AccountSettings> = {};

  if ("speedMultiplier" in row) next.speedMultiplier = clampSpeed(Number(row.speedMultiplier));
  if ("fastMode" in row) next.fastMode = row.fastMode === true;
  if (isSubjectFamiliarity(row.familiarity)) next.familiarity = row.familiarity;
  if (isTutorAudioLanguage(row.audioLanguage)) next.audioLanguage = row.audioLanguage;
  if (isTutorAccent(row.accent)) next.accent = row.accent;
  if ("narrationEnabled" in row) next.narrationEnabled = row.narrationEnabled === true;
  if ("lowLatencyVoice" in row) next.lowLatencyVoice = row.lowLatencyVoice === true;
  if ("subtitlesEnabled" in row) next.subtitlesEnabled = row.subtitlesEnabled === true;
  if (isMarkerColorId(row.markerColor)) next.markerColor = row.markerColor;
  if ("markerStunts" in row) next.markerStunts = parseStuntKinds(row.markerStunts);
  if (isLectureFileType(row.lectureFileType)) next.lectureFileType = row.lectureFileType;
  if ("showHomeSuggestions" in row) next.showHomeSuggestions = row.showHomeSuggestions === true;
  if ("reducedMotion" in row) next.reducedMotion = row.reducedMotion === true;
  if ("teachingNote" in row) next.teachingNote = sanitizeTeachingNote(row.teachingNote);
  if ("alwaysShowUnits" in row) next.alwaysShowUnits = row.alwaysShowUnits === true;
  if ("alwaysStateLawFirst" in row) next.alwaysStateLawFirst = row.alwaysStateLawFirst === true;
  if ("rememberWeakTopics" in row) next.rememberWeakTopics = row.rememberWeakTopics === true;
  if ("emailWeeklyRecap" in row) next.emailWeeklyRecap = row.emailWeeklyRecap === true;
  if ("emailGuardianNotice" in row) next.emailGuardianNotice = row.emailGuardianNotice === true;

  return next;
}

export function readSettingsCache(): Partial<SettingsState> {
  if (typeof window === "undefined") return {};
  const overrides: Partial<SettingsState> = {};
  try {
    if (window.localStorage.getItem(SETTINGS_CACHE_KEYS.fastMode) === "0") {
      overrides.fastMode = false;
    }
    if (window.localStorage.getItem(SETTINGS_CACHE_KEYS.subtitles) === "1") {
      overrides.subtitlesEnabled = true;
    }
    const storedSpeed = Number(window.localStorage.getItem(SETTINGS_CACHE_KEYS.speed));
    if (Number.isFinite(storedSpeed) && storedSpeed >= SPEED_MIN && storedSpeed <= SPEED_MAX) {
      overrides.speedMultiplier = storedSpeed;
    }
    const storedMarker = window.localStorage.getItem(SETTINGS_CACHE_KEYS.markerColor);
    if (isMarkerColorId(storedMarker)) overrides.markerColor = storedMarker;
    const storedLevel = window.localStorage.getItem(SETTINGS_CACHE_KEYS.familiarity);
    if (isSubjectFamiliarity(storedLevel)) overrides.familiarity = storedLevel;
    const storedLanguage = window.localStorage.getItem(SETTINGS_CACHE_KEYS.audioLanguage);
    if (isTutorAudioLanguage(storedLanguage)) overrides.audioLanguage = storedLanguage;
    const storedAccent = window.localStorage.getItem(SETTINGS_CACHE_KEYS.accent);
    if (isTutorAccent(storedAccent)) overrides.accent = storedAccent;
    if (window.localStorage.getItem(SETTINGS_CACHE_KEYS.narration) === "0") {
      overrides.narrationEnabled = false;
    }
    if (window.localStorage.getItem(SETTINGS_CACHE_KEYS.lowLatency) === "1") {
      overrides.lowLatencyVoice = true;
    }
    const storedStunts = window.localStorage.getItem(SETTINGS_CACHE_KEYS.markerStunts);
    // "" is a real answer here: it is the student having deselected every
    // trick, which `parseStuntKinds` reads as the empty list.
    if (storedStunts !== null) overrides.markerStunts = parseMarkerStunts(storedStunts);
    const storedFileType = window.localStorage.getItem(SETTINGS_CACHE_KEYS.lectureFileType);
    if (isLectureFileType(storedFileType)) overrides.lectureFileType = storedFileType;
  } catch {
    return overrides;
  }
  return overrides;
}

export function writeSettingsCache(settings: SettingsState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_CACHE_KEYS.fastMode, settings.fastMode ? "1" : "0");
    window.localStorage.setItem(SETTINGS_CACHE_KEYS.subtitles, settings.subtitlesEnabled ? "1" : "0");
    window.localStorage.setItem(SETTINGS_CACHE_KEYS.speed, String(settings.speedMultiplier));
    window.localStorage.setItem(SETTINGS_CACHE_KEYS.markerColor, settings.markerColor);
    window.localStorage.setItem(SETTINGS_CACHE_KEYS.familiarity, settings.familiarity);
    window.localStorage.setItem(SETTINGS_CACHE_KEYS.audioLanguage, settings.audioLanguage);
    window.localStorage.setItem(SETTINGS_CACHE_KEYS.accent, settings.accent);
    window.localStorage.setItem(SETTINGS_CACHE_KEYS.narration, settings.narrationEnabled ? "1" : "0");
    window.localStorage.setItem(SETTINGS_CACHE_KEYS.lowLatency, settings.lowLatencyVoice ? "1" : "0");
    window.localStorage.setItem(
      SETTINGS_CACHE_KEYS.markerStunts,
      serializeStuntKinds(settings.markerStunts),
    );
    window.localStorage.setItem(SETTINGS_CACHE_KEYS.lectureFileType, settings.lectureFileType);
  } catch {
    /* private mode / quota */
  }
}

export function teachingPromptAddon(settings: {
  teachingNote?: string | null;
  alwaysShowUnits?: boolean;
  alwaysStateLawFirst?: boolean;
}): string {
  const parts: string[] = [];
  const note = sanitizeTeachingNote(settings.teachingNote);
  if (note) {
    parts.push(
      `STUDENT TEACHING NOTE (honor in narration and work-area WRITE only; never invent diagram geometry from it):\n${note}`,
    );
  }
  if (settings.alwaysShowUnits) {
    parts.push("Always name the unit with every spoken and written quantity.");
  }
  if (settings.alwaysStateLawFirst) {
    parts.push("State the governing law or definition before substituting numbers.");
  }
  return parts.join("\n\n");
}
