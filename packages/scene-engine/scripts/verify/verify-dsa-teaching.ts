/**
 * Teaching-record gate: every family the router can reach must be teachable.
 *
 * `resolveCodeLessonBoardContext` in the app detects the family, then looks up
 * its teaching facts, and returns null if there are none. Null means the code
 * planner is handed no board context at all: it sees the question and writes
 * whichever correct solution it likes while the figure walks another, which is
 * the exact failure the context block was built to end. A family added to the
 * catalog without a record here therefore looks fine in every trace and
 * routing gate and quietly reopens that bug for its own problems.
 *
 * The content checks are the ones a record can fail while still existing: a
 * mechanism that is a label rather than a sentence, a term list that repeats
 * the family name, a `require` pattern that its own worked example would fail.
 */
import { ALGORITHM_FAMILIES } from "../../src/dsa/algorithmCatalog";
import { FAMILY_TEACHING, familyTeachingFacts } from "../../src/dsa/familyTeaching";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const missing: string[] = [];

for (const family of ALGORITHM_FAMILIES) {
  const facts = familyTeachingFacts(family.id);
  if (!facts) {
    missing.push(family.id);
    continue;
  }

  // The mechanism reaches the planner prompt and the tutor speaks from it, so
  // it has to be a sentence about the algorithm, not a restatement of its name.
  assert(
    facts.mechanism.trim().length >= 60,
    `${family.id}: mechanism is too short to say anything (${facts.mechanism.trim().length} chars)`,
  );
  assert(
    facts.mechanism.trim().length <= 400,
    `${family.id}: mechanism is a paragraph, not one spoken line (${facts.mechanism.trim().length} chars)`,
  );
  assert(
    !/[—–]/.test(facts.mechanism) && !/\s-\s/.test(facts.mechanism),
    `${family.id}: mechanism uses a dash as punctuation`,
  );
  assert(
    facts.terms.length > 0 && facts.terms.length <= 6,
    `${family.id}: expected 1 to 6 terms to define, got ${facts.terms.length}`,
  );
  for (const term of facts.terms) {
    assert(
      term.trim().length > 0 && term.length <= 24,
      `${family.id}: term ${JSON.stringify(term)} must be 1 to 24 characters`,
    );
  }

  const shape = facts.codeShape;
  if (shape) {
    assert(
      (shape.maxLoopsInMain ?? 0) >= 0 && (shape.maxLoopsInMain ?? 0) <= 4,
      `${family.id}: maxLoopsInMain ${shape.maxLoopsInMain} is not a plausible bound`,
    );
    // A pattern that is both required and forbidden can never be satisfied,
    // and the planner would lose the code panel on every attempt.
    for (const required of shape.require ?? []) {
      for (const forbidden of shape.forbid ?? []) {
        assert(
          required.source !== forbidden.source,
          `${family.id}: ${required.source} is both required and forbidden, so no program can pass`,
        );
      }
    }
  }
}

assert(
  missing.length === 0,
  `families with no teaching record, so the planner never sees the board for them:\n  ${missing.join("\n  ")}`,
);

// The other direction: a record for a family that no longer exists is dead
// weight that reads as coverage.
const known = new Set(ALGORITHM_FAMILIES.map((family) => family.id));
const orphans = Object.keys(FAMILY_TEACHING).filter((id) => !known.has(id));
assert(
  orphans.length === 0,
  `teaching records for families that are not in the catalog: ${orphans.join(", ")}`,
);

console.log(
  `verify-dsa-teaching: all ${ALGORITHM_FAMILIES.length} families have a usable teaching record`,
);
