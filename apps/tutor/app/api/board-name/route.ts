const FIREWORKS_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

const TITLE_SYSTEM_PROMPT = [
  "You are a topic namer. Output a 3-5 word noun phrase that names the MATH CONCEPT the question covers.",
  "Do NOT restate the question. Do NOT describe what the student is doing.",
  "",
  "Bad (describes the student):",
  '"The user asks about fractions"',
  '"How to find the area of a cube"',
  '"What is the quadratic formula"',
  '"Find the derivative of x squared"',
  "",
  "Good (names the topic):",
  '"Adding fractions"',
  '"Area of a cube"',
  '"Quadratic formula"',
  '"Power rule derivatives"',
  '"Long division"',
  '"Slope of a line"',
  "",
  "Output ONLY the topic name. No quotes, no punctuation, no explanation.",
]
  .join("\n");

const BAD_PREFIXES = [
  "the user",
  "user",
  "how to",
  "how do",
  "how can",
  "what is",
  "what are",
  "what does",
  "what is the",
  "what are the",
  "find",
  "find the",
  "calculate",
  "calculate the",
  "compute",
  "compute the",
  "solve",
  "solve for",
  "determine",
  "determine the",
  "the student",
  "student",
  "a student",
  "question about",
  "asking about",
  "asks about",
  "wants to",
  "wants",
  "needs help",
  "needs",
  "i need",
  "i want",
  "can you",
  "could you",
  "please",
  "explain",
  "explain how",
  "explain what",
  "derivation of",
  "proving",
  "prove",
];

function cleanTitle(raw: string): string {
  let title = raw.trim().replace(/^["']|["']$/g, "").trim();

  for (const prefix of BAD_PREFIXES) {
    if (title.toLowerCase().startsWith(prefix)) {
      title = title.slice(prefix.length).trim();
      break;
    }
  }

  title = title.replace(/^["':\-–\s]+/, "").trim();
  title = title.replace(/^(the|a|an)\s+/i, "").trim();
  title = title.replace(/^(how|what|why|when|where)\s+/i, "").trim();

  if (!title) return "";

  const words = title.split(/\s+/);
  if (words.length > 0) {
    words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
    for (let i = 1; i < words.length; i++) {
      words[i] = words[i].toLowerCase();
    }
    title = words.join(" ");
  }

  return title.slice(0, 60);
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const question = typeof body?.question === "string" ? body.question.trim() : "";

  if (!question) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }

  const apiKey = process.env.FIREWORKS_API_KEY;
  if (!apiKey) {
    return Response.json({ title: question.slice(0, 40) });
  }

  const model = process.env.FIREWORKS_MODEL ?? "accounts/fireworks/models/kimi-k2p6";

  try {
    const response = await fetch(FIREWORKS_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 48,
        temperature: 0.4,
        reasoning_effort: "low",
        stream: false,
        messages: [
          { role: "system", content: TITLE_SYSTEM_PROMPT },
          { role: "user", content: question },
        ],
      }),
    });

    if (!response.ok) {
      return Response.json({ title: question.slice(0, 40) });
    }

    const data = await response.json();
    const rawTitle: string = data?.choices?.[0]?.message?.content ?? "";
    const cleaned = cleanTitle(rawTitle);

    return Response.json({ title: cleaned || question.slice(0, 40) });
  } catch {
    return Response.json({ title: question.slice(0, 40) });
  }
}
