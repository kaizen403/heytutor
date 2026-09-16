/**
 * Board-versus-voice coupling analyser.
 *
 * Reads one or more probe runs (console.jsonl written by lesson-probe.mjs) and,
 * per segment, reconstructs the spoken window and every ink interval, then
 * reports how much of each sentence the pen was busy, parked, racing ahead or
 * still drawing after the voice stopped.
 *
 *   node sync-analyser.mjs <run-dir|console.jsonl> [more runs...] [--json out.json] [--md out.md] [--worst 3]
 *
 * All durations are WALL milliseconds (what the student sees). The runtime
 * plays TTS at DEFAULT_REPLAY_SPEED (1.5x) by default, so `total_duration_ms`
 * from the alignment is media time; the analyser measures the playback rate
 * per lesson from the log itself and reports it.
 *
 * Log grammar (apps/tutor, dev build, tutorDebug):
 *   [tutor:segment] runSegment start {index, narration_chars, command_type, command_text, narration_preview}
 *   [tutor:segment] runSegment end {index, chars, command_count}
 *   [tutor:tts]     segment audio started {index}
 *   [tutor:tts]     ws playback start (buffered) {ttft_ms}
 *   [tutor:tts]     segment timings {index, total_duration_ms}       (logged twice; first wins)
 *   [tutor:tts]     segment complete {duration_ms, total_audio_sec}  (no index; paired with the open segment)
 *   [tutor:draw]    write schedule ready {segment_index, schedule_source, timing_chars, first_offset_ms, ...}
 *   [tutor:draw]    write char start {segment_index, char, char_index, target_ms, audio_pos_ms, lag_ms} (first 8 only)
 *   [tutor:draw]    executeCommand start {type, text, params, speech_duration_ms, ink_pace}
 *   [tutor:draw]    executeCommand done {type}                        (nested: FOCUS/WRITE/FRAME host children)
 *   [tutor:draw]    layout erasing work area {text, rect_count}
 *   [tutor:turn]    turn complete {segment_count, total_draw_ms}
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const argv = process.argv.slice(2);
const opts = { json: null, md: null, worst: 3 };
const inputs = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--json") opts.json = argv[++i];
  else if (a === "--md") opts.md = argv[++i];
  else if (a === "--worst") opts.worst = Number(argv[++i]);
  else inputs.push(a);
}
if (inputs.length === 0) {
  console.error("usage: node sync-analyser.mjs <run-dir|console.jsonl>... [--json out] [--md out] [--worst N]");
  process.exit(2);
}

const INK_TYPES = new Set([
  "WRITE", "LABEL", "DIMENSION", "DRAW_LINE", "DRAW_ARC", "DRAW_POINT", "DRAW_CIRCLE", "DRAW_CURVE",
  "DRAW_RECT", "DRAW_POLYGON", "DRAW_PATH", "ARROW", "EMPHASIZE", "TYPE", "FRAME", "ERASE", "HIGHLIGHT",
  "UNDERLINE", "BOX", "CIRCLE_AROUND", "DRAW_ELLIPSE", "DRAW_ANGLE", "DRAW_VECTOR", "DRAW_AXES", "DRAW_GRID",
]);
const GESTURE_TYPES = new Set(["FOCUS", "POINT"]);
const SCENE_TYPES = new Set([
  "DRAW_LINE", "DRAW_ARC", "DRAW_POINT", "DRAW_CIRCLE", "DRAW_CURVE", "DRAW_RECT", "DRAW_POLYGON", "DRAW_PATH",
  "ARROW", "LABEL", "DIMENSION", "DRAW_ELLIPSE", "DRAW_ANGLE", "DRAW_VECTOR", "DRAW_AXES", "DRAW_GRID",
]);

const LINE_RE = /^\[tutor:([a-z]+)\]\s+(\d+(?:\.\d+)?)ms\s+(.*?)(?:\s+(\{.*\}))?\s*$/s;

function parseLine(raw) {
  const m = LINE_RE.exec(raw.text);
  if (!m) return null;
  let payload = null;
  if (m[4]) {
    try { payload = JSON.parse(m[4]); } catch { payload = { _unparsed: m[4].slice(0, 200) }; }
  }
  return { t: Number(m[2]), wall: raw.wall, tag: m[1], msg: m[3].trim(), p: payload };
}

function unionMs(intervals, lo, hi) {
  // total length of the union of [s,e] intervals clipped to [lo,hi]
  const clipped = intervals
    .map(([s, e]) => [Math.max(s, lo), Math.min(e, hi)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0, curS = null, curE = null;
  for (const [s, e] of clipped) {
    if (curS === null) { curS = s; curE = e; continue; }
    if (s <= curE) curE = Math.max(curE, e);
    else { total += curE - curS; curS = s; curE = e; }
  }
  if (curS !== null) total += curE - curS;
  return total;
}

function gapsMs(intervals, lo, hi) {
  // list of [s,e] gaps in [lo,hi] not covered by intervals
  const clipped = intervals
    .map(([s, e]) => [Math.max(s, lo), Math.min(e, hi)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let cursor = lo;
  for (const [s, e] of clipped) {
    if (s > cursor) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (hi > cursor) gaps.push([cursor, hi]);
  return gaps;
}

function analyseRun(input) {
  const file = existsSync(input) && statSync(input).isDirectory() ? join(input, "console.jsonl") : input;
  const name = basename(existsSync(input) && statSync(input).isDirectory() ? input : input.replace(/\/console\.jsonl$/, ""));
  const raws = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const events = raws.map(parseLine).filter(Boolean);

  const question = (() => {
    const q = raws.find((r) => r.type === "probe" && r.text.startsWith("goto "));
    if (!q) return null;
    try { return decodeURIComponent(q.text.split("?q=")[1] ?? ""); } catch { return null; }
  })();

  const segments = [];
  const byIndex = new Map();
  let open = null;
  const stack = []; // nested executeCommand
  const commands = []; // all commands, with segment ref
  let turnComplete = null;
  let turnMeta = null;
  const planner = [];
  const pendingErase = { seg: null, start: null };
  const timingsByIndex = new Map();
  const lessonMeta = { intro: null, segmentsBuilt: null, codeLesson: false, typeDropped: 0, frames: null };

  for (const ev of events) {
    const { t, tag, msg, p } = ev;
    if (tag === "planner") {
      if (msg === "code lesson lane" || msg === "dsa walk-through frames" || msg === "dsa scene synthesis") {
        planner.push({ t, msg, p });
        if (msg === "code lesson lane") lessonMeta.codeLesson = true;
        if (msg === "dsa walk-through frames") lessonMeta.frames = p;
      }
      continue;
    }
    if (tag === "draw" && msg === "queued diagram intro segments") { lessonMeta.intro = p; continue; }
    if (tag === "turn" && msg === "lesson segments built") { lessonMeta.segmentsBuilt = p; continue; }
    if (tag === "turn" && msg === "turn complete") { turnComplete = t; turnMeta = p; continue; }

    if (tag === "segment" && msg === "runSegment start") {
      open = {
        index: p.index, start: t, end: null,
        narrationChars: p.narration_chars ?? 0,
        narrationPreview: p.narration_preview ?? "",
        commandType: p.command_type ?? null,
        commandText: p.command_text ?? null,
        mode: null,
        audioStart: null, playbackStart: null, speechEnd: null, mediaMs: null,
        schedules: [], chars: [], commands: [], eraseMs: 0, eraseStart: null, blocked: [],
      };
      segments.push(open);
      byIndex.set(p.index, open);
      continue;
    }
    if (tag === "segment" && msg === "runSegment end") {
      if (open && open.index === p.index) { open.end = t; open.commandCount = p.command_count; }
      open = null;
      continue;
    }
    if (tag === "segment" && open && (msg === "narration-only" || msg === "draw-only" || msg === "paired narration+draw")) {
      open.mode = msg;
      if (open.eraseStart !== null) { open.eraseMs = t - open.eraseStart; open.eraseEnd = t; }
      continue;
    }
    if (tag === "draw" && msg === "layout erasing work area" && open) { open.eraseStart = t; continue; }

    if (tag === "tts" && msg === "segment timings") {
      if (!timingsByIndex.has(p.index)) timingsByIndex.set(p.index, p.total_duration_ms);
      continue;
    }
    if (tag === "tts" && msg === "segment audio started") {
      const seg = byIndex.get(p.index);
      if (seg) seg.audioStart = t;
      continue;
    }
    if (tag === "tts" && msg === "ws playback start (buffered)") {
      if (open && open.playbackStart === null) open.playbackStart = t;
      continue;
    }
    if (tag === "tts" && msg === "segment complete") {
      // pair with the open segment (no index on this line)
      if (open && open.speechEnd === null) {
        open.speechEnd = t; open.completeMeta = p;
      }
      continue;
    }
    if (tag === "draw" && msg === "write schedule ready") {
      const seg = byIndex.get(p.segment_index) ?? open;
      if (seg) seg.schedules.push({ t, ...p });
      continue;
    }
    if (tag === "draw" && msg === "write char start") {
      const seg = byIndex.get(p.segment_index) ?? open;
      if (seg) seg.chars.push({ t, ...p });
      continue;
    }
    if (tag === "draw" && msg === "TYPE dropped") { lessonMeta.typeDropped++; if (open) open.blocked.push({ t, type: "TYPE", text: p.block_id ?? null, reason: "no controller" }); continue; }
    if (tag === "draw" && (msg === "block unverified diagram command" || msg === "block uncompiled diagram draw")) {
      if (open) open.blocked.push({ t, type: p.type ?? p.command_type ?? null, text: p.text ?? null, reason: p.reason ?? msg });
      continue;
    }
    if (tag === "draw" && msg === "executeCommand start") {
      const cmd = {
        type: p.type, text: p.text ?? null, params: p.params ?? null,
        speechBudgetMs: p.speech_duration_ms ?? null, inkPace: p.ink_pace ?? null,
        start: t, end: null, depth: stack.length, parent: stack[stack.length - 1] ?? null,
        seg: open, postTurn: open === null, children: [],
      };
      if (cmd.parent) cmd.parent.children.push(cmd);
      stack.push(cmd);
      commands.push(cmd);
      if (open) open.commands.push(cmd);
      continue;
    }
    if (tag === "draw" && msg === "executeCommand done") {
      // pop the innermost open command of that type
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].type === p.type && stack[i].end === null) {
          stack[i].end = t;
          stack.splice(i, 1);
          break;
        }
      }
      continue;
    }
  }
  for (const c of commands) if (c.end === null) c.end = turnComplete ?? c.start;
  for (const seg of segments) {
    if (seg.end === null) seg.end = turnComplete ?? seg.start;
    seg.mediaMs = timingsByIndex.get(seg.index) ?? null;
    if (seg.audioStart === null && seg.playbackStart !== null) seg.audioStart = seg.playbackStart;
  }

  // playback rate: media ms / wall ms over segments with both ends
  const rateSamples = segments
    .filter((s) => s.audioStart !== null && s.speechEnd !== null && s.mediaMs && s.speechEnd - s.audioStart > 800)
    .map((s) => s.mediaMs / (s.speechEnd - s.audioStart));
  const rate = rateSamples.length ? median(rateSamples) : null;

  // per segment metrics
  const segOut = [];
  for (const seg of segments) {
    const busy = seg.commands.filter((c) => c.type !== "PAUSE").map((c) => [c.start, c.end]);
    const inkOnly = seg.commands.filter((c) => INK_TYPES.has(c.type)).map((c) => [c.start, c.end]);
    const hasSpeech = seg.audioStart !== null && seg.speechEnd !== null;
    const spokenWall = hasSpeech ? seg.speechEnd - seg.audioStart : 0;
    const busyInWindow = hasSpeech ? unionMs(busy, seg.audioStart, seg.speechEnd) : 0;
    const parkedInWindow = hasSpeech ? spokenWall - busyInWindow : 0;
    const parkedGaps = hasSpeech ? gapsMs(busy, seg.audioStart, seg.speechEnd).filter(([a, b]) => b - a >= 250) : [];
    const segTail = Math.max(seg.end, ...seg.commands.map((c) => c.end), seg.speechEnd ?? 0);
    const inkAfterSpeech = hasSpeech ? unionMs(inkOnly, seg.speechEnd, segTail) : unionMs(inkOnly, seg.start, segTail);
    const inkBeforeAudio = seg.audioStart !== null ? unionMs(inkOnly, seg.start, seg.audioStart) : 0;
    const audioStartDelay = seg.audioStart !== null ? seg.audioStart - seg.start : null;

    const top = seg.commands.filter((c) => c.depth === 0);
    const sceneTop = top.filter((c) => SCENE_TYPES.has(c.type));
    const isIntro = top.length >= 3 && sceneTop.length / top.length >= 0.6 && !top.some((c) => c.type === "WRITE");

    // WRITE metrics (top-level WRITE, TYPE for code lessons)
    const writes = top.filter((c) => c.type === "WRITE" || c.type === "TYPE").map((c) => {
      const chars = seg.chars.filter((ch) => ch.segment_index === seg.index);
      const sched = seg.schedules.find((s) => s.text === c.text) ?? seg.schedules[0] ?? null;
      const childInk = c.children.filter((k) => INK_TYPES.has(k.type));
      const ownEnd = childInk.length ? Math.min(...childInk.map((k) => k.start)) : c.end;
      return {
        type: c.type, text: c.text,
        start_offset_ms: seg.audioStart !== null ? c.start - seg.audioStart : null,
        finish_minus_speech_end_ms: hasSpeech ? ownEnd - seg.speechEnd : null,
        row_wall_ms: ownEnd - c.start,
        glyphs: (c.text ?? "").replace(/\s+/g, "").length,
        ms_per_glyph: (c.text ?? "").replace(/\s+/g, "").length ? Math.round((ownEnd - c.start) / (c.text ?? "").replace(/\s+/g, "").length) : null,
        end_sentence_pct: hasSpeech ? Math.round(((ownEnd - seg.audioStart) / spokenWall) * 100) : null,
        max_char_lag_ms: chars.length ? Math.max(...chars.map((ch) => ch.lag_ms)) : null,
        min_char_lag_ms: chars.length ? Math.min(...chars.map((ch) => ch.lag_ms)) : null,
        chars_logged: chars.length,
        schedule_source: sched?.schedule_source ?? null,
        timing_chars: sched?.timing_chars ?? null,
        first_offset_ms: sched?.first_offset_ms ?? null,
        schedule_reason: sched?.reason ?? null,
        released_children: c.children.map((k) => `${k.type}${k.text ? `:${k.text}` : ""}`),
        released_children_ms: childInk.length ? Math.max(...childInk.map((k) => k.end)) - ownEnd : 0,
      };
    });

    const focuses = seg.commands.filter((c) => c.type === "FOCUS").map((c) => ({
      target: c.text,
      start_offset_ms: seg.audioStart !== null ? c.start - seg.audioStart : null,
      duration_ms: c.end - c.start,
      budget_ms: c.speechBudgetMs,
      parent: c.parent ? c.parent.type : null,
      after_speech: hasSpeech ? c.start >= seg.speechEnd : false,
      children: c.children.map((k) => `${k.type}${k.text ? `:${k.text}` : ""}`),
    }));

    const frames = seg.commands.filter((c) => c.type === "FRAME").map((c) => ({
      start_offset_ms: seg.audioStart !== null ? c.start - seg.audioStart : null,
      duration_ms: c.end - c.start,
      budget_ms: c.speechBudgetMs,
      child_count: c.children.length,
      finish_minus_speech_end_ms: hasSpeech ? c.end - seg.speechEnd : null,
    }));

    const introStats = isIntro && hasSpeech ? {
      command_count: top.length,
      ink_wall_ms: unionMs(inkOnly, seg.start, segTail),
      speech_wall_ms: spokenWall,
      ink_over_speech: +(unionMs(inkOnly, seg.start, segTail) / spokenWall).toFixed(2),
      first_cmd_offset_ms: top[0].start - seg.audioStart,
      last_cmd_done_offset_ms: Math.max(...top.map((c) => c.end)) - seg.audioStart,
      budgets_ms: top.map((c) => c.speechBudgetMs),
    } : null;

    // what the voice was saying during each parked gap (fraction of the sentence)
    const gapWords = parkedGaps.map(([a, b]) => {
      const f0 = (a - seg.audioStart) / spokenWall, f1 = (b - seg.audioStart) / spokenWall;
      const n = seg.narrationChars || seg.narrationPreview.length;
      const c0 = Math.floor(f0 * n), c1 = Math.ceil(f1 * n);
      const prev = seg.narrationPreview;
      const slice = prev.slice(Math.min(c0, prev.length), Math.min(c1, prev.length));
      return { from_ms: Math.round(a - seg.audioStart), to_ms: Math.round(b - seg.audioStart), sentence_pct: [Math.round(f0 * 100), Math.round(f1 * 100)], chars: [c0, c1], preview_slice: slice || (c0 >= prev.length ? "[beyond 80-char preview]" : "") };
    });

    segOut.push({
      index: seg.index, mode: seg.mode, command_type: seg.commandType, command_text: seg.commandText,
      narration_preview: seg.narrationPreview, narration_chars: seg.narrationChars,
      media_ms: seg.mediaMs, spoken_wall_ms: spokenWall, has_speech: hasSpeech,
      audio_start_delay_ms: audioStartDelay, erase_ms: seg.eraseMs,
      segment_wall_ms: seg.end - seg.start,
      busy_in_window_ms: busyInWindow, parked_in_window_ms: parkedInWindow,
      parked_pct: spokenWall ? Math.round((parkedInWindow / spokenWall) * 100) : null,
      ink_after_speech_ms: inkAfterSpeech, ink_before_audio_ms: inkBeforeAudio,
      is_intro: isIntro, intro: introStats,
      top_types: top.map((c) => c.type),
      blocked: seg.blocked.map((b) => `${b.type}${b.text ? `:${b.text}` : ""} (${b.reason})`),
      writes, focuses, frames,
      parked_gaps: gapWords,
      _cmds: seg.commands,
    });
  }

  // label / dimension classification
  const labelClass = { in_focus: [], by_write: [], in_frame: [], intro: [], other_segment: [], post_turn: [] };
  for (const c of commands) {
    if (c.type !== "LABEL" && c.type !== "DIMENSION") continue;
    const rec = { type: c.type, text: c.text, t: Math.round(c.start), seg: c.seg?.index ?? null, ms: Math.round(c.end - c.start) };
    if (c.postTurn || c.seg === null) labelClass.post_turn.push(rec);
    else if (c.parent?.type === "FOCUS") labelClass.in_focus.push(rec);
    else if (c.parent?.type === "WRITE") labelClass.by_write.push(rec);
    else if (c.parent?.type === "FRAME") labelClass.in_frame.push(rec);
    else if (segOut.find((s) => s.index === c.seg.index)?.is_intro) labelClass.intro.push(rec);
    else labelClass.other_segment.push(rec);
  }
  const postTurnCmds = commands.filter((c) => c.postTurn);
  const postTurnInkMs = unionMs(postTurnCmds.map((c) => [c.start, c.end]), -Infinity, Infinity);

  // lesson totals
  const spoken = segOut.filter((s) => s.has_speech);
  const totals = {
    segments: segOut.length,
    spoken_segments: spoken.length,
    narration_only_segments: segOut.filter((s) => s.mode === "narration-only").length,
    draw_only_segments: segOut.filter((s) => s.mode === "draw-only").length,
    playback_rate: rate ? +rate.toFixed(2) : null,
    spoken_wall_ms: sum(spoken.map((s) => s.spoken_wall_ms)),
    busy_in_window_ms: sum(spoken.map((s) => s.busy_in_window_ms)),
    parked_in_window_ms: sum(spoken.map((s) => s.parked_in_window_ms)),
    parked_pct: null,
    ink_after_speech_ms: sum(segOut.map((s) => s.ink_after_speech_ms)),
    ink_before_audio_ms: sum(segOut.map((s) => s.ink_before_audio_ms)),
    post_turn_ink_ms: postTurnInkMs,
    post_turn_cmds: postTurnCmds.map((c) => `${c.type}${c.text ? `:${c.text}` : ""}`),
    erase_ms: sum(segOut.map((s) => s.erase_ms)),
    write_rows: sum(segOut.map((s) => s.writes.length)),
    write_schedule_sources: countBy(segOut.flatMap((s) => s.writes.map((w) => w.schedule_source ?? "none"))),
    write_finish_minus_speech_end_ms: segOut.flatMap((s) => s.writes.map((w) => w.finish_minus_speech_end_ms)).filter((v) => v !== null),
    write_raced_ms: sum(segOut.flatMap((s) => s.writes.map((w) => Math.max(0, -(w.finish_minus_speech_end_ms ?? 0))))),
    write_late_ms: sum(segOut.flatMap((s) => s.writes.map((w) => Math.max(0, w.finish_minus_speech_end_ms ?? 0)))),
    write_ms_per_glyph_median: (() => { const a = segOut.flatMap((s) => s.writes.map((w) => w.ms_per_glyph)).filter((v) => v !== null && v > 0); return a.length ? Math.round(median(a)) : null; })(),
    write_ms_per_glyph_range: (() => { const a = segOut.flatMap((s) => s.writes.map((w) => w.ms_per_glyph)).filter((v) => v !== null && v > 0); return a.length ? [Math.min(...a), Math.max(...a)] : null; })(),
    write_max_char_lag_ms: max(segOut.flatMap((s) => s.writes.map((w) => w.max_char_lag_ms)).filter((v) => v !== null)),
    intro: segOut.find((s) => s.is_intro)?.intro ?? null,
    intro_index: segOut.find((s) => s.is_intro)?.index ?? null,
    focus_count: sum(segOut.map((s) => s.focuses.length)),
    focus_durations_ms: segOut.flatMap((s) => s.focuses.map((f) => f.duration_ms)),
    focus_start_offsets_ms: segOut.flatMap((s) => s.focuses.map((f) => f.start_offset_ms)).filter((v) => v !== null),
    focus_after_speech: segOut.flatMap((s) => s.focuses).filter((f) => f.after_speech).length,
    frame_count: sum(segOut.map((s) => s.frames.length)),
    frames: segOut.flatMap((s) => s.frames),
    labels: Object.fromEntries(Object.entries(labelClass).map(([k, v]) => [k, v.length])),
    label_detail: labelClass,
    type_dropped: lessonMeta.typeDropped,
    code_lesson: lessonMeta.codeLesson,
    turn: turnMeta,
    lesson_wall_ms: segments.length ? (turnComplete ?? Math.max(...segments.map((sg) => sg.end))) - segments[0].start : null,
    truncated: turnComplete === null,
  };
  totals.parked_pct = totals.spoken_wall_ms ? Math.round((totals.parked_in_window_ms / totals.spoken_wall_ms) * 100) : null;

  // cause attribution (wall ms)
  const causes = {
    "WRITE row: estimated schedule (15 chars/s media) races the voice, pen parks for the rest of the sentence": 0,
    "WRITE row: glyph floor (~200 ms wall/glyph) overruns a short sentence (ink after speech end)": 0,
    "FOCUS-only sentence: fixed 0.6-2.7 s tour at t=0, parked for the rest": 0,
    "figure intro not paced to its sentence (parks under a long one, overruns a short one)": 0,
    "draw-only segment: the [WRITE] after a FOCUS sentence is lettered silently after the voice": 0,
    "narration-only segment: no command at all": 0,
    "DSA: commands blocked (verified-scene ownership / no controller), sentence runs with no ink": 0,
    "DSA: TYPE block typed at natural speed, pen idles for the rest of the sentence": 0,
    "DSA: FRAME redraw finishes in a third of its sentence, parked until the late FOCUS": 0,
    "deferred labels/dimensions released by a WRITE row (lettered outside their own words)": 0,
    "post-turn flush (labels/dimensions after turn complete)": 0,
    "erase before audio (voice waits for the duster)": 0,
    "other ink after speech end inside a segment": 0,
  };
  for (const s of segOut) {
    causes["erase before audio (voice waits for the duster)"] += s.erase_ms;
    if (s.mode === "narration-only") { causes["narration-only segment: no command at all"] += s.parked_in_window_ms; continue; }
    if (s.mode === "draw-only") { causes["draw-only segment: the [WRITE] after a FOCUS sentence is lettered silently after the voice"] += s.ink_after_speech_ms; continue; }
    const byWriteMs = sum(s.writes.map((w) => w.released_children_ms));
    causes["deferred labels/dimensions released by a WRITE row (lettered outside their own words)"] += byWriteMs;
    let afterLeft = Math.max(0, s.ink_after_speech_ms - byWriteMs);
    if (s.is_intro) {
      causes["figure intro not paced to its sentence (parks under a long one, overruns a short one)"] += s.parked_in_window_ms + afterLeft;
      continue;
    }
    if (s.top_types.length === 0 && s.blocked.length > 0) {
      causes["DSA: commands blocked (verified-scene ownership / no controller), sentence runs with no ink"] += s.parked_in_window_ms;
      continue;
    }
    if (s.frames.length) {
      causes["DSA: FRAME redraw finishes in a third of its sentence, parked until the late FOCUS"] += s.parked_in_window_ms;
      causes["other ink after speech end inside a segment"] += afterLeft;
      continue;
    }
    const typeRows = s.writes.filter((w) => w.type === "TYPE");
    if (typeRows.length) {
      causes["DSA: TYPE block typed at natural speed, pen idles for the rest of the sentence"] += s.parked_in_window_ms;
      causes["other ink after speech end inside a segment"] += afterLeft;
      continue;
    }
    if (s.writes.length) {
      causes["WRITE row: estimated schedule (15 chars/s media) races the voice, pen parks for the rest of the sentence"] += s.parked_in_window_ms;
      const late = sum(s.writes.map((w) => Math.max(0, w.finish_minus_speech_end_ms ?? 0)));
      const lateMs = Math.min(late, afterLeft);
      causes["WRITE row: glyph floor (~200 ms wall/glyph) overruns a short sentence (ink after speech end)"] += lateMs;
      afterLeft -= lateMs;
      causes["other ink after speech end inside a segment"] += afterLeft;
      continue;
    }
    if (s.focuses.length) {
      causes["FOCUS-only sentence: fixed 0.6-2.7 s tour at t=0, parked for the rest"] += s.parked_in_window_ms;
      causes["other ink after speech end inside a segment"] += afterLeft;
      continue;
    }
    causes["other ink after speech end inside a segment"] += afterLeft;
  }
  causes["post-turn flush (labels/dimensions after turn complete)"] += postTurnInkMs;

  // worst segments
  const worst = [...segOut]
    .filter((s) => s.has_speech || s.mode === "draw-only")
    .map((s) => ({ ...s, badness: s.parked_in_window_ms + s.ink_after_speech_ms }))
    .sort((a, b) => b.badness - a.badness)
    .slice(0, opts.worst);

  return { name, question, totals, causes, segments: segOut.map(({ _cmds, ...rest }) => rest), worst: worst.map(({ _cmds, ...rest }) => rest), planner };
}

function sum(a) { return a.reduce((x, y) => x + (y ?? 0), 0); }
function max(a) { return a.length ? Math.max(...a) : null; }
function median(a) { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; }
function countBy(a) { const m = {}; for (const k of a) m[k] = (m[k] ?? 0) + 1; return m; }
function fmt(v) { return v === null || v === undefined ? "-" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v); }
function s(ms) { return ms === null || ms === undefined ? "-" : (ms / 1000).toFixed(1) + "s"; }

const runs = inputs.map(analyseRun);

// ---- markdown report ----
const md = [];
md.push(`# Board-versus-voice coupling (wall ms; TTS plays at the measured rate)`);
md.push("");
const cols = runs.map((r) => r.name);
const rows = [
  ["question", (r) => (r.question ?? "").slice(0, 48)],
  ["playback rate (media/wall)", (r) => fmt(r.totals.playback_rate)],
  ["segments (spoken / narr-only / draw-only)", (r) => `${r.totals.segments} (${r.totals.spoken_segments} / ${r.totals.narration_only_segments} / ${r.totals.draw_only_segments})`],
  ["lesson wall", (r) => `${s(r.totals.lesson_wall_ms)}${r.totals.truncated ? " (probe timed out before turn complete)" : ""}`],
  ["spoken wall (sum of sentences)", (r) => s(r.totals.spoken_wall_ms)],
  ["pen busy inside speech", (r) => s(r.totals.busy_in_window_ms)],
  ["pen PARKED inside speech", (r) => `${s(r.totals.parked_in_window_ms)} (${r.totals.parked_pct}%)`],
  ["ink after speech end (in segment)", (r) => s(r.totals.ink_after_speech_ms)],
  ["ink before audio start", (r) => s(r.totals.ink_before_audio_ms)],
  ["post-turn flush ink", (r) => `${s(r.totals.post_turn_ink_ms)} [${r.totals.post_turn_cmds.join(", ")}]`],
  ["erase-before-audio", (r) => s(r.totals.erase_ms)],
  ["WRITE rows / schedule sources", (r) => `${r.totals.write_rows} / ${JSON.stringify(r.totals.write_schedule_sources)}`],
  ["WRITE finish minus speech end (median / min / max)", (r) => { const a = r.totals.write_finish_minus_speech_end_ms; return a.length ? `${Math.round(median(a))} / ${Math.min(...a)} / ${Math.max(...a)}` : "-"; }],
  ["WRITE raced total (sum of early finish)", (r) => s(r.totals.write_raced_ms)],
  ["WRITE late total (sum of finish after speech)", (r) => s(r.totals.write_late_ms)],
  ["WRITE max char lag (first 8 chars)", (r) => fmt(r.totals.write_max_char_lag_ms)],
  ["WRITE wall ms per glyph (median, min-max)", (r) => r.totals.write_ms_per_glyph_median ? `${r.totals.write_ms_per_glyph_median} (${r.totals.write_ms_per_glyph_range.join("-")})` : "-"],
  ["figure intro: ink / speech", (r) => r.totals.intro ? `${s(r.totals.intro.ink_wall_ms)} / ${s(r.totals.intro.speech_wall_ms)} = ${r.totals.intro.ink_over_speech} (${r.totals.intro.command_count} cmds, seg ${r.totals.intro_index})` : "none detected"],
  ["FOCUS count / durations ms", (r) => `${r.totals.focus_count} / [${r.totals.focus_durations_ms.map(Math.round).join(", ")}]`],
  ["FOCUS start offsets from audio start ms", (r) => `[${r.totals.focus_start_offsets_ms.map(Math.round).join(", ")}]`],
  ["FOCUS fired after speech ended", (r) => fmt(r.totals.focus_after_speech)],
  ["FRAME advances (DSA)", (r) => r.totals.frame_count ? r.totals.frames.map((f) => `dur ${Math.round(f.duration_ms)} budget ${f.budget_ms} end-vs-speech ${Math.round(f.finish_minus_speech_end_ms ?? 0)}`).join("; ") : "-"],
  ["labels: in FOCUS / by WRITE / in FRAME / intro / other / post-turn", (r) => { const l = r.totals.labels; return `${l.in_focus} / ${l.by_write} / ${l.in_frame} / ${l.intro} / ${l.other_segment} / ${l.post_turn}`; }],
  ["TYPE dropped / code lesson", (r) => `${r.totals.type_dropped} / ${r.totals.code_lesson}`],
  ["total_draw_ms (runtime)", (r) => fmt(r.totals.turn?.total_draw_ms)],
];
md.push(`| metric | ${cols.join(" | ")} |`);
md.push(`|---|${cols.map(() => "---").join("|")}|`);
for (const [label, f] of rows) md.push(`| ${label} | ${runs.map((r) => f(r)).join(" | ")} |`);
md.push("");

for (const r of runs) {
  md.push(`## ${r.name}: worst ${opts.worst} segments`);
  for (const w of r.worst) {
    md.push(`- seg ${w.index} [${w.mode}; ${w.top_types.join(",")}] "${w.narration_preview}" (${w.narration_chars} chars, spoken ${s(w.spoken_wall_ms)}): parked ${s(w.parked_in_window_ms)} (${w.parked_pct}%), ink after speech ${s(w.ink_after_speech_ms)}` +
      (w.writes.length ? `; WRITE "${w.writes[0].text}" finish-vs-speech ${Math.round(w.writes[0].finish_minus_speech_end_ms ?? 0)} ms (row done at ${w.writes[0].end_sentence_pct}% of sentence), src ${w.writes[0].schedule_source}, max lag ${w.writes[0].max_char_lag_ms}` + (w.writes[0].released_children.length ? `, released [${w.writes[0].released_children.join(", ")}] +${Math.round(w.writes[0].released_children_ms)} ms` : "") : "") +
      (w.focuses.length ? `; FOCUS ${w.focuses.map((f) => `"${f.target}" at +${Math.round(f.start_offset_ms ?? 0)} for ${Math.round(f.duration_ms)}`).join(", ")}` : "") +
      (w.blocked.length ? `; BLOCKED [${w.blocked.join("; ")}]` : "") +
      (w.intro ? `; intro ink ${s(w.intro.ink_wall_ms)} of ${s(w.intro.speech_wall_ms)} (last shape done at +${Math.round(w.intro.last_cmd_done_offset_ms)})` : ""));
    for (const g of w.parked_gaps) md.push(`    parked +${g.from_ms}..+${g.to_ms} ms (${g.sentence_pct[0]}%..${g.sentence_pct[1]}% of sentence) while voice said: "${g.preview_slice}"`);
  }
  md.push("");
}

md.push(`## Causes ranked by total parked/raced/orphaned wall ms across ${runs.length} lesson(s)`);
const causeTotals = {};
for (const r of runs) for (const [k, v] of Object.entries(r.causes)) causeTotals[k] = (causeTotals[k] ?? 0) + v;
const ranked = Object.entries(causeTotals).sort((a, b) => b[1] - a[1]);
md.push(`| cause | total | ${cols.join(" | ")} |`);
md.push(`|---|---|${cols.map(() => "---").join("|")}|`);
for (const [k, v] of ranked) md.push(`| ${k} | ${s(v)} | ${runs.map((r) => s(r.causes[k])).join(" | ")} |`);
md.push("");

const report = md.join("\n");
console.log(report);
if (opts.md) writeFileSync(opts.md, report);
if (opts.json) writeFileSync(opts.json, JSON.stringify(runs, null, 2));
