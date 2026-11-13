/**
 * Onboarding copy. Three short steps: who you are, about you, your lessons.
 * Login asks nothing; the college or individual split lives only here.
 */
export const ONBOARDING_COPY = {
  steps: ["You", "About you", "Lessons"],
  role: {
    title: "College student or individual?",
    body: "Pick the one that fits. It decides what we ask next and what your home board suggests.",
    college: {
      label: "College student",
      hint: "At university: an undergraduate degree, postgraduate study, or similar",
    },
    other: {
      label: "Individual",
      hint: "In school (Class 8 to 12), preparing for JEE or boards, or learning on your own",
    },
    continue: "Continue",
    missing: "Choose one to continue.",
  },
  college: {
    title: "Tell us about your college year",
    body: "This shapes the home board. It never reaches the diagram engine.",
    yearLegend: "Year",
  },
  other: {
    title: "Tell us about your classroom",
    body: "This shapes the home board. It never reaches the diagram engine.",
    yearLegend: "Class / year",
  },
  lessons: {
    title: "How should lessons feel?",
    body: "Pick your subjects and a voice. You can change any of this later in Settings.",
  },
  shared: {
    ageTitle: "How old are you?",
    ageBody: "Accelute is not available under 13. Ages 13 to 17 need a guardian email.",
    ageMissing: "Choose your age group.",
    guardianMissing: "Enter a guardian email to continue.",
    guardianPlaceholder: "Guardian email",
    nameMissing: "Enter the name the tutor should use.",
    yearMissing: "Choose your year.",
    subjectsMissing: "Pick at least one subject.",
    yearPlaceholder: "Choose one",
    nameLabel: "What should the tutor call you?",
    namePlaceholder: "Your name",
    subjectsLegend: "Subjects",
    subjectsHint: "Pick one or more.",
    voiceLegend: "Tutor voice",
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
    continue: "Continue",
    start: "Start learning",
    saving: "Saving…",
    finishError: "We could not save your setup. Check your connection and try again.",
    guardianError: "Enter a valid guardian email.",
  },
} as const;
