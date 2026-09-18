/**
 * Onboarding splits on college student vs individual into two setup pages.
 * Age still gates under-13. DSA stays a coming-soon chip.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLASS_YEAR_LABELS,
  COLLEGE_EXAM_GOALS,
  COLLEGE_YEARS,
  SCHOOL_EXAM_GOALS,
  SCHOOL_YEARS,
  classYearFitsRole,
  classYearsForRole,
  examGoalFitsRole,
  examGoalsForRole,
  isLearnerRole,
  profileSubtitle,
} from "../../lib/account/types";
import { ONBOARDING_COPY } from "../../lib/account/onboardingCopy";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(isLearnerRole("college") && isLearnerRole("other"), "the two learner roles must exist");
assert(!isLearnerRole("student"), "an unknown role must not pass");

assert(
  classYearsForRole("college").join(",") === COLLEGE_YEARS.join(","),
  "college onboarding must use college years",
);
assert(
  classYearsForRole("other").join(",") === SCHOOL_YEARS.join(","),
  "the other path must use school years",
);
assert(classYearFitsRole("college", "ug1") && !classYearFitsRole("college", "11"), "college is not class 11");
assert(classYearFitsRole("other", "12") && !classYearFitsRole("other", "ug2"), "school is not a college year");
assert(examGoalFitsRole("college", "coding") && !examGoalFitsRole("college", "jee_main"), "college is not JEE");
assert(examGoalFitsRole("other", "jee_main") && !examGoalFitsRole("other", "course"), "school is not course exams");
assert(
  examGoalsForRole("college").join(",") === COLLEGE_EXAM_GOALS.join(","),
  "college goals are coding, course, learning",
);
assert(
  examGoalsForRole("other").join(",") === SCHOOL_EXAM_GOALS.join(","),
  "the other path keeps JEE and school exams",
);
assert(
  CLASS_YEAR_LABELS.ug1 === "First year" && CLASS_YEAR_LABELS["11"] === "Class 11",
  "college years and school years keep their own labels",
);

assert(
  profileSubtitle({ learnerRole: "college", examGoal: "coding", classYear: "ug2" }) ===
    "College student · Coding interview · Second year",
  "a college profile names the role, the goal, and the year",
);

assert(ONBOARDING_COPY.role.title === "College student or individual?", "the first question is college student or individual");
assert(ONBOARDING_COPY.role.college.label === "College student", "college card is College student");
assert(ONBOARDING_COPY.role.other.label === "Individual", "the other card is Individual, not not-in-college");
assert(
  ONBOARDING_COPY.college.title.includes("college") && ONBOARDING_COPY.other.title.includes("classroom"),
  "the two setup pages must not share a title",
);
assert(!/[—–]| - /.test(ONBOARDING_COPY.role.title), "the first question carries no dash punctuation");

const root = resolve(import.meta.dirname, "../..");
const screen = readFileSync(resolve(root, "features/account/OnboardingScreen.tsx"), "utf8");
assert(screen.includes('"role" | "setup"') || screen.includes("type Step = \"role\" | \"setup\""), "onboarding is role then a setup page");
assert(screen.includes("pickRole(\"college\")") && screen.includes("pickRole(\"other\")"), "both answers on the first page");
assert(screen.includes("GraduationCap") && screen.includes("User"), "role cards carry college and individual logos");
assert(screen.includes("examGoalsForRole") && screen.includes("classYearsForRole"), "the setup page is chosen from the role");
assert(screen.includes("learnerRole"), "the chosen role is sent with the rest of onboarding");

const api = readFileSync(resolve(root, "app/api/account/onboarding/route.ts"), "utf8");
assert(api.includes("isLearnerRole") && api.includes("classYearFitsRole"), "the server must keep the role and the year together");
assert(api.includes("learnerRole: body.learnerRole"), "the role is stored on the account");

const login = readFileSync(resolve(root, "features/account/LoginScreen.tsx"), "utf8");
assert(login.includes("Continue as a student"), "login offers Continue as a student");
assert(login.includes("Continue as an Individual"), "login offers Continue as an Individual");
assert(login.includes("GoogleMark"), "Google sign-in buttons carry the Google logo");
assert(!login.includes("Continue as local student"), "local student is no longer a third label");
assert(!login.includes("Continue with Google"), "the Google buttons are labelled by role");
assert(!/[—–]/.test(login), "login copy carries no dash punctuation");

console.log("onboarding verification passed");
