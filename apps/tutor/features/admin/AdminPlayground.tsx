"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Download, FlaskConical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Checkbox } from "./Checkbox";
import { countItems, flattenItems, type SyllabusItem, type SyllabusSubject, type SyllabusTree } from "./parseSyllabus";
import { StatusBadge } from "./StatusBadge";
import { TopicSheet } from "./TopicSheet";
import { useSyllabusProgress } from "./useSyllabusProgress";

interface AdminPlaygroundProps {
  tree: SyllabusTree;
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

export function AdminPlayground({ tree }: AdminPlaygroundProps) {
  const { progress, get, setChecked, setStatus, setNotes, setBoardId, resetAll, exportJson } =
    useSyllabusProgress();

  const [subject, setSubject] = useState<SyllabusSubject>("physics");
  const [selectedItem, setSelectedItem] = useState<SyllabusItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const stats = useMemo(() => computeStats(tree, progress), [tree, progress]);
  const units = tree.subjects[subject];

  const openItem = (item: SyllabusItem) => {
    setSelectedItem(item);
    setSheetOpen(true);
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

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      style={{ background: "var(--wb-bg)" }}
    >
      <div className="shrink-0 px-4 pt-4 pb-2">
        <header className="rounded-2xl border border-white/70 bg-white/90 px-4 py-3 shadow-[0_8px_30px_-18px_rgba(37,99,235,0.35)] backdrop-blur-md">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-[#EDF3FD] text-[#2563EB]">
                <FlaskConical className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div>
                <h1 className="text-base font-semibold text-[#111827]">Syllabus Playground</h1>
                <p className="text-xs text-[#6B7280]">
                  JEE Main checklist · {countItems(tree)} topics · {stats.checked}/{stats.total} reviewed
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#EDF3FD] px-2 py-0.5 text-[11px] font-medium text-[#2563EB]">
                {stats.accepted} accepted
              </span>
              <span className="rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[11px] font-medium text-[#DC2626]">
                {stats.rejected} rejected
              </span>
              <span className="rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-medium text-[#D97706]">
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
                className="gap-1.5 text-[#6B7280]"
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
                  ? "bg-[#2563EB] text-white"
                  : "border border-[#E5E7EB] bg-white text-[#111827] hover:bg-[#EDF3FD] hover:text-[#2563EB]",
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

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {units.map((unit) => {
            const { accepted, total } = unitProgress(unit.items, progress);

            return (
              <section
                key={`${unit.subject}-${unit.number}`}
                className="animate-wb-fade-in rounded-xl border bg-white px-4 py-3.5 shadow-sm"
                style={{ borderColor: "#E5E7EB" }}
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold text-[#111827]">
                      Unit {unit.number}: {unit.title}
                    </h2>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {unit.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-[#EDF3FD] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#2563EB]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="text-xs text-[#6B7280]">
                    {accepted}/{total} accepted
                  </span>
                </div>

                <ul className="flex flex-col gap-1">
                  {unit.items.map((item, index) => {
                    const entry = get(item.id);
                    const showSubsection =
                      item.subsection &&
                      (index === 0 || unit.items[index - 1]?.subsection !== item.subsection);

                    return (
                      <li key={item.id}>
                        {showSubsection ? (
                          <p className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                            {item.subsection}
                          </p>
                        ) : null}
                        <div
                          className={cn(
                            "group flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-[#EDF3FD]/60",
                            entry.checked && "bg-[#EDF3FD]/30",
                          )}
                        >
                          <Checkbox
                            checked={entry.checked}
                            onCheckedChange={(checked) => setChecked(item.id, checked)}
                            className="mt-0.5"
                          />
                          <button
                            type="button"
                            onClick={() => openItem(item)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="text-sm leading-snug text-[#111827]">{item.text}</span>
                          </button>
                          <StatusBadge status={entry.status} />
                          <button
                            type="button"
                            onClick={() => openItem(item)}
                            aria-label="Open topic details"
                            className="shrink-0 rounded-md p-1 text-[#9CA3AF] opacity-0 transition-opacity hover:bg-white hover:text-[#2563EB] group-hover:opacity-100"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </main>

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
    </div>
  );
}
