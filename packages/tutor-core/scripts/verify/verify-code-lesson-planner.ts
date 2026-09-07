/**
 * Code-planner transport gate: a failed repair must not cost the code panel.
 *
 * The planner calls a language model twice: once to write the lesson, and, if
 * deterministic validation rejects it, once more to fix what was reported.
 * The second call can come back with nothing at all. Measured on Network Delay
 * Time in a live round: the repair returned an empty object, both attempts
 * were discarded, and a DSA lesson ran with no code panel and no worked
 * example beside a correct figure.
 *
 * The first attempt is strict on purpose. But when the only thing wrong with
 * it is what the repair pass would itself have tolerated — a line a few
 * characters wide, an indent step, a different example from the board — the
 * plan is worth keeping if the repair produces nothing. A slightly wide line
 * wraps. No code panel teaches nothing.
 */
import { planCodeLessonV1 } from "../../src/code/codeLessonPlanner";
import { MAX_CODE_LINE_CHARS } from "../../src/code/codeLessonPlan";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** A line past the width rule, which is a cosmetic issue by definition. */
const WIDE_LINE = `    total = ${"value_".repeat(9)}0`;
assert(WIDE_LINE.length > MAX_CODE_LINE_CHARS, "the fixture line must actually be too wide");

function plan(options: { wide: boolean }): unknown {
  const body = options.wide
    ? ["def solve(values):", WIDE_LINE, "    return total"]
    : ["def solve(values):", "    total = sum(values)", "    return total"];
  return {
    schemaVersion: "code-lesson/v1",
    title: "Sum a list",
    language: "python",
    sections: [
      {
        id: "s1",
        title: "The loop",
        explanation: "Add every value and return the running total.",
        blocks: body.map((code, index) => ({ id: `s1b${index + 1}`, code })),
        typeAlongRanges: [{ startLine: 1, endLine: body.length }],
      },
      {
        id: "s2",
        title: "Run it",
        explanation: "Run the worked example and print what comes back.",
        blocks: [
          { id: "s2b1", code: "values = [1, 2, 3]" },
          { id: "s2b2", code: "print(solve(values))" },
        ],
        typeAlongRanges: [{ startLine: 1, endLine: 2 }],
      },
    ],
    diagramHint: { structure: "none" },
  };
}

/**
 * More sections than the schema allows: a structural rejection, not a
 * cosmetic one, and not something the repair pass would wave through either.
 */
function planTooManySections(): unknown {
  return {
    schemaVersion: "code-lesson/v1",
    title: "Sum a list",
    language: "python",
    sections: Array.from({ length: 9 }, (_unused, index) => ({
      id: `s${index + 1}`,
      title: `Step ${index + 1}`,
      explanation: "Add every value and return the running total.",
      blocks: [{ id: `s${index + 1}b1`, code: "total = 0" }],
      typeAlongRanges: [{ startLine: 1, endLine: 1 }],
    })),
    diagramHint: { structure: "none" },
  };
}

function completion(body: unknown): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** Serve one canned response per call, in order. */
function serve(bodies: unknown[]): { calls: () => number } {
  let call = 0;
  globalThis.fetch = (async () => {
    const body = bodies[Math.min(call, bodies.length - 1)];
    call += 1;
    return completion(body);
  }) as typeof fetch;
  return { calls: () => call };
}

const OPTIONS = {
  proxyUrl: "http://127.0.0.1:0/plan",
  timeoutMs: 20_000,
  context: {
    familyId: "sum_values",
    familyTitle: "A single pass",
    mechanism: "add each value to a running total",
    input: { values: [1, 2, 3] },
    resultText: "6",
    frameCaptions: ["Running total after each value"],
  },
} as unknown as Parameters<typeof planCodeLessonV1>[1];

async function main(): Promise<void> {
  const realFetch = globalThis.fetch;
  try {
    // --- A clean first plan is accepted without a repair call. ---
    {
      const served = serve([plan({ wide: false })]);
      const result = await planCodeLessonV1("Sum a list of numbers.", OPTIONS);
      assert(result?.plan, "a clean plan must be accepted");
      assert(served.calls() === 1, `a clean plan must not spend a repair call, made ${served.calls()}`);
    }

    // --- The repair returning nothing must not cost a cosmetically flawed plan. ---
    {
      const rejections: string[] = [];
      const served = serve([plan({ wide: true }), {}]);
      const result = await planCodeLessonV1("Sum a list of numbers.", {
        ...OPTIONS,
        onRejected: (_phase, issues) => rejections.push(...issues.map((issue) => issue.code)),
      });
      assert(served.calls() === 2, `a wide line must be worth a repair, made ${served.calls()} call(s)`);
      assert(
        rejections.includes("line_too_wide"),
        `the width rule must be what rejected it, got ${rejections.join(",") || "nothing"}`,
      );
      assert(
        result?.plan,
        "the first plan must survive a repair that returned nothing: no code panel teaches nothing",
      );
      assert(
        result!.plan.sections.length === 2,
        "the salvaged plan must be the whole first plan, not a fragment",
      );
    }

    // --- A structurally wrong plan is not salvaged. ---
    {
      serve([planTooManySections(), {}]);
      const result = await planCodeLessonV1("Sum a list of numbers.", OPTIONS);
      assert(
        result === null,
        "a plan the schema rejects outright is not worth salvaging: the salvage covers cosmetics, not anything that failed validation",
      );
    }

    // --- A plan that parses but is broken is not salvaged. ---
    {
      // Unbalanced delimiters pass the schema and fail the format gate, which
      // is exactly the shape the salvage must refuse: a plan good enough to
      // validate and still not good enough to teach from.
      const broken = plan({ wide: false }) as {
        sections: Array<{ blocks: Array<{ id: string; code: string }> }>;
      };
      broken.sections[0]!.blocks[1] = { id: "s1b2", code: "    total = sum(values" };
      const rejections: string[] = [];
      serve([broken, {}]);
      const result = await planCodeLessonV1("Sum a list of numbers.", {
        ...OPTIONS,
        onRejected: (_phase, issues) => rejections.push(...issues.map((issue) => issue.code)),
      });
      assert(
        rejections.includes("unbalanced_delimiters"),
        `the delimiter rule must be what rejected it, got ${rejections.join(",") || "nothing"}`,
      );
      assert(
        result === null,
        "code that does not close its brackets is not worth salvaging: the student would type it",
      );
    }

    // --- Nothing parseable at all is not salvaged either. ---
    {
      serve(["not json", {}]);
      const result = await planCodeLessonV1("Sum a list of numbers.", OPTIONS);
      assert(result === null, "an unparseable first response leaves nothing to salvage");
    }

    // --- A good repair still wins over the salvaged first attempt. ---
    {
      serve([plan({ wide: true }), plan({ wide: false })]);
      const result = await planCodeLessonV1("Sum a list of numbers.", OPTIONS);
      assert(result?.plan, "a good repair must be accepted");
      const code = result!.plan.sections[0]!.blocks.map((block) => block.code).join("\n");
      assert(
        !code.includes(WIDE_LINE),
        "the repaired plan must be preferred over the salvaged one",
      );
    }
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log("verify-code-lesson-planner: a repair that returns nothing no longer costs the code panel");
}

void main();
