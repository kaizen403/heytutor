import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { playReplayAudio } from "../../lib/replay/replayAudio";
import { useReplay, type UseReplayParams } from "../../features/tutor-session/hooks/useReplay";
import type { ReplayCue } from "../../lib/replay/replayTimeline";
import { DifficultyCell } from "../../features/admin/components/DifficultyCell";
import { TopicRow } from "../../features/admin/components/TopicRow";
import { makeLectureJobs } from "../../features/admin/lib/lectureJobs";
import type { SyllabusItem } from "../../features/admin/lib/parseSyllabus";
import type { ProbeQuestion } from "../../features/admin/lib/probes";

class FakeAudio {
  static instances: FakeAudio[] = [];
  currentTime = 0;
  duration = 4;
  readyState = 0;
  playbackRate = 1;
  preload = "";
  playCurrentTime: number | null = null;
  onloadedmetadata: (() => void) | null = null;
  onplay: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    assert.equal(url, "fixture.mp3");
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    this.playCurrentTime = this.currentTime;
    return Promise.resolve();
  }

  pause(): void {}
  removeAttribute(): void {}
  load(): void {}
}

export async function verifyAdminLivePlayback(): Promise<void> {
  const watchSource = readFileSync(
    resolve(import.meta.dirname, "../../features/admin/components/WatchDrawer.tsx"),
    "utf8",
  );
  assert.match(
    watchSource,
    /window\.addEventListener\("keydown", onKeyDown, true\)/,
    "Watch Escape must run in capture before the live shell's window listener",
  );
  assert.match(
    watchSource,
    /if \(event\.key === "Escape"\) \{\s*event\.stopImmediatePropagation\(\);\s*onCloseRef\.current\(\)/,
    "closing Watch with Escape must not also cancel the live lecture",
  );

  const question: ProbeQuestion = {
    id: "physics|1|motion|easy",
    topicId: "physics|1|motion",
    difficulty: "easy",
    question: "What is velocity?",
  };
  assert.equal(
    makeLectureJobs([question], 1, { interactive: true })[0]?.interactive,
    true,
  );
  assert.ok(
    makeLectureJobs([question, question], 1, { interactive: true }).every(
      (job) => !job.interactive,
    ),
    "batch recordings must remain independent headless sessions",
  );

  // The standalone tsx runner uses classic JSX for imported client components.
  const previousReact = Object.getOwnPropertyDescriptor(globalThis, "React");
  Object.defineProperty(globalThis, "React", {
    value: React,
    configurable: true,
  });
  try {
    const idleCell = renderToStaticMarkup(
      React.createElement(DifficultyCell, {
        difficulty: "easy",
        state: "idle",
        onActivate: () => {},
      }),
    );
    assert.match(idleCell, /teach this question live/i);
    assert.doesNotMatch(idleCell, /disabled/);
    const missingCell = renderToStaticMarkup(
      React.createElement(DifficultyCell, {
        difficulty: "medium",
        state: "missing",
        onActivate: () => {},
      }),
    );
    assert.match(missingCell, /disabled/);

    const topicRow = renderToStaticMarkup(
      React.createElement(TopicRow, {
        item: { id: question.topicId, text: "Motion" } as SyllabusItem,
        probes: [question],
        states: { easy: "idle", medium: "missing", hard: "missing" },
        boardIds: {},
        costsByBoardId: {},
        checked: false,
        status: "pending",
        selecting: false,
        selectedIds: new Set<string>(),
        expanded: true,
        onToggleSelected: () => {},
        onToggleExpanded: () => {},
        onOpenSheet: () => {},
        onActivate: () => {},
        onNotes: () => {},
        onDelete: () => {},
      }),
    );
    assert.match(topicRow, /Teach live/);
  } finally {
    if (previousReact)
      Object.defineProperty(globalThis, "React", previousReact);
    else Reflect.deleteProperty(globalThis, "React");
  }

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  Object.defineProperty(globalThis, "window", {
    value: globalThis,
    configurable: true,
  });
  Object.defineProperty(globalThis, "Audio", {
    value: FakeAudio,
    configurable: true,
  });
  FakeAudio.instances = [];
  try {
    let starts = 0;
    const playback = playReplayAudio("fixture.mp3", {
      onStart: () => {
        starts += 1;
      },
    });
    const audio = FakeAudio.instances[0]!;
    audio.onloadedmetadata?.();
    assert.equal(
      starts,
      0,
      "metadata must not start board ink before voice playback",
    );
    audio.onplay?.();
    assert.equal(starts, 0, "a buffering play event must not start board ink");
    audio.onplaying?.();
    audio.onplaying?.();
    assert.equal(
      starts,
      1,
      "audible playback must start the board clock exactly once",
    );
    audio.onended?.();
    await playback.done;

    const preloaded = new FakeAudio("fixture.mp3");
    preloaded.readyState = 4;
    const reused = playReplayAudio("fixture.mp3", {
      audio: preloaded as unknown as HTMLAudioElement,
      startAtMs: 1_000,
    });
    assert.equal(
      FakeAudio.instances.length,
      2,
      "replay must reuse the preloaded media element",
    );
    assert.equal(
      preloaded.playCurrentTime,
      1,
      "a preloaded clip must seek before play",
    );
    preloaded.onplaying?.();
    preloaded.onended?.();
    await reused.done;

    const interrupted = playReplayAudio("fixture.mp3", {
      onStart: () => {
        starts += 1;
      },
    });
    const brokenAudio = FakeAudio.instances[2]!;
    brokenAudio.onplaying?.();
    brokenAudio.onerror?.();
    await assert.rejects(interrupted.done, /Replay audio failed/);
    assert.equal(starts, 2, "the failed clip must have reached audible playback");

    const fallbackSpeech: string[] = [];
    const cue: ReplayCue = {
      id: "0-0-0",
      turnIndex: 0,
      segmentIndex: 0,
      startMs: 0,
      endMs: 4_000,
      durationMs: 4_000,
      narration: "Explain the answer.",
      commands: [],
      trustedDiagramGeometry: false,
      audioUrl: "fixture.mp3",
      durationMsStored: 4_000,
      timings: null,
      segment: {
        id: "segment-0",
        orderIndex: 0,
        narration: "Explain the answer.",
        spokenText: "Explain the answer.",
        command: null,
        audioUrl: "fixture.mp3",
        durationMs: 4_000,
        timings: null,
      },
    };
    const cancelRef = { current: false };
    const replayGenerationRef = { current: 1 };
    const replayAudioRef = { current: null };
    let replay!: ReturnType<typeof useReplay>;
    const params = {
      cancelRef,
      replayGenerationRef,
      replayAudioRef,
      replayAudioPreloadRef: { current: new Map() },
      replayCueRef: { current: null },
      isPausedRef: { current: false },
      speedRef: { current: 1 },
      whiteboardRef: { current: { setAnimationSpeed: () => {} } },
      ttsClientRef: {
        current: {
          unlockAudio: () => {},
          setMuted: () => {},
          setPlaybackRate: () => {},
          speakSegment: async (text: string) => {
            fallbackSpeech.push(text);
          },
        },
      },
      setPhase: () => {},
      setCurrentSegmentText: () => {},
      setReplayProgressMs: () => {},
      raceWithCancel: async <T,>(promise: Promise<T>) => promise,
    } as unknown as UseReplayParams;
    renderToStaticMarkup(React.createElement(() => {
      replay = useReplay(params);
      return null;
    }));
    assert.ok(replay);
    const interruptedCue = replay.playReplayCue(cue, 0, 1, true);
    await Promise.resolve();
    const cueAudio = FakeAudio.instances[3]!;
    cueAudio.onplaying?.();
    cueAudio.onerror?.();
    await interruptedCue;
    assert.deepEqual(
      fallbackSpeech,
      ["Explain the answer."],
      "a recorded clip that began playing but failed must finish through live TTS",
    );
  } finally {
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousAudio)
      Object.defineProperty(globalThis, "Audio", previousAudio);
    else Reflect.deleteProperty(globalThis, "Audio");
  }
  console.log(
    "✓ admin Teach live, audible replay start, and preloaded audio reuse",
  );
}

if (process.argv[1]?.endsWith("verify-admin-live-playback.ts")) {
  void verifyAdminLivePlayback().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
