"use client";

import {
  Settings,
  Gauge,
  Volume2,
  Mic2,
  Captions,
  PenLine,
  Zap,
  BookOpen,
  Rabbit,
} from "lucide-react";

import {
  DEFAULT_ACCENT,
  DEFAULT_AUDIO_LANGUAGE,
  DEFAULT_FAMILIARITY,
  isSubjectFamiliarity,
  isTutorAccent,
  isTutorAudioLanguage,
  type SubjectFamiliarity,
  type TutorAccent,
  type TutorAudioLanguage,
} from "@heytutor/tutor-core";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Marker ink, not UI chrome. These are painted onto the white writing surface,
 * so they are chosen for contrast against paper rather than against the navy —
 * the one place in the app that is deliberately off the Night Blueprint ramp.
 * Navy and blue are the palette's own inks; the rest are the physical set.
 */
export const MARKER_COLORS = [
  { id: "navy", color: "#1B2A4A", label: "Navy" },
  { id: "black", color: "#222222", label: "Black" },
  { id: "blue", color: "#3E8FB4", label: "Blue" },
  { id: "red", color: "#D64545", label: "Red" },
  { id: "green", color: "#4CAF7D", label: "Green" },
  { id: "purple", color: "#9B7ED9", label: "Purple" },
  { id: "orange", color: "#E8913A", label: "Orange" },
] as const;

export type MarkerColorId = (typeof MARKER_COLORS)[number]["id"];

export interface SettingsState {
  speedMultiplier: number;
  fastMode: boolean;
  /**
   * Default familiarity for a new question. The chat-bar picker overrides it
   * per question; this is only where each question starts.
   */
  familiarity: SubjectFamiliarity;
  audioLanguage: TutorAudioLanguage;
  accent: TutorAccent;
  /** Off keeps the lesson writing and stays silent. */
  narrationEnabled: boolean;
  /** Trade voice quality for faster first audio. */
  lowLatencyVoice: boolean;
  subtitlesEnabled: boolean;
  markerColor: MarkerColorId;
}

export const DEFAULT_SETTINGS: Omit<SettingsState, "speedMultiplier"> = {
  fastMode: true,
  familiarity: DEFAULT_FAMILIARITY,
  audioLanguage: DEFAULT_AUDIO_LANGUAGE,
  accent: DEFAULT_ACCENT,
  narrationEnabled: true,
  lowLatencyVoice: false,
  subtitlesEnabled: false,
  markerColor: "navy",
};

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SettingsState;
  onSettingsChange: (settings: SettingsState) => void;
}

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 3;
const SPEED_STEP = 0.25;

/* The drawer's slice of Night Blueprint (app/globals.css). Named by role so a
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
        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
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

export function getMarkerColorHex(id: MarkerColorId): string {
  return MARKER_COLORS.find((entry) => entry.id === id)?.color ?? "#1B2A4A";
}

export function isMarkerColorId(value: unknown): value is MarkerColorId {
  return typeof value === "string" && MARKER_COLORS.some((entry) => entry.id === value);
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
      <SheetContent side="right" className="border-l" style={{ borderColor: theme.border }}>
        <SheetHeader className="space-y-1 px-5 pb-2 pt-5">
          <SheetTitle
            className="flex items-center gap-2 text-base"
            style={{ color: theme.darkest }}
          >
            <Settings className="h-4 w-4" style={{ color: theme.dark }} />
            Settings
          </SheetTitle>
          <SheetDescription className="text-xs" style={{ color: theme.sage }}>
            Playback, model, audio, and board preferences
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-5 pb-6 pt-1">
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
                      "h-8 w-8 rounded-full transition-all",
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
