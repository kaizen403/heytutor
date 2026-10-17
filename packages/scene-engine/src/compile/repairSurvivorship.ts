import type { SceneIssue } from "../types";

type RecordValue = Record<string, unknown>;
type Producer = { operator: unknown; inputs: RecordValue; outputIndex: number };
const record = (value: unknown): value is RecordValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const records = (value: unknown): RecordValue[] =>
  Array.isArray(value) ? value.filter(record) : [];
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
const role = (entity: RecordValue): string =>
  typeof entity.role === "string"
    ? entity.role
        .trim()
        .replace(/[_\s]+/g, " ")
        .toLowerCase()
    : "";
const analyticOperators = new Set([
  "function_curve",
  "parametric_curve",
  "polar_curve",
]);
const curveKinds = new Set([
  "curve",
  "function_curve",
  "parametric_curve",
  "polar_curve",
  "polyline",
]);
const namedPointRoles = [
  /\b(?:apex|highest|topmost|maximum height)\b/,
  /\b(?:launch|release|initial)\b/,
  /\b(?:landing|impact|target)\b/,
  /\b(?:ascending|rising|upward crossing)\b/,
  /\b(?:descending|falling|downward crossing)\b/,
  /\bperpendicular\b/,
];
function pointObligations(entity: RecordValue): RegExp[] {
  if (
    entity.kind !== "point" ||
    /\b(?:direction|reference|extent|foot|below|beneath)\b/.test(role(entity))
  )
    return [];
  return namedPointRoles.filter((pattern) => pattern.test(role(entity)));
}

function producers(document: RecordValue): Map<unknown, Producer> {
  return new Map(
    records(document.constructions).flatMap((c) =>
      strings(c.outputs).map(
        (id, outputIndex) =>
          [
            id,
            {
              operator: c.operator,
              inputs: record(c.inputs) ? c.inputs : {},
              outputIndex,
            },
          ] as const,
      ),
    ),
  );
}
function typedMotionPath(producer: Producer | undefined): boolean {
  return (
    producer?.operator === "constant_acceleration_trajectory" ||
    (producer?.operator === "projectile_trajectory" &&
      producer.outputIndex === 0)
  );
}
function motionPath(producer: Producer | undefined): boolean {
  return (
    typedMotionPath(producer) ||
    analyticOperators.has(String(producer?.operator))
  );
}
function motionRole(entity: RecordValue): boolean {
  const text = role(entity);
  return (
    !/\b(?:ground|surface|wall|incline|slope)\b/.test(text) ||
    /\b(?:trajectory|flight path|motion path)\b/.test(text)
  );
}
function vectorMeaning(producer: Producer | undefined): unknown {
  if (
    producer?.operator === "projectile_trajectory" &&
    producer.outputIndex === 1
  )
    return "velocity";
  if (producer?.operator === "trajectory_state") return producer.inputs.kind;
  return undefined;
}

/** Construction dependencies preserve helper points, but never make a hidden path visible. */
function retainedEntities(
  document: RecordValue,
  producerMap: Map<unknown, Producer>,
): Set<unknown> {
  const entities = records(document.entities);
  const ids = new Set(entities.map((e) => e.id));
  const groups = records(document.revealGroups);
  const visible = new Set<unknown>(
    groups.length
      ? groups.flatMap((g) => strings(g.entityIds))
      : strings(document.requiredEntityIds),
  );
  const reachable = new Set(visible);
  const visit = (value: unknown): void => {
    if (typeof value === "string" && ids.has(value) && !reachable.has(value)) {
      reachable.add(value);
      visit(producerMap.get(value)?.inputs);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (record(value)) Object.values(value).forEach(visit);
  };
  for (const id of visible) visit(producerMap.get(id)?.inputs);
  for (const entity of entities)
    if (
      entity.kind === "point" &&
      !pointObligations(entity).length &&
      reachable.has(entity.id)
    )
      visible.add(entity.id);
  return visible;
}

// These are semantic contradiction checks, not a demand for identical model prose.
// Numeric and positional truth remains the independent compiler's responsibility.
function roleCompatible(
  original: RecordValue,
  candidate: RecordValue,
): boolean {
  const before = role(original);
  const after = role(candidate);
  const categories =
    original.kind === "vector"
      ? [/\bvelocity\b/, /\b(?:acceleration|gravity|gravitational)\b/]
      : pointObligations(original);
  if (
    categories.some(
      (category) => category.test(before) && !category.test(after),
    )
  )
    return false;
  const path = /\b(?:trajectory|flight path|motion path)\b/;
  const surface = /\b(?:ground|surface|wall|incline|slope)\b/;
  return !(path.test(before) && surface.test(after) && !path.test(after));
}
function sameEndpoints(
  a: Producer | undefined,
  b: Producer | undefined,
): boolean {
  const start = a?.inputs.start;
  const end = a?.inputs.end;
  return (
    typeof start === "string" &&
    typeof end === "string" &&
    ((start === b?.inputs.start && end === b.inputs.end) ||
      (start === b?.inputs.end && end === b.inputs.start))
  );
}
function sameMeaning(
  original: RecordValue,
  candidate: RecordValue,
  a: Producer | undefined,
  b: Producer | undefined,
): boolean {
  if (!a || !b || !roleCompatible(original, candidate)) return false;
  const originalCurve = curveKinds.has(String(original.kind));
  const candidateCurve = curveKinds.has(String(candidate.kind));
  if (originalCurve && motionPath(a))
    return candidateCurve && motionPath(b) && motionRole(candidate);
  if (original.kind !== candidate.kind) {
    const spans = new Set(["dimension", "segment"]);
    return (
      spans.has(String(original.kind)) &&
      spans.has(String(candidate.kind)) &&
      sameEndpoints(a, b)
    );
  }
  if (original.kind === "point") {
    if (a.operator === b.operator) return true;
    return (
      ["point", "curve_anchor", "trajectory_state"].includes(
        String(a.operator),
      ) &&
      ["point", "curve_anchor", "trajectory_state"].includes(
        String(b.operator),
      ) &&
      (b.operator !== "trajectory_state" || b.inputs.kind === "position")
    );
  }
  if (original.kind === "vector") {
    const before = vectorMeaning(a);
    const after = vectorMeaning(b);
    if (before && after && before !== after) return false;
    return (
      ["vector", "trajectory_state", "projectile_trajectory"].includes(
        String(a.operator),
      ) &&
      ["vector", "trajectory_state", "projectile_trajectory"].includes(
        String(b.operator),
      )
    );
  }
  return a.operator === b.operator;
}
function lost(entityIds: string[], message: string): SceneIssue {
  return {
    code: "repair_required_geometry_lost",
    severity: "fatal",
    failureKind: "truth",
    entityIds,
    message,
  };
}

/** Preserve the chosen seed's geometric obligations, allowing equivalent constructions
 * and harmless role prose. This is an additional guard, never a substitute for compilation. */
export function validateRepairSurvivorship(
  seed: RecordValue,
  replacement: RecordValue,
): SceneIssue[] {
  const originalRequired = new Set(strings(seed.requiredEntityIds));
  const entities = records(replacement.entities);
  const originalProducers = producers(seed);
  const repairedProducers = producers(replacement);
  const retained = retainedEntities(replacement, repairedProducers);
  const originalEntities = records(seed.entities);
  return originalEntities.flatMap((entity): SceneIssue[] => {
    if (!originalRequired.has(String(entity.id)) || entity.kind === "label")
      return [];
    const eligible = entities.filter(
      (candidate) =>
        retained.has(candidate.id) &&
        sameMeaning(
          entity,
          candidate,
          originalProducers.get(entity.id),
          repairedProducers.get(candidate.id),
        ),
    );
    const stable = eligible.filter((candidate) => candidate.id === entity.id);
    const renamed = eligible.filter(
      (candidate) =>
        role(entity).length > 0 && role(candidate) === role(entity),
    );
    // If the original ID exists, a different entity cannot mask its substitution.
    const originalRoleCount = originalEntities.filter(
      (other) =>
        originalRequired.has(String(other.id)) && role(other) === role(entity),
    ).length;
    if (
      stable.length === 1 ||
      (!entities.some((candidate) => candidate.id === entity.id) &&
        originalRoleCount === 1 &&
        renamed.length === 1)
    )
      return [];
    return [
      lost(
        typeof entity.id === "string" ? [entity.id] : [],
        "A repair must retain each required geometric element with compatible construction meaning and a stable ID or unambiguous role.",
      ),
    ];
  });
}

/** Either initial lane can establish a typed functional core. Require the largest
 * declared motion-path count, not a union of optional helper entities across lanes. */
export function validateRepairCandidateSetSurvivorship(
  initialSeeds: readonly RecordValue[],
  replacement: RecordValue,
): SceneIssue[] {
  const requiredMotionCount = Math.max(
    0,
    ...initialSeeds.map((seed) => {
      const producerMap = producers(seed);
      const required = new Set(strings(seed.requiredEntityIds));
      return records(seed.entities).filter(
        (entity) =>
          required.has(String(entity.id)) &&
          curveKinds.has(String(entity.kind)) &&
          typedMotionPath(producerMap.get(entity.id)),
      ).length;
    }),
  );
  if (!requiredMotionCount) return [];
  const producerMap = producers(replacement);
  const retained = retainedEntities(replacement, producerMap);
  const motionCount = records(replacement.entities).filter(
    (entity) =>
      retained.has(entity.id) &&
      curveKinds.has(String(entity.kind)) &&
      motionPath(producerMap.get(entity.id)) &&
      motionRole(entity),
  ).length;
  return motionCount >= requiredMotionCount
    ? []
    : [
        lost(
          [],
          `A repair must retain the initial candidates' typed motion paths (${requiredMotionCount} required, ${motionCount} retained).`,
        ),
      ];
}
