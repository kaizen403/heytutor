import type { SceneDocumentCandidate, SceneRepairError } from "./scenePlannerV2";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.flatMap(strings) : record(value) ? Object.values(value).flatMap(strings) : typeof value === "string" ? [value] : [];
const items = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(record) : [];
const indexedItems = (value: unknown) => Array.isArray(value)
  ? value.flatMap((item, index) => record(item) ? [{ item, index }] : []) : [];
const namedAssertion = (message: string, id: unknown) => typeof id === "string" &&
  message.match(/\bAssertion\s+["']?(.+?)(?:["']?:\s|["']?\s|$)/i)?.[1] === id;

/** Diagnostic context only: never changes a candidate, proof, or authoritative expected value. */
export function scenePlannerRepairFeedback(candidate: SceneDocumentCandidate, errors: readonly SceneRepairError[]) {
  const fatal = errors.filter(error => error.severity === "fatal");
  const affected = new Set(fatal.flatMap(error => error.entityIds ?? []));
  const assertionFailures = fatal.filter(error => /assertion|angle/.test(error.code));
  const assertions = indexedItems(candidate.assertions);
  const implicated = new Set<number>();
  for (const error of assertionFailures) {
    const index = error.path?.match(/^assertions\[(\d+)\]/)?.[1];
    const identified = typeof error.assertionId === "string" ? assertions.filter(entry => entry.item.id === error.assertionId) : [];
    // Real reader diagnostics carry stable IDs. Legacy callback indexes are
    // safe only for a single original record; never guess after removals.
    const indexed = !error.assertionId && assertions.length === 1
      ? assertions.filter(entry => String(entry.index) === index) : [];
    const named = assertions.filter(entry => namedAssertion(error.message, entry.item.id));
    const operands = assertions.filter(entry => strings(entry.item.entities).some(id => error.entityIds?.includes(id)));
    const scoped = identified.length ? identified : named.length ? named : operands.length ? operands : indexed.length ? indexed
      : !error.path && !error.entityIds?.length ? assertions : [];
    for (const entry of scoped) implicated.add(entry.index);
  }
  const matches = assertions.filter(entry => implicated.has(entry.index)).slice(0, 6);
  const failedAssertions: Record<string, unknown>[] = [];
  const omittedAssertions: string[] = [];
  let assertionChars = 0;
  for (const { item: assertion, index } of matches) {
    for (const id of strings(assertion.entities)) affected.add(id);
    const detail = Object.fromEntries(["id", "predicate", "entities", "expected", "severity"]
      .flatMap(key => assertion[key] === undefined ? [] : [[key, assertion[key]]]));
    const size = JSON.stringify(detail).length;
    if (size > 700 || assertionChars + size > 1_200) {
      omittedAssertions.push(`assertions[${index}]: oversized claim omitted; use authoritative facts`);
      continue;
    }
    assertionChars += size;
    failedAssertions.push(detail);
  }

  const constructions = items(candidate.constructions);
  for (const error of fatal) {
    const index = error.path?.match(/^constructions\[(\d+)\]/)?.[1];
    const call = (typeof error.constructionId === "string" ? constructions.find(entry => entry.id === error.constructionId) : undefined) ??
      (!error.constructionId && constructions.length === 1 && index !== undefined ? indexedItems(candidate.constructions).find(entry => entry.index === Number(index))?.item : undefined);
    if (call) for (const id of strings(call.outputs)) affected.add(id);
  }
  // Terminal producers alone hide the graph whose path count failed. Follow
  // shared endpoint IDs, not visual proximity, and retain exact bounded inputs.
  const incident: Record<string, unknown>[] = [];
  if (matches.some(entry => entry.item.predicate === "pathCount")) {
    const terminals = new Set(affected);
    const edges = constructions.filter(call => ["symbol", "connect", "segment"].includes(String(call.operator)) &&
      record(call.inputs) && typeof call.inputs.start === "string" && typeof call.inputs.end === "string");
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const call of edges) {
        if (incident.includes(call)) continue;
        const input = record(call.inputs) ? call.inputs : {};
        const endpoints = strings([input.start, input.end]);
        if (!endpoints.some(id => terminals.has(id))) continue;
        incident.push(call);
        for (const id of endpoints) { terminals.add(id); affected.add(id); }
        expanded = true;
      }
    }
  }
  const focus = [...incident, ...constructions.filter(call => !incident.includes(call) &&
    (call.operator === "axes" || strings(call.outputs).some(id => affected.has(id))))];
  const dependencies = new Set(focus.flatMap(call => strings(call.inputs)));
  // Exact small inputs, then direct dependencies; never resend a full invalid
  // program or silently truncate an expression/point list into different facts.
  const repairInputs: Record<string, unknown>[] = [];
  let inputChars = 0;
  for (const call of [...focus, ...constructions.filter(call => !focus.includes(call) && strings(call.outputs).some(id => dependencies.has(id)))]) {
    const detail = { id: call.id, operator: call.operator, inputs: call.inputs, outputs: call.outputs };
    const size = JSON.stringify(detail).length;
    if (size > 500 || inputChars + size > 1_500) continue;
    inputChars += size;
    repairInputs.push(detail);
  }
  const guidance: string[] = [];
  for (const assertion of failedAssertions) {
    const expected = JSON.stringify(assertion.expected);
    guidance.push(`Claim ${assertion.id} (candidate-authored): ${assertion.predicate}(${strings(assertion.entities).join(",")}),expected ${expected && expected.length <= 100 ? expected : "see authoritative facts"}. Check its predicate scope against source facts,then repair geometry.`);
  }
  if (failedAssertions.some(assertion => assertion.predicate === "pathCount")) {
    guidance.push("pathCount includes the source branch and all terminal paths,not just loads. Operands:two terminal point IDs,never a component. sameTerminalPair proves load parallelism; preserve the source's load count. Correct a planner-authored total-path count to its predicate scope while retaining required load-parallel proofs. Never replace an authoritative expected value with the measured actual value.");
  }
  if (assertionFailures.length && constructions.some(call => String(call.operator).startsWith("space_"))) {
    guidance.push("Direction cosine angles need directed space_vector arms from the origin toward positive axes. An undirected space_line gives the acute angle; it cannot prove an obtuse directed angle. Keep the authoritative angle.");
  }
  for (const call of focus.filter(call => call.operator === "axes").slice(0, 2)) {
    const input = record(call.inputs) ? call.inputs : {};
    guidance.push(`Axis ${strings(call.outputs).join(",")}: x=[${input.xMin},${input.xMax}],y=[${input.yMin},${input.yMax}]. Include curve extents too. Use labelled display units/ratios for comparable spans; convert every curve,bound,point and proof together,never source quantities or metric geometry. function_curve has no xScale/yScale inputs.`);
  }
  const pv = constructions.some(call => call.operator === "polytropic_process" || call.operator === "isochoric_process") ||
    items(candidate.entities).some(entity => /isobar|isochor|isotherm|adiabat/i.test(String(entity.role ?? "") + " " + String(entity.label ?? "")));
  if (pv && fatal.length) {
    guidance.push("P-V paths: an isobar is horizontal (polytropic_process exponent0); an isochor is vertical at fixed volume with distinct pressures (isochoric_process). Use process_state for endpoints and a real intermediate state; never reuse one diagonal chord or a zero-length segment for both. Share pressureUnit,volumeUnit,origin,pressureScale,volumeScale. Preserve source states and direction.");
  }
  // Keep complete diagnostic lines only: truncating an expression would change
  // its meaning. The original candidate and authoritative context stay intact.
  const boundedGuidance: string[] = [];
  let guidanceChars = 0;
  for (const line of guidance) {
    if (line.length > 700 || guidanceChars + line.length > 1_800) continue;
    boundedGuidance.push(line);
    guidanceChars += line.length;
  }
  if (boundedGuidance.length !== guidance.length) boundedGuidance.push("Oversized diagnostic lines omitted; retain authoritative facts.");
  return { failedAssertions, omittedAssertions, repairInputs,
    guidance: boundedGuidance.length ? `\nFAILED CLAIMS AND AXES\n${boundedGuidance.join("\n")}` : "" };
}
