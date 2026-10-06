/**
 * Relative motion on one line, drawn from an admitted source.
 *
 * Every body is a `constant_acceleration_trajectory` with zero acceleration
 * in source metres and seconds; its t=0 marker, velocity arrow and encounter
 * marker are `trajectory_state` outputs, so the compiler checks each x, t and
 * velocity label against the evaluated motion. The lower lane is the same
 * motion seen from the reference body: the reference stays put and the
 * subject moves at v_subject − v_reference. Lanes separate the bodies on the
 * page only; the physical coordinate is x alone.
 */
import { sameSceneValue } from "../document/valueEquality";
import {
  motionRationalNumber,
  relativeMotionSource,
  type MotionRational,
  type RelativeMotionBody,
  type RelativeMotionSource,
} from "../physics/relativeMotionSource";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import {
  SCENE_DOCUMENT_VERSION,
  type SceneAssertion,
  type SceneConstruction,
  type SceneDocument,
  type SceneEntity,
  type SceneIssue,
  type SceneRevealGroup,
} from "../types";

export const RELATIVE_MOTION_SOURCE_MODEL = "relative_motion_1d" as const;

type Quantity = { id: string; symbol: string; value: number; unit: string };

function decimal(value: MotionRational): { text: string; exact: boolean } {
  // Exact when the reduced denominator has only factors 2 and 5 and few digits.
  let d = value.d;
  let places = 0;
  while (d % 2n === 0n || d % 5n === 0n) { d /= d % 2n === 0n ? 2n : 5n; }
  if (d === 1n) {
    while (10n ** BigInt(places) % value.d !== 0n) places++;
  }
  if (d === 1n && places <= 4) {
    const scaled = value.n * 10n ** BigInt(places) / value.d;
    const negative = scaled < 0n;
    const digits = (negative ? -scaled : scaled).toString().padStart(places + 1, "0");
    const text = places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
    return { text: `${negative ? "-" : ""}${text}`, exact: true };
  }
  return { text: motionRationalNumber(value).toFixed(2), exact: false };
}
function claim(symbol: string, value: MotionRational, unit: string, signed = false): string {
  const { text, exact } = decimal(value);
  const shown = signed && value.n > 0n ? `+${text}` : text;
  return `${symbol}${exact ? "=" : "≈"}${shown}${unit ? ` ${unit}` : ""}`;
}

interface Layout {
  tEnd: number;
  span: number;
  lane: number;
  minX: number;
  maxX: number;
  timeScale: number;
}

function layout(source: RelativeMotionSource): Layout {
  const { subject, reference, observer, encounter } = source;
  const vs = [subject.v, reference.v, source.relativeVelocity, ...(observer ? [observer.v] : [])].map(motionRationalNumber);
  const gap = Math.abs(motionRationalNumber(reference.x0) - motionRationalNumber(subject.x0));
  const fastest = Math.max(...vs.map(Math.abs));
  let tEnd: number;
  if (encounter.kind === "future") tEnd = motionRationalNumber(encounter.time);
  else if (encounter.kind === "past_root") tEnd = Math.abs(motionRationalNumber(encounter.algebraicTime));
  else if (encounter.kind === "never_parallel" && fastest > 0) tEnd = gap / fastest;
  else tEnd = fastest > 0 && gap > 0 ? gap / fastest : 1;
  if (!(tEnd > 0)) tEnd = 1;
  const xs: number[] = [];
  for (const body of [subject, reference, ...(observer ? [observer] : [])]) {
    const x0 = motionRationalNumber(body.x0);
    xs.push(x0, x0 + motionRationalNumber(body.v) * tEnd);
  }
  xs.push(motionRationalNumber(subject.x0) + motionRationalNumber(source.relativeVelocity) * tEnd);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const span = maxX - minX > 0 ? maxX - minX : Math.max(1, gap, fastest);
  // The fastest arrow spans a fifth of the motion; arrows share one time scale.
  const timeScale = fastest > 0 ? (0.2 * span) / fastest : 1;
  return { tEnd, span, lane: 0.22 * span, minX, maxX, timeScale };
}

class Document {
  readonly quantities: Quantity[] = [];
  readonly entities: SceneEntity[] = [];
  readonly constructions: SceneConstruction[] = [];
  readonly assertions: SceneAssertion[] = [];
  readonly helpers = new Set<string>();
  readonly groups: SceneRevealGroup[] = [];

  quantity(id: string, symbol: string, value: MotionRational | number, unit: string): string {
    this.quantities.push({ id, symbol, value: typeof value === "number" ? value : motionRationalNumber(value), unit });
    return id;
  }
  add(entity: SceneEntity, operator: string, inputs: Record<string, unknown>, outputs: string[] = [entity.id]): string {
    this.entities.push(entity);
    this.constructions.push({ id: `make_${entity.id}`, operator, inputs, outputs });
    return entity.id;
  }
  helper(id: string, x: number, y: number): string {
    this.helpers.add(id);
    return this.add({ id, kind: "point", role: "lane anchor helper" }, "point", { x, y, coordinateSpace: "world" });
  }
  note(id: string, x: number, y: number, role: string, text: string): string {
    const anchor = this.helper(`${id}_anchor`, x, y);
    this.entities.push({ id, kind: "label", role, label: text, provenance: { pinLabel: false, requireLabelLeader: false, leaderGeometrySafe: false } });
    this.constructions.push({ id: `make_${id}`, operator: "label", inputs: { target: anchor, text }, outputs: [id] });
    return id;
  }
  tag(id: string, target: string, role: string, text: string): string {
    this.entities.push({ id, kind: "label", role, label: text });
    this.constructions.push({ id: `make_${id}`, operator: "label", inputs: { target, text }, outputs: [id] });
    return id;
  }
}

interface Lane {
  trajectory: string;
  start: string;
  arrow: string;
  end: string;
}

function lane(doc: Document, key: string, name: string, x0: string, v: string, y: number, view: Layout, roles: { body: string; label: string; velocityLabel: string }): Lane {
  const trajectory = doc.add(
    { id: `${key}_path`, kind: "polyline", role: `${roles.body} motion over the shown interval`, ...(roles.label ? { label: roles.label } : {}) },
    "constant_acceleration_trajectory",
    { initialPosition: [x0, y], initialVelocity: [v, 0], acceleration: [0, 0], tMin: 0, tMax: "q_t_end", samples: 3, units: { length: "m", time: "s" } },
  );
  const start = doc.add({ id: `${key}_start`, kind: "point", role: `${roles.body} at t=0`, label: name }, "trajectory_state", { trajectory, time: 0, kind: "position" });
  const arrow = doc.add(
    { id: `${key}_velocity`, kind: "vector", role: `velocity of ${roles.body}`, label: roles.velocityLabel },
    "trajectory_state",
    { trajectory, time: 0, kind: "velocity", timeScale: view.timeScale },
  );
  const end = doc.add({ id: `${key}_end`, kind: "point", role: "trajectory end helper" }, "trajectory_state", { trajectory, time: "q_t_end", kind: "position" });
  doc.helpers.add(end);
  doc.assertions.push({ id: `${key}_start_on_path`, predicate: "on", entities: [start, trajectory], expected: true, severity: "fatal" });
  return { trajectory, start, arrow, end };
}

function bodyQuantities(doc: Document, body: RelativeMotionBody): { x0: string; v: string } {
  return {
    x0: doc.quantity(`q_x0_${body.name}`, `x0${body.name}`, body.x0, "m"),
    v: doc.quantity(`q_v_${body.name}`, `v${body.name}`, body.v, "m/s"),
  };
}

/** Builds the document for an admitted source; the compiler proves it. */
export function relativeMotionDocument(question: string, source: RelativeMotionSource): SceneDocument {
  const view = layout(source);
  const doc = new Document();
  const { subject: a, reference: b, observer, encounter } = source;
  const relName = `v${a.name}${b.name}`;
  doc.quantity("q_t_end", "tshown", view.tEnd, "s");
  const qa = bodyQuantities(doc, a);
  const qb = bodyQuantities(doc, b);
  const qRel = doc.quantity(`q_${relName}`, relName, source.relativeVelocity, "m/s");
  const qRelStart = doc.quantity(`q_x0_${a.name}_in_${b.name}`, `x0${a.name}`, a.x0, "m");
  const qRest = doc.quantity(`q_rest_${b.name}`, `v${b.name}${b.name}`, 0, "m/s");
  const pad = 0.08 * view.span;
  const y = { axis: 0, reference: view.lane, subject: 2 * view.lane, observer: 3 * view.lane, relative: -1.1 * view.lane };

  // Setup: the ground axis with its declared positive sense.
  const axisStart = doc.helper("axis_start", view.minX - pad, y.axis);
  const axisEnd = doc.helper("axis_end", view.maxX + pad, y.axis);
  doc.add({ id: "ground_axis", kind: "vector", role: "ground frame axis", label: `+x: ${source.positiveDirection}` }, "vector", { start: axisStart, end: axisEnd });

  const laneA = lane(doc, "a", a.name, qa.x0, qa.v, y.subject, view, { body: `body ${a.name}`, label: "", velocityLabel: claim(`v${a.name}`, a.v, "m/s", true) });
  const laneB = lane(doc, "b", b.name, qb.x0, qb.v, y.reference, view, { body: `body ${b.name}`, label: "", velocityLabel: claim(`v${b.name}`, b.v, "m/s", true) });
  doc.tag("a_x0", laneA.start, "initial position", claim("x", a.x0, "m"));
  doc.tag("b_x0", laneB.start, "initial position", claim("x", b.x0, "m"));
  doc.groups.push({ id: "setup", entityIds: ["ground_axis", laneA.start, laneB.start, "a_x0", "b_x0"], dependsOn: [], narrationCue: `bodies ${a.name} and ${b.name} at t=0 on the ground axis` });
  doc.groups.push({ id: "velocities", entityIds: [laneA.arrow, laneB.arrow], dependsOn: ["setup"], narrationCue: `velocities of ${a.name} and ${b.name} in the ground frame` });

  let observerLane: Lane | null = null;
  if (observer) {
    const qo = bodyQuantities(doc, observer);
    observerLane = lane(doc, "o", observer.name, qo.x0, qo.v, y.observer, view, { body: `observer ${observer.name}`, label: "", velocityLabel: claim(`v${observer.name}`, observer.v, "m/s", true) });
    doc.tag("o_x0", observerLane.start, "initial position", claim("x", observer.x0, "m"));
    doc.quantity(`q_v${a.name}${observer.name}`, `v${a.name}${observer.name}`, motionRationalNumber(a.v) - motionRationalNumber(observer.v), "m/s");
    doc.quantity(`q_v${b.name}${observer.name}`, `v${b.name}${observer.name}`, motionRationalNumber(b.v) - motionRationalNumber(observer.v), "m/s");
    doc.groups.push({ id: "observer", entityIds: [observerLane.start, observerLane.arrow, "o_x0"], dependsOn: ["velocities"], narrationCue: `observer ${observer.name} and its ground velocity` });
  }

  // The same motion seen from the reference body: it stays at its start.
  const relLane = lane(doc, "rel", a.name, qRelStart, qRel, y.relative, view, {
    body: `body ${a.name} relative to ${b.name}`,
    label: `${a.name} seen from ${b.name}`,
    velocityLabel: claim(relName, source.relativeVelocity, "m/s", true),
  });
  const restPath = doc.add(
    { id: "rest_path", kind: "polyline", role: `body ${b.name} in its own frame`, label: `${b.name} at rest` },
    "constant_acceleration_trajectory",
    { initialPosition: [qb.x0, y.relative], initialVelocity: [qRest, 0], acceleration: [0, 0], tMin: 0, tMax: "q_t_end", samples: 3, units: { length: "m", time: "s" } },
  );
  const restMark = doc.add({ id: "rest_mark", kind: "point", role: `body ${b.name} in its own frame` }, "trajectory_state", { trajectory: restPath, time: 0, kind: "position" });
  doc.note("rel_lane_note", view.minX - pad, y.relative - 0.35 * view.lane, "frame caption", `in ${b.name}'s frame`);
  doc.groups.push({ id: "relative", entityIds: [relLane.start, relLane.arrow, restMark, "rel_lane_note"], dependsOn: [observerLane ? "observer" : "velocities"], narrationCue: `${a.name} relative to ${b.name}: ${relName} = v${a.name} - v${b.name}` });

  const motion = [laneA.trajectory, laneB.trajectory, relLane.trajectory, restPath, ...(observerLane ? [observerLane.trajectory] : [])];
  const outcome: string[] = [...motion];
  if (encounter.kind === "future" || encounter.kind === "initial") {
    const qT = doc.quantity("q_t_meet", "tmeet", encounter.time, "s");
    const meetA = doc.add({ id: "a_meet", kind: "point", role: `body ${a.name} at the encounter` }, "trajectory_state", { trajectory: laneA.trajectory, time: qT, kind: "position" });
    const meetB = doc.add({ id: "b_meet", kind: "point", role: `body ${b.name} at the encounter` }, "trajectory_state", { trajectory: laneB.trajectory, time: qT, kind: "position" });
    const meetRel = doc.add({ id: "rel_meet", kind: "point", role: `${a.name} reaches ${b.name} in ${b.name}'s frame` }, "trajectory_state", { trajectory: relLane.trajectory, time: qT, kind: "position" });
    doc.add({ id: "meet_line", kind: "segment", role: "encounter: same x at the same time" }, "segment", { start: meetA, end: meetB });
    doc.tag("meet_time", meetA, "encounter time", claim("t", encounter.time, "s"));
    doc.tag("meet_x", meetB, "encounter position", claim("x", encounter.position, "m"));
    doc.assertions.push(
      { id: "meet_a_on_path", predicate: "on", entities: [meetA, laneA.trajectory], expected: true, severity: "fatal" },
      { id: "meet_b_on_path", predicate: "on", entities: [meetB, laneB.trajectory], expected: true, severity: "fatal" },
      { id: "meet_rel_on_path", predicate: "on", entities: [meetRel, relLane.trajectory], expected: true, severity: "fatal" },
    );
    outcome.push(meetA, meetB, meetRel, "meet_line", "meet_time", "meet_x");
    if (encounter.kind === "initial") {
      outcome.push(doc.note("outcome_note", view.minX - pad, y.subject + 0.45 * view.lane, "encounter outcome", "meet at start"));
    }
  } else {
    const text = encounter.kind === "past_root"
      ? "no meeting ahead"
      : encounter.kind === "never_parallel"
        ? "gap never closes"
        : "always together";
    outcome.push(doc.note("outcome_note", view.minX - pad, y.subject + 0.45 * view.lane, "encounter outcome", text));
  }
  doc.groups.push({ id: "encounter", entityIds: outcome, dependsOn: ["relative"], narrationCue: encounter.kind === "future" ? "where and when they meet" : "why there is no single meeting time" });

  // Metric proof: the drawn displacements over the same interval keep the
  // source speed ratios, so the figure cannot drift from the velocities.
  const speeds = { a: Math.abs(motionRationalNumber(a.v)), b: Math.abs(motionRationalNumber(b.v)), rel: Math.abs(motionRationalNumber(source.relativeVelocity)) };
  if (speeds.a > 0 && speeds.b > 0) {
    doc.assertions.push({ id: "ground_speed_ratio", predicate: "distance_ratio", entities: [laneA.start, laneA.end, laneB.start, laneB.end], expected: Number((speeds.a / speeds.b).toFixed(9)), severity: "fatal" });
  }
  if (speeds.rel > 0 && speeds.a > 0) {
    doc.assertions.push({ id: "relative_speed_ratio", predicate: "distance_ratio", entities: [relLane.start, relLane.end, laneA.start, laneA.end], expected: Number((speeds.rel / speeds.a).toFixed(9)), severity: "fatal" });
  }

  const required = doc.entities.map((entity) => entity.id).filter((id) => !doc.helpers.has(id) && !id.endsWith("_anchor"));
  const grouped = new Set(doc.groups.flatMap((group) => group.entityIds));
  const rest = required.filter((id) => !grouped.has(id));
  if (rest.length) doc.groups[doc.groups.length - 1]!.entityIds.push(...rest);
  for (const group of doc.groups) group.entityIds = group.entityIds.filter((id) => !doc.helpers.has(id));
  const reason = `relative motion of ${a.name} and ${b.name} on one line in the ground frame, ${source.positiveDirection} positive`;
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason },
    source: { question, synthesizedFamily: true, sourceModel: RELATIVE_MOTION_SOURCE_MODEL,
      slotSources: Object.fromEntries(doc.quantities.map(({ id }) => [id, "stem"])) },
    quantities: doc.quantities,
    entities: doc.entities,
    constructions: doc.constructions,
    relations: [],
    assertions: doc.assertions,
    annotations: [],
    requiredEntityIds: required,
    revealGroups: doc.groups,
    teachingTimeline: doc.groups.map((group, index) => ({
      id: `reveal_${group.id}`,
      action: "reveal" as const,
      targetId: group.id,
      dependsOn: index === 0 ? [] : [`reveal_${doc.groups[index - 1]!.id}`],
      narrationIntent: group.narrationCue,
    })),
  };
}

/**
 * Same-source check for a document that claims this source model: reparse
 * the actual question and require every body quantity to match it. A stale
 * or forged relative velocity, swapped body or dropped observer fails before
 * any ink.
 */
export function validateRelativeMotionSourceInputs(document: SceneDocument, question: unknown): SceneIssue[] {
  if (document.visualDecision.mode === "text_only") return [];
  const claimedSource = (document.source as Record<string, unknown> | undefined)?.sourceModel === RELATIVE_MOTION_SOURCE_MODEL;
  const admission = relativeMotionSource(question);
  // An admitted actual source cannot be opted out of by deleting metadata.
  if (!claimedSource && admission?.status !== "admitted") return [];
  if (!admission || admission.status !== "admitted") {
    return [{ code: "relative_motion_source_unsupported", severity: "fatal", path: "source.question", message: `relative motion scene needs an admitted source: ${admission?.status === "rejected" ? admission.reason : "question does not state constant 1D relative motion"}` }];
  }
  const generated = relativeMotionDocument(String(question), admission.source);
  const expected = validateSceneDocument(pruneDeadSceneEntities(generated as unknown as Record<string, unknown>)).document ?? generated;
  const issues: SceneIssue[] = [];
  const shape = (doc: SceneDocument) => ({
    quantities: doc.quantities,
    constructions: doc.constructions,
    assertions: doc.assertions,
    entities: doc.entities.map((entity) => [entity.id, entity.kind, entity.label ?? null]),
  });
  const actual = shape(document); const wanted = shape(expected);
  for (const key of ["quantities", "constructions", "assertions", "entities"] as const) {
    if (!sameSceneValue(actual[key], wanted[key])) {
      issues.push({ code: "relative_motion_source_mismatch", severity: "fatal", path: key, message: `relative motion ${key} must be exactly those computed from the admitted source (bodies, frame, units, velocities and encounter)` });
    }
  }
  return issues;
}
