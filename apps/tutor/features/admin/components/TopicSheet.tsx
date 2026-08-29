"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { PenSpinner } from "@heytutor/whiteboard/pen-spinner";
import { PlainButton, SiteButton } from "@/components/ui/site-button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { createBoard } from "@/lib/boards/boardsClient";
import type { SyllabusItem } from "../lib/parseSyllabus";
import type { ItemStatus } from "../lib/progressStorage";
import { PROBE_DIFFICULTIES, type ProbeDifficulty, type ProbeQuestion } from "../lib/probes";
import { Checkbox } from "./Checkbox";
import { statusLabel } from "./StatusBadge";

interface TopicSheetProps {
  item: SyllabusItem | null;
  probes: ProbeQuestion[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checked: boolean;
  status: ItemStatus;
  notes: string;
  boardId?: string;
  recording?: Partial<Record<ProbeDifficulty, string>>;
  onCheckedChange: (checked: boolean) => void;
  onStatusChange: (status: ItemStatus) => void;
  onNotesChange: (notes: string) => void;
  onBoardIdChange: (boardId: string) => void;
  onWatchLive?: (boardId: string, difficulty: ProbeDifficulty) => void;
}

const STATUS_OPTIONS: ItemStatus[] = ["pending", "accepted", "rejected", "needs-improvement"];

function NotesField({
  notes,
  onNotesChange,
}: {
  notes: string;
  onNotesChange: (notes: string) => void;
}) {
  const [draft, setDraft] = useState(notes);

  return (
    <textarea
      id="topic-notes"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== notes) {
          onNotesChange(draft);
        }
      }}
      placeholder="What worked, what broke, what to fix…"
      rows={5}
      className="w-full resize-y rounded-lg border border-stroke bg-ink-950 px-3 py-2 text-sm text-frost placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900"
    />
  );
}

export function TopicSheet({
  item,
  probes,
  open,
  onOpenChange,
  checked,
  status,
  notes,
  boardId,
  recording = {},
  onCheckedChange,
  onStatusChange,
  onNotesChange,
  onBoardIdChange,
  onWatchLive,
}: TopicSheetProps) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenLiveBoard = async () => {
    if (!item) {
      return;
    }

    if (boardId) {
      window.open(`/c/${boardId}`, "_blank", "noopener,noreferrer");
      return;
    }

    setOpening(true);
    setError(null);

    try {
      const board = await createBoard();
      if (!board) {
        throw new Error("Could not create board");
      }
      onBoardIdChange(board.id);
      window.open(`/c/${board.id}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open live board");
    } finally {
      setOpening(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="site-theme flex w-full flex-col overflow-y-auto border-l border-stroke bg-ink-900 sm:max-w-lg"
      >
        {item ? (
          <>
            <SheetHeader className="space-y-1 px-1 pb-2 pt-2">
              <SheetTitle className="text-base leading-snug text-frost">
                Unit {item.unitNumber}: {item.unitTitle}
              </SheetTitle>
              <SheetDescription className="text-xs text-soft">
                {item.subsection ? `${item.subsection} · ` : ""}
                {item.subject === "physics" ? "Physics" : "Mathematics"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 px-1 pb-6">
              <p className="text-sm leading-relaxed text-frost">{item.text}</p>

              <div className="glass rounded-xl px-4 py-3.5">
                <p className="type-accent-xs mb-3 text-faint">
                  Questions
                </p>
                <ul className="flex flex-col gap-3">
                  {PROBE_DIFFICULTIES.map((difficulty) => {
                    const probe = probes.find((entry) => entry.difficulty === difficulty);
                    const liveBoardId = recording[difficulty];
                    return (
                      <li key={difficulty} data-topic-sheet-question={difficulty}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="type-accent-xs text-sky-300">
                            {difficulty}
                          </p>
                          {liveBoardId && onWatchLive ? (
                            <PlainButton
                              variant="sky"
                              onClick={() => onWatchLive(liveBoardId, difficulty)}
                            >
                              Watch live
                            </PlainButton>
                          ) : null}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-frost">
                          {probe ? probe.question : "No fixture yet"}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="topic-checked"
                  checked={checked}
                  onCheckedChange={onCheckedChange}
                  aria-label="Mark as reviewed"
                />
                <Label htmlFor="topic-checked" className="text-sm font-normal text-frost">
                  Mark as reviewed
                </Label>
              </div>

              <div className="glass rounded-xl px-4 py-3.5">
                <p className="type-accent-xs mb-3 text-faint">
                  Status
                </p>
                <RadioGroup
                  value={status}
                  onValueChange={(value) => onStatusChange(value as ItemStatus)}
                  className="gap-2.5"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <div key={option} className="flex items-center gap-2">
                      <RadioGroupItem value={option} id={`status-${option}`} />
                      <Label htmlFor={`status-${option}`} className="text-sm font-normal text-frost">
                        {statusLabel(option)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="glass rounded-xl px-4 py-3.5">
                <Label htmlFor="topic-notes" className="type-accent-xs mb-2 block text-faint">
                  Notes
                </Label>
                <NotesField key={item.id} notes={notes} onNotesChange={onNotesChange} />
              </div>

              <div className="flex flex-col gap-2">
                <SiteButton
                  variant="ghost"
                  size="md"
                  block
                  disabled={opening}
                  onClick={() => void handleOpenLiveBoard()}
                >
                  {opening ? (
                    <PenSpinner size={16} ink="#C9C9D2" trail={false} />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                  Open live board
                </SiteButton>
                <p className="text-[11px] text-faint">
                  Opens a normal tutor session in a new tab. To record a lecture for this topic,
                  use Select questions on the list.
                </p>
                {error ? <p className="text-xs text-danger">{error}</p> : null}
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
