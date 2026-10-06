/**
 * Vertical loop-the-loop work-energy gate (DCP-04).
 *
 * The hard probe "a smooth incline ends in a vertical circular loop" taught
 * with no figure at all: the detector drew a mass-on-a-string figure for a
 * track-loop work-energy question, and the picture demand then vetoed it
 * because a bare "circular loop" counted as a magnetic source — so both the
 * archetype and the family fallback declined. The archetype now carries a
 * string/track variant, the track figure draws the release height and the
 * normal reaction, the magnetic veto needs electromagnetic context, and a
 * current-carrying loop stays vetoed (it is electromagnetism, not mechanics).
 *
 * Fixtures are verbatim bank/probe stems where they exist; the numeric and
 * phrasing variations pin the reusable slots, not the question.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-vertical-loop-energy.ts
 */
import {
  attemptArchetypeScene,
  checkPictureContract,
  detectArchetype,
  rankArchetypes,
} from "../../src/archetypes";
import {
  familiesFromProblemStructure,
  inferFamiliesFromQuestion,
} from "../../src/synthesize/familyClassification";
import { demandRejection, sceneDemand } from "../../src/synthesize/sceneDemand";
import type { SceneDocument } from "../../src/types";

const failures: string[] = [];

function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

function rolesOf(document: SceneDocument): string[] {
  return document.entities.map((entity) => `${entity.role ?? ""}`.toLowerCase());
}

/** Verbatim physics-unit-4 hard probe: the work-energy loop-the-loop. */
const HARD_TRACK =
  "A smooth incline ends in a vertical circular loop of radius R. A small body is released from height h. "
  + "If it exerts a force of three times its weight on the track at the highest point of the circle, "
  + "then h = α R. Find α. Options included 3, 4, 5/2.";

/** Verbatim archetype-probe string stem: the figure this archetype always drew. */
const STRING_CONTROL =
  "A stone tied to a string of length 1 m is whirled in a vertical circle. Find the minimum speed at the top.";

/** Verbatim physics-unit-4 medium probe: whirled string, velocity-change ask. */
const STRING_MEDIUM =
  "A stone tied to a string of length L is whirled in a vertical circle about the other end. "
  + "At the lowest point the speed is u. The magnitude of the change in velocity as it reaches the point "
  + "where the string is horizontal is √x (u² − g L). Find x. Options: 3, 2, 1, 5.";

/** Verbatim bank stem (physics|13): a current loop, not a mechanics loop. */
const MAGNETIC_LOOP =
  "Using Biot-Savart law, derive expression for the magnetic field (B) due to a circular current "
  + "carrying loop at a point on its axis and hence at its centre. 3";

/* -- The failure fixture: track loop with an incline approach ---------------- */

{
  const match = detectArchetype(HARD_TRACK);
  check(match?.id === "vertical_circle", `hard track: detected ${match?.id ?? "nothing"}, expected vertical_circle`);
  check(match?.slots.variant === "track", `hard track: variant is ${String(match?.slots.variant)}, expected track`);
  check(match?.slots.approach === "incline", `hard track: approach is ${String(match?.slots.approach)}, expected incline`);

  const attempt = attemptArchetypeScene({ question: HARD_TRACK });
  check(Boolean(attempt.scene), `hard track: no scene (${attempt.declined ?? "unknown"})`);
  const scene = attempt.scene;
  if (scene) {
    check(scene.tier === "qualitative_verified", `hard track: tier is ${scene.tier}, expected qualitative_verified`);
    const roles = rolesOf(scene.document);
    check(!roles.some((role) => role.includes("tension")), "hard track: a track loop must not draw a string tension");
    check(roles.some((role) => role.includes("normal reaction")), "hard track: the top contact force must be the normal reaction");
    check(roles.some((role) => role.includes("release height")), "hard track: the release height dimension is missing");
    check(roles.some((role) => role.includes("approach incline")), "hard track: the approach incline is missing");
    check(
      checkPictureContract(scene.document, "vertical_circle").length === 0,
      "hard track: track figure must satisfy the vertical_circle contract",
    );
    check(
      demandRejection(scene.document, sceneDemand(HARD_TRACK)) === null,
      "hard track: picture demand must accept the track figure",
    );
    check(
      scene.renderScene.primitives.length >= 3,
      `hard track: only ${scene.renderScene.primitives.length} primitives; the figure is not drawn`,
    );
    check(
      scene.document.assertions.some((assertion) =>
        assertion.predicate === "label_attached" && assertion.entities.includes("top")),
      "hard track: the top body needs a label check",
    );
    check(
      scene.document.assertions.some((assertion) =>
        assertion.predicate === "label_attached" && assertion.entities.includes("release")),
      "hard track: the release body needs a label check",
    );
    // Symbolic R/h: nothing numeric to carry, so no quantities and no invented numbers.
    check(
      !scene.document.quantities.some((quantity) => quantity.symbol === "R" || quantity.symbol === "h"),
      "hard track: symbolic R/h must not produce carried quantities",
    );
    const source = scene.document.source as Record<string, unknown>;
    check(
      source.archetype === "vertical_circle" && typeof source.slotSources === "object" && "exactGrounding" in source,
      "hard track: document.source lacks archetype provenance",
    );
  }
}

/* -- String control: the existing figure is unchanged ------------------------ */

{
  const match = detectArchetype(STRING_CONTROL);
  check(match?.id === "vertical_circle", `string control: detected ${match?.id ?? "nothing"}`);
  check(match?.slots.variant === "string", `string control: variant is ${String(match?.slots.variant)}, expected string`);

  const attempt = attemptArchetypeScene({ question: STRING_CONTROL });
  const scene = attempt.scene;
  check(Boolean(scene), `string control: no scene (${attempt.declined ?? "unknown"})`);
  if (scene) {
    const roles = rolesOf(scene.document);
    check(roles.some((role) => role.includes("tension")), "string control: the string figure must keep its tension");
    check(!roles.some((role) => role.includes("normal reaction")), "string control: no track normal belongs here");
    check(!roles.some((role) => role.includes("release height")), "string control: no release height belongs here");
    const carried = scene.document.quantities.find((quantity) => quantity.symbol === "r");
    check(
      carried !== undefined && Math.abs(Number(carried.value) - 1) < 0.01,
      `string control: expected |r| = 1, figure carries ${carried ? String(carried.value) : "no r quantity"}`,
    );
  }

  const medium = detectArchetype(STRING_MEDIUM);
  check(medium?.id === "vertical_circle", `string medium: detected ${medium?.id ?? "nothing"}`);
  check(medium?.slots.variant === "string", `string medium: variant is ${String(medium?.slots.variant)}, expected string`);
  check(
    Boolean(attemptArchetypeScene({ question: STRING_MEDIUM }).scene),
    "string medium: the whirled-string bank stem must still compile",
  );
}

/* -- Decline threshold: a current loop is still not this figure -------------- */

{
  const ranked = rankArchetypes(MAGNETIC_LOOP).map((entry) => entry.id);
  check(!ranked.includes("vertical_circle"), "magnetic loop: vertical_circle must be vetoed at the cue layer");
  const attempt = attemptArchetypeScene({ question: MAGNETIC_LOOP });
  check(!attempt.scene, "magnetic loop: the archetype layer must still decline a Biot-Savart loop");
  // The demand veto is contextual, not removed: a loop with EM context still
  // forbids the mass-on-a-string figure, a bare mechanics loop does not.
  check(
    sceneDemand(MAGNETIC_LOOP).forbids.includes("suspended_body"),
    "magnetic loop: a current loop must still forbid the suspended-body figure",
  );
  check(
    !sceneDemand(HARD_TRACK).forbids.includes("suspended_body"),
    "hard track: a mechanics loop must not trip the magnetic veto",
  );
  // A wire loop with no stated current is still a wire apparatus, never an
  // energy track; the archetype layer leaves it for the neutral family figure.
  const wireRanked = rankArchetypes(
    "A circular loop of stiff wire stands in a vertical plane. A small bead is threaded on it. Describe the bead's motion.",
  ).map((entry) => entry.id);
  check(!wireRanked.includes("vertical_circle"), "wire loop: vertical_circle must be vetoed for a wire apparatus");
}

/* -- Numeric variation: stated R and h reach the figure ---------------------- */

{
  const numeric =
    "A small block is released from rest from a height of 5.0 m above the ground onto a smooth incline "
    + "that ends in a vertical circular loop of radius 2.0 m. "
    + "Find the normal force on the block at the highest point of the loop.";
  const match = detectArchetype(numeric);
  check(match?.id === "vertical_circle", `numeric: detected ${match?.id ?? "nothing"}`);
  check(match?.slots.variant === "track", `numeric: variant is ${String(match?.slots.variant)}, expected track`);
  check(match?.slots.radius === 2, `numeric: radius slot is ${String(match?.slots.radius)}, expected 2`);
  check(match?.slots.releaseHeight === 5, `numeric: releaseHeight slot is ${String(match?.slots.releaseHeight)}, expected 5`);

  const scene = attemptArchetypeScene({ question: numeric }).scene;
  check(Boolean(scene), "numeric: no scene");
  if (scene) {
    const radius = scene.document.quantities.find((quantity) => quantity.symbol === "R");
    const height = scene.document.quantities.find((quantity) => quantity.symbol === "h");
    check(
      radius !== undefined && Math.abs(Number(radius.value) - 2) < 0.01,
      `numeric: expected |R| = 2, figure carries ${radius ? String(radius.value) : "no R quantity"}`,
    );
    check(
      height !== undefined && Math.abs(Number(height.value) - 5) < 0.01,
      `numeric: expected |h| = 5, figure carries ${height ? String(height.value) : "no h quantity"}`,
    );
    const dimension = scene.document.entities.find((entity) => entity.id === "release_height");
    check(dimension?.label === "h=5 m", `numeric: release dimension reads "${dimension?.label ?? "none"}", expected "h=5 m"`);
  }
}

/* -- Phrasing variations: loop-the-loop and track wordings agree ------------- */

for (const stem of [
  "A stunt car enters a loop-the-loop track of radius 8 m. What minimum speed at the top keeps it on the track?",
  "A bead slides on a smooth vertical circular track of radius R, released from height h above the bottom. "
    + "Find the speed at the top of the circle.",
]) {
  const match = detectArchetype(stem);
  check(match?.id === "vertical_circle", `phrasing: detected ${match?.id ?? "nothing"} for "${stem.slice(0, 48)}..."`);
  check(match?.slots.variant === "track", `phrasing: variant is ${String(match?.slots.variant)} for "${stem.slice(0, 48)}..."`);
  check(
    Boolean(attemptArchetypeScene({ question: stem }).scene),
    `phrasing: no scene for "${stem.slice(0, 48)}..."`,
  );
}

/* -- Grounded incline approach: the loop still wins -------------------------- */

{
  const stem =
    "A block slides down a smooth 30 degree incline that ends in a vertical circular loop of radius 1.5 m. "
    + "The block is released from a height of 4 m. Find its speed at the top of the loop.";
  const match = detectArchetype(stem);
  check(match?.id === "vertical_circle", `grounded incline: detected ${match?.id ?? "nothing"}, the loop must win`);
  check(match?.slots.variant === "track", `grounded incline: variant is ${String(match?.slots.variant)}, expected track`);
  check(Boolean(attemptArchetypeScene({ question: stem }).scene), "grounded incline: no scene");
}

/* -- The contract alternative is enforced, not vacuous ----------------------- */

{
  const noContactForce = {
    entities: [
      { id: "path", kind: "circle", role: "circular path" },
      { id: "body", kind: "point", role: "body" },
      { id: "weight", kind: "vector", role: "weight" },
    ],
    constructions: [],
  } as unknown as SceneDocument;
  check(
    checkPictureContract(noContactForce, "vertical_circle").length > 0,
    "contract: a loop figure with neither tension nor normal reaction must fail",
  );
}

/* -- Planner availability: structure and fallback both reach contact_body ---- */

{
  check(
    inferFamiliesFromQuestion(HARD_TRACK).includes("contact_body"),
    "planner: the English fallback must offer contact_body for the loop stem",
  );
  check(
    familiesFromProblemStructure({
      entities: [{ kind: "body", label: "small body on the loop" }],
      representationIntents: [{ kind: "free_body" }],
    }).includes("contact_body"),
    "planner: a solved body-on-loop structure must route to contact_body",
  );
}

console.log("verify-vertical-loop-energy: cases=10 (hard track, string control, string medium, magnetic decline, numeric, 2 phrasings, grounded incline, contract, planner)");
if (failures.length > 0) {
  console.error(`verify-vertical-loop-energy: FAILED (${failures.length})`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("verify-vertical-loop-energy: ok");
