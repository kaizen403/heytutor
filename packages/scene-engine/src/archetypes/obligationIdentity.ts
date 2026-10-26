/**
 * Physics body identity for the visual-obligation check.
 *
 * ProblemIR names physics bodies in model words: "parabolic trajectory",
 * "projectile (point mass)", "near bank". The archetype draws them under short
 * board labels. This reader binds such a name to the figure's own certified
 * identity, and to nothing else:
 *
 * - certification: the candidate must be exactly the figure its archetype
 *   generator rebuilds from the original question alone, and the identity is
 *   the record that fresh build made of the bodies it constructed. A label is
 *   never the authority;
 * - role: the name must contain exactly one noun of a recorded body's role
 *   ("trajectory" or "path" for the trajectory), and every other word must be
 *   an attribute the generator recorded for that body ("parabolic" for the
 *   parabola it computed, "near" for the near bank). "horizontal trajectory",
 *   "second projectile" or "swimmer" bind nothing;
 * - kind: the ProblemIR kind must fit the role (a trajectory is a curve).
 *
 * Every other name returns null and stays with the ordinary exact-label rule.
 */
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import type { SceneDocument } from "../types";
import { builtArchetypeFigureIdentity, type ArchetypeBodyRole, type ArchetypeFigureIdentity, type CertifiedArchetypeBody } from "./figureIdentity";
import { attemptArchetypeScene } from "./index";

/** Archetypes whose generators record the bodies they construct. */
const CERTIFIED_ARCHETYPES = new Set(["projectile", "river_boat"]);

/** The nouns that name each role, and the ProblemIR kinds that may carry it. */
const ROLES: Readonly<Record<ArchetypeBodyRole, { nouns: readonly string[]; kinds: readonly string[] }>> = {
  projectile: { nouns: ["projectile"], kinds: ["point", "body", "other"] },
  trajectory: { nouns: ["trajectory", "path"], kinds: ["curve", "other"] },
  ground: { nouns: ["ground"], kinds: ["line", "body", "other"] },
  river: { nouns: ["river"], kinds: ["region", "body", "other"] },
  bank: { nouns: ["bank"], kinds: ["line", "body", "other"] },
  current: { nouns: ["current", "flow"], kinds: ["field", "other"] },
};

const FILLER = new Set(["the", "a", "an", "of"]);

/**
 * The identity of an archetype candidate, or null. The generator is rerun on
 * the original question with no plan and no ProblemIR, and the candidate's
 * whole ink, topology, quantities and reveal schedule must equal that fresh
 * figure.
 */
export function certifiedArchetypeFigureIdentity(document: SceneDocument, originalQuestion?: string): ArchetypeFigureIdentity | null {
  if (!originalQuestion?.trim() || document.source.question !== originalQuestion.trim()) return null;
  const archetype = String(document.source.archetype ?? "");
  if (!CERTIFIED_ARCHETYPES.has(archetype)) return null;
  let fresh: SceneDocument | null;
  try {
    const attempt = attemptArchetypeScene({ question: originalQuestion });
    fresh = attempt.scene?.archetype === archetype ? attempt.scene.document : null;
  } catch {
    return null;
  }
  const identity = builtArchetypeFigureIdentity(fresh);
  if (!fresh || !identity || identity.archetype !== archetype) return null;
  return sameRecomputedFigure(document, fresh) ? identity : null;
}

function sameRecomputedFigure(document: SceneDocument, fresh: SceneDocument): boolean {
  const labels = new Map(fresh.entities.map((entity) => [entity.id, entity.label]));
  if (document.entities.some((entity) => entity.label !== labels.get(entity.id))) return false;
  const normalize = (input: SceneDocument) => validateSceneDocument(pruneDeadSceneEntities(input as unknown as Record<string, unknown>));
  const expected = normalize(fresh);
  const actual = normalize(document);
  if (!expected.document || !actual.document) return false;
  const content = (input: SceneDocument) => Object.fromEntries(Object.entries(input).filter(([key]) => key !== "source"));
  return stableValue(content(actual.document)) === stableValue(content(expected.document));
}

function stableValue(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([first], [second]) => first.localeCompare(second)));
  });
}

export interface ArchetypeBodyBinding {
  /** The certified body bound; the caller marks it used. */
  body: CertifiedArchetypeBody;
  entityId: string;
  consumes: string[];
}

/**
 * Bind one obligated body name to a certified body by role, or null. Each
 * certified body binds at most once, whatever marks it consumes: one drawn
 * river cannot stand for two ProblemIR rivers, so the second stays missing.
 */
export function bindArchetypeBody(
  identity: ArchetypeFigureIdentity,
  problemKind: string,
  problemLabel: string,
  consumed: ReadonlySet<string>,
  usedBodies: ReadonlySet<CertifiedArchetypeBody>,
): ArchetypeBodyBinding | null {
  // An article is filler only when written lower case before another word, and only first
  // ("a projectile") or right after "of" ("path of the ball"). A capital, trailing or inner
  // letter ("projectile A", "projectile a", "projectile a (point mass)") is a body name, so
  // the label keeps it and cannot bind as the bare role noun.
  const tokens = problemLabel.replace(/[()]/g, " ").trim().split(/\s+/).filter(Boolean);
  const words = tokens
    .filter((token, index) => !(FILLER.has(token) && index < tokens.length - 1
      && (token === "of" || index === 0 || tokens[index - 1] === "of")))
    .map((token) => token.toLowerCase());
  if (words.length === 0) return null;
  for (const body of identity.bodies) {
    const role = ROLES[body.role];
    if (usedBodies.has(body)) continue;
    if (!role.kinds.includes(problemKind) || body.consumes.some((id) => consumed.has(id))) continue;
    const nouns = words.filter((word) => role.nouns.includes(word));
    if (nouns.length !== 1) continue;
    if (!words.every((word) => role.nouns.includes(word) || body.attributes.includes(word))) continue;
    return { body, entityId: body.entityId, consumes: [...body.consumes] };
  }
  return null;
}
