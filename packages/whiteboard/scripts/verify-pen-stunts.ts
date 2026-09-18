/**
 * Marker stunts, measured.
 *
 * A stunt is the one thing in the idle repertoire big enough to go wrong in a
 * way the student would actually notice: the barrel turns twice, the pen comes
 * 24px off the board, the hand walks it out across the knuckles. So the rules
 * it has to hold to are stricter than the fidget's, not looser.
 *
 *  - It enters and leaves at exactly rest, with zero slope at both ends.
 *  - A turn is a whole turn: the barrel finishes where it started.
 *  - It is performed where the pen stands. Nothing here may read as the pen
 *    being carried somewhere; that is what `flyCursorTo` is for.
 *  - It never touches opacity. The marker is exactly as visible mid-trick as
 *    it is standing still.
 *  - It is rare. One slot in eight or so, never the opening beat of a pause,
 *    never two close together — a flourish, not wallpaper.
 *  - It is off unless asked for, and with it off the hand is bit-for-bit the
 *    hand that shipped before stunts existed.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  IDLE_GESTURE_KINDS,
  IDLE_LIFT_MAX_PX,
  IDLE_RELEASE_MAX_MS,
  IDLE_RELEASE_MS,
  IDLE_TRAVEL_MAX_PX,
  STUNT_REST_GAIN,
  idleGestureAt,
  idleGestureSequence,
  idlePose,
  idleReleaseMs,
  performanceDurationMs,
  releaseIdlePose,
  type IdlePose,
} from "../src/penIdle";
import {
  STUNT_COPY,
  STUNT_EARLIEST_INDEX,
  STUNT_KINDS,
  STUNT_LIFT_MAX_PX,
  STUNT_MS,
  STUNT_SEPARATION,
  STUNT_TRAVEL_MAX_PX,
  isStuntKind,
  parseStuntKinds,
  serializeStuntKinds,
  stuntFrame,
  type StuntKind,
} from "../src/penStunts";
import { shortestAngleDelta } from "../src/penChoreography";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const DT = 8;
const SPAN_MS = 120000;
const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);
/** The whole repertoire chosen, which is the default a student starts on. */
const ON = { stunts: STUNT_KINDS } as const;

function sample(seed: number, spanMs = SPAN_MS, options = ON): IdlePose[] {
  const poses: IdlePose[] = [];
  for (let ms = 0; ms <= spanMs; ms += DT) poses.push(idlePose(ms, seed, options));
  return poses;
}

// --- there are four stunts, and every one of them gets used ----------------
{
  assert(STUNT_KINDS.length === 4, `expected four stunts, got ${STUNT_KINDS.length}`);
  assert(new Set(STUNT_KINDS).size === 4, "the stunt kinds must be distinct");

  const seen = new Set<string>();
  for (const seed of SEEDS) {
    for (const slot of idleGestureSequence(60, seed, ON)) {
      if (slot.stunt) seen.add(slot.kind);
    }
  }
  for (const kind of STUNT_KINDS) {
    assert(seen.has(kind), `${kind} never came up across ${SEEDS.length} pauses`);
  }

  for (const kind of STUNT_KINDS) {
    assert(STUNT_MS[kind] >= 1200, `${kind} at ${STUNT_MS[kind]}ms is a twitch, not a trick`);
    assert(STUNT_MS[kind] <= 2600, `${kind} at ${STUNT_MS[kind]}ms outstays a narration pause`);
    assert(
      performanceDurationMs(kind) === STUNT_MS[kind],
      `the sequencer must budget ${kind} for its own duration`,
    );
  }
}

// --- off unless asked for, and off means exactly the old hand ---------------
/*
  The setting has to be a switch on a new behaviour, not a rewrite of the old
  one. With stunts off, every pure function here must return what it returned
  before the repertoire gained a loud half — otherwise turning the feature off
  is not a way back to the hand the lesson was tuned against.
*/
{
  for (const seed of SEEDS) {
    for (const slot of idleGestureSequence(80, seed)) {
      assert(!slot.stunt, `seed ${seed} played ${slot.kind} with stunts off`);
      assert(!isStuntKind(slot.kind), `seed ${seed} played ${slot.kind} with stunts off`);
    }
    /*
      An empty selection is a real state, not an absent one: it is the student
      having deselected every trick. The pool must stay shut, and the sequencer
      must still produce a whole schedule — asked to draw from an empty pool it
      returned `undefined` as the kind, which made the duration `undefined` and
      every `startMs` after it NaN, so the hand stopped moving at all.
    */
    for (const slot of idleGestureSequence(80, seed, { stunts: [] })) {
      assert(!slot.stunt, `seed ${seed} played ${slot.kind} with nothing selected`);
      assert(
        typeof slot.kind === "string" && IDLE_GESTURE_KINDS.includes(slot.kind as never),
        `seed ${seed} produced "${slot.kind}" as a gesture with nothing selected`,
      );
      assert(
        Number.isFinite(slot.startMs) && Number.isFinite(slot.durationMs),
        `seed ${seed} produced a non-finite schedule with nothing selected`,
      );
    }
    for (let ms = 0; ms <= 40000; ms += 137) {
      const pose = idlePose(ms, seed, { stunts: [] });
      assert(
        Number.isFinite(pose.dx) && Number.isFinite(pose.spin) && Number.isFinite(pose.lift),
        `seed ${seed} froze the hand at ${ms}ms with nothing selected`,
      );
    }
  }

  // Bit-for-bit: the default and an explicit `false` are the same performance.
  for (const seed of [1, 7, 23]) {
    for (let ms = 0; ms <= 40000; ms += 97) {
      const bare = idlePose(ms, seed);
      const off = idlePose(ms, seed, { stunts: [] });
      assert(
        bare.dx === off.dx &&
          bare.dy === off.dy &&
          bare.spin === off.spin &&
          bare.lift === off.lift &&
          bare.scale === off.scale &&
          bare.gesture === off.gesture,
        `the default and an empty selection disagree at ${ms}ms on seed ${seed}`,
      );
      assert(bare.stunt === false, "a pose with nothing selected is never flagged as one");
    }
  }
}

// --- the board plays what the student picked, and nothing else -------------
/*
  This is the whole point of the setting being a list. A student who keeps the
  knuckle roll and drops the toss must never see the toss again, and one who
  keeps a single trick must still see it about as often as four students each
  seeing one of four — the pool weight is how often *a* trick happens, not how
  many are in it.
*/
{
  const SELECTIONS: readonly (readonly StuntKind[])[] = [
    ["thumbAround"],
    ["tossCatch"],
    ["knuckleRoll", "helicopter"],
    ["thumbAround", "helicopter", "tossCatch"],
    STUNT_KINDS,
  ];

  const shareOf = (selection: readonly StuntKind[]): number => {
    let slots = 0;
    let stunts = 0;
    for (const seed of SEEDS) {
      for (const slot of idleGestureSequence(60, seed, { stunts: selection })) {
        slots += 1;
        if (!slot.stunt) continue;
        stunts += 1;
        assert(
          selection.includes(slot.kind as StuntKind),
          `${slot.kind} played although the student picked ${selection.join(", ") || "nothing"}`,
        );
      }
    }
    return stunts / slots;
  };

  const shares = SELECTIONS.map(shareOf);
  for (let index = 0; index < SELECTIONS.length; index += 1) {
    const selection = SELECTIONS[index]!;
    const share = shares[index]!;
    assert(
      share > 0.05 && share < 0.14,
      `picking ${selection.join(", ")} changed how often a trick happens: ${(share * 100).toFixed(1)}%`,
    );
  }
  // One trick chosen comes up roughly as often as four do between them.
  const single = shares[0]!;
  const all = shares[shares.length - 1]!;
  assert(
    Math.abs(single - all) < 0.02,
    `one trick fires at ${(single * 100).toFixed(1)}% against ${(all * 100).toFixed(1)}% for four`,
  );

  // And a single-trick selection must not run the picker out of candidates:
  // the pool filters out the last two kinds, and with one chosen that would
  // leave nothing to draw.
  for (const seed of SEEDS) {
    let seen = 0;
    for (const slot of idleGestureSequence(80, seed, { stunts: ["helicopter"] })) {
      if (!slot.stunt) continue;
      seen += 1;
      assert(slot.kind === "helicopter", `a one-trick selection drew ${slot.kind}`);
    }
    assert(seen > 0, `seed ${seed} never played the one trick that was chosen`);
  }

  // The poses agree with the sequence: it is not enough for the *list* to be
  // filtered if the frame the board paints comes from somewhere else.
  for (const seed of SEEDS.slice(0, 12)) {
    for (let ms = 0; ms <= 60000; ms += 40) {
      const pose = idlePose(ms, seed, { stunts: ["knuckleRoll"] });
      if (!pose.stunt) continue;
      assert(pose.gesture === "knuckleRoll", `the board painted ${pose.gesture} instead`);
    }
  }
}

// --- every trick has a name and a sentence a student would recognise -------
/*
  Copy lives with the motion so a stunt cannot reach the settings screen as a
  camelCase identifier, and so the drawer, the account page and the preview all
  say the same thing about it.
*/
{
  for (const kind of STUNT_KINDS) {
    const copy = STUNT_COPY[kind];
    assert(copy !== undefined, `${kind} has no display copy`);
    assert(
      copy.label.length > 2 && copy.label.length <= 24,
      `${kind}'s label is not a name a student would say: "${copy.label}"`,
    );
    assert(copy.label !== kind, `${kind} is showing its identifier as its label`);
    assert(
      copy.caption.length > 12 && copy.caption.length <= 110,
      `${kind}'s caption does not describe it: "${copy.caption}"`,
    );
    assert(!copy.caption.endsWith("."), `${kind}'s caption must not carry its own full stop`);
    for (const dash of ["\u2014", "\u2013"]) {
      assert(
        !copy.label.includes(dash) && !copy.caption.includes(dash),
        `${kind}'s copy uses a dash as punctuation, which this product's voice does not`,
      );
    }
  }
  const labels = STUNT_KINDS.map((kind) => STUNT_COPY[kind].label);
  assert(new Set(labels).size === labels.length, "two tricks share a label");
}

// --- the selection has exactly one stored shape ----------------------------
{
  assert(serializeStuntKinds(STUNT_KINDS) === STUNT_KINDS.join(","), "all four store in order");
  assert(serializeStuntKinds([]) === "", "and nothing stores as nothing");
  assert(
    serializeStuntKinds(["tossCatch", "thumbAround"]) ===
      serializeStuntKinds(["thumbAround", "tossCatch"]),
    "the order a student clicked in must not reach the store",
  );
  assert(
    parseStuntKinds("tossCatch, knuckleRoll").join(",") === "knuckleRoll,tossCatch",
    "whitespace and order are both normalised on the way back",
  );
  assert(parseStuntKinds("cartwheel,helicopter").join(",") === "helicopter", "unknown ids drop");
  assert(parseStuntKinds(undefined).length === 0, "and nothing at all is the empty selection");
  assert(parseStuntKinds(["helicopter", "helicopter"]).join(",") === "helicopter", "and dedupes");
  for (const selection of [[], ["helicopter"], ["knuckleRoll", "tossCatch"], STUNT_KINDS]) {
    const stored = serializeStuntKinds(selection as readonly StuntKind[]);
    assert(
      parseStuntKinds(stored).join(",") === (selection as readonly string[]).join(","),
      `${JSON.stringify(selection)} did not round-trip, got "${stored}"`,
    );
  }
}

// --- rare enough to be a flourish, not a habit ------------------------------
{
  let slots = 0;
  let stunts = 0;
  let onOpeningBeat = 0;
  let tightest = Number.POSITIVE_INFINITY;
  const perKind: Record<string, number> = {};

  for (const seed of SEEDS) {
    let lastStuntIndex = Number.NEGATIVE_INFINITY;
    for (const slot of idleGestureSequence(60, seed, ON)) {
      slots += 1;
      if (!slot.stunt) continue;
      stunts += 1;
      perKind[slot.kind] = (perKind[slot.kind] ?? 0) + 1;
      if (slot.index === 0) onOpeningBeat += 1;
      tightest = Math.min(tightest, slot.index - lastStuntIndex);
      lastStuntIndex = slot.index;
    }
  }

  /*
    The band is measured, not derived from the constants: an assertion written
    as `share < STUNT_POOL_WEIGHT`-anything moves its own goalpost the moment
    the weight is raised, which is the one change it exists to catch. The real
    share is about 9%; the separation rule alone already pins the ceiling near
    20%, so a bound there would pass a pool weight six times too big.
  */
  const share = stunts / slots;
  assert(share > 0.05, `stunts are switched on but barely happen: ${(share * 100).toFixed(1)}%`);
  assert(share < 0.14, `stunts are wallpaper at ${(share * 100).toFixed(1)}% of the repertoire`);
  assert(STUNT_EARLIEST_INDEX >= 1, "a trick may not be the first thing a pause does");
  assert(STUNT_SEPARATION >= 2, "two tricks may not land within two slots of each other");
  assert(onOpeningBeat === 0, `${onOpeningBeat} pauses opened on a trick`);
  assert(
    tightest > 2,
    `two tricks landed ${tightest} slots apart, which reads as a nervous habit`,
  );
  // No single trick may be most of the pool: four stunts, not one with three
  // understudies.
  for (const kind of STUNT_KINDS) {
    const count = perKind[kind] ?? 0;
    assert(count / stunts > 0.08, `${kind} is only ${((count / stunts) * 100).toFixed(1)}% of tricks`);
    assert(count / stunts < 0.5, `${kind} is ${((count / stunts) * 100).toFixed(1)}% of tricks`);
  }

  // The hand rests longer after a trick than after a fidget.
  assert(STUNT_REST_GAIN > 1.2, "a trick must earn a longer rest than a fidget");
  for (const seed of [2, 9, 31]) {
    const sequence = idleGestureSequence(60, seed, ON);
    for (let index = 1; index < sequence.length; index++) {
      const previous = sequence[index - 1]!;
      if (!previous.stunt) continue;
      const rest = sequence[index]!.startMs - (previous.startMs + previous.durationMs);
      assert(rest > 900, `the hand went straight from a ${previous.kind} into the next slot`);
    }
  }
}

// --- nothing pops: every stunt enters and leaves at exactly rest ------------
{
  const EPSILON = 1e-6;
  const SLOPE_EPSILON = 0.05;
  const h = 1e-4;
  for (const kind of STUNT_KINDS) {
    for (const swing of [-1, 1]) {
      for (const roll of [0, 0.37, 1]) {
        const open = stuntFrame(kind as StuntKind, 0, swing, 3.2, roll, 1 - roll);
        const close = stuntFrame(kind as StuntKind, 1, swing, 3.2, roll, 1 - roll);
        for (const [name, frame] of [
          ["open", open],
          ["close", close],
        ] as const) {
          assert(Math.abs(frame.dx) < EPSILON, `${kind} does not ${name} where the pen is (dx)`);
          assert(Math.abs(frame.dy) < EPSILON, `${kind} does not ${name} where the pen is (dy)`);
          assert(Math.abs(frame.lift) < EPSILON, `${kind} does not ${name} on the board`);
          assert(Math.abs(frame.tiltOffset) < EPSILON, `${kind} does not ${name} at rest tilt`);
          assert(Math.abs(frame.scaleUp) < EPSILON, `${kind} does not ${name} at rest scale`);
        }
        assert(open.spin === 0, `${kind} must start from an unturned barrel`);
        // A turn is a whole turn. 290° is where a stunt that "nearly" ends at
        // rest leaves the barrel, and the frame it ends on snaps the rest.
        assert(
          Math.abs(close.spin % 360) < EPSILON,
          `${kind} leaves the barrel at ${close.spin.toFixed(1)}deg, not a whole turn`,
        );
        if (close.spin !== 0) {
          assert(close.fullTurn === true, `${kind} turns the barrel but is not marked fullTurn`);
        }

        // Zero slope at both ends, so there is no velocity to pop into.
        const near = stuntFrame(kind as StuntKind, h, swing, 3.2, roll, 1 - roll);
        const far = stuntFrame(kind as StuntKind, 1 - h, swing, 3.2, roll, 1 - roll);
        for (const [name, a, b] of [
          ["entry", open, near],
          ["exit", close, far],
        ] as const) {
          assert(
            Math.abs(b.dx - a.dx) / h < SLOPE_EPSILON &&
              Math.abs(b.dy - a.dy) / h < SLOPE_EPSILON &&
              Math.abs(b.lift - a.lift) / h < SLOPE_EPSILON &&
              Math.abs(b.tiltOffset - a.tiltOffset) / h < SLOPE_EPSILON,
            `${kind} has a velocity at its ${name}: it would pop`,
          );
        }
      }
    }
  }
}

// --- the motion between two frames is a hand, not a jump -------------------
/*
  Measured at 8ms, which is finer than the board ever runs, so a cap that holds
  here holds at 60fps with room to spare. The spin is compared the short way
  round: the frame a stunt closes on 720° is the pose it opened from, and a
  renderer cannot tell the two apart.
*/
{
  let worstStep = 0;
  let worstSpin = 0;
  let worstLift = 0;
  let worstScale = 0;

  for (const seed of SEEDS) {
    const poses = sample(seed);
    for (let index = 1; index < poses.length; index++) {
      const previous = poses[index - 1]!;
      const pose = poses[index]!;
      for (const value of [pose.dx, pose.dy, pose.spin, pose.lift, pose.scale]) {
        assert(Number.isFinite(value), `seed ${seed} produced a non-finite pose at frame ${index}`);
      }
      worstStep = Math.max(worstStep, Math.hypot(pose.dx - previous.dx, pose.dy - previous.dy));
      worstSpin = Math.max(worstSpin, Math.abs(shortestAngleDelta(previous.spin, pose.spin)));
      worstLift = Math.max(worstLift, Math.abs(pose.lift - previous.lift));
      worstScale = Math.max(worstScale, Math.abs(pose.scale - previous.scale));
    }
  }

  assert(worstStep < 1.2, `a stunt jumped the pen ${worstStep.toFixed(2)}px in one 8ms frame`);
  assert(worstLift < 1.6, `a stunt jumped the lift ${worstLift.toFixed(2)}px in one 8ms frame`);
  assert(worstScale < 0.01, `a stunt jumped the scale by ${worstScale.toFixed(4)} in one frame`);
  // A double helicopter is the fastest thing the hand does, and it is still a
  // barrel turning in the fingers rather than a strobe.
  assert(worstSpin < 12, `a stunt turned the barrel ${worstSpin.toFixed(1)}deg in one 8ms frame`);
}

// --- a stunt is performed where the pen stands -----------------------------
{
  let worstTravel = 0;
  let worstLift = 0;
  let worstStuntTravel = 0;
  let worstPlainTravel = 0;
  for (const seed of SEEDS) {
    for (const pose of sample(seed)) {
      const travel = Math.hypot(pose.dx, pose.dy);
      worstTravel = Math.max(worstTravel, travel);
      worstLift = Math.max(worstLift, pose.lift);
      if (pose.stunt) worstStuntTravel = Math.max(worstStuntTravel, travel);
      else worstPlainTravel = Math.max(worstPlainTravel, travel);
    }
  }
  assert(
    worstTravel <= STUNT_TRAVEL_MAX_PX,
    `a stunt took the pen ${worstTravel.toFixed(1)}px from where it stood`,
  );
  assert(
    worstLift <= STUNT_LIFT_MAX_PX,
    `a stunt pulled the pen ${worstLift.toFixed(1)}px off the board`,
  );
  /*
    The wider box belongs to the stunt alone: turning stunts on must not
    loosen the plain repertoire by a pixel. The bound is the measured plain
    worst (12.7px) with a little headroom, not `IDLE_TRAVEL_MAX_PX` — the soft
    cap compresses so hard that a plain gesture handed the stunt box peaks at
    17.2px and would slip under an 18px assertion.
  */
  assert(
    worstPlainTravel <= 13.5,
    `a plain gesture used the stunt travel box: ${worstPlainTravel.toFixed(1)}px`,
  );
  assert(
    worstPlainTravel <= IDLE_TRAVEL_MAX_PX,
    `a plain gesture broke its own travel cap: ${worstPlainTravel.toFixed(1)}px`,
  );
  // And it is a real box, not a fig leaf: a trick you cannot see is not one.
  assert(worstStuntTravel > IDLE_TRAVEL_MAX_PX * 0.5, "no stunt actually moved the hand");
  assert(worstLift > IDLE_LIFT_MAX_PX, "no stunt actually came off the board");
}

// --- the hand is never frozen, and never invisible -------------------------
{
  for (const seed of [3, 11, 29]) {
    const poses = sample(seed, 60000);
    let still = 0;
    let worstStill = 0;
    for (let index = 1; index < poses.length; index++) {
      const previous = poses[index - 1]!;
      const pose = poses[index]!;
      const moved =
        Math.hypot(pose.dx - previous.dx, pose.dy - previous.dy) > 1e-4 ||
        Math.abs(pose.spin - previous.spin) > 1e-4 ||
        Math.abs(pose.lift - previous.lift) > 1e-4 ||
        Math.abs(pose.tiltOffset - previous.tiltOffset) > 1e-4;
      still = moved ? 0 : still + 1;
      worstStill = Math.max(worstStill, still);
    }
    assert(
      worstStill * DT < 400,
      `seed ${seed} left the hand frozen for ${worstStill * DT}ms between tricks`,
    );
  }

  // The pose the board paints from has no way to make the marker fainter, and
  // the stunt module must never learn one. This is the whole complaint the
  // area exists to answer: a pen that plays tricks is fine, a pen that
  // disappears is not.
  const stuntSource = readFileSync(
    fileURLToPath(new URL("../src/penStunts.ts", import.meta.url)),
    "utf8",
  );
  const code = stuntSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const banned of ["opacity", "visible", "alpha", "fade"]) {
    assert(
      !code.includes(banned),
      `penStunts must not touch ${banned}: a trick may not make the marker any less visible`,
    );
  }
  const pose = idlePose(3000, 7, ON) as unknown as Record<string, unknown>;
  assert(!("opacity" in pose), "an idle pose has no opacity to give away");
  assert(!("fade" in pose), "an idle pose has no fade to give away");
}

// --- caught mid-trick, the hand puts the pen down rather than dropping it ---
{
  for (const seed of SEEDS.slice(0, 12)) {
    for (const slot of idleGestureSequence(40, seed, ON)) {
      if (!slot.stunt) continue;
      for (const phase of [0.15, 0.4, 0.62, 0.88]) {
        const caught = idlePose(slot.startMs + slot.durationMs * phase, seed, ON);
        assert(caught.stunt, `a stunt slot must report itself at ${phase} through`);
        const target = Math.round(caught.spin / 360) * 360;
        const forward = target > caught.spin;
        const windowMs = idleReleaseMs(caught);
        let previous = caught;
        let turned = 0;
        const frames = Math.ceil(windowMs / DT);
        for (let frame = 1; frame <= frames; frame++) {
          const k = 1 - Math.min((frame * DT) / windowMs, 1);
          const released = releaseIdlePose(caught, k);
          turned += Math.abs(released.spin - previous.spin);
          assert(
            forward ? released.spin >= previous.spin - 1e-9 : released.spin <= previous.spin + 1e-9,
            `${slot.kind} unwound backwards out of its turn`,
          );
          assert(
            Math.hypot(released.dx, released.dy) <= Math.hypot(previous.dx, previous.dy) + 1e-9,
            `${slot.kind} carried the pen further away while being handed back`,
          );
          assert(released.lift <= previous.lift + 1e-9, `${slot.kind} lifted while being caught`);
          previous = released;
        }
        assert(
          Math.abs(previous.spin - target) < 1e-6,
          `${slot.kind} was handed back at ${previous.spin.toFixed(1)}deg, not a whole turn`,
        );
        assert(
          turned <= 180 + 1e-6,
          `${slot.kind} took the long way round on release: ${turned.toFixed(0)}deg`,
        );
        // Nothing may be dropped faster than a hand can catch it.
        const dropRate = caught.lift / windowMs;
        assert(dropRate < 0.22, `${slot.kind} was snatched down at ${dropRate.toFixed(3)}px/ms`);
      }
    }
  }

  // The catch window opens with how far the pen has to come back, capped.
  const still = idlePose(0, 5, ON);
  assert(
    idleReleaseMs(still) === IDLE_RELEASE_MS,
    "a hand already at rest is handed back in the plain window",
  );
  assert(idleReleaseMs(null) === IDLE_RELEASE_MS, "and so is no pose at all");
  let widest = 0;
  for (const seed of SEEDS) {
    for (const pose of sample(seed, 40000)) widest = Math.max(widest, idleReleaseMs(pose));
  }
  assert(widest > IDLE_RELEASE_MS, "a trick in the air must be given longer to be caught");
  assert(
    widest <= IDLE_RELEASE_MAX_MS,
    `the catch must not outlast the pause: ${widest.toFixed(0)}ms`,
  );
}

// --- a pause replays identically, and no two pauses match -------------------
{
  for (let ms = 0; ms <= 30000; ms += 211) {
    const once = idlePose(ms, 4, ON);
    const twice = idlePose(ms, 4, ON);
    assert(
      once.dx === twice.dx && once.spin === twice.spin && once.gesture === twice.gesture,
      `the same pause must replay identically at ${ms}ms`,
    );
  }
  const first = idleGestureSequence(20, 1, ON).map((slot) => slot.kind).join(",");
  const second = idleGestureSequence(20, 2, ON).map((slot) => slot.kind).join(",");
  assert(first !== second, "two pauses in one lesson must not play the same performance");
}

// --- the sequencer and the clock agree about the tricks too -----------------
{
  for (const seed of SEEDS.slice(0, 10)) {
    for (const slot of idleGestureSequence(14, seed, ON)) {
      const opening = idleGestureAt(slot.startMs + 1, seed, ON);
      const middle = idleGestureAt(slot.startMs + slot.durationMs / 2, seed, ON);
      assert(opening?.gesture.kind === slot.kind, `walk and list disagree at ${slot.startMs}ms`);
      assert(opening?.gesture.stunt === slot.stunt, "and about whether it is a trick");
      assert(middle?.gesture.index === slot.index, "and in the middle of it");
    }
  }
}

console.log(
  "verify-pen-stunts: four distinct tricks, each with a name and a sentence a student would recognise, each entering and leaving at exactly rest with the barrel on a whole turn, only the ones the student picked ever played and at the same rate whether one is chosen or four, drawn about one slot in eight and never on a pause's opening beat or within two slots of another, performed inside a bounded box the plain repertoire never borrows, never touching the marker's opacity, caught rather than dropped when work arrives, and bit-for-bit absent when nothing is selected",
);
