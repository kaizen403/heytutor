import {
  countJobsByStatus,
  DELETE_LECTURE_CONFIRM,
  deletableJobBoardIds,
  deleteLecturesConfirm,
  drainLectureJobs,
  EXPECTED_LECTURE_MS,
  isLectureDeletable,
  isLectureLiveWatchable,
  isLectureWatchable,
  isSyllabusSlugTitle,
  jobProgressPercent,
  lectureJobTitle,
  makeLectureJobs,
  nextQueuedJobs,
  ongoingLectureJobs,
  shouldKeepHeadlessRuntime,
} from "../../features/admin/lib/lectureJobs";
import {
  indexPlaygroundRecordings,
  mergePlaygroundRecordings,
  parsePlaygroundBoardTitle,
  playgroundBoardTitle,
  recordingBoardIdsForQuestions,
  recordingKey,
} from "../../features/admin/lib/playgroundBoards";
import {
  parseProbeFile,
  questionsByIds,
  questionsForTopic,
  questionsForUnit,
  unitIdFromTopicId,
} from "../../features/admin/lib/probes";
import { finalizeBoardTitle } from "../../lib/boards/boardTitle";
import {
  applyReplaySpeed,
  DEFAULT_REPLAY_SPEED,
  syncControlledPlaybackRate,
} from "../../lib/replay/replayAudio";
import {
  headlessLectureBoardStyle,
  headlessLectureOffscreenStyle,
  liveRecordingsDockStyle,
  promotedLectureBoardStyle,
  promotedLectureBoardWrapStyle,
  promotedLectureFrameStyle,
  promotedLectureScale,
} from "../../features/admin/lib/headlessRuntime";
import { canStartStoredLectureReplay } from "../../features/tutor-session/lib/autoReplay";
import { isWhiteboardReadyToDraw } from "../../features/tutor-session/lib/whiteboardReady";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../../features/tutor-session/constants";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const title = playgroundBoardTitle("physics|1|least-count", "hard");
assert(
  title === "[Playground] physics|1|least-count · hard",
  `unexpected playground title: ${title}`,
);

const parsed = parsePlaygroundBoardTitle(title);
assert(parsed?.topicId === "physics|1|least-count", "failed to parse topicId from playground title");
assert(parsed.difficulty === "hard", "failed to parse difficulty from playground title");
assert(
  parsePlaygroundBoardTitle("[Playground] physics|1|least-count · live") === null,
  "live escape-hatch boards must not count as recordings",
);
assert(
  parsePlaygroundBoardTitle("Unit 1: least count") === null,
  "non-playground titles must not parse",
);

const probes = parseProbeFile({
  schemaVersion: "syllabus-probes/v1",
  unitId: "physics|1",
  questions: [
    {
      id: "physics|1|least-count|easy",
      topicId: "physics|1|least-count",
      difficulty: "easy",
      question: "What is least count?",
    },
    {
      id: "physics|1|least-count|medium",
      topicId: "physics|1|least-count",
      difficulty: "medium",
      question: "Find the least count of a vernier.",
    },
    {
      id: "physics|1|dimensions|easy",
      topicId: "physics|1|dimensions",
      difficulty: "easy",
      question: "Write the dimensions of force.",
    },
    {
      id: "physics|10|gravitation|easy",
      topicId: "physics|10|gravitation",
      difficulty: "easy",
      question: "State Newton’s law of gravitation.",
    },
  ],
});

assert(unitIdFromTopicId("physics|1|least-count") === "physics|1", "unit id slice is wrong");
assert(questionsForUnit(probes, "physics|1").length === 3, "unit 1 must not include unit 10");
assert(questionsForUnit(probes, "physics|1", "easy").length === 2, "unit 1 easy filter is wrong");
assert(questionsForUnit(probes, "physics|1", "hard").length === 0, "missing difficulties must be empty");
assert(questionsForTopic(probes, "physics|1|least-count").length === 2, "topic filter is wrong");
assert(
  questionsForTopic(probes, "physics|1|least-count", "medium")[0]?.id === "physics|1|least-count|medium",
  "single-difficulty topic play is wrong",
);
assert(questionsByIds(probes, ["physics|1|dimensions|easy"]).length === 1, "id selection is wrong");
assert(questionsForUnit(probes, "physics|2").length === 0, "units without fixtures must be empty");

const now = 1_000_000;
const jobs = makeLectureJobs(questionsForUnit(probes, "physics|1", "easy"), now);
assert(jobs.length === 2 && jobs.every((job) => job.status === "queued"), "enqueue must start queued");
assert(
  jobs.every((job) => job.title === finalizeBoardTitle(job.question) && !isSyllabusSlugTitle(job.title)),
  "jobs must use dashboard board names, not syllabus ids",
);
assert(
  isSyllabusSlugTitle("physics|2|suvat-equations · easy"),
  "raw topic ids must be treated as slug titles",
);
assert(
  lectureJobTitle({
    question: "What is least count?",
    title: "physics|1|least-count · easy",
  }) === finalizeBoardTitle("What is least count?"),
  "slug job labels must fall back to dashboard naming",
);

const queuedPlusRunning = [
  { ...jobs[0]!, status: "running" as const, startedAt: now },
  jobs[1]!,
  { ...jobs[0]!, id: "extra-queued", status: "queued" as const },
];
assert(nextQueuedJobs(queuedPlusRunning, 3).map((job) => job.id).join(",") === `${jobs[1]!.id},extra-queued`, "fill remaining slots from queued jobs");
assert(nextQueuedJobs(queuedPlusRunning, 1).length === 0, "no extra slots when at concurrency cap");
assert(nextQueuedJobs(jobs, 2).length === 2, "idle queue can start up to the cap");

const running = { ...jobs[0]!, status: "running" as const, startedAt: now };
assert(jobProgressPercent(running, now) === 0, "just-started job must be 0%");
assert(
  jobProgressPercent(running, now + EXPECTED_LECTURE_MS) === 95,
  "elapsed expected duration must cap at 95% until complete",
);
assert(
  jobProgressPercent(running, now + EXPECTED_LECTURE_MS * 4) === 95,
  "timeout-length elapsed must still cap at 95%",
);
assert(jobProgressPercent({ status: "complete" }, now) === 100, "complete jobs are 100%");

const drained = drainLectureJobs(
  [
    running,
    jobs[1]!,
    { ...jobs[0]!, id: "done", status: "complete" },
  ],
  now + 50,
);
assert(drained.length === 2, "drain must drop queued jobs");
assert(drained[0]?.status === "failed" && drained[0].error === "stopped", "running job must fail on stop");
assert(drained[1]?.status === "complete", "completed jobs must be kept");
assert(countJobsByStatus(drained).failed === 1, "failed count after drain is wrong");

const recordings = indexPlaygroundRecordings([
  {
    id: "older",
    title: playgroundBoardTitle("physics|1|least-count", "easy"),
    createdAt: 1,
    preview: "What is least count?",
  },
  {
    id: "newer",
    title: playgroundBoardTitle("physics|1|least-count", "easy"),
    createdAt: 2,
    preview: "What is least count?",
  },
  {
    id: "empty",
    title: playgroundBoardTitle("physics|1|least-count", "medium"),
    createdAt: 3,
    preview: "",
  },
]);
assert(
  recordings.get(recordingKey("physics|1|least-count", "easy"))?.id === "newer",
  "Watch must use the newest playground board",
);
assert(
  !recordings.has(recordingKey("physics|1|least-count", "medium")),
  "boards that never persisted a turn must not be Watchable",
);
assert(
  indexPlaygroundRecordings(
    [
      {
        id: "human",
        title: "Least count of a vernier",
        createdAt: 9,
        preview: "What is least count?",
      },
    ],
    new Map([["human", { topicId: "physics|1|least-count", difficulty: "easy" }]]),
  ).get(recordingKey("physics|1|least-count", "easy"))?.id === "human",
  "human-titled lecture boards must still map to Watch chips",
);

const completeJob = {
  ...jobs[0]!,
  status: "complete" as const,
  boardId: "job-board",
};
assert(isLectureWatchable(completeJob), "complete jobs with a boardId are watchable");
assert(
  isLectureWatchable(completeJob, { boardPreview: "" }),
  "complete jobs stay watchable when preview is still empty",
);
assert(
  !isLectureWatchable({ status: "complete", boardId: undefined }),
  "complete jobs without a board are not watchable",
);
assert(
  !isLectureWatchable({ status: "running", boardId: "job-board" }),
  "running jobs are not watchable",
);
assert(
  isLectureLiveWatchable(
    { status: "running", boardId: "job-board" },
    { isRecording: true },
  ),
  "running recordings with a shell are Watch Live",
);
assert(
  !isLectureLiveWatchable(
    { status: "running", boardId: "job-board" },
    { isRecording: false },
  ),
  "a running job is not live until the headless shell exists",
);
assert(
  !isLectureLiveWatchable({ status: "running" }, { isRecording: true }),
  "Watch Live requires a boardId",
);
assert(
  !isLectureLiveWatchable(
    { status: "queued", boardId: "job-board" },
    { isRecording: true },
  ),
  "queued jobs are not Watch Live",
);
assert(
  !isLectureLiveWatchable(
    { status: "complete", boardId: "job-board" },
    { isRecording: true },
  ),
  "finished jobs are replay, not Watch Live",
);
assert(
  ongoingLectureJobs([
    { ...jobs[0]!, status: "running" },
    { ...jobs[0]!, id: "queued", status: "queued" },
    { ...jobs[0]!, id: "done", status: "complete" },
  ]).map((job) => job.id).join(",") === jobs[0]!.id,
  "Ongoing Lectures lists only running jobs",
);
assert(
  shouldKeepHeadlessRuntime("job-board", "job-board"),
  "Watch Live must keep the recording shell if the job finishes while attached",
);
assert(
  !shouldKeepHeadlessRuntime("job-board", null),
  "an unwatched recording can unmount when the job ends",
);
assert(
  !shouldKeepHeadlessRuntime("job-board", "other-board"),
  "holding a different live lecture must not keep this shell",
);
assert(
  !isLectureWatchable(
    { status: "failed", boardId: "job-board" },
    { boardPreview: "" },
  ),
  "failed jobs with no persisted turn are not watchable",
);
assert(
  isLectureWatchable(
    { status: "failed", boardId: "job-board" },
    { boardPreview: "What is least count?" },
  ),
  "failed jobs that persisted a turn remain watchable",
);
assert(
  !isLectureWatchable(completeJob, { isRecording: true }),
  "a board that is still recording must not be Watchable",
);
assert(isLectureDeletable(completeJob), "complete jobs with a boardId are deletable");
assert(
  !isLectureDeletable(completeJob, { isRecording: true }),
  "a board that is still recording must not be deletable",
);
assert(
  isLectureDeletable({ status: "failed", boardId: "leftover" }),
  "failed leftover boards are deletable",
);
assert(
  !isLectureDeletable({ status: "running", boardId: "job-board" }),
  "running jobs must not be deletable",
);
assert(
  !isLectureDeletable({ status: "complete" }),
  "jobs without a board are not deletable",
);

assert(
  deleteLecturesConfirm(1) === DELETE_LECTURE_CONFIRM,
  "a single delete must keep the original confirm copy",
);
assert(
  deleteLecturesConfirm(3).includes("3 lecture recordings"),
  "bulk delete must name how many recordings will be removed",
);
assert(
  deletableJobBoardIds(
    [
      { status: "complete", boardId: "done-a" },
      { status: "complete", boardId: "done-a" },
      { status: "failed", boardId: "failed-a" },
      { status: "running", boardId: "live" },
      { status: "complete", boardId: "still-recording" },
      { status: "queued" },
    ],
    new Set(["still-recording"]),
  ).join(",") === "done-a,failed-a",
  "bulk job delete must skip running boards and duplicate ids",
);
assert(
  recordingBoardIdsForQuestions(
    [
      { topicId: "physics|1|least-count", difficulty: "easy" },
      { topicId: "physics|1|least-count", difficulty: "easy" },
      { topicId: "physics|1|least-count", difficulty: "medium" },
      { topicId: "physics|1|dimensions", difficulty: "easy" },
    ],
    new Map([
      [recordingKey("physics|1|least-count", "easy"), { id: "rec-easy" }],
      [recordingKey("physics|1|least-count", "medium"), { id: "rec-medium" }],
      [recordingKey("physics|1|dimensions", "easy"), { id: "rec-live" }],
    ]),
    new Set(["rec-live"]),
  ).join(",") === "rec-easy,rec-medium",
  "selected-question delete must skip live recorders and duplicates",
);

const merged = mergePlaygroundRecordings(
  [
    {
      id: "empty-complete",
      title: playgroundBoardTitle("physics|1|least-count", "hard"),
      createdAt: 4,
      preview: "",
    },
  ],
  [
    {
      status: "complete",
      boardId: "empty-complete",
      topicId: "physics|1|least-count",
      difficulty: "hard",
      question: "A hard least-count question",
    },
    {
      status: "failed",
      boardId: "failed-empty",
      topicId: "physics|1|dimensions",
      difficulty: "easy",
      question: "Write the dimensions of force.",
    },
  ],
  new Set(),
);
assert(
  merged.get(recordingKey("physics|1|least-count", "hard"))?.id === "empty-complete",
  "completed jobs must surface Watch even when preview is empty",
);
assert(
  !merged.has(recordingKey("physics|1|dimensions", "easy")),
  "failed jobs without a persisted preview must not surface Watch",
);

assert(
  DEFAULT_REPLAY_SPEED === 1.5,
  "Watch overlay default speed must be 1.5×",
);

const overlayAudio = { playbackRate: 1, preservesPitch: false } as HTMLAudioElement & {
  preservesPitch: boolean;
};
let overlayTtsRate = DEFAULT_REPLAY_SPEED;
let overlayInkRate = DEFAULT_REPLAY_SPEED;
const overlayAppliedRates: number[] = [];
const applyWatchOverlaySpeed = (rate: number) => {
  overlayAppliedRates.push(rate);
  applyReplaySpeed({
    rate,
    audio: overlayAudio,
    setTtsPlaybackRate: (next) => {
      overlayTtsRate = next;
    },
    setAnimationSpeed: (next) => {
      overlayInkRate = next;
    },
  });
};

syncControlledPlaybackRate(undefined, DEFAULT_REPLAY_SPEED, applyWatchOverlaySpeed);
syncControlledPlaybackRate(DEFAULT_REPLAY_SPEED, DEFAULT_REPLAY_SPEED, applyWatchOverlaySpeed);
syncControlledPlaybackRate(2, DEFAULT_REPLAY_SPEED, applyWatchOverlaySpeed);
if (overlayAppliedRates.join(",") !== "2") {
  throw new Error(
    `Watch overlay speed must call applyReplaySpeed only when the rate changes; got ${overlayAppliedRates.join(",")}`,
  );
}
if (overlayAudio.playbackRate !== 2) {
  throw new Error("overlay speed must retune HTML audio");
}
if (overlayTtsRate !== 2) {
  throw new Error("overlay speed must hit live TTS setPlaybackRate");
}
if (overlayInkRate !== 2) {
  throw new Error("overlay speed must retune ink animation");
}

assert(
  canStartStoredLectureReplay({
    autoReplay: true,
    isHeadless: false,
    boardLoaded: true,
    storedTurnsCount: 1,
    isReplaying: false,
    alreadyStarted: false,
    viewportMeasured: true,
  }),
  "Watch must auto-replay once the board is loaded and fitted",
);
assert(
  !canStartStoredLectureReplay({
    autoReplay: true,
    isHeadless: false,
    boardLoaded: true,
    storedTurnsCount: 1,
    isReplaying: false,
    alreadyStarted: false,
    viewportMeasured: false,
  }),
  "Watch must not start replay before the board has a real size",
);
assert(
  !canStartStoredLectureReplay({
    autoReplay: true,
    isHeadless: false,
    boardLoaded: true,
    storedTurnsCount: 1,
    isReplaying: false,
    alreadyStarted: true,
    viewportMeasured: true,
  }),
  "Watch must not restart replay after it has begun",
);

assert(isWhiteboardReadyToDraw(null) === false, "a missing whiteboard is not ready");
assert(
  isWhiteboardReadyToDraw({ getDrawLayer: () => null }) === false,
  "Konva layers must exist before ink or the pen is dropped",
);
assert(
  isWhiteboardReadyToDraw({ getDrawLayer: () => ({}) }) === true,
  "a stage with a draw layer is ready",
);

const hidden = headlessLectureOffscreenStyle(2);
assert(hidden.left >= 0, "the hidden recorder must stay in the viewport for Konva");
assert(hidden.top >= 0, "the hidden recorder must stay in the viewport vertically");
assert(hidden.opacity === 0, "background recordings must not show stacked live canvases");
assert(hidden.pointerEvents === "none", "hidden recordings must not steal clicks");
assert(hidden.zIndex < 0, "hidden recordings must sit behind the syllabus");
assert(hidden.width === BOARD_WIDTH, "the hidden recorder must keep the live board size");
assert(hidden.height === BOARD_HEIGHT, "the hidden recorder must keep the live board size");
const board = headlessLectureBoardStyle(1);
assert(board.width === BOARD_WIDTH, "the recorder must keep the live board size");
assert(board.height === BOARD_HEIGHT, "the recorder must keep the live board size");
assert(board.pointerEvents === "none", "the live board itself must not steal clicks");

const dock = liveRecordingsDockStyle();
assert(dock.right >= 0, "the live recordings tab must stay on screen");
assert(dock.bottom >= 0, "the live recordings tab must stay on screen vertically");
assert(dock.zIndex > 0, "the live recordings tab must paint above the syllabus");

const liveSlot = { left: 24, top: 96, width: 960, height: 540 };
const promoted = promotedLectureFrameStyle(liveSlot);
assert(promoted.left === liveSlot.left, "the live overlay must sit on the watch slot");
assert(promoted.top === liveSlot.top, "the live overlay must sit on the watch slot vertically");
assert(promoted.width === liveSlot.width, "the live overlay must fill the watch slot");
assert(promoted.height === liveSlot.height, "the live overlay must fill the watch slot height");
assert(promoted.zIndex > 60, "the promoted lecture must paint above the overlay backdrop");
assert(promoted.pointerEvents === "none", "the promoted lecture must not block overlay chrome");
const liveScale = promotedLectureScale(liveSlot);
assert(liveScale <= liveSlot.width / BOARD_WIDTH, "the promoted board must fit the slot width");
assert(liveScale <= liveSlot.height / BOARD_HEIGHT, "the promoted board must fit the slot height");
const wrap = promotedLectureBoardWrapStyle(liveSlot);
assert(wrap.width <= liveSlot.width, "the promoted wrap must stay inside the slot");
assert(wrap.height <= liveSlot.height, "the promoted wrap must stay inside the slot vertically");
const promotedBoard = promotedLectureBoardStyle(liveSlot);
assert(promotedBoard.width === BOARD_WIDTH, "the promoted recorder must keep the live board size");
assert(promotedBoard.transform.includes(String(liveScale)), "the promoted scale must match the slot fit");

console.log("verify-lecture-lab: all checks passed");
