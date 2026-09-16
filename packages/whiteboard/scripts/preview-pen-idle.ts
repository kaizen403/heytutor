/**
 * Render the idle repertoire to a standalone page for visual review.
 *
 * The gates in `verify-pen-idle` prove the numbers; this is for the other
 * question, which is whether the motion reads as a hand. It samples the real
 * `idlePose` — the same function the board calls every frame — bakes the poses
 * into the page, and plays them back on the instrument art `VirtualCursor`
 * draws, so what you watch here is what the board does.
 *
 *   pnpm --filter @heytutor/whiteboard preview:idle /tmp/pen-idle.html
 */

import { writeFileSync } from "node:fs";
import {
  instrumentMetrics,
  instrumentPalette,
  instrumentShapes,
  type InstrumentKind,
  type InstrumentPalette,
  type InstrumentShape,
} from "../src/instruments";
import { RESTING_TILT } from "../src/penChoreography";
import {
  IDLE_GESTURE_KINDS,
  IDLE_GESTURE_MS,
  idleBreath,
  idleGestureSequence,
  idlePose,
  type IdleGestureKind,
} from "../src/penIdle";

const BOARD = "#F6E4C4";
const INK = "#1B2A4A";
const FRAME_MS = 20;
const PAUSE_MS = 45000;
const PAUSE_SEEDS = [1, 2, 3];
const LEAD_MS = 360;

function renderShape(shape: InstrumentShape, palette: InstrumentPalette): string {
  const fill = shape.fill ? palette[shape.fill] : "none";
  const stroke = shape.stroke
    ? ` stroke="${palette[shape.stroke]}" stroke-width="${shape.strokeWidth ?? 0.4}"`
    : "";
  const opacity = shape.opacity !== undefined ? ` opacity="${shape.opacity}"` : "";
  const filter = shape.shadow ? ' filter="url(#drop)"' : "";
  if (shape.kind === "rect") {
    return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.radius ?? 0}" fill="${fill}"${stroke}${opacity}${filter} stroke-linejoin="round"/>`;
  }
  if (shape.kind === "circle") {
    return `<circle cx="${shape.x}" cy="${shape.y}" r="${shape.radius}" fill="${fill}"${stroke}${opacity}/>`;
  }
  const points: string[] = [];
  for (let index = 0; index < shape.points.length; index += 2) {
    points.push(`${shape.points[index]},${shape.points[index + 1]}`);
  }
  if (shape.kind === "stroke") {
    return `<polyline points="${points.join(" ")}" fill="none"${stroke}${opacity}/>`;
  }
  return `<polygon points="${points.join(" ")}" fill="${fill}"${stroke}${opacity}${filter} stroke-linejoin="round"/>`;
}

function barrel(kind: InstrumentKind): string {
  const palette = instrumentPalette(kind, INK);
  return instrumentShapes(kind)
    .map((shape) => renderShape(shape, palette))
    .join("");
}

/** One frame, rounded to hundredths — the page only needs what the eye sees. */
type Frame = [number, number, number, number, number, number, number, number];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function frameAt(heldMs: number, seed: number, subtractBreath: boolean): Frame {
  const pose = idlePose(heldMs, seed);
  const breath = idleBreath(heldMs);
  const gesture = pose.gesture ? IDLE_GESTURE_KINDS.indexOf(pose.gesture) : -1;
  return [
    round(subtractBreath ? pose.dx - breath.dx : pose.dx),
    round(subtractBreath ? pose.dy - breath.dy : pose.dy),
    round(subtractBreath ? pose.tiltOffset - breath.tiltOffset : pose.tiltOffset),
    round(pose.spin),
    round(subtractBreath ? pose.lift - breath.hover : pose.lift),
    round(pose.scale),
    round(pose.spinVelocity),
    gesture,
  ];
}

/** A whole pause, as the board would play it. */
const pauses = PAUSE_SEEDS.map((seed) => {
  const frames: Frame[] = [];
  for (let ms = 0; ms <= PAUSE_MS; ms += FRAME_MS) frames.push(frameAt(ms, seed, false));
  return {
    seed,
    frames,
    sequence: idleGestureSequence(60, seed)
      .filter((gesture) => gesture.startMs < PAUSE_MS)
      .map((gesture) => [IDLE_GESTURE_KINDS.indexOf(gesture.kind), gesture.startMs, gesture.durationMs]),
  };
});

/**
 * And each gesture on its own, breathing subtracted, so a tile loops on exactly
 * the gesture and you can see one thing at a time.
 */
const gallery = IDLE_GESTURE_KINDS.map((kind: IdleGestureKind) => {
  let found: { startMs: number; seed: number } | null = null;
  for (let seed = 0; seed < 80 && !found; seed++) {
    const hit = idleGestureSequence(30, seed).find((gesture) => gesture.kind === kind);
    if (hit) found = { startMs: hit.startMs, seed };
  }
  if (!found) throw new Error(`no seed produced a ${kind}`);
  const frames: Frame[] = [];
  const from = found.startMs - LEAD_MS;
  const to = found.startMs + IDLE_GESTURE_MS[kind] + LEAD_MS;
  for (let ms = from; ms <= to; ms += FRAME_MS) frames.push(frameAt(ms, found.seed, true));
  return { kind, durationMs: IDLE_GESTURE_MS[kind], frames };
});

const CAPTIONS: Record<IdleGestureKind, string> = {
  twirl: "one full turn between the fingers, ending where it began",
  roll: "the barrel rolled a little and rolled back: adjusting the hold",
  tap: "three taps of the nib against the board",
  bob: "bobbing in the air, nodding along with the sentence",
  wander: "a drift out across the board and back",
  sway: "swung about the nib like a metronome",
  lean: "pulled back to look at what is written, held, returned",
  loop: "a lazy figure eight in the air",
  jab: "two quick dips at the board: emphasis",
  jitter: "a fast nervous roll back and forth",
};

const data = {
  frameMs: FRAME_MS,
  kinds: IDLE_GESTURE_KINDS,
  captions: CAPTIONS,
  restingTilt: RESTING_TILT.idle,
  pivotY: instrumentMetrics("pen").pivotY,
  pauses,
  gallery,
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>The idle hand</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px 20px 60px; background: #14110d; color: #EDE6D8;
         font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.09em; color: #A79C86;
       margin: 34px 0 12px; font-weight: 600; }
  p.lede { margin: 0 0 22px; max-width: 62ch; color: #B3A992; }
  .wrap { max-width: 1120px; margin: 0 auto; }
  .board { background: ${BOARD}; border-radius: 10px; position: relative; overflow: hidden; }
  .stage { width: 100%; aspect-ratio: 16 / 7; display: block; }
  .now { display: flex; gap: 14px; align-items: baseline; margin: 12px 0 0; flex-wrap: wrap; }
  .now b { font-size: 15px; color: #F3EADA; }
  .now span { color: #A79C86; }
  .ribbon { position: relative; height: 26px; margin-top: 10px; background: #221d16;
            border-radius: 5px; overflow: hidden; }
  .ribbon i { position: absolute; top: 0; bottom: 0; background: #6C86B8; opacity: 0.85;
              border-radius: 3px; font-style: normal; font-size: 9px; color: #10131a;
              display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .ribbon .head { position: absolute; top: 0; bottom: 0; width: 2px; background: #F0C97B; }
  .controls { display: flex; gap: 10px; align-items: center; margin: 14px 0 0; flex-wrap: wrap; }
  button { font: inherit; padding: 6px 13px; border-radius: 999px; border: 1px solid #3B342A;
           background: #221d16; color: #EDE6D8; cursor: pointer; }
  button[aria-pressed="true"] { background: #EDE6D8; color: #1a1611; border-color: #EDE6D8; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; }
  .tile { background: ${BOARD}; border-radius: 9px; padding: 0 0 10px; }
  .tile svg { width: 100%; aspect-ratio: 1 / 1; display: block; }
  .tile h3 { margin: 0 10px 2px; font-size: 13px; color: #241d13; }
  .tile p { margin: 0 10px; font-size: 11px; line-height: 1.35; color: #6B5F49; }
  .legend { color: #8C836F; font-size: 12px; margin-top: 8px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>The idle hand</h1>
  <p class="lede">What the pen does while the voice is teaching and there is nothing to draw.
  Every pose here comes from <code>idlePose</code>, the function the board calls each frame,
  played back on the instrument art the board draws.</p>

  <h2>One pause, forty-five seconds</h2>
  <div class="board"><svg class="stage" id="stage" viewBox="0 0 320 140">
    <defs><filter id="drop" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0.9" dy="1.1" stdDeviation="2.4" flood-color="#000" flood-opacity="0.42"/>
    </filter></defs>
    <path id="trail" fill="none" stroke="${INK}" stroke-width="0.5" opacity="0.28"/>
    <g id="pen">${barrel("pen")}</g>
  </svg></div>
  <div class="now"><b id="label">…</b><span id="clock"></span></div>
  <div class="ribbon" id="ribbon"><div class="head" id="head"></div></div>
  <div class="controls" id="seeds"></div>
  <p class="legend">The ribbon is the gesture sequence; the gaps are rests, where the hand
  only breathes. Each pause draws its own order, its own moods and its own handedness, so no
  two pauses in a lesson play the same performance.</p>

  <h2>The repertoire, one gesture at a time</h2>
  <div class="grid" id="grid"></div>
  <p class="legend">Breathing subtracted in these tiles, so each shows only its own gesture.
  Every one starts and ends at exactly rest — that is what lets them be sequenced without the
  pen ever popping into or out of a motion.</p>
</div>
<script id="data" type="application/json">${JSON.stringify(data)}</script>
<script>
const DATA = JSON.parse(document.getElementById("data").textContent);
const PEN_BODY = document.getElementById("pen").innerHTML;

function pose(group, frame, cx, cy, scale) {
  const [dx, dy, tilt, spin, lift, grow] = frame;
  group.setAttribute(
    "transform",
    "translate(" + (cx + dx * scale) + " " + (cy + dy * scale) + ") rotate(" +
      (DATA.restingTilt + tilt) + ") scale(" + (scale * grow) + ") translate(0 " + -lift + ")",
  );
  const inner = group.firstElementChild;
  if (inner) {
    inner.setAttribute(
      "transform",
      "translate(0 " + DATA.pivotY + ") rotate(" + spin + ") translate(0 " + -DATA.pivotY + ")",
    );
  }
}

// --- the long pause -------------------------------------------------------
const stage = document.getElementById("stage");
const penGroup = document.getElementById("pen");
penGroup.innerHTML = "<g>" + PEN_BODY + "</g>";
const trail = document.getElementById("trail");
const label = document.getElementById("label");
const clock = document.getElementById("clock");
const ribbon = document.getElementById("ribbon");
const head = document.getElementById("head");
const CX = 160, CY = 96, SCALE = 1.5;
let pauseIndex = 0;
let startedAt = performance.now();

function drawRibbon() {
  const pause = DATA.pauses[pauseIndex];
  const span = pause.frames.length * DATA.frameMs;
  ribbon.querySelectorAll("i").forEach((node) => node.remove());
  for (const [kind, startMs, durationMs] of pause.sequence) {
    const node = document.createElement("i");
    node.style.left = (100 * startMs / span) + "%";
    node.style.width = Math.max(0.6, 100 * durationMs / span) + "%";
    node.textContent = DATA.kinds[kind];
    ribbon.appendChild(node);
  }
}

const seeds = document.getElementById("seeds");
DATA.pauses.forEach((pause, index) => {
  const button = document.createElement("button");
  button.textContent = "pause " + (index + 1);
  button.setAttribute("aria-pressed", String(index === 0));
  button.onclick = () => {
    pauseIndex = index;
    startedAt = performance.now();
    points.length = 0;
    drawRibbon();
    seeds.querySelectorAll("button").forEach((other, otherIndex) =>
      other.setAttribute("aria-pressed", String(otherIndex === index)));
  };
  seeds.appendChild(button);
});

const points = [];
function tick(now) {
  const pause = DATA.pauses[pauseIndex];
  const span = pause.frames.length * DATA.frameMs;
  const elapsed = (now - startedAt) % span;
  const frame = pause.frames[Math.floor(elapsed / DATA.frameMs)] || pause.frames[0];
  pose(penGroup, frame, CX, CY, SCALE);
  points.push([CX + frame[0] * SCALE, CY + frame[1] * SCALE]);
  if (points.length > 90) points.shift();
  trail.setAttribute("d", "M " + points.map((p) => p[0].toFixed(2) + " " + p[1].toFixed(2)).join(" L "));
  const kind = frame[7] >= 0 ? DATA.kinds[frame[7]] : null;
  label.textContent = kind ? kind : "breathing";
  clock.textContent = kind
    ? DATA.captions[kind] + "  ·  " + (elapsed / 1000).toFixed(1) + "s into the pause"
    : "resting between gestures  ·  " + (elapsed / 1000).toFixed(1) + "s into the pause";
  head.style.left = (100 * elapsed / span) + "%";
  requestAnimationFrame(tick);
}
drawRibbon();
requestAnimationFrame(tick);

// --- the gallery ----------------------------------------------------------
const grid = document.getElementById("grid");
const tiles = DATA.gallery.map((entry) => {
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.innerHTML =
    '<svg viewBox="0 0 120 120"><g class="pen"><g>' + PEN_BODY + "</g></g></svg>" +
    "<h3>" + entry.kind + " · " + (entry.durationMs / 1000).toFixed(2) + "s</h3>" +
    "<p>" + DATA.captions[entry.kind] + "</p>";
  grid.appendChild(tile);
  return { entry, group: tile.querySelector("g.pen") };
});

function tickGallery(now) {
  for (const tile of tiles) {
    const span = tile.entry.frames.length * DATA.frameMs;
    const frame = tile.entry.frames[Math.floor((now % span) / DATA.frameMs)] || tile.entry.frames[0];
    pose(tile.group, frame, 60, 82, 1.15);
  }
  requestAnimationFrame(tickGallery);
}
requestAnimationFrame(tickGallery);
</script>
</body>
</html>
`;

const target = process.argv[2] ?? "pen-idle-preview.html";
writeFileSync(target, html);
console.log(
  `preview-pen-idle: wrote ${target} — ${pauses.length} pauses, ${gallery.length} gestures, ${(html.length / 1024).toFixed(0)}KB`,
);
