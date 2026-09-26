const EXAM_GOALS = [
  "jee_main",
  "jee_advanced",
  "school",
  "course",
  "coding",
  "learning",
] as const;

export type ExamGoal = (typeof EXAM_GOALS)[number];

const CLASS_YEARS = ["11", "12", "dropper", "ug1", "ug2", "ug3", "ug4", "other"] as const;

export type ClassYear = (typeof CLASS_YEARS)[number];

/** First onboarding question: college student, or individual. */
const LEARNER_ROLES = ["college", "other"] as const;

export type LearnerRole = (typeof LEARNER_ROLES)[number];

export const SCHOOL_YEARS: readonly ClassYear[] = ["11", "12", "dropper", "other"];
export const COLLEGE_YEARS: readonly ClassYear[] = ["ug1", "ug2", "ug3", "ug4", "other"];

export const SCHOOL_EXAM_GOALS: readonly ExamGoal[] = [
  "jee_main",
  "jee_advanced",
  "school",
  "learning",
];
export const COLLEGE_EXAM_GOALS: readonly ExamGoal[] = ["coding", "course", "learning"];

const SUBJECTS = ["physics", "maths", "dsa", "chemistry"] as const;

export type SubjectId = (typeof SUBJECTS)[number];

/** Subjects a student can pick. DSA stays in SUBJECTS for progress tagging. */
export const AVAILABLE_SUBJECTS: readonly SubjectId[] = ["physics", "maths", "chemistry"];

/** Onboarding chips only. Never stored, never suggested. */
export const COMING_SOON_SUBJECTS: readonly SubjectId[] = ["dsa"];

const AGE_BANDS = ["under_13", "13_17", "18_plus"] as const;

export type AgeBand = (typeof AGE_BANDS)[number];

export const EXAM_GOAL_LABELS: Record<ExamGoal, string> = {
  jee_main: "JEE Main",
  jee_advanced: "JEE Advanced",
  school: "School exams",
  course: "Course exams",
  coding: "Coding interview",
  learning: "Just learning",
};

export const CLASS_YEAR_LABELS: Record<ClassYear, string> = {
  "11": "Class 11",
  "12": "Class 12",
  dropper: "Dropper",
  ug1: "First year",
  ug2: "Second year",
  ug3: "Third year",
  ug4: "Fourth year",
  other: "Other",
};

const LEARNER_ROLE_LABELS: Record<LearnerRole, string> = {
  college: "College student",
  other: "Individual",
};

export const SUBJECT_LABELS: Record<SubjectId, string> = {
  physics: "Physics",
  maths: "Maths",
  dsa: "DSA",
  chemistry: "Chemistry",
};

export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  under_13: "Under 13",
  "13_17": "13–17",
  "18_plus": "18 or older",
};

export const SETTINGS_SECTIONS = [
  "general",
  "tutor",
  "voice",
  "board",
  "appearance",
  "personalization",
  "notifications",
  "data",
  "security",
  "usage",
  "help",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  general: "General",
  tutor: "Tutor",
  voice: "Voice and speech",
  board: "Board",
  appearance: "Appearance",
  personalization: "Personalization",
  notifications: "Notifications",
  data: "Data controls",
  security: "Security",
  usage: "Plan and usage",
  help: "Help",
};

export function isExamGoal(value: unknown): value is ExamGoal {
  return typeof value === "string" && (EXAM_GOALS as readonly string[]).includes(value);
}

export function isClassYear(value: unknown): value is ClassYear {
  return typeof value === "string" && (CLASS_YEARS as readonly string[]).includes(value);
}

export function isLearnerRole(value: unknown): value is LearnerRole {
  return typeof value === "string" && (LEARNER_ROLES as readonly string[]).includes(value);
}

export function classYearsForRole(role: LearnerRole): readonly ClassYear[] {
  return role === "college" ? COLLEGE_YEARS : SCHOOL_YEARS;
}

export function examGoalsForRole(role: LearnerRole): readonly ExamGoal[] {
  return role === "college" ? COLLEGE_EXAM_GOALS : SCHOOL_EXAM_GOALS;
}

export function classYearFitsRole(role: LearnerRole, year: ClassYear): boolean {
  return classYearsForRole(role).includes(year);
}

export function examGoalFitsRole(role: LearnerRole, goal: ExamGoal): boolean {
  return examGoalsForRole(role).includes(goal);
}

function isSubjectId(value: unknown): value is SubjectId {
  return typeof value === "string" && (SUBJECTS as readonly string[]).includes(value);
}

export function isAgeBand(value: unknown): value is AgeBand {
  return typeof value === "string" && (AGE_BANDS as readonly string[]).includes(value);
}

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === "string" && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function parseSubjects(value: unknown): SubjectId[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSubjectId);
}

export function profileSubtitle(input: {
  examGoal?: string | null;
  classYear?: string | null;
  learnerRole?: string | null;
}): string | null {
  const role = isLearnerRole(input.learnerRole) ? LEARNER_ROLE_LABELS[input.learnerRole] : null;
  const goal = isExamGoal(input.examGoal) ? EXAM_GOAL_LABELS[input.examGoal] : null;
  const year = isClassYear(input.classYear) ? CLASS_YEAR_LABELS[input.classYear] : null;
  const rest = [goal, year].filter(Boolean).join(" · ");
  if (role && rest) return `${role} · ${rest}`;
  return role ?? (rest || null);
}

export type AccountProfile = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  emailVerified: string | null;
  onboardingCompletedAt: string | null;
  examGoal: ExamGoal | null;
  classYear: ClassYear | null;
  learnerRole: LearnerRole | null;
  subjects: SubjectId[];
  locale: string;
  ageBand: AgeBand | null;
  guardianEmail: string | null;
  learningNote: string | null;
  createdAt: string;
};

export type AccountSnapshot = {
  boardCount: number;
  lessonCount: number;
  narrationMinutes: number;
  exportCount: number;
  lastBoard: { id: string; title: string; updatedAt: string } | null;
};

export function firstName(name: string | null | undefined, email: string | null | undefined): string {
  const fromName = name?.trim().split(/\s+/)[0];
  if (fromName) return fromName;
  const local = email?.split("@")[0]?.trim();
  if (local) return local;
  return "Student";
}
