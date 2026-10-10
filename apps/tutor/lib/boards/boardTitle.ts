const META_PHRASES = [
  "topic name",
  "math concept",
  "covered by",
  "the quest",
  "the question",
  "user wants",
  "student wants",
  "noun phrase",
  "output only",
  "names the topic",
  "what the student",
  "what the user",
  "tutoring session about the user",
];

const META_PREFIXES = [
  "the user",
  "user",
  "the student",
  "student",
  "a student",
  "wants a topic",
  "wants to",
  "wants",
  "needs a topic",
  "needs help",
  "needs",
  "question about",
  "asking about",
  "asks about",
  "i need",
  "i want",
  "can you",
  "could you",
  "please name",
  "please",
];

const TOPIC_PATTERNS: Array<{
  test: RegExp;
  title: string | ((question: string) => string);
}> = [
  {
    test: /free[- ]body|fbd/i,
    title: (question) => {
      const kg = question.match(/(\d+(?:\.\d+)?)\s*kg/i);
      if (kg && /friction|μ|mu|push|newton/i.test(question)) {
        return `${kg[1]} kg box free-body diagram`;
      }
      if (kg) {
        return `${kg[1]} kg free-body diagram`;
      }
      return "Free-body diagram problem";
    },
  },
  {
    test: /newton|second law|f\s*=\s*ma/i,
    title: "Newton's second law",
  },
  {
    test: /quadratic/i,
    title: "Quadratic equations",
  },
  {
    test: /pythagor/i,
    title: "Pythagorean theorem",
  },
  {
    test: /^(?!.*\b(?:ionic|atomic|covalent|metallic)\s+radi).*(?:\bcircle\b|circumference|\bradius\b)/is,
    title: "Circle geometry",
  },
  {
    test: /\bfractions?\b/i,
    title: "Fractions",
  },
  {
    test: /2x\s*\+\s*3|linear equation|isolate/i,
    title: "Linear equation",
  },
  {
    test: /photosynthesis|\bplants?\b|glucose/i,
    title: "Photosynthesis",
  },
  {
    test: /affect|effect|grammar|vocabulary/i,
    title: "Affect vs effect",
  },
];

/** Element symbols, so "Na+" and "Ca" keep their case in a title. */
const ELEMENT_SYMBOLS = new Set(
  ("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
    "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm " +
    "Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No " +
    "Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og").split(" "),
);

/**
 * Symbols that are also common capitalised words in a Title Case title. They
 * keep their case only when written as notation, with a charge ("As+").
 */
const WORD_LIKE_SYMBOLS = new Set(["In", "As", "At", "Be", "He", "No", "Am"]);

/** Acronyms an all caps question still keeps ("DNA AND RNA"). */
const SYLLABUS_ACRONYMS = new Set(
  ("DNA RNA ATP ADP NAD NADH NADP NADPH EMF AC DC LED LCR LC RC SHM UV IR NMR SI CGS MKS STP NTP " +
    "IUPAC VSEPR MO LCAO CFSE HCF LCM GCD AP GP HP AM GM LPG CNG").split(" "),
);

/**
 * A formula, symbol or acronym the writer cased on purpose: NaCl, H2O, pH,
 * DNA, Na+, As3+, Ca, and single letter symbols such as M (molar) or point A.
 * Its case is kept; every other word is sentence cased.
 */
function keepsWrittenCase(word: string): boolean {
  const core = word.replace(/[^A-Za-z0-9]/g, "");
  if (!core) return false;
  if (/\d/.test(core) || /[A-Z]/.test(core.slice(1)) || /^[A-Z]$/.test(core)) return true;
  if (!ELEMENT_SYMBOLS.has(core)) return false;
  return !WORD_LIKE_SYMBOLS.has(core) || /^[A-Z][a-z]?[+\-−]/.test(word);
}

function formatBoardTitle(raw: string): string {
  let title = raw.trim().replace(/^["']|["']$/g, "").trim();
  title = title.replace(/[.!?]+$/, "").trim();

  for (const prefix of META_PREFIXES) {
    if (title.toLowerCase().startsWith(prefix)) {
      title = title.slice(prefix.length).trim();
      break;
    }
  }

  title = title.replace(/^["':\-–—\s]+/, "").trim();
  title = title.replace(/^(the|a|an)\s+/i, "").trim();

  if (!title) {
    return "";
  }

  const words = title.split(/\s+/);
  // Sentence case a clearly word-like all-caps title even after a prefix leaves
  // one word. Short uppercase tokens can be notation (CO), so keep their case.
  const shouting = !/[a-z]/.test(title) && (
    words.filter((word) => /[A-Z]{2,}/.test(word)).length >= 2 ||
    (words.length === 1 && title.replace(/[^A-Z]/g, "").length > 3)
  );
  const kept = (word: string) =>
    shouting
      ? /\d/.test(word) || SYLLABUS_ACRONYMS.has(word.replace(/[^A-Za-z]/g, ""))
      : keepsWrittenCase(word);
  title = words
    .map((word, index) => {
      if (kept(word)) return word;
      const lower = word.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");

  return title.slice(0, 60);
}

export function isMetaOrInvalidBoardTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  if (normalized.length < 3) {
    return true;
  }

  if (META_PHRASES.some((phrase) => normalized.includes(phrase))) {
    return true;
  }

  if (/^(wants|needs|asking|question about|topic for)\b/.test(normalized)) {
    return true;
  }

  if (normalized.split(/\s+/).length > 12) {
    return true;
  }

  return false;
}

export function deriveBoardTitleFromQuestion(question: string): string {
  const trimmed = question.trim();
  if (!trimmed) {
    return "New board";
  }

  for (const pattern of TOPIC_PATTERNS) {
    if (pattern.test.test(trimmed)) {
      const title =
        typeof pattern.title === "function" ? pattern.title(trimmed) : pattern.title;
      return formatBoardTitle(title);
    }
  }

  const stripped = trimmed
    .replace(/^(please\s+)?(solve|find|calculate|compute|determine|explain|show|help me with)[:\s,-]+/i, "")
    .replace(/^(what is|what are|how do i|how to)\s+/i, "")
    .trim();

  // A period followed by a digit is a decimal point (0.50), never a sentence end.
  const firstSentence = stripped.split(/[!?]|\.(?!\d)/)[0]?.trim() ?? stripped;
  const clipped =
    firstSentence.length > 48
      ? firstSentence.slice(0, 48).replace(/\s+\S*$/, "").trim()
      : firstSentence;

  return formatBoardTitle(clipped || trimmed.slice(0, 48));
}

export function finalizeBoardTitle(question: string, llmRaw?: string): string {
  const cleaned = llmRaw ? formatBoardTitle(llmRaw) : "";
  if (cleaned && !isMetaOrInvalidBoardTitle(cleaned)) {
    return cleaned;
  }

  return deriveBoardTitleFromQuestion(question);
}

/**
 * Whether this ask should name the board. An abandoned first question can
 * leave a title on a board that still has no persisted turns; the next ask
 * on that empty board must rename it, or the chrome keeps naming a lesson
 * that never saved.
 */
export function boardNeedsGeneratedTitle(input: {
  isDraft: boolean;
  title: string | undefined;
  persistedTurnCount: number;
}): boolean {
  if (input.isDraft) return true;
  if (input.persistedTurnCount === 0) return true;
  const title = input.title?.trim().toLowerCase() ?? "";
  return title.length === 0 || title === "new board";
}

export const BOARD_TITLE_SYSTEM_PROMPT = [
  "You name tutoring whiteboard sessions.",
  "Output a short board title (3-7 words) that says what this lesson is about — the problem type or topic in the student's question.",
  "The title should read like a folder name the student would recognize later.",
  "",
  "Good:",
  '"5 kg box free-body diagram"',
  '"Free-body diagram with friction"',
  '"Quadratic formula"',
  '"Solving 2x + 3 = 7"',
  '"Area of a circle"',
  "",
  "Bad (never output meta text or instructions):",
  '"The user wants..."',
  '"Wants a topic name for the math concept"',
  '"Math concept covered by the question"',
  "Restating the entire long question word-for-word",
  "",
  "Output ONLY the title. No quotes, no trailing punctuation, no explanation.",
].join("\n");
