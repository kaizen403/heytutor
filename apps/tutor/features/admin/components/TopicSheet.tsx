"use client";

import { PlainButton } from "@/components/ui/site-button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { RunCostSessionRow } from "@/lib/obs/runCost";
import { figureCount, type PlaygroundLecture } from "@/lib/admin/playgroundLecture";
import { SYLLABUS_SUBJECT_LABEL, type SyllabusItem } from "../lib/parseSyllabus";
import type { ProbeQuestion, ProbeDifficulty } from "../lib/probes";
import { QuestionTags } from "./QuestionTags";

export function TopicSheet({ item, probes, open, onOpenChange, lectures, onWatch, onNotes, onReview, costsByBoardId }: {
  item: SyllabusItem | null;
  probes: ProbeQuestion[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lectures: Partial<Record<ProbeDifficulty, { boardId: string; lecture: PlaygroundLecture }>>;
  costsByBoardId: Record<string, RunCostSessionRow>;
  onWatch: (boardId: string, question: string) => void;
  onNotes: (boardId: string) => void;
  onReview: (boardId: string, question: string) => void;
}) {
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="right" className="site-theme flex w-full flex-col overflow-y-auto border-l border-stroke bg-ink-900 sm:max-w-lg">
      {item ? <>
        <SheetHeader>
          <SheetTitle className="text-base text-frost">{item.text}</SheetTitle>
          <SheetDescription>{SYLLABUS_SUBJECT_LABEL[item.subject]} · Unit {item.unitNumber}: {item.unitTitle}</SheetDescription>
        </SheetHeader>
        <p className="my-4 text-sm text-soft">Figures drawn: {figureCount(Object.values(lectures).map(entry => entry.lecture))} of {probes.length}</p>
        <ul className="space-y-5">
          {probes.map(probe => {
            const entry = lectures[probe.difficulty];
            return <li key={probe.id} data-topic-sheet-question={probe.difficulty} className="space-y-2 border-b border-stroke pb-4">
              <p className="text-xs text-sky-300">{probe.difficulty}</p>
              <p className="whitespace-pre-wrap text-sm text-frost">{probe.question}</p>
              <QuestionTags lecture={entry?.lecture} cost={entry ? costsByBoardId[entry.boardId] : undefined} />
              {entry?.lecture.state === "complete" ? <div className="flex flex-wrap gap-2">
                <PlainButton onClick={() => onWatch(entry.boardId, probe.question)}>Watch</PlainButton>
                <PlainButton onClick={() => onNotes(entry.boardId)}>Notes</PlainButton>
                <PlainButton onClick={() => onReview(entry.boardId, probe.question)}>Review</PlainButton>
              </div> : null}
            </li>;
          })}
        </ul>
        {!probes.length ? <p className="text-sm text-soft">No question fixtures for this topic yet.</p> : null}
      </> : null}
    </SheetContent>
  </Sheet>;
}
