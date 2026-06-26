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
    test: /circle|radius|circumference/i,
    title: "Circle geometry",
  },
  {
    test: /fraction/i,
    title: "Fractions",
  },
  {
    test: /2x\s*\+\s*3|linear equation|isolate/i,
    title: "Linear equation",
  },
  {
    test: /photosynthesis|plant|glucose|oxygen/i,
    title: "Photosynthesis",
  },
  {
    test: /affect|effect|grammar|vocabulary/i,
    title: "Affect vs effect",
  },
];

export function formatBoardTitle(raw: string): string {
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
  if (words.length > 0) {
    words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
    for (let i = 1; i < words.length; i++) {
      const word = words[i] ?? "";
      words[i] =
        word.length <= 3 && /^[a-z]{1,3}$/i.test(word) ? word.toLowerCase() : word.toLowerCase();
    }
    title = words.join(" ");
  }

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

  const firstSentence = stripped.split(/[.!?]/)[0]?.trim() ?? stripped;
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
