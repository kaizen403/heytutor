/**
 * Onboarding copy. Same split as login: college student or individual.
 */
export const ONBOARDING_COPY = {
  role: {
    kicker: "Step 1 of 2",
    title: "College student or individual?",
    body: "We'll ask different questions next, so the home board fits how you study.",
    college: {
      label: "College student",
      hint: "Undergraduate or a similar degree",
    },
    other: {
      label: "Individual",
      hint: "School, an entrance exam, or learning on your own",
    },
    continue: "Continue",
    missing: "Choose one to continue.",
  },
  college: {
    kicker: "Step 2 of 2 · College student",
    title: "Set up your college classroom",
    body: "This shapes the home board. It never reaches the diagram engine.",
    yearLegend: "Year",
  },
  other: {
    kicker: "Step 2 of 2 · Individual",
    title: "Set up your classroom",
    body: "This shapes the home board. It never reaches the diagram engine.",
    yearLegend: "Class / year",
  },
  shared: {
    ageTitle: "How old are you?",
    ageBody: "Accelute is a student product. Under 13 is not allowed. Ages 13 to 17 need a guardian email.",
    ageMissing: "Choose your age group.",
    guardianMissing: "A guardian email is required if you are 13 to 17.",
    guardianPlaceholder: "Guardian email",
    yearPlaceholder: "Choose one",
    nameLabel: "Display name",
    subjectsLegend: "Subjects",
    voiceLegend: "Voice",
    familiarityLegend: "Default familiarity",
    familiarityInfoLabel: "What is default familiarity?",
    familiarityInfo: [
      "New: the tutor explains from the start.",
      "Normal: the usual pace, some explanation.",
      "Revision: shorter, assumes you already know the topic.",
    ],
    familiarityInfoNote:
      "This is how new lessons start. You can change it any time from the lesson chat bar.",
    back: "Back",
    start: "Start teaching",
    saving: "Saving…",
    finishError: "Finish every step before continuing.",
    guardianError: "Enter a valid guardian email.",
  },
} as const;
