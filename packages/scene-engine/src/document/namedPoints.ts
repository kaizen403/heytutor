/**
 * Every student-facing point on a compiled diagram must be marked and labeled.
 * This pass infers compact labels from roles, conventional IDs, and the
 * question, then keeps those points in the visible reveal contract.
 */
export function ensureStudentFacingPointMarks(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.entities)) return raw;
  const question = sourceQuestion(raw);
  const usedLabels = new Set<string>();
  const entities = raw.entities.map((entity) => {
    if (!isRecord(entity) || typeof entity.id !== "string") return entity;
    if (typeof entity.label === "string" && entity.label.trim()) {
      usedLabels.add(normalizeLabel(entity.label));
      return entity;
    }
    if (String(entity.kind ?? "") !== "point") return entity;
    const label = inferPointLabel(entity.id, String(entity.role ?? ""), question, usedLabels);
    if (!label) return entity;
    usedLabels.add(normalizeLabel(label));
    return { ...entity, label };
  });
  const constructed = new Set(
    (Array.isArray(raw.constructions) ? raw.constructions : []).flatMap((construction) =>
      isRecord(construction) && Array.isArray(construction.outputs)
        ? construction.outputs.filter((id): id is string => typeof id === "string")
        : []),
  );
  const labeledPointIds = entities.flatMap((entity) =>
    isRecord(entity) &&
    typeof entity.id === "string" &&
    entity.kind === "point" &&
    typeof entity.label === "string" &&
    entity.label.trim() &&
    constructed.has(entity.id)
      ? [entity.id]
      : []);
  if (labeledPointIds.length === 0) {
    return entities === raw.entities ? raw : { ...raw, entities };
  }
  const required = new Set([
    ...(Array.isArray(raw.requiredEntityIds) ? raw.requiredEntityIds : [])
      .filter((id): id is string => typeof id === "string"),
    ...labeledPointIds,
  ]);
  const revealGroups = Array.isArray(raw.revealGroups) && raw.revealGroups.length > 0
    ? raw.revealGroups.map((group, index) => {
        if (!isRecord(group) || !Array.isArray(group.entityIds)) return group;
        if (index !== 0) return group;
        return { ...group, entityIds: [...new Set([...group.entityIds, ...labeledPointIds])] };
      })
    : [{
        id: "setup",
        entityIds: [...required],
        dependsOn: [],
        narrationCue: "Mark the named points on the figure.",
      }];

  const assertionIds = new Set(
    (Array.isArray(raw.assertions) ? raw.assertions : []).flatMap((assertion) =>
      isRecord(assertion) && typeof assertion.id === "string" ? [assertion.id] : []),
  );
  const assertions = [
    ...(Array.isArray(raw.assertions) ? raw.assertions : []),
    ...labeledPointIds.flatMap((id) => {
      const assertionId = `assert_label_${id}`;
      if (assertionIds.has(assertionId)) return [];
      assertionIds.add(assertionId);
      return [{
        id: assertionId,
        predicate: "label_attached",
        entities: [id],
        expected: true,
        severity: "fatal",
        reason: "student-facing points must stay labeled",
      }];
    }),
  ];

  return {
    ...raw,
    entities,
    requiredEntityIds: [...required],
    revealGroups,
    assertions,
  };
}

function inferPointLabel(
  id: string,
  role: string,
  question: string,
  used: ReadonlySet<string>,
): string | null {
  const fromId = conventionalLabel(id);
  if (fromId && !used.has(normalizeLabel(fromId))) return fromId;
  const semantic = `${id} ${role}`.toLowerCase().replace(/[_-]+/g, " ");
  for (const [pattern, label] of ROLE_LABELS) {
    if (pattern.test(semantic) && !used.has(normalizeLabel(label))) return label;
  }
  const asked = askedPointLabels(question);
  if (asked.includes(fromId ?? "") && fromId && !used.has(normalizeLabel(fromId))) return fromId;
  return null;
}

const ROLE_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bobject position\b|\bpoint object\b/, "O"],
  [/\bintermediate(?: real)? image\b/, "I"],
  [/\bfinal(?: virtual)? image\b/, "I'"],
  [/\bimage position\b|\bparaxial image\b/, "I"],
  [/\bfocal point\b|\bfocus\b/, "F"],
  [/\bcenter of curvature\b|\bcentre of curvature\b/, "C"],
  [/\b(?:lens |mirror |surface )?vertex\b|\bpole\b/, "V"],
  [/\bobjective lens center\b/, "L_o"],
  [/\beyepiece lens center\b/, "L_e"],
  [/\bhinge\b/, "H"],
  [/\bapex\b/, "A"],
  [/\bpoint of incidence\b|\bcontact point\b/, "P"],
  [/\bcentre of mass\b|\bcenter of mass\b/, "G"],
];

function conventionalLabel(id: string): string | null {
  const normalized = id.replace(/[_-]+/g, "");
  if (/^iprime$/i.test(normalized) || /^ip$/i.test(normalized)) return "I'";
  if (/^lo$/i.test(normalized)) return "L_o";
  if (/^le$/i.test(normalized)) return "L_e";
  if (/^fo$/i.test(normalized)) return "F_o";
  if (/^fe$/i.test(normalized)) return "F_e";
  if (/^[A-Z]$/i.test(id) || /^(?:O|I|C|F|V|P|H|G)$/i.test(normalized)) {
    return normalized.toUpperCase();
  }
  return null;
}

function askedPointLabels(question: string): string[] {
  const names: string[] = [];
  for (const match of question.matchAll(/\bpoints?\s+([A-Z])(?:\s*(?:,|and|&)\s*([A-Z]))+/g)) {
    for (const part of match.slice(1)) {
      if (part && !names.includes(part)) names.push(part);
    }
  }
  for (const match of question.matchAll(/\b(?:mark|label|locate)\b[^.]{0,40}\b([A-Z])\b/g)) {
    const name = match[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

function sourceQuestion(raw: Record<string, unknown>): string {
  if (typeof raw.source === "string") return raw.source;
  if (isRecord(raw.source) && typeof raw.source.question === "string") return raw.source.question;
  return "";
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
