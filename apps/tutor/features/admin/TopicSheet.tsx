"use client";

import { useState } from "react";
import { ExternalLink, FlaskConical, Loader2 } from "lucide-react";
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
import { resolveApiUrl } from "@heytutor/tutor-core";
import type { SyllabusItem } from "./parseSyllabus";
import type { ItemStatus } from "./progressStorage";
import { statusLabel } from "./StatusBadge";

interface TopicSheetProps {
  item: SyllabusItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checked: boolean;
  status: ItemStatus;
  notes: string;
  boardId?: string;
  onCheckedChange: (checked: boolean) => void;
  onStatusChange: (status: ItemStatus) => void;
  onNotesChange: (notes: string) => void;
  onBoardIdChange: (boardId: string) => void;
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
      className="w-full resize-y rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
    />
  );
}

export function TopicSheet({
  item,
  open,
  onOpenChange,
  checked,
  status,
  notes,
  boardId,
  onCheckedChange,
  onStatusChange,
  onNotesChange,
  onBoardIdChange,
}: TopicSheetProps) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateBoard = async () => {
    if (!item) {
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const title = `[Playground] Unit ${item.unitNumber}: ${item.unitTitle} — ${item.text}`;
      const res = await fetch(resolveApiUrl("/api/boards"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });

      if (!res.ok) {
        throw new Error(`Failed to create board (${res.status})`);
      }

      const data = (await res.json()) as { board?: { id: string } };
      const id = data.board?.id;

      if (!id) {
        throw new Error("Board response missing id");
      }

      onBoardIdChange(id);
      window.open(`/c/${id}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create board");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l sm:max-w-md" style={{ borderColor: "#E5E7EB" }}>
        {item ? (
          <>
            <SheetHeader className="space-y-1 px-1 pb-2 pt-2">
              <SheetTitle className="text-base leading-snug text-[#111827]">
                Unit {item.unitNumber}: {item.unitTitle}
              </SheetTitle>
              <SheetDescription className="text-xs text-[#6B7280]">
                {item.subsection ? `${item.subsection} · ` : ""}
                {item.subject === "physics" ? "Physics" : "Mathematics"}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 overflow-y-auto px-1 pb-6">
              <p className="text-sm leading-relaxed text-[#111827]">{item.text}</p>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="topic-checked"
                  checked={checked}
                  onChange={(event) => onCheckedChange(event.target.checked)}
                  className="h-4 w-4 rounded border-[#E5E7EB] accent-[#2563EB]"
                />
                <Label htmlFor="topic-checked" className="text-sm font-normal">
                  Mark as reviewed
                </Label>
              </div>

              <div className="rounded-xl border bg-white px-4 py-3.5 shadow-sm" style={{ borderColor: "#E5E7EB" }}>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
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
                      <Label htmlFor={`status-${option}`} className="text-sm font-normal">
                        {statusLabel(option)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="rounded-xl border bg-white px-4 py-3.5 shadow-sm" style={{ borderColor: "#E5E7EB" }}>
                <Label htmlFor="topic-notes" className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                  Notes
                </Label>
                <NotesField key={item.id} notes={notes} onNotesChange={onNotesChange} />
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  onClick={() => void handleCreateBoard()}
                  disabled={creating}
                  className="w-full gap-2"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FlaskConical className="h-4 w-4" />
                  )}
                  Create test board
                </Button>

                {boardId ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => window.open(`/c/${boardId}`, "_blank", "noopener,noreferrer")}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Reopen last board
                  </Button>
                ) : null}

                {error ? <p className="text-xs text-[#DC2626]">{error}</p> : null}
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
