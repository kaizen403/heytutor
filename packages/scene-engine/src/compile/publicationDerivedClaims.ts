import type { SceneConstruction, SceneDocument, SceneIssue } from "../types";

/** A claim can use only a meaning explicitly supplied by evaluated typed metadata. */
export type PublicationClaimAuthority = Readonly<Record<string, number | readonly [number, number]>>;
const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const SCALAR = new RegExp(`^(${NUMBER})$`);
const PAIR = new RegExp(`^[([]\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*[)\\]]$`);
const key = (text: string): string => text.trim().replace(/_/g, "").replace(/\s+/g, "").toLowerCase();
function fail(message: string): never { throw new Error(message); }
function compare(token: string, expected: number, approximate = false): void {
  const actual = Number(token);
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) fail("Derived claims require finite numeric authority");
  if (actual === 0 && /[1-9]/.test(token.split(/[eE]/)[0]!)) fail("A nonzero literal cannot underflow to certified zero");
  let tolerance = 128 * Number.EPSILON * Math.abs(expected);
  if (approximate) {
    const [mantissa, exponent] = token.toLowerCase().split("e");
    tolerance += 0.5 * 10 ** (Number(exponent ?? 0) - (mantissa!.split(".")[1]?.length ?? 0));
  }
  if (actual === 0 && expected !== 0 || Math.abs(actual - expected) > tolerance) fail("Derived label contradicts evaluated mathematical metadata");
}
function quantityValue(id: string, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number {
  const visit = (value: unknown, level: number): number => {
    if (level > 32 || seen.has(value)) return fail("Derived quantity references are cyclic or too deep");
    if (typeof value === "number" && Number.isFinite(value)) return value;
    seen.add(value);
    if (typeof value === "object" && value !== null && "value" in value) {
      if ("unit" in value && typeof value.unit === "string" && !["", "1", "unit", "units", "dimensionless"].includes(value.unit.trim())) fail("This derived claim has no certified physical unit conversion");
      return visit(value.value, level + 1);
    }
    if (typeof value === "string") {
      const quantity = document.quantities.find((candidate) => candidate.id === value);
      if (quantity) return visit(quantity, level + 1);
      if (SCALAR.test(value.trim())) { compare(value.trim(), Number(value)); return Number(value); }
    }
    return fail("Derived quantity must resolve to a finite scalar");
  };
  return visit(id, depth);
}

/** Mirrors the existing derived-value boundary; unsupported numeric grammar fails closed. */
export function validatePublicationDerivedClaims(
  construction: SceneConstruction, index: number, document: SceneDocument,
  authorities: readonly PublicationClaimAuthority[], issues: SceneIssue[],
): void {
  construction.outputs.forEach((id, outputIndex) => {
    const authority = new Map(Object.entries(authorities[outputIndex] ?? {}).map(([name, value]) => [key(name), value]));
    const checkText = (text: unknown): void => {
      if (text === undefined) return;
      if (typeof text !== "string") fail("Derived labels must be text");
      if (/(?:\bNaN\b|\bInfinity\b|∞)/i.test(text)) fail("Derived claims must be finite");
      if (/^[\p{L}][\p{L}\p{N}_'′]*$/u.test(text.trim()) || !/[0-9]/.test(text)) return;
      const match = /^\s*([^=≈:]*?)\s*([=≈:])\s*(.*?)\s*$/.exec(text);
      const name = match ? key(match[1]!) : "";
      const expected = authority.get(name);
      if (expected === undefined) fail("Numeric label has no supported evaluated meaning");
      const right = match ? match[3]! : text.trim();
      const tokens = typeof expected === "number" ? SCALAR.exec(right)?.slice(1) : PAIR.exec(right)?.slice(1);
      if (!tokens || typeof expected !== "number" && (right.startsWith("(") ? !right.endsWith(")") : !right.endsWith("]"))) fail("Numeric label grammar or units are unsupported");
      tokens.forEach((token, component) => compare(token, typeof expected === "number" ? expected : expected[component]!, match?.[2] === "≈"));
    };
    const check = (run: () => void, path: string): void => {
      try { run(); } catch (error) { issues.push({ code: "invalid_publication_derived_label", severity: "fatal", message: error instanceof Error ? error.message : "Invalid derived label", path, entityIds: [id] }); }
    };
    // Labels can be derived from other labels. Every descendant keeps the
    // original result's numeric authority, including annotations that replace
    // its displayed text. This does not depend on displayLength metadata.
    const targets = new Set([id]);
    const pending = [id];
    while (pending.length > 0) {
      const target = pending.pop()!;
      document.constructions.forEach((label, labelIndex) => {
        if (label.operator !== "label" || (label.inputs.target ?? label.inputs.at ?? label.inputs.point) !== target) return;
        check(() => checkText(label.inputs.text), `constructions[${labelIndex}].inputs.text`);
        for (const labelId of label.outputs) {
          if (!targets.has(labelId)) { targets.add(labelId); pending.push(labelId); }
        }
      });
    }
    document.entities.forEach((entity, entityIndex) => {
      if (targets.has(entity.id)) check(() => checkText(entity.label), `entities[${entityIndex}].label`);
    });
    document.annotations.forEach((annotation, annotationIndex) => {
      if (!annotation.targetIds.some((target) => targets.has(target))) return;
      check(() => {
        checkText(annotation.text);
        if (annotation.quantityId === undefined) return;
        const quantity = document.quantities.find((candidate) => candidate.id === annotation.quantityId);
        if (!quantity) fail("Derived annotation references an unknown quantity");
        const expected = authority.get(key(typeof quantity.symbol === "string" ? quantity.symbol : quantity.id));
        if (typeof expected !== "number") fail("Quantity annotation needs a supported computed scalar meaning");
        compare(String(quantityValue(annotation.quantityId, document)), expected);
      }, `annotations[${annotationIndex}]`);
    });
  });
}
