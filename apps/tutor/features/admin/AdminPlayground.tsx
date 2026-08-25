"use client";

import { useCallback, useMemo, useState } from "react";
import { Download, FlaskConical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  TutorSessionShell,
  unlockTutorAudio,
} from "@/features/tutor-session";
import { JobsPanel } from "./components/JobsPanel";
import { PlayMenu } from "./components/PlayMenu";
import { Checkbox } from "./components/Checkbox";
import { TopicRow } from "./components/TopicRow";
import { TopicSheet } from "./components/TopicSheet";
import { WatchDrawer, type WatchIntent } from "./components/WatchDrawer";
import { useLectureQueue } from "./hooks/useLectureQueue";
import { useSyllabusProgress } from "./hooks/useSyllabusProgress";
import { mergePlaygroundRecordings, recordingKey } from "./lib/playgroundBoards";
import {
  PROBE_DIFFICULTIES,
  questionsByIds,
  questionsForTopic,
  questionsForUnit,
  unitIdFor,
  type ProbeDifficulty,
  type ProbeQuestion,
} from "./lib/probes";
import { DELETE_LECTURE_CONFIRM } from "./lib/lectureJobs";
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

function difficultyCounts(questions: ProbeQuestion[]): Partial<Record<ProbeDifficulty, number>> {
  const counts: Partial<Record<ProbeDifficulty, number>> = {};
  for (const difficulty of PROBE_DIFFICULTIES) {
    const count = questions.filter((question) => question.difficulty === difficulty).length;
    if (count > 0) {
      counts[difficulty] = count;
    }
  }
  return counts;
}

export function AdminPlayground({ tree, probes }: AdminPlaygroundProps) {
  const { progress, get, setChecked, setStatus, setNotes, setBoardId, resetAll, exportJson } =
    useSyllabusProgress();
  const queue = useLectureQueue();

  const [subject, setSubject] = useState<SyllabusSubject>("physics");
  const [selectedItem, setSelectedItem] = useState<SyllabusItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [watchBoardId, setWatchBoardId] = useState<string | null>(null);
  const [watchIntent, setWatchIntent] = useState<WatchIntent>("replay");
  const [watchTitle, setWatchTitle] = useState<string | undefined>(undefined);
  const [watchQuestion, setWatchQuestion] = useState<string | undefined>(undefined);

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

  const closeWatch = useCallback(() => {
    setWatchBoardId(null);
    setWatchTitle(undefined);
    setWatchQuestion(undefined);
    setWatchIntent("replay");
  }, []);

  const openLecture = (
    boardId: string,
    intent: WatchIntent,
    options?: { title?: string; question?: string },
  ) => {
    if (recordingBoardIds.has(boardId)) {
      return;
    }
    unlockTutorAudio();
    setWatchIntent(intent);
    setWatchTitle(options?.title);
    setWatchQuestion(options?.question);
    setWatchBoardId(boardId);
  };

  const deleteLecture = async (boardId: string) => {
    if (recordingBoardIds.has(boardId)) {
      return;
    }
    if (!window.confirm(DELETE_LECTURE_CONFIRM)) {
      return;
    }
    if (watchBoardId === boardId) {
      closeWatch();
    }
    const ok = await queue.removeRecording(boardId);
    if (!ok) {
      window.alert("Could not delete this lecture recording.");
    }
  };

  const startSelected = () => {
    const questions = questionsByIds(probes, selectedIds);
    if (questions.length === 0) {
      return;
    }
    unlockTutorAudio();
    queue.enqueue(questions);
    setSelectedIds(new Set());
  };

  const selectQuestions = (questions: ProbeQuestion[]) => {
    toggleSelected(
      questions.map((question) => question.id),
      true,
    );
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
                  {" · "}square selects a test, round marks reviewed
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
                  if (window.confirm("Reset all checklist progress? This cannot be undone.")) {
                    resetAll();
                  }
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

      <main className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-6", (selectedCount > 0 || queue.isBusy) && "pb-24")}>
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <JobsPanel
            jobs={queue.jobs}
            now={queue.now}
            busy={queue.isBusy}
            concurrency={queue.concurrency}
            onConcurrencyChange={queue.setConcurrency}
            lastBatchCount={queue.lastBatchCount}
            onStartAgain={() => {
              unlockTutorAudio();
              queue.startAgain();
            }}
            onClear={queue.clearJobs}
            onStop={queue.stopAll}
            boards={queue.boards}
            recordingBoardIds={recordingBoardIds}
            onWatch={(boardId) => {
              const job = queue.jobs.find((entry) => entry.boardId === boardId);
              openLecture(boardId, "replay", {
                title: job ? `${job.topicId} · ${job.difficulty}` : undefined,
                question: job?.question,
              });
            }}
            onNotes={(boardId) => {
              const job = queue.jobs.find((entry) => entry.boardId === boardId);
              openLecture(boardId, "notes", {
                title: job ? `${job.topicId} · ${job.difficulty}` : undefined,
                question: job?.question,
              });
            }}
            onDelete={(boardId) => {
              void deleteLecture(boardId);
            }}
          />

          {units.map((unit) => {
            const { accepted, total } = unitProgress(unit.items, progress);
            const unitId = unitIdFor(unit.subject, unit.number);
            const unitQuestions = questionsForUnit(probes, unitId);

            const unitProbeIds = unitQuestions.map((question) => question.id);
            const unitSelectedCount = unitProbeIds.filter((id) => selectedIds.has(id)).length;
            const unitAllSelected = unitProbeIds.length > 0 && unitSelectedCount === unitProbeIds.length;
            const unitSomeSelected = unitSelectedCount > 0 && !unitAllSelected;

            return (
              <section
                key={`${unit.subject}-${unit.number}`}
                className="animate-wb-fade-in rounded-xl border border-[#2E2E33] bg-[#151517] px-4 py-3.5"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Checkbox
                      checked={unitAllSelected}
                      indeterminate={unitSomeSelected}
                      disabled={unitProbeIds.length === 0}
                      onCheckedChange={(selected) => toggleSelected(unitProbeIds, selected)}
                      aria-label={`Select Unit ${unit.number} for testing`}
                      title={
                        unitProbeIds.length === 0
                          ? "No lecture fixtures for this unit yet"
                          : "Select this unit for testing"
                      }
                      className="mt-0.5 rounded-[2px]"
                    />
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
                    <PlayMenu
                      label="Select"
                      available={difficultyCounts(unitQuestions)}
                      emptyTitle="No lecture fixtures for this unit yet"
                      onPick={(choice) => selectQuestions(questionsForUnit(probes, unitId, choice))}
                    />
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
                          selectedIds={selectedIds}
                          expanded={expandedIds.has(item.id)}
                          recorded={recorded}
                          recordingDifficulties={runningJobs
                            .filter((job) => job.topicId === item.id)
                            .map((job) => job.difficulty)}
                          onToggleReviewed={(value) => setChecked(item.id, value)}
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

      {selectedCount > 0 || queue.isBusy ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#2E2E33] bg-[#151517]/95 px-4 py-3 backdrop-blur-md">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[#A6A6AE]">
              {selectedCount > 0
                ? `${selectedCount} question${selectedCount === 1 ? "" : "s"} selected`
                : "Lecture running"}
            </p>
            <div className="flex items-center gap-2">
              {queue.isBusy ? (
                <Button type="button" variant="outline" size="sm" onClick={queue.stopAll}>
                  Stop testing
                </Button>
              ) : null}
              {selectedCount > 0 ? (
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
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        checked={selectedEntry?.checked ?? false}
        status={selectedEntry?.status ?? "pending"}
        notes={selectedEntry?.notes ?? ""}
        boardId={selectedEntry?.boardId}
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

      <WatchDrawer
        boardId={watchBoardId}
        intent={watchIntent}
        title={watchTitle}
        question={watchQuestion}
        onIntentChange={(next) => {
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

      {queue.runtimes.map((runtime, index) => (
        <div
          key={runtime.jobId}
          aria-hidden
          style={{
            position: "fixed",
            left: -2000,
            top: index * (BOARD_HEIGHT + 16),
            width: BOARD_WIDTH,
            height: BOARD_HEIGHT,
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          <TutorSessionShell
            sessionId={runtime.boardId}
            variant="headless"
            autoQuestion={runtime.question}
            muteAudio
            onPhase={(phase) => queue.handlePhase(runtime.jobId, phase)}
            onComplete={() => queue.handleComplete(runtime.jobId)}
            onError={(error) => queue.handleError(runtime.jobId, error)}
          />
        </div>
      ))}
    </div>
  );
}
