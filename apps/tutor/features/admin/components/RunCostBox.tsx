"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCharCount, formatTokenCount, formatUsd, type RunCostApiPayload, type RunCostReport } from "@/lib/obs/runCost";

const KIND_LABELS: Record<string, string> = {
  "fireworks-llm": "Teaching",
  "turn-plan-v3": "Turn plan",
  "problem-ir-v1": "Problem IR",
  "scene-planner-v2": "Scene",
  "code-lesson-v1": "Code lesson",
  "notes-chat-llm": "Notes",
  "tts-segment": "Voice",
  "qwen-vision": "Photo OCR",
  "extract-question": "Photo OCR",
};

interface RunCostBoxProps {
  busy: boolean;
  lectureCount: number;
  titlesBySession: Record<string, string>;
  data: RunCostApiPayload | null;
  loading: boolean;
  error: string | null;
}

function kindLabel(name: string): string {
  return KIND_LABELS[name] ?? name;
}

function statusCopy(options: {
  busy: boolean;
  configured: boolean;
  error: string | null;
  observations: number;
  loading: boolean;
}): string {
  if (!options.configured) return "Langfuse is not configured";
  if (options.error === "langfuse_unavailable") return "Langfuse unreachable";
  if (options.error === "unauthorized") return "Admin only";
  if (options.observations === 0) {
    return options.busy || options.loading ? "Waiting for traces" : "No traces yet";
  }
  return options.busy ? "Live" : "From Langfuse";
}

function shareWidth(part: number, total: number): string {
  if (total <= 0 || part <= 0) return "0%";
  return `${Math.max(6, Math.round((part / total) * 100))}%`;
}

function CostLine({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="min-w-0 truncate type-accent-xs text-soft">
        {label}
        <span className="ml-1.5 text-faint">{hint}</span>
      </p>
      <p className="shrink-0 tabular-nums text-xs text-frost">{value}</p>
    </div>
  );
}

export function RunCostBox({
  busy,
  lectureCount,
  titlesBySession,
  data,
  loading,
  error,
}: RunCostBoxProps) {
  const [open, setOpen] = useState(false);
  const report: RunCostReport | undefined = data?.report;
  const totals = report?.totals;
  const observations = totals?.observations ?? 0;
  const configured = data?.configured ?? true;
  const status = statusCopy({
    busy,
    configured,
    error: error ?? data?.error ?? null,
    observations,
    loading,
  });

  const llmHint = totals
    ? `${formatTokenCount(totals.inputTokens)} in · ${formatTokenCount(totals.outputTokens)} out`
    : "—";
  const voiceHint = totals ? `${formatCharCount(totals.characters)} chars` : "—";
  const cartesiaRate = data?.pricing.tts.find((row) => row.lane === "cartesia")?.usdPer1kChars;
  const flashRate = data?.pricing.tts.find((row) => row.lane === "flash")?.usdPer1kChars;
  const multiRate = data?.pricing.tts.find((row) => row.lane === "multilingual")?.usdPer1kChars;

  const sessionRows = useMemo(() => {
    if (!report) return [];
    return report.bySession.map((row) => ({
      ...row,
      title: titlesBySession[row.sessionId] ?? row.sessionId.slice(0, 8),
    }));
  }, [report, titlesBySession]);

  return (
    <div className={cn("glass rounded-xl", busy && "glass-sky")}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="type-accent-xs text-faint">{status}</p>
          <p className="mt-1 text-[15px] font-medium tracking-[-0.02em] text-frost">
            Cost
            <span className="ml-2 tabular-nums text-sky-200">
              {formatUsd(totals?.totalUsd ?? 0)}
            </span>
          </p>
        </div>
        <p className="type-accent-xs text-faint">
          {lectureCount} lecture{lectureCount === 1 ? "" : "s"}
          {totals && totals.traces > 0 ? ` · ${totals.traces} traces` : ""}
        </p>
      </div>

      <div className="space-y-1.5 border-t border-stroke px-3 py-2.5">
        <CostLine label="AI" value={formatUsd(totals?.llmUsd ?? 0)} hint={llmHint} />
        <CostLine label="Voice" value={formatUsd(totals?.ttsUsd ?? 0)} hint={voiceHint} />
        {totals && totals.totalUsd > 0 ? (
          <div className="flex h-1 overflow-hidden rounded-full bg-ink-700">
            <div
              className="h-full bg-sky-500/80"
              style={{ width: shareWidth(totals.llmUsd, totals.totalUsd) }}
            />
            <div
              className="h-full bg-frost/35"
              style={{ width: shareWidth(totals.ttsUsd, totals.totalUsd) }}
            />
          </div>
        ) : null}
      </div>

      <div className="border-t border-stroke px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left type-accent-xs text-faint transition-colors hover:text-frost"
          aria-expanded={open}
        >
          Details
          <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {open ? (
          <div className="space-y-3 px-1.5 pb-2 pt-1">
            <ul className="space-y-1">
              {(report?.byKind ?? []).map((row) => (
                <li key={row.name} className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate type-accent-xs text-soft">
                    {kindLabel(row.name)}
                    <span className="ml-1.5 text-faint">
                      {row.stream === "tts"
                        ? `${formatCharCount(row.characters)} chars`
                        : `${formatTokenCount(row.inputTokens + row.outputTokens)} tok`}
                    </span>
                  </p>
                  <p className="shrink-0 tabular-nums type-accent-xs text-frost">{formatUsd(row.usd)}</p>
                </li>
              ))}
              {(report?.byKind.length ?? 0) === 0 ? (
                <li className="type-accent-xs text-faint">
                  Planner, teaching, and voice spans land here after Langfuse ingests the run.
                </li>
              ) : null}
            </ul>

            {sessionRows.length > 1 ? (
              <ul className="space-y-1 border-t border-stroke pt-2">
                {sessionRows.map((row) => (
                  <li key={row.sessionId} className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate type-accent-xs text-soft">{row.title}</p>
                    <p className="shrink-0 tabular-nums type-accent-xs text-frost">
                      {formatUsd(row.totalUsd)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="type-accent-xs leading-relaxed text-faint">
              AI is Fireworks serverless. Voice uses the selected speech provider
              {cartesiaRate != null ? `. Cartesia estimate ${formatUsd(cartesiaRate)} / 1k chars` : ""}
              {flashRate != null && multiRate != null
                ? `. Flash ${formatUsd(flashRate)} / 1k chars, Multilingual ${formatUsd(multiRate)} / 1k chars`
                : ""}
              .
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
