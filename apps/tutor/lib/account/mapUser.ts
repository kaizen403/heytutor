import type { User, UserSettings } from "@prisma/client";
import {
  isAgeBand,
  isClassYear,
  isExamGoal,
  parseSubjects,
  type AccountProfile,
  type AccountSnapshot,
} from "./types";
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
    subjects: parseSubjects(user.subjects),
    locale: user.locale || "en",
    ageBand: isAgeBand(user.ageBand) ? user.ageBand : null,
    guardianEmail: user.guardianEmail,
    learningNote: user.learningNote,
    createdAt: user.createdAt.toISOString(),
  };
}

export function mapAccountSettings(row: UserSettings | null): AccountSettings {
  if (!row) return { ...DEFAULT_ACCOUNT_SETTINGS };
  return parseAccountSettings(row);
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
