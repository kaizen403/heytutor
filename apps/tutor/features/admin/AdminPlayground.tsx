"use client";

import { useCallback, useMemo, useState } from "react";
import { Download, FlaskConical, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TutorSessionShell, unlockTutorAudio } from "@/features/tutor-session";
import { JobsPanel } from "./components/JobsPanel";
import { MessageDialog } from "./components/MessageDialog";
import { LiveRecordingsDock } from "./components/LiveRecordingsDock";
import { Checkbox } from "./components/Checkbox";
import { TopicRow } from "./components/TopicRow";
import { TopicSheet } from "./components/TopicSheet";
import { WatchDrawer, type WatchIntent } from "./components/WatchDrawer";
import { useLectureQueue } from "./hooks/useLectureQueue";
import { useLiveWatchSlot } from "./hooks/useLiveWatchSlot";
import { useSyllabusProgress } from "./hooks/useSyllabusProgress";
import { mergePlaygroundRecordings, recordingBoardIdsForQuestions, recordingKey } from "./lib/playgroundBoards";
import {
  PROBE_DIFFICULTIES,
  questionsByIds,
  questionsForTopic,
  questionsForUnit,
  unitIdFor,
  type ProbeDifficulty,
  type ProbeQuestion,
} from "./lib/probes";
import { deletableJobBoardIds, deleteLecturesConfirm, isLectureLiveWatchable, lectureJobTitle } from "./lib/lectureJobs";
import { selectLiveWatchRuntime } from "./lib/lectureIsolation";
import {
  headlessLectureBoardStyle,
  headlessLectureOffscreenStyle,
  promotedLectureBoardStyle,
  promotedLectureBoardWrapStyle,
  promotedLectureFrameStyle,
} from "./lib/headlessRuntime";
import {
  countItems,
  flattenItems,
  type SyllabusItem,
  type SyllabusSubject,
  type SyllabusTree,
} from "./lib/parseSyllabus";

interface AdminPlaygroundProps {
  tree: SyllabusTree;
  probes: ProbeQuestion[];
}

function computeStats(tree: SyllabusTree, progress: ReturnType<typeof useSyllabusProgress>["progress"]) {
  const items = flattenItems(tree);
  let checked = 0;
  let accepted = 0;
  let rejected = 0;
  let needsImprovement = 0;

  for (const item of items) {
    const entry = progress[item.id];
    if (!entry) {
      continue;
    }
    if (entry.checked) {
      checked += 1;
    }
    if (entry.status === "accepted") {
      accepted += 1;
    } else if (entry.status === "rejected") {
      rejected += 1;
    } else if (entry.status === "needs-improvement") {
      needsImprovement += 1;
    }
  }

  return {
    total: items.length,
    checked,
    accepted,
    rejected,
    needsImprovement,
  };
}

function unitProgress(
  items: SyllabusItem[],
  progress: ReturnType<typeof useSyllabusProgress>["progress"],
) {
  let accepted = 0;
  for (const item of items) {
    if (progress[item.id]?.status === "accepted") {
      accepted += 1;
    }
  }
  return { accepted, total: items.length };
}

function liveRecordingMap(
  jobs: { status: string; topicId: string; difficulty: ProbeDifficulty; boardId?: string }[],
  topicId: string,
  recordingBoardIds: ReadonlySet<string>,
): Partial<Record<ProbeDifficulty, string>> {
  const recording: Partial<Record<ProbeDifficulty, string>> = {};
  for (const job of jobs) {
    if (job.status !== "running" || job.topicId !== topicId || !job.boardId) {
      continue;
    }
    if (!recordingBoardIds.has(job.boardId)) {
      continue;
    }
    recording[job.difficulty] = job.boardId;
  }
  return recording;
}

export function AdminPlayground({ tree, probes }: AdminPlaygroundProps) {
  const { progress, get, setChecked, setStatus, setNotes, setBoardId, resetAll, exportJson } =
    useSyllabusProgress();
  const queue = useLectureQueue();

  const [subject, setSubject] = useState<SyllabusSubject>("physics");
  const [selectedItem, setSelectedItem] = useState<SyllabusItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [watchBoardId, setWatchBoardId] = useState<string | null>(null);
  const [watchIntent, setWatchIntent] = useState<WatchIntent>("replay");
  const [watchTitle, setWatchTitle] = useState<string | undefined>(undefined);
  const [watchQuestion, setWatchQuestion] = useState<string | undefined>(undefined);
  const [dialog, setDialog] = useState<{
    mode: "confirm" | "notice";
    title: string;
    description: string;
    confirmLabel?: string;
    onConfirm?: () => void;
  } | null>(null);

  const stats = useMemo(() => computeStats(tree, progress), [tree, progress]);
  const units = tree.subjects[subject];
  const runningJobs = queue.jobs.filter((job) => job.status === "running");
  const recordingBoardIds = useMemo(
    () => new Set(queue.runtimes.map((runtime) => runtime.boardId)),
    [queue.runtimes],
  );
  const recordings = useMemo(
    () => mergePlaygroundRecordings(queue.boards, queue.jobs, recordingBoardIds),
    [queue.boards, queue.jobs, recordingBoardIds],
  );
  const isLiveWatch = watchIntent === "live" && watchBoardId !== null;
  const liveSlot = useLiveWatchSlot(isLiveWatch, watchBoardId);
  const liveRuntime = selectLiveWatchRuntime(queue.runtimes, watchBoardId);
  const liveJob = isLiveWatch
    ? queue.jobs.find((job) => job.boardId === watchBoardId)
    : undefined;

  const setHeldBoardId = queue.setHeldBoardId;

  const closeWatch = useCallback(() => {
    setWatchBoardId(null);
    setWatchTitle(undefined);
    setWatchQuestion(undefined);
    setWatchIntent("replay");
    setHeldBoardId(null);
  }, [setHeldBoardId]);

  const openLecture = (
    boardId: string,
    intent: WatchIntent,
    options?: { title?: string; question?: string },
  ) => {
    if (intent === "live") {
      return;
    }
    if (recordingBoardIds.has(boardId)) {
      return;
    }
    setHeldBoardId(null);
    unlockTutorAudio();
    setWatchIntent(intent);
    setWatchTitle(options?.title);
    setWatchQuestion(options?.question);
    setWatchBoardId(boardId);
  };

  const openLiveLecture = (
    boardId: string,
    options?: { title?: string; question?: string },
  ) => {
    const job = queue.jobs.find((entry) => entry.boardId === boardId);
    if (
      !job ||
      !isLectureLiveWatchable(job, { isRecording: recordingBoardIds.has(boardId) })
    ) {
      return;
    }
    unlockTutorAudio();
    setHeldBoardId(boardId);
    setWatchIntent("live");
    setWatchTitle(options?.title ?? lectureJobTitle(job));
    setWatchQuestion(options?.question ?? job.question);
    setWatchBoardId(boardId);
  };

  const performDelete = async (boardIds: string[]) => {
    if (watchBoardId && boardIds.includes(watchBoardId)) {
      closeWatch();
    }
    const result = await queue.removeRecordings(boardIds);
    if (result.failed === 0) {
      return;
    }
    setDialog({
      mode: "notice",
      title: result.deleted === 0 ? "Could not delete" : "Some lectures were not deleted",
      description:
        result.deleted === 0
          ? "Could not delete those lecture recordings."
          : `Deleted ${result.deleted}, but ${result.failed} could not be removed.`,
    });
  };

  const deleteLectures = (boardIds: string[]) => {
    const unique = [...new Set(boardIds)].filter((boardId) => !recordingBoardIds.has(boardId));
    if (unique.length === 0) {
      if (boardIds.length > 0) {
        setDialog({
          mode: "notice",
          title: "Still recording",
          description: "Those lectures are still recording and cannot be deleted yet.",
        });
      }
      return;
    }
    setDialog({
      mode: "confirm",
      title: unique.length === 1 ? "Delete lecture?" : `Delete ${unique.length} lectures?`,
      description: deleteLecturesConfirm(unique.length),
      confirmLabel: unique.length === 1 ? "Delete" : `Delete ${unique.length}`,
      onConfirm: () => {
        void performDelete(unique);
      },
    });
  };

  const deleteLecture = (boardId: string) => {
    deleteLectures([boardId]);
  };

  const startSelected = () => {
    const questions = questionsByIds(probes, selectedIds);
    if (questions.length === 0) {
      return;
    }
    unlockTutorAudio();
    queue.enqueue(questions);
    setSelectedIds(new Set());
    setIsSelecting(false);
  };

  const cancelSelecting = () => {
    setSelectedIds(new Set());
    setIsSelecting(false);
  };

  const toggleSelected = (ids: string[], selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (selected) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  };

  const handleExport = () => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "heytutor-syllabus-progress.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const selectedEntry = selectedItem ? get(selectedItem.id) : null;
  const selectedCount = selectedIds.size;
  const selectedQuestions = useMemo(
    () => questionsByIds(probes, selectedIds),
    [probes, selectedIds],
  );
  const selectedRecordingIds = useMemo(
    () => recordingBoardIdsForQuestions(selectedQuestions, recordings, recordingBoardIds),
    [selectedQuestions, recordings, recordingBoardIds],
  );
  const completedJobRecordingIds = useMemo(
    () => deletableJobBoardIds(queue.jobs, recordingBoardIds),
    [queue.jobs, recordingBoardIds],
  );

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: "var(--wb-bg)" }}
    >
      <div className="shrink-0 px-4 pt-4 pb-2">
        <header className="rounded-2xl border border-[rgba(242,242,244,0.08)] bg-[#151517]/90 px-4 py-3 shadow-[0_8px_30px_-18px_rgba(0,0,0,0.55)] backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(201,201,210,0.12)] text-[#C9C9D2]">
                <FlaskConical className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div>
                <h1 className="text-base font-semibold tracking-[-0.02em] text-[#F2F2F4]">Syllabus Playground</h1>
                <p className="text-xs text-[#A6A6AE]">
                  Syllabus taxonomy · {countItems(tree)} topics · {stats.checked}/{stats.total} reviewed
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[rgba(201,201,210,0.12)] px-2 py-0.5 text-[11px] font-medium text-[#C9C9D2]">
                {stats.accepted} accepted
              </span>
              <span className="rounded-full bg-[rgba(224,104,88,0.15)] px-2 py-0.5 text-[11px] font-medium text-[#E06858]">
                {stats.rejected} rejected
              </span>
              <span className="rounded-full bg-[#1E1E21] px-2 py-0.5 text-[11px] font-medium text-[#A6A6AE]">
                {stats.needsImprovement} needs work
              </span>
              <Button type="button" variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDialog({
                    mode: "confirm",
                    title: "Reset progress?",
                    description: "This clears all checklist progress. It cannot be undone.",
                    confirmLabel: "Reset",
                    onConfirm: resetAll,
                  });
                }}
                className="gap-1.5 text-[#A6A6AE]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          </div>
        </header>

        <div className="mt-3 flex gap-2">
          {(["physics", "maths"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSubject(value)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                subject === value
                  ? "border border-[#C9C9D2] bg-[rgba(201,201,210,0.12)] text-[#C9C9D2] shadow-sm"
                  : "border border-[#2E2E33] bg-transparent text-[#F2F2F4] hover:border-[#C9C9D2] hover:bg-[#1E1E21]",
              )}
            >
              {value === "physics" ? "Physics" : "Mathematics"}
              <span className="ml-1.5 text-xs opacity-80">
                ({tree.subjects[value].length} units)
              </span>
            </button>
          ))}
        </div>
      </div>

      <main className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-6", (isSelecting || queue.isBusy) && "pb-24")}>
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <JobsPanel
            jobs={queue.jobs}
            now={queue.now}
            busy={queue.isBusy}
            concurrency={queue.concurrency}
            onConcurrencyChange={queue.setConcurrency}
            lastBatchCount={queue.lastBatchCount}
            onStartAgain={() => {
              closeWatch();
              unlockTutorAudio();
              queue.startAgain();
            }}
            onClear={queue.clearJobs}
            onStop={() => {
              closeWatch();
              queue.stopAll();
            }}
            boards={queue.boards}
            recordingBoardIds={recordingBoardIds}
            onWatchLive={(boardId) => {
              const job = queue.jobs.find((entry) => entry.boardId === boardId);
              openLiveLecture(boardId, {
                title: job ? lectureJobTitle(job) : undefined,
                question: job?.question,
              });
            }}
            onWatch={(boardId) => {
              const job = queue.jobs.find((entry) => entry.boardId === boardId);
              openLecture(boardId, "replay", {
                title: job ? lectureJobTitle(job) : undefined,
                question: job?.question,
              });
            }}
            onNotes={(boardId) => {
              const job = queue.jobs.find((entry) => entry.boardId === boardId);
              openLecture(boardId, "notes", {
                title: job ? lectureJobTitle(job) : undefined,
                question: job?.question,
              });
            }}
            onDelete={(boardId) => {
              deleteLecture(boardId);
            }}
            onDeleteCompleted={
              completedJobRecordingIds.length > 0
                ? () => {
                    deleteLectures(completedJobRecordingIds);
                  }
                : undefined
            }
            completedDeleteCount={completedJobRecordingIds.length}
          />

          {units.map((unit) => {
            const { accepted, total } = unitProgress(unit.items, progress);
            const unitId = unitIdFor(unit.subject, unit.number);
            const unitQuestions = questionsForUnit(probes, unitId);

            const unitProbeIds = unitQuestions.map((question) => question.id);
            const unitSelectedCount = unitProbeIds.filter((id) => selectedIds.has(id)).length;
            const unitAllSelected = unitProbeIds.length > 0 && unitSelectedCount === unitProbeIds.length;
            const unitSomeSelected = unitSelectedCount > 0 && !unitAllSelected;
            const unitRecordingIds = recordingBoardIdsForQuestions(
              unitQuestions,
              recordings,
              recordingBoardIds,
            );

            return (
              <section
                key={`${unit.subject}-${unit.number}`}
                className="animate-wb-fade-in rounded-xl border border-[#2E2E33] bg-[#151517] px-4 py-3.5"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    {isSelecting ? (
                      <Checkbox
                        checked={unitAllSelected}
                        indeterminate={unitSomeSelected}
                        disabled={unitProbeIds.length === 0}
                        onCheckedChange={(selected) => toggleSelected(unitProbeIds, selected)}
                        aria-label={`Select Unit ${unit.number}`}
                        title={
                          unitProbeIds.length === 0
                            ? "No lecture fixtures for this unit yet"
                            : "Select this unit"
                        }
                        className="mt-0.5"
                      />
                    ) : null}
                    <div>
                      <h2 className="text-sm font-semibold text-[#F2F2F4]">
                        Unit {unit.number}: {unit.title}
                      </h2>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {unit.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-[rgba(201,201,210,0.12)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#C9C9D2]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[#A6A6AE]">
                      {accepted}/{total} accepted
                    </span>
                    {unitRecordingIds.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-[#A6A6AE] hover:text-[#E06858]"
                        onClick={() => {
                          void deleteLectures(unitRecordingIds);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete lectures ({unitRecordingIds.length})
                      </Button>
                    ) : null}
                    {unitProbeIds.length > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsSelecting(true)}
                      >
                        Select
                      </Button>
                    ) : null}
                  </div>
                </div>

                <ul className="flex flex-col gap-1">
                  {unit.items.map((item, index) => {
                    const entry = get(item.id);
                    const topicProbes = questionsForTopic(probes, item.id);
                    const recorded: Partial<Record<ProbeDifficulty, string>> = {};
                    for (const difficulty of PROBE_DIFFICULTIES) {
                      const board = recordings.get(recordingKey(item.id, difficulty));
                      if (board) {
                        recorded[difficulty] = board.id;
                      }
                    }
                    const recording = liveRecordingMap(runningJobs, item.id, recordingBoardIds);
                    const showSubsection =
                      item.subsection &&
                      (index === 0 || unit.items[index - 1]?.subsection !== item.subsection);

                    return (
                      <li key={item.id}>
                        {showSubsection ? (
                          <p className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-[#717177]">
                            {item.subsection}
                          </p>
                        ) : null}
                        <TopicRow
                          item={item}
                          probes={topicProbes}
                          checked={entry.checked}
                          status={entry.status}
                          selecting={isSelecting}
                          selectedIds={selectedIds}
                          expanded={expandedIds.has(item.id)}
                          recorded={recorded}
                          recording={recording}
                          onToggleSelected={toggleSelected}
                          onToggleExpanded={() => {
                            setExpandedIds((current) => {
                              const next = new Set(current);
                              if (next.has(item.id)) {
                                next.delete(item.id);
                              } else {
                                next.add(item.id);
                              }
                              return next;
                            });
                          }}
                          onOpenSheet={() => {
                            setSelectedItem(item);
                            setSheetOpen(true);
                          }}
                          onWatch={(boardId, difficulty) => {
                            const probe = topicProbes.find((entry) => entry.difficulty === difficulty);
                            openLecture(boardId, "replay", {
                              title: item.text,
                              question:
                                probe?.question ||
                                recordings.get(recordingKey(item.id, difficulty))?.preview,
                            });
                          }}
                          onWatchLive={(boardId, difficulty) => {
                            const probe = topicProbes.find((entry) => entry.difficulty === difficulty);
                            openLiveLecture(boardId, {
                              title: item.text,
                              question: probe?.question,
                            });
                          }}
                          onNotes={(boardId, difficulty) => {
                            const probe = topicProbes.find((entry) => entry.difficulty === difficulty);
                            openLecture(boardId, "notes", {
                              title: item.text,
                              question:
                                probe?.question ||
                                recordings.get(recordingKey(item.id, difficulty))?.preview,
                            });
                          }}
                          onDelete={(boardId) => {
                            void deleteLecture(boardId);
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </main>

      {isSelecting || queue.isBusy ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#2E2E33] bg-[#151517]/95 px-4 py-3 backdrop-blur-md">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[#A6A6AE]">
              {isSelecting
                ? selectedCount > 0
                  ? `${selectedCount} selected`
                  : "Tick the questions you want"
                : "Lecture running"}
            </p>
            <div className="flex items-center gap-2">
              {queue.isBusy ? (
                <Button type="button" variant="outline" size="sm" onClick={() => {
                  closeWatch();
                  queue.stopAll();
                }}>
                  Stop testing
                </Button>
              ) : null}
              {isSelecting ? (
                <Button type="button" variant="ghost" size="sm" onClick={cancelSelecting}>
                  Cancel
                </Button>
              ) : null}
              {isSelecting && selectedRecordingIds.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-[#A6A6AE] hover:text-[#E06858]"
                  onClick={() => {
                    void deleteLectures(selectedRecordingIds);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete ({selectedRecordingIds.length})
                </Button>
              ) : null}
              {isSelecting && selectedCount > 0 ? (
                <Button type="button" size="sm" onClick={startSelected}>
                  Start testing ({selectedCount})
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <TopicSheet
        item={selectedItem}
        probes={selectedItem ? questionsForTopic(probes, selectedItem.id) : []}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        checked={selectedEntry?.checked ?? false}
        status={selectedEntry?.status ?? "pending"}
        notes={selectedEntry?.notes ?? ""}
        boardId={selectedEntry?.boardId}
        recording={
          selectedItem
            ? liveRecordingMap(runningJobs, selectedItem.id, recordingBoardIds)
            : {}
        }
        onWatchLive={(boardId) => {
          const job = queue.jobs.find((entry) => entry.boardId === boardId);
          openLiveLecture(boardId, {
            title: selectedItem?.text,
            question: job?.question,
          });
        }}
        onCheckedChange={(checked) => {
          if (selectedItem) {
            setChecked(selectedItem.id, checked);
          }
        }}
        onStatusChange={(status) => {
          if (selectedItem) {
            setStatus(selectedItem.id, status);
          }
        }}
        onNotesChange={(notes) => {
          if (selectedItem) {
            setNotes(selectedItem.id, notes);
          }
        }}
        onBoardIdChange={(boardId) => {
          if (selectedItem) {
            setBoardId(selectedItem.id, boardId);
          }
        }}
      />

      <MessageDialog
        open={dialog !== null}
        title={dialog?.title ?? ""}
        description={dialog?.description ?? ""}
        mode={dialog?.mode ?? "notice"}
        confirmLabel={dialog?.confirmLabel}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
          }
        }}
        onConfirm={dialog?.onConfirm}
      />

      <WatchDrawer
        boardId={watchBoardId}
        intent={watchIntent}
        title={watchTitle}
        question={watchQuestion}
        livePhase={liveJob?.phase}
        liveStatus={
          liveJob?.status === "complete" || liveJob?.status === "failed" || liveJob?.status === "running"
            ? liveJob.status
            : undefined
        }
        onIntentChange={(next) => {
          if (watchIntent === "live") {
            return;
          }
          if (next === "replay") {
            unlockTutorAudio();
          }
          setWatchIntent(next);
        }}
        onClose={closeWatch}
        onDelete={(boardId) => {
          void deleteLecture(boardId);
        }}
      />

      {!isLiveWatch ? (
        <LiveRecordingsDock
          jobs={queue.jobs}
          now={queue.now}
          recordingBoardIds={recordingBoardIds}
          watchingBoardId={null}
          onWatchLive={(boardId) => {
            const job = queue.jobs.find((entry) => entry.boardId === boardId);
            openLiveLecture(boardId, {
              title: job ? lectureJobTitle(job) : undefined,
              question: job?.question,
            });
          }}
        />
      ) : null}

      {queue.runtimes.map((runtime, index) => {
        const promoted = Boolean(
          isLiveWatch && liveRuntime?.jobId === runtime.jobId && liveSlot,
        );
        return (
          <div
            key={runtime.jobId}
            aria-hidden
            data-lecture-job-id={runtime.jobId}
            data-lecture-board-id={runtime.boardId}
            style={
              promoted && liveSlot
                ? promotedLectureFrameStyle(liveSlot)
                : headlessLectureOffscreenStyle(index)
            }
          >
            <div
              style={
                promoted && liveSlot
                  ? promotedLectureBoardWrapStyle(liveSlot)
                  : { width: "100%", height: "100%", overflow: "hidden" }
              }
            >
              <div
                style={
                  promoted && liveSlot
                    ? promotedLectureBoardStyle(liveSlot)
                    : headlessLectureBoardStyle(1)
                }
              >
                <TutorSessionShell
                  sessionId={runtime.boardId}
                  variant="headless"
                  autoQuestion={runtime.question}
                  muteAudio={!promoted}
                  onPhase={(phase) => queue.handlePhase(runtime.jobId, phase)}
                  onComplete={() => queue.handleComplete(runtime.jobId)}
                  onError={(error) => queue.handleError(runtime.jobId, error)}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
