"use client";

import {
  Settings,
  Gauge,
  Volume2,
  Mic2,
  Captions,
  PenLine,
  Sparkles,
  Zap,
  BookOpen,
  Rabbit,
  FileDown,
} from "lucide-react";

import Link from "next/link";
import { useState } from "react";
import { isSubjectFamiliarity, isTutorAccent, isTutorAudioLanguage, type SubjectFamiliarity } from "@heytutor/tutor-core";
import {
  MarkerStuntPreview,
  STUNT_COPY,
  STUNT_KINDS,
  type StuntKind,
} from "@heytutor/whiteboard";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  getMarkerColorHex,
  LECTURE_FILE_TYPES,
  LECTURE_FILE_TYPE_LABELS,
  MARKER_COLORS,
  SPEED_MAX,
  SPEED_MIN,
  toggleMarkerStunt,
  type SettingsState,
} from "@/lib/account/lessonSettings";
import { cn } from "@/lib/utils";

export {
  DEFAULT_SETTINGS,
  MARKER_COLORS,
  SPEED_MAX,
  SPEED_MIN,
  getMarkerColorHex,
  isMarkerColorId,
  toggleMarkerStunt,
  type MarkerColorId,
  type SettingsState,
} from "@/lib/account/lessonSettings";

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SettingsState;
  onSettingsChange: (settings: SettingsState) => void;
}

const SPEED_STEP = 0.25;

/* The drawer's slice of the palette (app/globals.css). Named by role so a
   palette change lands in the tokens, not here. */
const theme = {
  darkest: "var(--frost)",
  dark: "var(--text-soft)",
  sage: "var(--sky-500)",
  mint: "var(--ink-850)",
  border: "var(--stroke)",
  borderSubtle: "var(--ink-700)",
} as const;

function SettingsSection({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="rounded-xl border bg-ink-850 px-4 py-3.5 shadow-sm"
      style={{ borderColor: theme.border }}
    >
      {children}
    </section>
  );
}

function SectionLabel({
  icon: Icon,
  children,
  note,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex shrink-0" style={{ color: theme.dark }}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span
          className="text-[0.6875rem] font-semibold tracking-[0.01em]"
          style={{ color: theme.darkest }}
        >
          {children}
        </span>
      </div>
      {note ? (
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-medium leading-none"
          style={{ backgroundColor: theme.borderSubtle, color: theme.dark }}
        >
          {note}
        </span>
      ) : null}
    </div>
  );
}

function SelectPill({
  label,
  checked,
  disabled = false,
  onClick,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={checked}
      className={cn(
        "rounded-lg border px-3 py-2 text-xs font-medium transition-all",
        checked
          ? "border-sky-500 bg-sky-500/12 text-sky-200 shadow-sm"
          : "border-stroke text-frost hover:border-sky-500 hover:shadow-sm",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      {label}
    </button>
  );
}

function ToggleRow({
  title,
  hint,
  checked,
  onCheckedChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <span className="block text-xs font-medium" style={{ color: theme.darkest }}>
          {title}
        </span>
        <span className="mt-1 block text-[0.6875rem] leading-4" style={{ color: theme.dark }}>
          {hint}
        </span>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="data-[state=checked]:bg-sky-500 data-[state=unchecked]:bg-ink-600"
      />
    </div>
  );
}

export { isSubjectFamiliarity, isTutorAccent, isTutorAudioLanguage };

// One axis, shared with the chat-bar picker: how familiar the student is with
// the subject. The step count itself comes from the question (see
// `lessonScope.ts`) and this shifts that band one tier, so the hints describe
// the shift rather than an absolute number a proof would blow past anyway.
const FAMILIARITY_OPTIONS: ReadonlyArray<[SubjectFamiliarity, string, string]> = [
  ["new", "New", "Not learned yet, so teach it fully"],
  ["normal", "Normal", "Rusty, so give the usual lesson"],
  ["revision", "Revision", "Known already, so refresh only"],
];

/**
 * Pick the tricks, and watch the one you are picking.
 *
 * A list of four with a showcase beside it, rather than a switch, because the
 * names alone do not tell a student what a knuckle roll looks like on their
 * board. Touching a row shows it; the checkbox is what turns it on. The
 * showcase follows hover and keyboard focus too, so it can be browsed without
 * changing the selection.
 */
function MarkerStuntPicker({
  selected,
  ink,
  onToggle,
}: {
  selected: readonly StuntKind[];
  ink: string;
  onToggle: (kind: StuntKind) => void;
}) {
  const [showing, setShowing] = useState<StuntKind>(selected[0] ?? STUNT_KINDS[0]!);
  const copy = STUNT_COPY[showing];

  return (
    <div className="flex gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {STUNT_KINDS.map((kind) => {
          const checked = selected.includes(kind);
          return (
            <button
              key={kind}
              type="button"
              role="switch"
              aria-checked={checked}
              onClick={() => {
                setShowing(kind);
                onToggle(kind);
              }}
              onMouseEnter={() => setShowing(kind)}
              onFocus={() => setShowing(kind)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-all",
                checked
                  ? "border-sky-500 bg-sky-500/12 text-sky-200"
                  : "border-stroke text-frost hover:border-sky-500",
                showing === kind ? "ring-1 ring-sky-500/40" : "",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border text-[9px] leading-none",
                  checked ? "border-sky-400 bg-sky-500 text-ink-850" : "border-stroke",
                )}
              >
                {checked ? "✓" : ""}
              </span>
              <span className="truncate">{STUNT_COPY[kind].label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex w-[124px] shrink-0 flex-col gap-1.5">
        <MarkerStuntPreview
          kind={showing}
          size={124}
          ink={ink}
          label={`${copy.label}: ${copy.caption}`}
        />
        <p className="text-[0.625rem] leading-3.5" style={{ color: theme.dark }}>
          {copy.caption}
        </p>
      </div>
    </div>
  );
}

export function SettingsDrawer({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
}: SettingsDrawerProps) {
  const update = (partial: Partial<SettingsState>) => {
    onSettingsChange({ ...settings, ...partial });
  };

  // Hindi ships as a single voice, so the accent choice only applies to English.
  const accentApplies = settings.audioLanguage === "english";
  const familiarityHint = FAMILIARITY_OPTIONS.find(([id]) => id === settings.familiarity)?.[2];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[min(100%,24rem)] flex-col overflow-y-auto border-l sm:max-w-sm"
        style={{ borderColor: theme.border }}
      >
        <SheetHeader className="shrink-0 space-y-1 px-5 pb-2 pr-12 pt-5">
          <SheetTitle
            className="flex items-center gap-2 text-base"
            style={{ color: theme.darkest }}
          >
            <Settings className="h-4 w-4" style={{ color: theme.dark }} />
            Settings
          </SheetTitle>
          <SheetDescription className="text-xs" style={{ color: theme.sage }}>
            Quick lesson sheet. Full account settings live at{" "}
            <Link href="/settings" className="text-sky-300 underline-offset-2 hover:underline">
              /settings
            </Link>
            .
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-6 pt-1">
          <SettingsSection>
            <SectionLabel icon={Zap}>Fast mode</SectionLabel>
            <ToggleRow
              title="Use Fireworks Fast serving"
              hint="On by default. Planners use Kimi K3 Fast; teaching uses GLM 5.3 Fast. Turn off to stay on standard Kimi K3 and GLM 5.3 Flash."
              checked={settings.fastMode}
              onCheckedChange={(checked) => update({ fastMode: checked })}
            />
          </SettingsSection>

          <SettingsSection>
            <SectionLabel icon={BookOpen} note={familiarityHint}>
              Default familiarity
            </SectionLabel>
            <div className="flex flex-wrap gap-2">
              {FAMILIARITY_OPTIONS.map(([value, label]) => (
                <SelectPill
                  key={value}
                  label={label}
                  checked={settings.familiarity === value}
                  onClick={() => update({ familiarity: value })}
                />
              ))}
            </div>
            <p className="mt-2 text-[0.6875rem] leading-4" style={{ color: theme.dark }}>
              Familiarity: where every new question starts. Change it per question
              with Select Familiarity in the chat bar. It says how well you know the topic, not how
              hard the problem is, so New means the subject is new to you and the tutor assumes
              less and works through more. Every setting still states the givens, the formula, and
              what the answer means.
            </p>
          </SettingsSection>

          <SettingsSection>
            <SectionLabel icon={Gauge}>Playback Speed</SectionLabel>
            <div className="flex h-8 items-center gap-3">
              <input
                type="range"
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={SPEED_STEP}
                value={settings.speedMultiplier}
                onChange={(event) => update({ speedMultiplier: Number(event.target.value) })}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full accent-sky-500"
                style={{ backgroundColor: theme.borderSubtle }}
              />
              <span
                className="flex h-8 w-10 shrink-0 items-center justify-end text-xs font-semibold tabular-nums"
                style={{ color: theme.darkest }}
              >
                {settings.speedMultiplier}x
              </span>
            </div>
          </SettingsSection>

          <SettingsSection>
            <SectionLabel icon={Volume2}>Audio Language</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <SelectPill
                label="English"
                checked={settings.audioLanguage === "english"}
                onClick={() => update({ audioLanguage: "english" })}
              />
              <SelectPill
                label="Hindi"
                checked={settings.audioLanguage === "hindi"}
                onClick={() => update({ audioLanguage: "hindi" })}
              />
            </div>
            <p className="mt-2 text-[0.6875rem] leading-4" style={{ color: theme.dark }}>
              Changes the speaking voice. Lessons are still written and taught in English.
            </p>
          </SettingsSection>

          <SettingsSection>
            <SectionLabel icon={Mic2} note={accentApplies ? undefined : "English only"}>
              Accent
            </SectionLabel>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["india", "India"],
                  ["uk", "UK"],
                  ["us", "US"],
                ] as const
              ).map(([value, label]) => (
                <SelectPill
                  key={value}
                  label={label}
                  checked={accentApplies && settings.accent === value}
                  disabled={!accentApplies}
                  onClick={() => update({ accent: value })}
                />
              ))}
            </div>
          </SettingsSection>

          <SettingsSection>
            <SectionLabel icon={Volume2}>Narration</SectionLabel>
            <ToggleRow
              title="Speak the lesson out loud"
              hint="Off keeps the board writing in sync but stays silent, useful in a shared room."
              checked={settings.narrationEnabled}
              onCheckedChange={(checked) => update({ narrationEnabled: checked })}
            />
          </SettingsSection>

          <SettingsSection>
            <SectionLabel icon={Rabbit}>Voice quality</SectionLabel>
            <div className="flex flex-wrap gap-2">
              <SelectPill
                label="Natural"
                checked={!settings.lowLatencyVoice}
                onClick={() => update({ lowLatencyVoice: false })}
              />
              <SelectPill
                label="Low latency"
                checked={settings.lowLatencyVoice}
                onClick={() => update({ lowLatencyVoice: true })}
              />
            </div>
            <p className="mt-2 text-[0.6875rem] leading-4" style={{ color: theme.dark }}>
              Low latency starts speaking sooner with a slightly flatter voice. Takes effect on the
              next question.
            </p>
          </SettingsSection>

          <SettingsSection>
            <SectionLabel icon={Captions}>Subtitles</SectionLabel>
            <ToggleRow
              title="Show subtitles on the board"
              hint="Off by default. Captions the tutor&rsquo;s narration under the board while it teaches."
              checked={settings.subtitlesEnabled}
              onCheckedChange={(checked) => update({ subtitlesEnabled: checked })}
            />
          </SettingsSection>

          <SettingsSection>
            <SectionLabel
              icon={Sparkles}
              note={
                settings.markerStunts.length === 0
                  ? "None"
                  : `${settings.markerStunts.length} of ${STUNT_KINDS.length}`
              }
            >
              Marker Stunts
            </SectionLabel>
            <MarkerStuntPicker
              selected={settings.markerStunts}
              ink={getMarkerColorHex(settings.markerColor)}
              onToggle={(kind) =>
                update({ markerStunts: toggleMarkerStunt(settings.markerStunts, kind) })
              }
            />
            <p className="mt-2 text-[0.6875rem] leading-4" style={{ color: theme.dark }}>
              Tricks the hand plays in the gaps between strokes, while the tutor is talking. Pick
              the ones you want and the board plays only those. The marker stays where it is
              standing and never leaves the board.
            </p>
          </SettingsSection>

          <SettingsSection>
            <SectionLabel icon={PenLine}>Marker Color</SectionLabel>
            <div className="flex flex-wrap gap-2.5">
              {MARKER_COLORS.map(({ id, color, label }) => {
                const selected = settings.markerColor === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-label={label}
                    title={label}
                    onClick={() => update({ markerColor: id })}
                    className={[
                      "h-10 w-10 rounded-full transition-all",
                      selected
                        ? "scale-105 ring-2 ring-sky-500 ring-offset-2 ring-offset-ink-850"
                        : "ring-1 ring-stroke hover:scale-105",
                    ].join(" ")}
                    style={{ backgroundColor: color }}
                  />
                );
              })}
            </div>
          </SettingsSection>

          <SettingsSection>
            <SectionLabel icon={FileDown}>Lecture file type</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {LECTURE_FILE_TYPES.map((value) => (
                <SelectPill
                  key={value}
                  label={LECTURE_FILE_TYPE_LABELS[value]}
                  checked={settings.lectureFileType === value}
                  onClick={() => update({ lectureFileType: value })}
                />
              ))}
            </div>
            <p className="mt-2 text-[0.6875rem] leading-4" style={{ color: theme.dark }}>
              The format of Lecture download. MP4 is the default. Switch to WebM if a player will
              not open the file.
            </p>
          </SettingsSection>
        </div>
      </SheetContent>
    </Sheet>
  );
}
