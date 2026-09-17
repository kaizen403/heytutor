/**
 * Onboarding copy. The first question splits the rest of the flow:
 * college students get one setup page, everyone else gets another.
 */
export const ONBOARDING_COPY = {
  role: {
    kicker: "Step 1 of 2",
    title: "Are you a college student?",
    body: "We'll ask different questions next, so the home board fits how you study.",
    college: {
      label: "Yes, I am in college",
      hint: "Undergraduate or a similar degree",
    },
    other: {
      label: "No, not in college",
      hint: "School, an entrance exam, or learning on your own",
    },
    continue: "Continue",
    missing: "Choose one to continue.",
  },
  college: {
    kicker: "Step 2 of 2 · College",
    title: "Set up your college classroom",
    body: "This shapes the home board. It never reaches the diagram engine.",
    goalLegend: "Why are you here?",
    yearLegend: "Year",
  },
  other: {
    kicker: "Step 2 of 2 · School and exams",
    title: "Set up your classroom",
    body: "This shapes the home board. It never reaches the diagram engine.",
    goalLegend: "Why are you here?",
    yearLegend: "Class / year",
  },
  shared: {
    ageTitle: "How old are you?",
    ageBody: "Accelute is a student product. Under 13 is not allowed. Ages 13 to 17 need a guardian email.",
    ageMissing: "Choose your age group.",
    guardianMissing: "A guardian email is required if you are 13 to 17.",
    guardianPlaceholder: "Guardian email",
    nameLabel: "Display name",
    subjectsLegend: "Subjects",
    voiceLegend: "Voice",
    familiarityLegend: "Default familiarity",
    back: "Back",
    start: "Start teaching",
    saving: "Saving…",
    finishError: "Finish every step before continuing.",
    guardianError: "Enter a valid guardian email.",
  },
} as const;
