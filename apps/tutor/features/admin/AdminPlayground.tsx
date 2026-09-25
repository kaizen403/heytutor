"use client";

import { useCallback, useMemo, useState } from "react";
import { FlaskConical, Info, SearchX, Trash2 } from "lucide-react";
import { SiteButton } from "@/components/ui/site-button";
import { TutorSessionShell, unlockTutorAudio } from "@/features/tutor-session";
import { AdminToolbar } from "./components/AdminToolbar";
import { MessageDialog } from "./components/MessageDialog";
import { RunBar } from "./components/RunBar";
import { RunCostBox } from "./components/RunCostBox";
import { TopicRow } from "./components/TopicRow";
import { TopicSheet } from "./components/TopicSheet";
import { UnitSection, type UnitSummary } from "./components/UnitSection";
import { WatchDrawer, type WatchIntent } from "./components/WatchDrawer";
import { useLectureCosts } from "./hooks/useLectureCosts";
import { useLectureQueue } from "./hooks/useLectureQueue";
import { useLiveWatchSlot } from "./hooks/useLiveWatchSlot";
import { useRunCost } from "./hooks/useRunCost";
import { useSyllabusProgress } from "./hooks/useSyllabusProgress";
import {
  headlessLectureBoardStyle,
  headlessLectureOffscreenStyle,
  promotedLectureBoardStyle,
  promotedLectureBoardWrapStyle,
  promotedLectureFrameStyle,
} from "./lib/headlessRuntime";
import { selectLiveWatchRuntime } from "./lib/lectureIsolation";
import {
  deletableJobBoardIds,
  deleteLecturesConfirm,
  isLectureLiveWatchable,
  lectureJobTitle,
} from "./lib/lectureJobs";
import {
  buildLectureStates,
  cellStateFor,
  type DifficultyState,
} from "./lib/lectureState";
import {
  SYLLABUS_SUBJECT_LABEL,
  countItems,
  type SyllabusItem,
  type SyllabusSubject,
  type SyllabusTree,
} from "./lib/parseSyllabus";
import {
  mergePlaygroundRecordings,
  recordingKey,
} from "./lib/playgroundBoards";
import { buildProbeIndex, probesForTopic, visibleSelectedProbes } from "./lib/probeIndex";
import {
  PROBE_DIFFICULTIES,
  unitIdFor,
  type ProbeDifficulty,
  type ProbeQuestion,
} from "./lib/probes";
import { DEFAULT_PROGRESS_ENTRY, type ItemStatus } from "./lib/progressStorage";
import {
  collapseLectureState,
  DEFAULT_TOPIC_FILTERS,
  filtersAreActive,
  normalizeQuery,
  topicMatchesFilters,
  type TopicFilters,
} from "./lib/topicFilters";

interface AdminPlaygroundProps {
  tree: SyllabusTree;
  probes: ProbeQuestion[];
}

interface VisibleTopic {
  item: SyllabusItem;
  probes: ProbeQuestion[];
  probeIds: string[];
  states: Record<ProbeDifficulty, DifficultyState>;
  boardIds: Partial<Record<ProbeDifficulty, string>>;
  status: ItemStatus;
  checked: boolean;
}

interface VisibleUnit {
  key: string;
  unitId: string;
  number: number;
  title: string;
  tags: string[];
  topics: VisibleTopic[];
  summary: UnitSummary;
  selectableIds: string[];
  deletableBoardIds: string[];
}

function unitKey(subject: SyllabusSubject, number: number): string {
  return `${subject}|${number}`;
}

export function AdminPlayground({ tree, probes }: AdminPlaygroundProps) {
  const {
    progress,
    get,
    setChecked,
    setStatus,
    setNotes,
    setBoardId,
    resetAll,
    exportJson,
  } = useSyllabusProgress();
  const queue = useLectureQueue();

  const [subject, setSubject] = useState<SyllabusSubject>("physics");
  const [filters, setFilters] = useState<TopicFilters>(DEFAULT_TOPIC_FILTERS);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedItem, setSelectedItem] = useState<SyllabusItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [watchBoardId, setWatchBoardId] = useState<string | null>(null);
  const [watchIntent, setWatchIntent] = useState<WatchIntent>("replay");
  const [watchTitle, setWatchTitle] = useState<string | undefined>(undefined);
  const [watchQuestion, setWatchQuestion] = useState<string | undefined>(
    undefined,
  );
  const [dialog, setDialog] = useState<{
    mode: "confirm" | "notice";
    title: string;
    description: string;
    confirmLabel?: string;
    onConfirm?: () => void;
  } | null>(null);

  const probeIndex = useMemo(() => buildProbeIndex(probes), [probes]);

  const recordingBoardIds = useMemo(
    () => new Set(queue.runtimes.map((runtime) => runtime.boardId)),
    [queue.runtimes],
  );
  const recordings = useMemo(
    () =>
      mergePlaygroundRecordings(queue.boards, queue.jobs, recordingBoardIds),
    [queue.boards, queue.jobs, recordingBoardIds],
  );
  const lectureStates = useMemo(
    () => buildLectureStates(queue.jobs, recordings, recordingBoardIds),
    [queue.jobs, recordings, recordingBoardIds],
  );
  const costSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const job of queue.jobs) {
      if (job.boardId) ids.add(job.boardId);
    }
    for (const runtime of queue.runtimes) {
      ids.add(runtime.boardId);
    }
    return [...ids];
  }, [queue.jobs, queue.runtimes]);
  const costTitlesBySession = useMemo(() => {
    const titles: Record<string, string> = {};
    for (const job of queue.jobs) {
      if (job.boardId) titles[job.boardId] = lectureJobTitle(job);
    }
    return titles;
  }, [queue.jobs]);
  const runCost = useRunCost(costSessionIds, queue.isBusy);

  const units = tree.subjects[subject];
  const subjectHasFixtures = useMemo(
    () =>
      units.some((unit) =>
        probeIndex.byUnit.has(unitIdFor(unit.subject, unit.number)),
      ),
    [units, probeIndex],
  );

  /**
   * One pass builds every unit's rows, counts and bulk-action ids. Row lookups
   * go through `probeIndex`, so this stays linear in topics rather than
   * rescanning all ~1000 probes per row.
   */
  const visibleUnits = useMemo<VisibleUnit[]>(() => {
    const query = normalizeQuery(filters.query);
    const built: VisibleUnit[] = [];

    for (const unit of units) {
      const unitId = unitIdFor(unit.subject, unit.number);
      const topics: VisibleTopic[] = [];
      const selectableIds: string[] = [];
      const deletableBoardIds: string[] = [];
      const seenBoards = new Set<string>();
      let recorded = 0;
      let running = 0;
      let accepted = 0;
      let possible = 0;

      for (const item of unit.items) {
        const topicProbes = probesForTopic(probeIndex, item.id);
        const entry = progress[item.id] ?? DEFAULT_PROGRESS_ENTRY;
        const states = {} as Record<ProbeDifficulty, DifficultyState>;
        const boardIds: Partial<Record<ProbeDifficulty, string>> = {};

        for (const difficulty of PROBE_DIFFICULTIES) {
          const hasFixture = topicProbes.some(
            (probe) => probe.difficulty === difficulty,
          );
          if (hasFixture) {
            possible += 1;
          }
          const cell = cellStateFor(
            lectureStates,
            item.id,
            difficulty,
            hasFixture,
          );
          states[difficulty] = cell.state;
          if (cell.boardId) {
            boardIds[difficulty] = cell.boardId;
          }
          if (cell.state === "recorded") {
            recorded += 1;
            const board = cell.boardId;
            if (
              board &&
              !recordingBoardIds.has(board) &&
              !seenBoards.has(board)
            ) {
              seenBoards.add(board);
              deletableBoardIds.push(board);
            }
          } else if (cell.state === "running") {
            running += 1;
          }
        }

        if (entry.status === "accepted") {
          accepted += 1;
        }
        const lecture = collapseLectureState(
          PROBE_DIFFICULTIES.map((d) => states[d]),
        );
        if (
          !topicMatchesFilters(
            item,
            topicProbes,
            entry.status,
            lecture,
            filters,
            query,
          )
        ) {
          continue;
        }

        for (const probe of topicProbes) {
          selectableIds.push(probe.id);
        }

        topics.push({
          item,
          probes: topicProbes,
          probeIds: topicProbes.map((probe) => probe.id),
          states,
          boardIds,
          status: entry.status,
          checked: entry.checked,
        });
      }

      built.push({
        key: unitKey(unit.subject, unit.number),
        unitId,
        number: unit.number,
        title: unit.title,
        tags: unit.tags,
        topics,
        summary: {
          shown: topics.length,
          total: unit.items.length,
          possible,
          recorded,
          running,
          accepted,
        },
        selectableIds,
        deletableBoardIds,
      });
    }

    return built;
  }, [units, probeIndex, progress, lectureStates, recordingBoardIds, filters]);

  const lectureCostSessions = useMemo(() => {
    const sessions: Array<{ sessionId: string; hot: boolean }> = [];
    const seen = new Set<string>();
    for (const unit of visibleUnits) {
      for (const topic of unit.topics) {
        for (const difficulty of PROBE_DIFFICULTIES) {
          const boardId = topic.boardIds[difficulty];
          const state = topic.states[difficulty];
          if (!boardId || (state !== "recorded" && state !== "running"))
            continue;
          if (seen.has(boardId)) continue;
          seen.add(boardId);
          sessions.push({ sessionId: boardId, hot: state === "running" });
        }
      }
    }
    return sessions;
  }, [visibleUnits]);
  const costsByBoardId = useLectureCosts(lectureCostSessions);

  const active = filtersAreActive(filters);
  const shownUnits = useMemo(
    () =>
      active
        ? visibleUnits.filter((unit) => unit.topics.length > 0)
        : visibleUnits,
    [visibleUnits, active],
  );
  const visibleProbeIds = useMemo(
    () => new Set(shownUnits.flatMap((unit) => unit.selectableIds)),
    [shownUnits],
  );
  const visibleSelected = useMemo(
    () => visibleSelectedProbes(probeIndex, selectedIds, visibleProbeIds),
    [probeIndex, selectedIds, visibleProbeIds],
  );
  const matchCount = useMemo(
    () => visibleUnits.reduce((sum, unit) => sum + unit.topics.length, 0),
    [visibleUnits],
  );

  /**
   * Units start collapsed: this subject has 342 topics, and opening all of them
   * at once is the wall of rows this layout exists to avoid. Searching
   * auto-opens whatever matched, so results are never hidden behind a header.
   */
  const isUnitExpanded = useCallback(
    (key: string) => active || expandedUnits.has(key),
    [active, expandedUnits],
  );
  const allExpanded =
    active ||
    (shownUnits.length > 0 &&
      shownUnits.every((unit) => expandedUnits.has(unit.key)));

  const stats = useMemo(() => {
    let checked = 0;
    let accepted = 0;
    let rejected = 0;
    let needsImprovement = 0;
    for (const entry of Object.values(progress)) {
      if (entry.checked) checked += 1;
      if (entry.status === "accepted") accepted += 1;
      else if (entry.status === "rejected") rejected += 1;
      else if (entry.status === "needs-improvement") needsImprovement += 1;
    }
    return {
      total: countItems(tree),
      checked,
      accepted,
      rejected,
      needsImprovement,
    };
  }, [progress, tree]);

  const unitCounts = useMemo(
    () => ({
      physics: tree.subjects.physics.length,
      maths: tree.subjects.maths.length,
      chemistry: tree.subjects.chemistry.length,
    }),
    [tree],
  );
  const topicCounts = useMemo(
    () => ({
      physics: tree.subjects.physics.reduce(
        (sum, unit) => sum + unit.items.length,
        0,
      ),
      maths: tree.subjects.maths.reduce(
        (sum, unit) => sum + unit.items.length,
        0,
      ),
      chemistry: tree.subjects.chemistry.reduce(
        (sum, unit) => sum + unit.items.length,
        0,
      ),
    }),
    [tree],
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

  const notice = useCallback((title: string, description: string) => {
    setDialog({ mode: "notice", title, description });
  }, []);

  const openLecture = useCallback(
    (
      boardId: string,
      intent: Exclude<WatchIntent, "live">,
      options?: { title?: string; question?: string },
    ) => {
      if (recordingBoardIds.has(boardId)) {
        notice(
          "Still recording",
          "This lecture is still being recorded. Use Watch live to follow along, or wait for it to finish.",
        );
        return;
      }
      setHeldBoardId(null);
      unlockTutorAudio();
      setWatchIntent(intent);
      setWatchTitle(options?.title);
      setWatchQuestion(options?.question);
      setWatchBoardId(boardId);
    },
    [notice, recordingBoardIds, setHeldBoardId],
  );

  const openLiveLecture = useCallback(
    (boardId: string, options?: { title?: string; question?: string }) => {
      const job = queue.jobs.find((entry) => entry.boardId === boardId);
      if (
        !job ||
        !isLectureLiveWatchable(job, {
          isRecording: recordingBoardIds.has(boardId),
        })
      ) {
        notice(
          "Not live yet",
          "This lecture has not started drawing yet. Give it a moment and try again.",
        );
        return;
      }
      unlockTutorAudio();
      setHeldBoardId(boardId);
      setWatchIntent("live");
      setWatchTitle(options?.title ?? lectureJobTitle(job));
      setWatchQuestion(options?.question ?? job.question);
      setWatchBoardId(boardId);
    },
    [notice, queue.jobs, recordingBoardIds, setHeldBoardId],
  );

  const performDelete = useCallback(
    async (boardIds: string[]) => {
      if (watchBoardId && boardIds.includes(watchBoardId)) {
        closeWatch();
      }
      const result = await queue.removeRecordings(boardIds);
      if (result.failed === 0) {
        return;
      }
      notice(
        result.deleted === 0
          ? "Could not delete"
          : "Some lectures were not deleted",
        result.deleted === 0
          ? "Could not delete those lecture recordings."
          : `Deleted ${result.deleted}, but ${result.failed} could not be removed.`,
      );
    },
    [closeWatch, notice, queue, watchBoardId],
  );

  const deleteLectures = useCallback(
    (boardIds: string[]) => {
      const unique = [...new Set(boardIds)].filter(
        (boardId) => !recordingBoardIds.has(boardId),
      );
      if (unique.length === 0) {
        if (boardIds.length > 0) {
          notice(
            "Still recording",
            "Those lectures are still recording and cannot be deleted yet.",
          );
        }
        return;
      }
      setDialog({
        mode: "confirm",
        title:
          unique.length === 1
            ? "Delete lecture?"
            : `Delete ${unique.length} lectures?`,
        description: deleteLecturesConfirm(unique.length),
        confirmLabel:
          unique.length === 1 ? "Delete" : `Delete ${unique.length}`,
        onConfirm: () => {
          void performDelete(unique);
        },
      });
    },
    [notice, performDelete, recordingBoardIds],
  );

  const toggleSelected = useCallback((ids: string[], selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const startSelected = () => {
    const questions = visibleSelected;
    if (questions.length === 0) {
      return;
    }
    unlockTutorAudio();
    queue.enqueue(questions);
    setSelectedIds(new Set());
    setSelecting(false);
  };

  const handleExport = () => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "heytutor-syllabus-progress.json";
    anchor.click();
    // Revoking in the same tick can cancel the download in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const activateCell = (topic: VisibleTopic, difficulty: ProbeDifficulty) => {
    const boardId = topic.boardIds[difficulty];
    if (!boardId) {
      return;
    }
    const probe = topic.probes.find((entry) => entry.difficulty === difficulty);
    if (topic.states[difficulty] === "running") {
      openLiveLecture(boardId, {
        title: topic.item.text,
        question: probe?.question,
      });
      return;
    }
    openLecture(boardId, "replay", {
      title: topic.item.text,
      question:
        probe?.question ||
        recordings.get(recordingKey(topic.item.id, difficulty))?.preview,
    });
  };

  const selectedCount = visibleSelected.length;
  const selectedRecordingIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const probe of visibleSelected) {
      const board = recordings.get(
        recordingKey(probe.topicId, probe.difficulty),
      );
      if (!board || recordingBoardIds.has(board.id) || seen.has(board.id)) {
        continue;
      }
      seen.add(board.id);
      ids.push(board.id);
    }
    return ids;
  }, [visibleSelected, recordings, recordingBoardIds]);
  const completedJobRecordingIds = useMemo(
    () => deletableJobBoardIds(queue.jobs, recordingBoardIds),
    [queue.jobs, recordingBoardIds],
  );

  const selectedEntry = selectedItem ? get(selectedItem.id) : null;

  return (
    <div className="site-theme fx-aurora-soft relative min-h-screen">
      <div
        className={`relative z-10 mx-auto w-full max-w-[1480px] px-4 pt-6 lg:px-8 ${selecting ? "pb-28" : "pb-12"}`}
      >
        <AdminToolbar
          subject={subject}
          onSubjectChange={(next) => {
            if (next === subject) return;
            setSubject(next);
            setFilters(DEFAULT_TOPIC_FILTERS);
            setSelectedIds(new Set());
            setSelecting(false);
            setSelectedItem(null);
            setSheetOpen(false);
          }}
          unitCounts={unitCounts}
          topicCounts={topicCounts}
          stats={stats}
          filters={filters}
          onFiltersChange={setFilters}
          matchCount={matchCount}
          subjectTopicCount={topicCounts[subject]}
          selecting={selecting}
          canSelect={subjectHasFixtures}
          onToggleSelecting={() => {
            setSelecting((current) => {
              if (current) {
                setSelectedIds(new Set());
              }
              return !current;
            });
          }}
          allExpanded={allExpanded}
          showExpandToggle={!active}
          onExpandAll={() =>
            setExpandedUnits(new Set(visibleUnits.map((unit) => unit.key)))
          }
          onCollapseAll={() => setExpandedUnits(new Set())}
          onExport={handleExport}
          onReset={() =>
            setDialog({
              mode: "confirm",
              title: "Reset progress?",
              description:
                "This clears all checklist progress. It cannot be undone.",
              confirmLabel: "Reset",
              onConfirm: resetAll,
            })
          }
        />

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <main className="order-2 min-w-0 xl:order-1">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-base font-medium text-frost">
                  {SYLLABUS_SUBJECT_LABEL[subject]} syllabus
                </h2>
                <p className="mt-0.5 text-xs text-soft">
                  Open a unit, select questions to record, or watch a lecture; choose a topic to review it.
                </p>
              </div>
              <p className="text-xs text-faint">
                {shownUnits.length} units shown
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              {!subjectHasFixtures ? (
                <div className="glass flex flex-col items-center gap-2 rounded-xl border-dashed px-6 py-10 text-center">
                  <Info className="h-5 w-5 text-sky-400" aria-hidden />
                  <p className="text-sm font-medium text-frost">
                    No question fixtures for {SYLLABUS_SUBJECT_LABEL[subject]}{" "}
                    yet
                  </p>
                  <p className="max-w-md text-xs leading-relaxed text-soft">
                    The {topicCounts[subject]} topics below are listed from the
                    syllabus taxonomy, but no probe questions have been
                    generated for them, so lectures cannot be recorded yet. You
                    can still review and take notes on each topic.
                  </p>
                </div>
              ) : null}

              {shownUnits.length === 0 ? (
                <div className="glass flex flex-col items-center gap-3 rounded-xl border-dashed px-6 py-10 text-center">
                  <SearchX className="h-5 w-5 text-faint" aria-hidden />
                  <p className="text-sm font-medium text-frost">
                    No topics match these filters
                  </p>
                  <SiteButton
                    variant="ghost"
                    size="sm"
                    onClick={() => setFilters(DEFAULT_TOPIC_FILTERS)}
                  >
                    Clear filters
                  </SiteButton>
                </div>
              ) : null}

              {shownUnits.map((unit) => {
                const selectedInUnit = unit.selectableIds.filter((id) =>
                  selectedIds.has(id),
                ).length;
                const allSelected =
                  unit.selectableIds.length > 0 &&
                  selectedInUnit === unit.selectableIds.length;

                return (
                  <UnitSection
                    key={unit.key}
                    number={unit.number}
                    title={unit.title}
                    tags={unit.tags}
                    summary={unit.summary}
                    expanded={isUnitExpanded(unit.key)}
                    onToggleExpanded={() =>
                      setExpandedUnits((current) => {
                        const next = new Set(current);
                        if (next.has(unit.key)) next.delete(unit.key);
                        else next.add(unit.key);
                        return next;
                      })
                    }
                    selecting={selecting}
                    allSelected={allSelected}
                    someSelected={selectedInUnit > 0 && !allSelected}
                    selectableCount={unit.selectableIds.length}
                    onToggleSelected={(selected) =>
                      toggleSelected(unit.selectableIds, selected)
                    }
                    deletableCount={unit.deletableBoardIds.length}
                    onDeleteLectures={() =>
                      deleteLectures(unit.deletableBoardIds)
                    }
                  >
                    {unit.topics.map((topic) => (
                      <TopicRow
                        key={topic.item.id}
                        item={topic.item}
                        probes={topic.probes}
                        states={topic.states}
                        boardIds={topic.boardIds}
                        costsByBoardId={costsByBoardId}
                        checked={topic.checked}
                        status={topic.status}
                        selecting={selecting}
                        selectedIds={selectedIds}
                        expanded={expandedTopics.has(topic.item.id)}
                        onToggleSelected={toggleSelected}
                        onToggleExpanded={() =>
                          setExpandedTopics((current) => {
                            const next = new Set(current);
                            if (next.has(topic.item.id))
                              next.delete(topic.item.id);
                            else next.add(topic.item.id);
                            return next;
                          })
                        }
                        onOpenSheet={() => {
                          setSelectedItem(topic.item);
                          setSheetOpen(true);
                        }}
                        onActivate={(difficulty) =>
                          activateCell(topic, difficulty)
                        }
                        onNotes={(difficulty) => {
                          const boardId = topic.boardIds[difficulty];
                          if (!boardId) return;
                          const probe = topic.probes.find(
                            (entry) => entry.difficulty === difficulty,
                          );
                          openLecture(boardId, "notes", {
                            title: topic.item.text,
                            question:
                              probe?.question ||
                              recordings.get(
                                recordingKey(topic.item.id, difficulty),
                              )?.preview,
                          });
                        }}
                        onDelete={(difficulty) => {
                          const boardId = topic.boardIds[difficulty];
                          if (boardId) deleteLectures([boardId]);
                        }}
                      />
                    ))}
                  </UnitSection>
                );
              })}
            </div>
          </main>
          <aside
            className={`${queue.jobs.length === 0 ? "hidden xl:block" : ""} order-1 min-w-0 xl:order-2`}
            aria-label="Recording activity and costs"
          >
            <div className="space-y-3 xl:sticky xl:top-6">
              <div>
                <h2 className="text-base font-medium text-frost">
                  Recording activity
                </h2>
                <p className="mt-0.5 text-xs text-soft">
                  Queue, playback, and cost for the current run.
                </p>
              </div>
              {queue.jobs.length === 0 ? (
                <div className="glass rounded-xl p-4 text-sm text-soft">
                  <p className="font-medium text-frost">No recording run yet</p>
                  <p className="mt-2 leading-relaxed">
                    Select questions in the syllabus to record a lecture. The
                    run queue and its AI and voice costs will appear here.
                  </p>
                </div>
              ) : null}
              <RunBar
                jobs={queue.jobs}
                now={queue.now}
                busy={queue.isBusy}
                boards={queue.boards}
                recordingBoardIds={recordingBoardIds}
                concurrency={queue.concurrency}
                onConcurrencyChange={queue.setConcurrency}
                lastBatchCount={queue.lastBatchCount}
                watchingBoardId={watchBoardId}
                onStop={() => {
                  closeWatch();
                  queue.stopAll();
                }}
                onStartAgain={() => {
                  closeWatch();
                  unlockTutorAudio();
                  queue.startAgain();
                }}
                onClear={queue.clearJobs}
                onWatchLive={(boardId) => {
                  const job = queue.jobs.find(
                    (entry) => entry.boardId === boardId,
                  );
                  openLiveLecture(boardId, {
                    title: job ? lectureJobTitle(job) : undefined,
                    question: job?.question,
                  });
                }}
                onWatch={(boardId) => {
                  const job = queue.jobs.find(
                    (entry) => entry.boardId === boardId,
                  );
                  openLecture(boardId, "replay", {
                    title: job ? lectureJobTitle(job) : undefined,
                    question: job?.question,
                  });
                }}
                onNotes={(boardId) => {
                  const job = queue.jobs.find(
                    (entry) => entry.boardId === boardId,
                  );
                  openLecture(boardId, "notes", {
                    title: job ? lectureJobTitle(job) : undefined,
                    question: job?.question,
                  });
                }}
                onDelete={(boardId) => deleteLectures([boardId])}
                onDeleteCompleted={
                  completedJobRecordingIds.length > 0
                    ? () => deleteLectures(completedJobRecordingIds)
                    : undefined
                }
                completedDeleteCount={completedJobRecordingIds.length}
              />

              {queue.jobs.length > 0 ? (
                <RunCostBox
                  busy={queue.isBusy}
                  lectureCount={queue.jobs.length}
                  titlesBySession={costTitlesBySession}
                  data={runCost.data}
                  loading={runCost.loading}
                  error={runCost.error}
                />
              ) : null}
            </div>
          </aside>
        </div>
      </div>

      {selecting ? (
        <div className="glass-deep fixed inset-x-0 bottom-0 z-30 border-x-0 border-b-0 px-4 py-3">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2">
            <p className="type-accent-xs text-soft">
              {selectedCount > 0
                ? `${selectedCount} question${selectedCount === 1 ? "" : "s"} selected`
                : "Tick the questions you want to record"}
            </p>
            <div className="flex items-center gap-2">
              <SiteButton
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedIds(new Set());
                  setSelecting(false);
                }}
              >
                Cancel
              </SiteButton>
              {selectedRecordingIds.length > 0 ? (
                <SiteButton
                  variant="danger"
                  size="sm"
                  onClick={() => deleteLectures(selectedRecordingIds)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Delete ({selectedRecordingIds.length})
                </SiteButton>
              ) : null}
              <SiteButton
                variant="ice"
                size="sm"
                disabled={selectedCount === 0}
                onClick={startSelected}
              >
                <FlaskConical className="h-3.5 w-3.5" aria-hidden />
                Record {selectedCount} {selectedCount === 1 ? "lecture" : "lectures"}
              </SiteButton>
            </div>
          </div>
        </div>
      ) : null}

      <TopicSheet
        item={selectedItem}
        probes={selectedItem ? probesForTopic(probeIndex, selectedItem.id) : []}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        checked={selectedEntry?.checked ?? false}
        status={selectedEntry?.status ?? "pending"}
        notes={selectedEntry?.notes ?? ""}
        boardId={selectedEntry?.boardId}
        recording={
          selectedItem
            ? Object.fromEntries(
                PROBE_DIFFICULTIES.map((difficulty) => {
                  const cell = cellStateFor(
                    lectureStates,
                    selectedItem.id,
                    difficulty,
                    true,
                  );
                  return [
                    difficulty,
                    cell.state === "running" ? cell.boardId : undefined,
                  ];
                }).filter(([, boardId]) => Boolean(boardId)),
              )
            : {}
        }
        onWatchLive={(boardId) => {
          const job = queue.jobs.find((entry) => entry.boardId === boardId);
          openLiveLecture(boardId, {
            title: selectedItem?.text,
            question: job?.question,
          });
        }}
        onCheckedChange={(checked) =>
          selectedItem && setChecked(selectedItem.id, checked)
        }
        onStatusChange={(status) =>
          selectedItem && setStatus(selectedItem.id, status)
        }
        onNotesChange={(notes) =>
          selectedItem && setNotes(selectedItem.id, notes)
        }
        onBoardIdChange={(boardId) =>
          selectedItem && setBoardId(selectedItem.id, boardId)
        }
      />

      <MessageDialog
        open={dialog !== null}
        title={dialog?.title ?? ""}
        description={dialog?.description ?? ""}
        mode={dialog?.mode ?? "notice"}
        confirmLabel={dialog?.confirmLabel}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
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
          liveJob?.status === "complete" ||
          liveJob?.status === "failed" ||
          liveJob?.status === "running"
            ? liveJob.status
            : undefined
        }
        onIntentChange={(next) => {
          if (watchIntent === "live") return;
          if (next === "replay") unlockTutorAudio();
          setWatchIntent(next);
        }}
        onClose={closeWatch}
        onDelete={(boardId) => deleteLectures([boardId])}
      />

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
