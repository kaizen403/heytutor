/**
 * The idle hand, measured.
 *
 * The board used to fill every narration pause with one gesture — the barrel
 * twirling in place, on a fixed period, for as long as the tutor talked. These
 * gates hold the replacement to what a hand actually does: many different
 * things, never the same one twice running, never on a period, always alive
 * between them, and never so far from rest that the fidget could be mistaken
 * for the pen being taken somewhere.
 */

import {
  IDLE_CALM_AFTER_MS,
  IDLE_CALM_AMPLITUDE_DROP,
  IDLE_FIRST_GESTURE_MS,
  IDLE_GAP_MIN_MS,
  IDLE_GESTURE_KINDS,
  IDLE_GESTURE_MS,
  IDLE_HOVER_PX,
  IDLE_LIFT_MAX_PX,
  IDLE_RELEASE_MS,
  IDLE_TRAVEL_MAX_PX,
  idleBreath,
  idleCalm,
  idleGestureAt,
  idleGestureSequence,
  idleMood,
  idlePose,
  releaseIdlePose,
  type IdleGestureKind,
  type IdlePose,
} from "../src/penIdle";
import {
  SPIN_PERIOD_MS,
  SPIN_SWING,
  TILT_MAX_DEG_PER_SEC,
  shortestAngleDelta,
  spinGhosts,
  spinningPose,
} from "../src/penChoreography";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const DT = 8;
const SPAN_MS = 90000;
const SEEDS = [0, 1, 2, 3, 5, 8, 13, 21];

function sample(seed: number, spanMs = SPAN_MS): IdlePose[] {
  const poses: IdlePose[] = [];
  for (let ms = 0; ms <= spanMs; ms += DT) poses.push(idlePose(ms, seed));
  return poses;
}

// --- the hand starts from rest ---------------------------------------------
{
  const start = idlePose(0, 0);
  assert(start.dx === 0 && start.dy === 0, "the fidget must open from exactly where the pen is");
  assert(start.lift === 0, "and with the nib still on the board");
  assert(start.spin === 0 && start.scale === 1, "and with no twirl and no scale-up");
  assert(start.gesture === null, "the first gesture cannot be on the engaging frame");
  assert(
    idleGestureAt(IDLE_FIRST_GESTURE_MS - 1, 0) === null,
    "nothing happens before the hand has held the instrument a beat",
  );
}

// --- the repertoire is a repertoire, not one gesture -----------------------
{
  for (const seed of SEEDS) {
    const sequence = idleGestureSequence(40, seed);
    const kinds = new Set(sequence.map((gesture) => gesture.kind));
    assert(
      kinds.size >= 8,
      `seed ${seed} must draw on the whole repertoire: only ${kinds.size} kinds in 40 gestures`,
    );
    for (let index = 1; index < sequence.length; index++) {
      assert(
        sequence[index]!.kind !== sequence[index - 1]!.kind,
        `seed ${seed} repeated ${sequence[index]!.kind} back to back`,
      );
    }
    for (let index = 2; index < sequence.length; index++) {
      assert(
        sequence[index]!.kind !== sequence[index - 2]!.kind,
        `seed ${seed} alternated ${sequence[index]!.kind} every other gesture — that reads as a tic`,
      );
    }
    const counts = new Map<IdleGestureKind, number>();
    for (const gesture of sequence) {
      counts.set(gesture.kind, (counts.get(gesture.kind) ?? 0) + 1);
    }
    for (const [kind, count] of counts) {
      assert(
        count / sequence.length <= 0.24,
        `seed ${seed} leant on ${kind}: ${((100 * count) / sequence.length).toFixed(0)}% of gestures`,
      );
    }

    // The rests must not be a metronome either. A fixed gap is the other way an
    // idle animation gives itself away, and it survives every gate that only
    // looks at which gesture is playing.
    const gaps: number[] = [];
    for (let index = 1; index < sequence.length; index++) {
      gaps.push(
        sequence[index]!.startMs - (sequence[index - 1]!.startMs + sequence[index - 1]!.durationMs),
      );
    }
    const meanGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const spread =
      Math.sqrt(gaps.reduce((sum, gap) => sum + (gap - meanGap) ** 2, 0) / gaps.length) / meanGap;
    assert(
      spread > 0.15,
      `seed ${seed} rests on a period: gaps vary by only ${(100 * spread).toFixed(1)}% of their mean`,
    );
    for (let index = 1; index < gaps.length; index++) {
      assert(
        Math.abs(gaps[index]! - gaps[index - 1]!) > 1,
        `seed ${seed} took the same rest twice running (${gaps[index]!.toFixed(0)}ms)`,
      );
    }
    for (const gap of gaps) {
      assert(gap > 250, `seed ${seed} left only ${gap.toFixed(0)}ms between gestures`);
    }
  }
}

// --- and it is not the twirl -----------------------------------------------
{
  let twirlMs = 0;
  let turningFrames = 0;
  let frames = 0;
  for (const seed of SEEDS) {
    const poses = sample(seed);
    for (let index = 1; index < poses.length; index++) {
      const rate = Math.abs(shortestAngleDelta(poses[index - 1]!.spin, poses[index]!.spin)) / DT;
      if (rate > 0.02) turningFrames += 1;
      if (poses[index]!.gesture === "twirl") twirlMs += DT;
      frames += 1;
    }
  }
  const twirlShare = twirlMs / (frames * DT);
  const turningShare = turningFrames / frames;
  assert(twirlShare > 0.005, `the twirl must still happen sometimes, got ${(100 * twirlShare).toFixed(2)}%`);
  assert(
    twirlShare < 0.08,
    `the twirl must be an occasional flourish, not the idle: ${(100 * twirlShare).toFixed(1)}% of the pause`,
  );
  assert(
    turningShare < 0.2,
    `the barrel must be still most of the pause: turning ${(100 * turningShare).toFixed(1)}% of frames`,
  );

  // The gesture this replaced, measured the same way: always turning.
  let alwaysTurning = 0;
  let spinFrames = 0;
  for (let ms = DT; ms <= 30000; ms += DT) {
    const rate = Math.abs(shortestAngleDelta(spinningPose(ms - DT).spin, spinningPose(ms).spin)) / DT;
    if (rate > 0.02) alwaysTurning += 1;
    spinFrames += 1;
  }
  assert(
    alwaysTurning / spinFrames > 0.98,
    "the old twirl should measure as turning on essentially every frame",
  );
  assert(
    turningShare < 0.25 * (alwaysTurning / spinFrames),
    "the repertoire must turn the barrel far less than the twirl-only idle did",
  );
}

// --- nothing pops: every gesture enters and leaves at rest -----------------
{
  const seen = new Set<IdleGestureKind>();
  for (let seed = 0; seed < 60 && seen.size < IDLE_GESTURE_KINDS.length; seed++) {
    for (const gesture of idleGestureSequence(30, seed)) {
      if (seen.has(gesture.kind)) continue;
      seen.add(gesture.kind);
      const before = idlePose(gesture.startMs - 0.002, seed);
      const opening = idlePose(gesture.startMs + 0.002, seed);
      const closing = idlePose(gesture.startMs + gesture.durationMs - 0.002, seed);
      const after = idlePose(gesture.startMs + gesture.durationMs + 0.002, seed);
      const enter = Math.hypot(opening.dx - before.dx, opening.dy - before.dy);
      const leave = Math.hypot(after.dx - closing.dx, after.dy - closing.dy);
      assert(enter < 1e-3, `${gesture.kind} enters with a ${enter.toFixed(4)}px step`);
      assert(leave < 1e-3, `${gesture.kind} leaves with a ${leave.toFixed(4)}px step`);
      assert(
        Math.abs(opening.lift - before.lift) < 1e-3 && Math.abs(after.lift - closing.lift) < 1e-3,
        `${gesture.kind} steps the lift at one of its ends`,
      );
      assert(
        Math.abs(shortestAngleDelta(before.spin, opening.spin)) < 1e-2 &&
          Math.abs(shortestAngleDelta(closing.spin, after.spin)) < 1e-2,
        `${gesture.kind} steps the barrel at one of its ends — a turn must close on where it opened`,
      );
    }
  }
  assert(
    seen.size === IDLE_GESTURE_KINDS.length,
    `every gesture must be reachable: never saw ${IDLE_GESTURE_KINDS.filter((kind) => !seen.has(kind)).join(", ")}`,
  );
}

// --- and the motion between frames is a hand, not a jump ------------------
{
  const meanTwirlRate = 360 / SPIN_PERIOD_MS;
  for (const seed of SEEDS) {
    const poses = sample(seed);
    for (let index = 1; index < poses.length; index++) {
      const previous = poses[index - 1]!;
      const pose = poses[index]!;
      const step = Math.hypot(pose.dx - previous.dx, pose.dy - previous.dy);
      assert(step / DT < 0.09, `seed ${seed} moved the nib ${(step / DT).toFixed(3)}px/ms in one frame`);
      const tiltRate = (Math.abs(pose.tiltOffset - previous.tiltOffset) / DT) * 1000;
      assert(
        tiltRate <= TILT_MAX_DEG_PER_SEC,
        `seed ${seed} rolled the barrel at ${tiltRate.toFixed(0)}deg/s — past what a wrist can do`,
      );
      assert(
        Math.abs(pose.lift - previous.lift) / DT < 0.12,
        `seed ${seed} snapped the lift by ${Math.abs(pose.lift - previous.lift).toFixed(2)}px in a frame`,
      );
      const spinRate = Math.abs(shortestAngleDelta(previous.spin, pose.spin)) / DT;
      assert(
        spinRate <= meanTwirlRate * (1 + SPIN_SWING) + 1e-6,
        `seed ${seed} turned the barrel at ${spinRate.toFixed(3)}deg/ms, past a flick`,
      );
    }
  }
}

// --- the smear always agrees with the motion it smears --------------------
{
  const meanTwirlRate = 360 / SPIN_PERIOD_MS;
  for (const seed of SEEDS) {
    let sawSmear = false;
    for (let ms = DT; ms <= 40000; ms += DT) {
      const pose = idlePose(ms, seed);
      const measured =
        Math.abs(shortestAngleDelta(idlePose(ms - 1, seed).spin, idlePose(ms + 1, seed).spin)) /
        2 /
        meanTwirlRate;
      assert(
        pose.spinVelocity >= 0 && pose.spinVelocity <= 1 + SPIN_SWING + 1e-9,
        `seed ${seed} reported a smear rate outside the band: ${pose.spinVelocity}`,
      );
      assert(
        Math.abs(pose.spinVelocity - measured) < 0.05,
        `seed ${seed} at ${ms}ms claims ${pose.spinVelocity.toFixed(3)} but turns ${measured.toFixed(3)}`,
      );
      if (pose.spinVelocity > 0.2) sawSmear = true;
      if (pose.spinVelocity <= 0.001) {
        assert(spinGhosts(pose.spinVelocity).length === 0, "a still barrel must cast no smear");
      }
    }
    assert(sawSmear, `seed ${seed} never turned the barrel enough to smear — the twirl went missing`);
  }
}

// --- the pen fidgets where it stands -------------------------------------
{
  // The promise, not only what today's amplitudes happen to reach: a fidget
  // that may stray further than this stops being a fidget and starts being the
  // pen going somewhere, which the board owns and the hand does not.
  assert(
    IDLE_TRAVEL_MAX_PX <= 20 && IDLE_LIFT_MAX_PX <= 20,
    `the fidget must stay near rest: cap is ${IDLE_TRAVEL_MAX_PX}px travel, ${IDLE_LIFT_MAX_PX}px lift`,
  );
  let peakTravel = 0;
  for (const seed of SEEDS) {
    for (const pose of sample(seed)) {
      const travel = Math.hypot(pose.dx, pose.dy);
      peakTravel = Math.max(peakTravel, travel);
      assert(
        travel <= IDLE_TRAVEL_MAX_PX,
        `seed ${seed} wandered ${travel.toFixed(1)}px from rest — the pen must not go anywhere`,
      );
      assert(pose.lift >= 0, `seed ${seed} pushed the nib through the board: lift ${pose.lift}`);
      assert(
        pose.lift <= IDLE_LIFT_MAX_PX,
        `seed ${seed} lifted ${pose.lift.toFixed(1)}px off the board`,
      );
      assert(
        pose.scale >= 1 && pose.scale <= 1.12,
        `seed ${seed} scaled the instrument to ${pose.scale.toFixed(3)}`,
      );
      assert(
        Math.abs(pose.tiltOffset) <= 12,
        `seed ${seed} leant the barrel ${pose.tiltOffset.toFixed(1)}deg off its writing angle`,
      );
    }
  }
  assert(peakTravel < 12, `the widest gesture strayed ${peakTravel.toFixed(1)}px, which reads as a move`);
  assert(peakTravel > 4, `no gesture went anywhere at all: widest was ${peakTravel.toFixed(1)}px`);
}

// --- the gestures touch the board, and the rest of the time hover --------
{
  let contacts = 0;
  for (const seed of SEEDS) {
    for (const pose of sample(seed)) {
      if ((pose.gesture === "tap" || pose.gesture === "jab") && pose.lift === 0) contacts += 1;
    }
  }
  assert(contacts > 40, `taps and jabs must actually reach the board, saw ${contacts} frames of contact`);
  const settled = idlePose(4000, 0);
  assert(
    settled.lift > IDLE_HOVER_PX * 0.9 || settled.gesture !== null,
    "between gestures the nib rests just off the board",
  );
}

// --- the hand is never frozen -------------------------------------------
{
  const WINDOW_MS = 2500;
  for (const seed of SEEDS) {
    const poses = sample(seed);
    const perWindow = Math.round(WINDOW_MS / DT);
    for (let start = Math.round(1500 / DT); start + perWindow < poses.length; start += perWindow) {
      let alive = 0;
      for (let index = start + 1; index <= start + perWindow; index++) {
        const previous = poses[index - 1]!;
        const pose = poses[index]!;
        alive +=
          Math.hypot(pose.dx - previous.dx, pose.dy - previous.dy) +
          Math.abs(pose.tiltOffset - previous.tiltOffset) +
          Math.abs(pose.lift - previous.lift);
      }
      assert(
        alive > 2.5,
        `seed ${seed} parked the pen for ${WINDOW_MS}ms at ${start * DT}ms: only ${alive.toFixed(2)} of motion`,
      );
    }
  }
}

// --- and it is not on a loop --------------------------------------------
{
  const poses = sample(0, 60000);
  for (let periodMs = 1000; periodMs <= 20000; periodMs += 250) {
    const shift = Math.round(periodMs / DT);
    let worst = 0;
    for (let index = Math.round(2000 / DT); index + shift < poses.length; index += 4) {
      const a = poses[index]!;
      const b = poses[index + shift]!;
      worst = Math.max(
        worst,
        Math.hypot(a.dx - b.dx, a.dy - b.dy) + Math.abs(a.tiltOffset - b.tiltOffset),
      );
    }
    assert(worst > 1, `the idle repeats itself every ${periodMs}ms — that is a loop, not a hand`);
  }
}

// --- an unhurried hand fidgets less, not more ---------------------------
{
  let calmedKinds = 0;
  for (const seed of SEEDS) {
    const sequence = idleGestureSequence(60, seed);
    const early = sequence.filter((gesture) => gesture.startMs < IDLE_CALM_AFTER_MS);
    const late = sequence.filter((gesture) => gesture.startMs > IDLE_CALM_AFTER_MS * 3);
    assert(early.length > 2, `seed ${seed} must get going inside the first ${IDLE_CALM_AFTER_MS}ms`);
    const rate = (list: typeof sequence): number => {
      const span = list[list.length - 1]!.startMs - list[0]!.startMs;
      return span > 0 ? list.length / span : 0;
    };
    assert(
      rate(late) < rate(early),
      `seed ${seed} fidgets more the longer it waits — it must settle instead`,
    );
    // Same gesture, later in the pause: it has to be the smaller one. Compared
    // per kind and with the breathing subtracted off, so the measure is the
    // gesture itself rather than which kinds happened to land in each window.
    const peakOf = (gesture: { startMs: number; durationMs: number }): number => {
      let peak = 0;
      for (let t = gesture.startMs; t <= gesture.startMs + gesture.durationMs; t += DT) {
        const pose = idlePose(t, seed);
        const breath = idleBreath(t);
        peak = Math.max(
          peak,
          Math.hypot(pose.dx - breath.dx, pose.dy - breath.dy) +
            Math.abs(pose.lift - breath.hover) +
            Math.abs(pose.tiltOffset - breath.tiltOffset),
        );
      }
      return peak;
    };
    let compared = 0;
    for (const kind of IDLE_GESTURE_KINDS) {
      const first = early.find((gesture) => gesture.kind === kind);
      const last = late.filter((gesture) => gesture.kind === kind).pop();
      if (!first || !last) continue;
      compared += 1;
      assert(
        peakOf(last) < peakOf(first),
        `seed ${seed} does not calm down: a late ${kind} is as big as the first one`,
      );
    }
    calmedKinds += compared;
  }
  assert(calmedKinds > 10, `the calm ramp must be measurable, only compared ${calmedKinds} gestures`);
  assert(idleCalm(0) === 1, "the first gesture of a pause is full size");
  let previousCalm = 1;
  for (let ms = 0; ms <= 120000; ms += 500) {
    const calm = idleCalm(ms);
    assert(calm <= previousCalm + 1e-12, `the calm ramp must never turn back up at ${ms}ms`);
    assert(calm >= 1 - IDLE_CALM_AMPLITUDE_DROP - 1e-9, "and never past its floor");
    previousCalm = calm;
  }
  assert(
    Math.abs(idleCalm(120000) - (1 - IDLE_CALM_AMPLITUDE_DROP)) < 1e-6,
    "a long pause reaches the calm floor",
  );
  for (const seed of SEEDS) {
    const mood = idleMood(seed);
    assert(mood.energy > 0.5 && mood.energy < 1.5, `mood energy out of band: ${mood.energy}`);
    assert(mood.restless > 0.5 && mood.restless < 1.6, `mood restlessness out of band: ${mood.restless}`);
  }
}

// --- and two pauses in one lesson are not the same performance ----------
{
  let differed = 0;
  let pairs = 0;
  for (let seed = 0; seed < 24; seed++) {
    const a = idleGestureSequence(6, seed).map((gesture) => gesture.kind).join(",");
    const b = idleGestureSequence(6, seed + 1).map((gesture) => gesture.kind).join(",");
    pairs += 1;
    if (a !== b) differed += 1;
    assert(
      idleGestureSequence(6, seed)[0]!.kind !== undefined,
      "every pause must open with a gesture",
    );
  }
  assert(differed === pairs, `consecutive pauses must not replay the same order: ${pairs - differed} repeats`);
  // Same seed, same performance — a replayed lecture must not drift.
  const once = sample(3, 20000);
  const twice = sample(3, 20000);
  for (let index = 0; index < once.length; index++) {
    assert(
      once[index]!.dx === twice[index]!.dx && once[index]!.spin === twice[index]!.spin,
      "the same pause must replay identically",
    );
  }
}

// --- and the instrument is handed back without a twitch -----------------
{
  const gesture = idleGestureSequence(20, 1).find((entry) => entry.kind === "twirl");
  assert(gesture, "seed 1 must contain a twirl for the release test");
  const midTurn = idlePose(gesture.startMs + gesture.durationMs * 0.5, 1);
  assert(midTurn.spin > 100 && midTurn.spin < 260, `expected a half-turn, got ${midTurn.spin}`);

  // Caught late in the turn the barrel must finish it; caught early it must
  // fall back. Either way it goes the short way and lands on a whole turn —
  // never unwinding 290° backwards through the flick it just made.
  for (const phase of [0.3, 0.5, 0.72, 0.9]) {
    const caught = idlePose(gesture.startMs + gesture.durationMs * phase, 1);
    const target = Math.round(caught.spin / 360) * 360;
    const forward = target > caught.spin;
    let previous = caught;
    let travelled = 0;
    const frames = Math.ceil(IDLE_RELEASE_MS / DT);
    for (let frame = 1; frame <= frames; frame++) {
      const k = 1 - Math.min((frame * DT) / IDLE_RELEASE_MS, 1);
      const pose = releaseIdlePose(caught, k);
      travelled += Math.abs(pose.spin - previous.spin);
      assert(
        forward ? pose.spin >= previous.spin - 1e-9 : pose.spin <= previous.spin + 1e-9,
        `released at ${caught.spin.toFixed(0)}deg the barrel changed direction: ${previous.spin.toFixed(1)} -> ${pose.spin.toFixed(1)}`,
      );
      assert(
        Math.hypot(pose.dx, pose.dy) <= Math.hypot(previous.dx, previous.dy) + 1e-9,
        "the release must only ever bring the pen back toward rest",
      );
      assert(pose.lift <= previous.lift + 1e-9, "and only ever set it down");
      previous = pose;
    }
    assert(
      Math.abs(previous.spin - target) < 1e-6,
      `the release must land on a whole turn: ended at ${previous.spin.toFixed(1)}deg`,
    );
    assert(
      travelled <= 180 + 1e-6,
      `the release must take the short way round: turned ${travelled.toFixed(0)}deg`,
    );
  }
  const landed = releaseIdlePose(midTurn, 0);
  assert(
    landed.dx === 0 && landed.dy === 0 && landed.lift === 0 && landed.tiltOffset === 0,
    "a released pose is exactly the pose the pen was anchored at",
  );
  assert(landed.scale === 1 && landed.spinVelocity === 0, "and it is at rest, with no smear left");
  assert(landed.spin % 360 === 0, `and the barrel is back to a whole turn, got ${landed.spin}`);

  // A gesture caught mid-flight is small enough that even the snap would be
  // survivable — the release is belt and braces, not the only guard.
  let worst = 0;
  for (const seed of SEEDS) {
    for (const pose of sample(seed, 40000)) {
      if (pose.gesture === "twirl") continue;
      worst = Math.max(worst, Math.hypot(pose.dx, pose.dy));
    }
  }
  assert(worst < 14, `a gesture other than the twirl must stay small, peaked at ${worst.toFixed(1)}px`);
}

// --- the sequencer agrees with the clock --------------------------------
{
  for (const seed of SEEDS) {
    for (const gesture of idleGestureSequence(12, seed)) {
      const start = idleGestureAt(gesture.startMs + 1, seed);
      const middle = idleGestureAt(gesture.startMs + gesture.durationMs / 2, seed);
      const past = idleGestureAt(gesture.startMs + gesture.durationMs + IDLE_GAP_MIN_MS * 0.5, seed);
      assert(start?.gesture.kind === gesture.kind, `walk and list disagree at ${gesture.startMs}ms`);
      assert(middle?.gesture.index === gesture.index, "and in the middle of the gesture");
      assert(past === null, "and the rest after it is a rest");
      assert(
        gesture.durationMs === IDLE_GESTURE_MS[gesture.kind],
        "a gesture must run for its own duration",
      );
    }
  }
}

console.log(
  "verify-pen-idle: the idle hand plays a whole repertoire instead of one twirl, never the same gesture twice running, every gesture entering and leaving at rest, the barrel turning on a fifth of the frames the old twirl did, the nib fidgeting where it stands and never through the board, breathing in every rest, never repeating on a period, calming as the pause lengthens, seeded so no two pauses match, and handing the instrument back by finishing the turn rather than snapping out of it",
);
