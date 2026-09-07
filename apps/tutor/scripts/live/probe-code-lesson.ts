/**
 * Live probe for the code-lesson planner lane. Calls the running dev server
 * exactly as the client does, then prints the raw model output and every
 * deterministic issue so a rejection can be diagnosed without the browser.
 *
 * Usage: pnpm --filter @heytutor/tutor exec tsx scripts/live/probe-code-lesson.ts "reverse a linked list in java"
 */
import {
  CODE_LESSON_V1_PROMPT,
  codeFormatGateIssues,
  normalizeCodeLessonPlan,
  validateCodeLessonPlan,
} from "@heytutor/tutor-core";

async function main(): Promise<void> {
  const question = process.argv[2] ?? "reverse a linked list in java";
  const origin = process.env.PROBE_ORIGIN ?? "http://127.0.0.1:3000";
  const deadlineMs = Number.parseInt(process.env.PROBE_DEADLINE_MS ?? "60000", 10);

  // The API is gated on the anonymous htutor_uid cookie the landing page mints.
  const landing = await fetch(`${origin}/`, { redirect: "manual" });
  const cookie = (landing.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(";")[0])
    .join("; ");
  console.log(`cookie=${cookie || "(none)"}`);

  const started = Date.now();
  const response = await fetch(`${origin}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-planner": "1",
      "x-code-lesson-version": "1",
      "x-planner-deadline-ms": String(deadlineMs),
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({
      model: "server",
      max_tokens: 4200,
      temperature: 0,
      stream: false,
      messages: [
        { role: "system", content: CODE_LESSON_V1_PROMPT },
        { role: "user", content: `QUESTION\n${question}` },
      ],
    }),
  });

  console.log(`status=${response.status} elapsed_ms=${Date.now() - started}`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    console.log("no string content", JSON.stringify(payload).slice(0, 2000));
    return;
  }

  console.log(`content_chars=${content.length}`);
  console.log("----- raw content -----");
  console.log(content);
  console.log("----- end raw content -----");

  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    console.log("ISSUE: no JSON object braces found (likely truncated output)");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (error) {
    console.log(`ISSUE: JSON.parse failed: ${(error as Error).message}`);
    return;
  }

  const normalized = normalizeCodeLessonPlan(parsed, question);
  const validated = validateCodeLessonPlan(normalized);
  console.log("shape issues:", validated.issues);
  if (validated.plan) {
    console.log("format gate issues:", codeFormatGateIssues(validated.plan));
    for (const section of validated.plan.sections) {
      console.log(
        `section ${section.id} "${section.title}" blocks=${section.blocks.length} ranges=${JSON.stringify(section.typeAlongRanges)}`,
      );
    }
    console.log("diagramHint:", JSON.stringify(validated.plan.diagramHint));
  }
}

void main();
