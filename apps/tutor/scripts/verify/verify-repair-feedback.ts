/**
 * Scene repair feedback, gated on recorded refusals.
 *
 * Every refused candidate in fixtures/repair-refusals.json (Kimi K3 lab
 * rounds, authored, bank and probe questions only) is validated by today's
 * production check and rendered as the repair round would send it. The
 * feedback must name each finding's element by an id the validator stamped
 * or its own message names (never an index guess), carry no vague finding,
 * say what was measured for every failed assertion, stay bounded, and add no
 * turn-plan value the candidate did not already carry. The three findings
 * behind the recorded repeated failures must now say what is wrong. The
 * renderer's own rules are checked on synthetic errors, and the repair
 * request must carry the rendered lines, not the raw error JSON.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeSceneDocumentModelOutput,
  parseScenePlannerResponseJson,
  renderRepairErrors,
  repairErrorElement,
  repairSceneDocument,
  type SceneDocumentCandidate,
  type SceneRepairError,
} from "@heytutor/tutor-core";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks += 1; };

type Item = { id: string; question: string; turnPlan: Record<string, unknown>; rawContent: string; codes: string[] };
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/repair-refusals.json"), "utf8")) as { items: Item[] };

const VAGUE = [
  /failed its required topology proof/, /disagrees with TurnPlanV3$/m, /^- assertion_failed at [^:]+: Assertion \S+ failed\.?$/m,
  /do not form an ordered path$/m, /a circuit branch was removed before validation; the load count/,
];
const MEASURED = /measured|residual|found|share no endpoint|revisit|listed twice|not a connector|relation holds|does not hold|Counted paths/i;
const MAX_CHARS = 4000;

/**
 * The invalid_id refusals a candidate carries apart from its relation ids:
 * the same candidate validated with every relation given an id. The relation
 * id exemption must not hide any of them.
 */
const otherIdRefusals = (item: Item, candidate: SceneDocumentCandidate): string[] => {
  const filled = structuredClone(candidate) as { relations?: unknown[] };
  filled.relations = (filled.relations ?? []).map((relation, index) =>
    typeof relation === "object" && relation !== null && !(relation as { id?: unknown }).id ? { ...relation, id: `relation_${index}_filled` } : relation);
  return validateProductionSceneCandidate({ candidate: filled as never, question: item.question, turnPlan: item.turnPlan as never }).errors
    .filter((error) => error.severity === "fatal" && error.code === "invalid_id").map((error) => error.path ?? "");
};

/** The relation id exemption covers relation ids alone: an entity that loses its id is still refused for it. */
const entityIdStillRefuses = (item: Item, candidate: SceneDocumentCandidate) => {
  const variant = structuredClone(candidate) as { entities?: Array<Record<string, unknown>> };
  if (!variant.entities?.[0]?.id) return;
  delete variant.entities[0].id;
  const refused = validateProductionSceneCandidate({ candidate: variant as never, question: item.question, turnPlan: item.turnPlan as never });
  check(!refused.valid && refused.errors.some((error) => error.severity === "fatal" && error.code === "invalid_id" && error.path === "entities[0].id"),
    `${item.id}: an entity without an id is still refused with invalid_id beside the relation id exemption`);
};

const lines = (text: string) => text.split("\n").filter((line) => line.startsWith("- "));
const numbers = (value: unknown): number[] => typeof value === "number" ? [value]
  : Array.isArray(value) ? value.flatMap(numbers) : typeof value === "object" && value !== null ? Object.values(value).flatMap(numbers) : [];

globalThis.fetch = (async () => { throw new Error("verify-repair-feedback is offline"); }) as typeof fetch;

async function main(): Promise<void> {
  const rendered = new Map<string, string>();
  for (const item of fixture.items) {
    const parsed = parseScenePlannerResponseJson(item.rawContent);
    check(parsed, `${item.id}: the recorded candidate parses`);
    const candidate = normalizeSceneDocumentModelOutput(parsed!, item.question);
    const before = JSON.stringify(candidate);
    const validation = validateProductionSceneCandidate({ candidate: candidate as never, question: item.question, turnPlan: item.turnPlan as never });
    // Relations arriving without ids are normalized before the id stage
    // (verify-v3-scene-validity), so a refusal recorded only for relation ids
    // now reaches the later stages: it is accepted, or refused for what the
    // id stage used to hide, and never again for a relation id.
    // Any other invalid id the record was refused for must still refuse it
    // (PR #249 review: the exemption once left those unchecked).
    const relationIdsOnly = item.codes.every((code) => code === "invalid_id") &&
      ((candidate as { relations?: unknown[] }).relations ?? []).some((relation) => !(relation as { id?: unknown } | null)?.id);
    const otherIds = relationIdsOnly ? otherIdRefusals(item, candidate) : [];
    if (relationIdsOnly && otherIds.length === 0 && validation.valid) {
      entityIdStillRefuses(item, candidate);
      continue;
    }
    check(!validation.valid, `${item.id}: still refused`);
    const errors = validation.errors as SceneRepairError[];
    const fatal = errors.filter((error) => error.severity === "fatal");
    if (relationIdsOnly) {
      check(!fatal.some((error) => error.code === "invalid_id" && /^relations\[/.test(error.path ?? "")), `${item.id}: a relation id no longer refuses the candidate`);
      for (const path of otherIds) check(fatal.some((error) => error.code === "invalid_id" && error.path === path), `${item.id}: still refused with invalid_id at ${path}`);
      entityIdStillRefuses(item, candidate);
    } else for (const code of item.codes) check(fatal.some((error) => error.code === code), `${item.id}: still refused with ${code}`);
    const text = renderRepairErrors(candidate, errors);
    rendered.set(item.id, text);
    check(text === renderRepairErrors(candidate, errors) && JSON.stringify(candidate) === before, `${item.id}: rendering is deterministic and leaves the candidate unchanged`);
    check(text.length <= MAX_CHARS, `${item.id}: feedback is bounded (${text.length} chars)`);
    for (const pattern of VAGUE) check(!pattern.test(text), `${item.id}: no vague finding ${pattern}\n${text}`);

    // Every finding is listed, or named in the omitted marker.
    for (const error of fatal) check(text.includes(`- ${error.code} at `) || new RegExp(`not listed: .*\\b${error.code}\\b`).test(text), `${item.id}: ${error.code} reaches the feedback`);

    // An element named by id is confirmed by the validator's stamp or the error's own message.
    for (const line of lines(text)) {
      const named = /^- (\S+) at (assertion|construction) (\S+?)(?:[ ;:]|$)/.exec(line);
      if (!named) continue;
      const [, code, kind, id] = named as unknown as [string, string, string, string];
      const confirmed = fatal.some((error) => error.code === code && (
        (kind === "assertion" ? error.assertionId === id : error.constructionId === id) || new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(error.message)));
      check(confirmed, `${item.id}: ${kind} ${id} is confirmed by the validator, not guessed from an index`);
    }
    // A failed geometric or topological assertion says what the engine found.
    for (const line of lines(text).filter((candidateLine) => candidateLine.startsWith("- assertion_failed"))) {
      check(MEASURED.test(line), `${item.id}: a failed assertion says what was measured: ${line.slice(0, 200)}`);
    }
    // No turn-plan derived value enters the feedback unless the candidate already carries it.
    const derived = numbers((item.turnPlan as { derived?: unknown }).derived ?? []).filter((value) => Number.isFinite(value) && !Number.isInteger(value));
    for (const value of derived) {
      const spelled = [String(value), value.toFixed(2), value.toFixed(3)];
      for (const spelling of spelled) {
        if (text.includes(spelling)) check(item.rawContent.includes(spelling), `${item.id}: derived value ${spelling} appears only because the candidate wrote it`);
      }
    }
  }

  // The findings behind the recorded repeated failures now say what is wrong.
  const of = (fragment: string) => [...rendered.entries()].filter(([id]) => id.includes(fragment)).map(([, text]) => text);
  check(of("ask|physics|2").some((text) => /no reveal group is identified as that view/.test(text) && /keep the wiring/.test(text)),
    "parallel view: the feedback says the wiring is right and the view is unnamed (it used to say the topology proof failed)");
  check(of("q_2df5faa0a514").some((text) => /acute angle \(0 to 90 degrees\)/.test(text) && /measured \{"degrees":45\}/.test(text)),
    "direction cosines: the feedback reports the measured 45 degrees and the acute-angle rule (it used to say only that the assertion failed)");
  check(of("parallel-plate-capacito").some((text) => /reaches only/.test(text)),
    "capacitor loop: the feedback names the nodes the source terminal reaches");

  // Renderer rules on synthetic errors.
  const candidate: SceneDocumentCandidate = {
    constructions: [{ id: "c_left", operator: "connect", inputs: { start: "p1", end: "p1" } }, { id: "c_right", operator: "segment", inputs: { start: "p2", end: "p3" } }],
    assertions: [{ id: "a_first" }, { id: "a_second" }],
    relations: [{}, {}, {}],
  };
  const error = (extra: Partial<SceneRepairError>): SceneRepairError => ({ code: "construction_failed", message: "something failed", severity: "fatal", ...extra });
  check(repairErrorElement(candidate, error({ path: "constructions[0]", message: "c_right: segment endpoints must be distinct" })) === "construction c_right (segment)",
    "an index the message contradicts resolves to the item the message names");
  check(repairErrorElement(candidate, error({ path: "constructions[0]", message: "endpoints must be distinct" })) === "constructions[0]",
    "an index nothing confirms stays a raw path, never a guessed id");
  check(repairErrorElement(candidate, error({ path: "constructions[1]", constructionId: "c_left" })) === "construction c_left",
    "a validator-stamped construction id wins over the path");
  check(repairErrorElement(candidate, error({ path: "assertions[0]", assertionId: "a_second" })) === "assertion a_second",
    "a validator-stamped assertion id wins over the path");
  const ambiguous: SceneDocumentCandidate = {
    constructions: [
      { id: "segment", operator: "segment", inputs: { start: "p1", end: "p2" } },
      { id: "make_edge", operator: "make_edge", inputs: { start: "p2", end: "p3" } },
    ],
  };
  check(repairErrorElement(ambiguous, error({ path: "constructions[0]", message: "make_edge: segment endpoints must be distinct" })) === "construction make_edge (make_edge)",
    "an explicit id prefix wins over a later word that matches another construction id");
  const splitValues = renderRepairErrors(candidate, [
    error({ code: "invalid_parameter", path: "constructions[0]", constructionId: "c_left", message: "tangent_line domain is outside the curve", actual: { domain: [0, 1] }, expected: { domain: [0, 2] } }),
    error({ code: "invalid_parameter", path: "constructions[1]", constructionId: "c_right", message: "tangent_line domain is outside the curve", actual: { domain: [3, 4] }, expected: { domain: [0, 5] } }),
  ]);
  check(lines(splitValues).length === 2 && splitValues.includes("[0,1]") && splitValues.includes("[3,4]") && splitValues.includes("[0,2]") && splitValues.includes("[0,5]") && splitValues.includes("\"start\":\"p1\"") && splitValues.includes("\"start\":\"p2\""),
    "findings that share a message but not a measured value stay separate, each with its own value and inputs");
  const merged = renderRepairErrors(candidate, [0, 1, 2].map((index) => error({ code: "invalid_id", path: `relations[${index}].id`, message: `relations[${index}] needs a non-empty id` })));
  check(lines(merged).length === 1 && /relations\[0\]\.id; relations\[1\]\.id; relations\[2\]\.id/.test(merged), "findings that differ only in an index are one line");
  const withInputs = renderRepairErrors(candidate, [error({ path: "constructions[0]", message: "c_left: connect endpoints must be distinct" })]);
  check(/Its inputs as written: \{"start":"p1","end":"p1"\}/.test(withInputs), "a construction finding shows the inputs the candidate wrote");
  const warned = renderRepairErrors(candidate, [error({}), { code: "approximate_relation", message: "close enough", severity: "warning" }]);
  check(/1 warning, not blocking: approximate_relation/.test(warned) && !/close enough/.test(warned), "warnings are counted, not listed");
  const flood = renderRepairErrors(candidate, Array.from({ length: 80 }, (_, index) => error({ code: `code_${index}`, message: `${"x".repeat(120)} ${index}` })), { maxChars: 1500 });
  check(flood.length <= 1500 && /more fatal findings not listed: code_\d+.* and \d+ more/.test(flood) && lines(flood).every((line) => !line.endsWith("…")),
    "a long list keeps whole lines and names what it drops");

  // The repair request carries the rendered lines, not the raw error JSON.
  const errors = [error({ path: "constructions[0]", message: "c_left: connect endpoints must be distinct", expected: "distinct" })];
  let prompt = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    prompt = body.messages.map((message) => message.content).join("\n");
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    await repairSceneDocument("Draw a segment.", candidate, errors, { proxyUrl: "http://localhost/api/chat", timeoutMs: 5_000 });
  } finally {
    globalThis.fetch = originalFetch;
  }
  check(prompt.includes("STRUCTURED VALIDATION ERRORS") && prompt.includes(renderRepairErrors(candidate, errors)), "the repair request carries the rendered findings");
  check(!prompt.includes(JSON.stringify(errors)), "the repair request no longer carries the raw error JSON");

  console.log(`verify-repair-feedback: ${checks} checks passed (${fixture.items.length} recorded refusals)`);
}

main().catch((error) => { console.error(error); process.exit(1); });
