"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      className="w-full resize-y rounded-md border border-[#2E2E33] bg-[#0B0B0C] px-3 py-2 text-sm text-[#F2F2F4] placeholder:text-[#717177] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9C9D2] focus-visible:ring-offset-2 focus-visible:ring-offset-[#151517]"
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
        className="flex w-full flex-col overflow-y-auto border-l border-[#2E2E33] sm:max-w-lg"
      >
        {item ? (
          <>
            <SheetHeader className="space-y-1 px-1 pb-2 pt-2">
              <SheetTitle className="text-base leading-snug text-[#F2F2F4]">
                Unit {item.unitNumber}: {item.unitTitle}
              </SheetTitle>
              <SheetDescription className="text-xs text-[#A6A6AE]">
                {item.subsection ? `${item.subsection} · ` : ""}
                {item.subject === "physics" ? "Physics" : "Mathematics"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 px-1 pb-6">
              <p className="text-sm leading-relaxed text-[#F2F2F4]">{item.text}</p>

              <div className="rounded-xl border border-[#2E2E33] bg-[#151517] px-4 py-3.5">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#A6A6AE]">
                  Questions
                </p>
                <ul className="flex flex-col gap-3">
                  {PROBE_DIFFICULTIES.map((difficulty) => {
                    const probe = probes.find((entry) => entry.difficulty === difficulty);
                    const liveBoardId = recording[difficulty];
                    return (
                      <li key={difficulty} data-topic-sheet-question={difficulty}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-[#C9C9D2]">
                            {difficulty}
                          </p>
                          {liveBoardId && onWatchLive ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => onWatchLive(liveBoardId, difficulty)}
                            >
                              Watch Live
                            </Button>
                          ) : null}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#F2F2F4]">
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
                <Label htmlFor="topic-checked" className="text-sm font-normal text-[#F2F2F4]">
                  Mark as reviewed
                </Label>
              </div>

              <div className="rounded-xl border border-[#2E2E33] bg-[#151517] px-4 py-3.5">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#A6A6AE]">
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
                      <Label htmlFor={`status-${option}`} className="text-sm font-normal text-[#F2F2F4]">
                        {statusLabel(option)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="rounded-xl border border-[#2E2E33] bg-[#151517] px-4 py-3.5">
                <Label htmlFor="topic-notes" className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#A6A6AE]">
                  Notes
                </Label>
                <NotesField key={item.id} notes={notes} onNotesChange={onNotesChange} />
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  disabled={opening}
                  onClick={() => void handleOpenLiveBoard()}
                >
                  {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Open live board
                </Button>
                <p className="text-[11px] text-[#717177]">
                  Record lectures with Play on the list. This opens a normal tutor session.
                </p>
                {error ? <p className="text-xs text-[#E06858]">{error}</p> : null}
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
