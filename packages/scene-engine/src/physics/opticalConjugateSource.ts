/** Complete real-object conjugate setup, independent of planner slots. */
export interface OpticalConjugateSource {
  device: "mirror" | "lens";
  kind: "concave" | "convex";
  u: number;
  f: number;
  v: number;
  magnification: number;
  inputs: Array<{ role: "u" | "f"; value: number; unit: "mm" | "cm" | "m"; quote: string }>;
  request: string;
}

const length = (name: string) => String.raw`(?<${name}Literal>(?<${name}Value>\d+(?:\.\d+)?|\.\d+)\s*(?<${name}Unit>mm|cm|m))`;
const scale = { mm: 0.1, cm: 1, m: 100 };
const request = /^(?:(?:find|calculate|determine) (?:the )?(?:image distance|position of the image|magnification|image distance and (?:the )?magnification|position and nature of the image)|locate the image(?: and draw the ray diagram)?|draw the ray diagram and locate the image)(?:[.!?])?$/i;

/** This grammar names physical input roles, consumes all clauses and asks,
 * and has no numeric defaults or permission from a client provenance flag. */
export function readOpticalConjugateSource(question: string): OpticalConjugateSource | null {
  if (question.length > 4096) return null;
  // Every alternative binds the same two named physical roles and consumes
  // the entire source, including the request. No lexical figure defaults.
  const grammars = [
   String.raw`^(?:An?|The) object is placed ${length("u")} in front of (?:a|the) (?<kind>concave|convex) (?<device>mirror|lens) (?:with|of) focal length ${length("f")}[.]\s*(?<request>.+)$`,
   String.raw`^(?<kind>concave|convex) (?<device>mirror|lens), f\s*=\s*${length("f")}, object at ${length("u")}[.]\s*(?<request>.+)$`,
   String.raw`^A (?<kind>concave|convex) (?<device>mirror|lens) has focal length ${length("f")}[.] An object is placed ${length("u")} from the \k<device>[.]\s*(?<request>.+)$`,
   String.raw`^A (?<kind>concave|convex) (?<device>mirror|lens) of focal length ${length("f")} has an object at ${length("u")}[.]\s*(?<request>.+)$`,
  ];
  const match = grammars.map(grammar => new RegExp(grammar,"i").exec(question.trim())?.groups).find(Boolean);
  if (!match || !request.test(match.request!)) return null;
  const distance = Number(match.uValue), focal = Number(match.fValue);
  const distanceUnit = match.uUnit!.toLowerCase() as "mm" | "cm" | "m";
  const focalUnit = match.fUnit!.toLowerCase() as "mm" | "cm" | "m";
  const uMag = distance * scale[distanceUnit], fMag = focal * scale[focalUnit];
  if (![distance, focal, uMag, fMag].every(value => Number.isFinite(value) && value >= 1e-6 && value <= 1e6)) return null;
  const kind = match.kind!.toLowerCase() as "concave" | "convex";
  const device = match.device!.toLowerCase() as "mirror" | "lens";
  const u = -uMag;
  const f = kind === "concave" ? -fMag : fMag;
  const denominator = device === "mirror" ? u - f : u + f;
  if (denominator === 0) return null;
  const v = u * f / denominator;
  if (!Number.isFinite(v) || Math.abs(v) > 12 * uMag || Math.abs(v) < 1e-6) return null;
  return { device, kind, u, f, v, magnification: device === "mirror" ? -v / u : v / u,
    inputs: [{ role: "u", value: distance, unit: distanceUnit, quote: match.uLiteral! },
      { role: "f", value: focal, unit: focalUnit, quote: match.fLiteral! }], request: match.request! };
}

export function opticalLengthInCm(value: number, unit: unknown): number | null {
  if (typeof unit !== "string" || !(unit in scale)) return null;
  return value * scale[unit as keyof typeof scale];
}

export function opticalConjugateQuantityRole(quantity: { id: string; symbol?: string }): "u" | "f" | "v" | "magnification" | "ambiguous" | null {
  const role = (text: string) => {
    const key = text.toLowerCase().replace(/[_{}\\\s]/g, "");
    if (["u", "objectdistance", "do"].includes(key)) return "u" as const;
    if (["f", "focallength"].includes(key)) return "f" as const;
    if (["v", "imagedistance", "di"].includes(key)) return "v" as const;
    if (["magnification", "m"].includes(key)) return "magnification" as const;
    return null;
  };
  const symbolRole = role(quantity.symbol ?? ""), idRole = role(quantity.id);
  if(quantity.symbol !== undefined && quantity.symbol.trim() && !symbolRole) return idRole?"ambiguous":null;
  return symbolRole && idRole && symbolRole !== idRole ? "ambiguous" : symbolRole ?? idRole;
}

/** Magnitudes can name the two physically stated setup lengths. Image sign
 * and magnification remain computed output roles and are never flipped. */
export function opticalConjugatePlanConflicts(source: OpticalConjugateSource, quantities: ReadonlyArray<{id: string; symbol?: string; value: number; unit?: string}>): string[] {
  const conflicts: string[] = [];
  for (const quantity of quantities) {
    const role = opticalConjugateQuantityRole(quantity);
    if (!role) {conflicts.push(quantity.id);continue;}
    if (role === "ambiguous") {conflicts.push(quantity.id);continue;}
    const input = source.inputs.find(row => row.role === role);
    const actual = role === "magnification" ? (!quantity.unit || quantity.unit === "1" ? quantity.value : null)
      : opticalLengthInCm(quantity.value, quantity.unit ?? input?.unit);
    const expected = source[role];
    const same = (value: number) => value === expected || Math.abs(value - expected) <= 64 * Number.EPSILON * Math.max(Math.abs(value), Math.abs(expected));
    if (actual === null || !Number.isFinite(actual) || !(same(actual) || (input && actual >= 0 && same(-actual)))) conflicts.push(quantity.id);
  }
  return conflicts;
}

/** Unknowns are named source-supported output roles, not permission to add
 * unrelated values when the caller IR has no numerical solve requests. */
export function opticalConjugateUnknownConflicts(quantities: ReadonlyArray<{id: string; symbol?: string; unit?: string}>): string[] {
 return quantities.filter(quantity => {
  const role=opticalConjugateQuantityRole(quantity);
  return role === null || role === "ambiguous" ||
   (quantity.unit !== undefined && (role === "magnification" ? quantity.unit !== "1" : opticalLengthInCm(1,quantity.unit) === null));
 }).map(quantity => quantity.id);
}
