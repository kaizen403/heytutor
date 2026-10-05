import type { User, UserSettings } from "@prisma/client";
import {
  isAgeBand,
  isClassYear,
  isExamGoal,
  isLearnerRole,
  parseSubjects,
  type AccountProfile,
  type AccountSnapshot,
} from "./types";
import { hinglishVoiceAvailable } from "../tts/providerConfig";
import { DEFAULT_ACCOUNT_SETTINGS, parseAccountSettings, type AccountSettings } from "./userSettings";

export function mapAccountProfile(user: User): AccountProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    emailVerified: user.emailVerified?.toISOString() ?? null,
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
    examGoal: isExamGoal(user.examGoal) ? user.examGoal : null,
    classYear: isClassYear(user.classYear) ? user.classYear : null,
    learnerRole: isLearnerRole(user.learnerRole) ? user.learnerRole : null,
    subjects: parseSubjects(user.subjects),
    locale: user.locale || "en",
    ageBand: isAgeBand(user.ageBand) ? user.ageBand : null,
    guardianEmail: user.guardianEmail,
    learningNote: user.learningNote,
    createdAt: user.createdAt.toISOString(),
  };
}

/** The settings the lesson actually uses: a saved Hinglish choice reads as
 * English while the deployment has no Sarvam key, and returns with the key. */
export function mapAccountSettings(
  row: UserSettings | null,
  hinglishAvailable = hinglishVoiceAvailable(),
): AccountSettings {
  if (!row) return { ...DEFAULT_ACCOUNT_SETTINGS };
  const settings = parseAccountSettings(row);
  return settings.audioLanguage === "hinglish" && !hinglishAvailable
    ? { ...settings, audioLanguage: "english" }
    : settings;
}

export function emptySnapshot(): AccountSnapshot {
  return {
    boardCount: 0,
    lessonCount: 0,
    narrationMinutes: 0,
    exportCount: 0,
    lastBoard: null,
  };
}
