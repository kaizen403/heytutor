"use client";

import {
  Settings,
  Gauge,
  Volume2,
  Mic2,
  Captions,
  PenLine,
} from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const MARKER_COLORS = [
  { id: "navy", color: "#1B2A4A", label: "Navy" },
  { id: "black", color: "#222222", label: "Black" },
  { id: "blue", color: "#81A6C6", label: "Blue" },
  { id: "red", color: "#D64545", label: "Red" },
  { id: "green", color: "#4CAF7D", label: "Green" },
  { id: "purple", color: "#9B7ED9", label: "Purple" },
  { id: "orange", color: "#E8913A", label: "Orange" },
] as const;

export type MarkerColorId = (typeof MARKER_COLORS)[number]["id"];

export interface SettingsState {
  speedMultiplier: number;
  audioLanguage: "english" | "hindi";
  accent: "uk" | "us" | "india";
  subtitlesEnabled: boolean;
  subtitleLanguage: "english" | "hindi";
  markerColor: MarkerColorId;
}

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SettingsState;
  onSettingsChange: (settings: SettingsState) => void;
}

const SPEED_MIN = 1;
const SPEED_MAX = 3;
const SPEED_STEP = 0.25;

const theme = {
  darkest: "#659287",
  dark: "#4F7468",
  sage: "#88BDA4",
  mint: "#E6F2DD",
  border: "rgba(101, 146, 135, 0.28)",
  borderSubtle: "rgba(101, 146, 135, 0.18)",
} as const;

function SettingsSection({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border bg-white px-4 py-3.5 shadow-sm"
      style={{ borderColor: theme.border }}
    >
      {children}
    </section>
  );
}

function SectionLabel({
  icon: Icon,
  children,
  comingSoon = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  comingSoon?: boolean;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="inline-flex shrink-0" style={{ color: theme.dark }}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span
          className="text-[0.6875rem] font-semibold uppercase tracking-wider"
          style={{ color: theme.darkest }}
        >
          {children}
        </span>
      </div>
      {comingSoon && <ComingSoonBadge />}
    </div>
  );
}

function ComingSoonBadge() {
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-semibold uppercase leading-none tracking-wide"
      style={{
        backgroundColor: theme.borderSubtle,
        color: theme.dark,
      }}
    >
      Soon
    </span>
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
      className={cn(
        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
        checked
          ? "border-[#659287] bg-[rgba(101,146,135,0.08)] text-[#659287] shadow-sm"
          : "border-[rgba(101,146,135,0.28)] text-[#4F7468] hover:border-[#88BDA4] hover:shadow-sm",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      {label}
    </button>
  );
}

export function getMarkerColorHex(id: MarkerColorId): string {
  return MARKER_COLORS.find((entry) => entry.id === id)?.color ?? "#1B2A4A";
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
            Playback, audio, and board preferences
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-5 pb-6 pt-1">
          <SettingsSection>
            <SectionLabel icon={Gauge}>Playback Speed</SectionLabel>
            <div className="flex h-8 items-center gap-3">
              <input
                type="range"
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={SPEED_STEP}
                value={settings.speedMultiplier}
                onChange={(event) =>
                  update({ speedMultiplier: Number(event.target.value) })
                }
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full accent-[#4F7468]"
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
          </SettingsSection>

          <SettingsSection>
            <SectionLabel icon={Mic2} comingSoon>
              Accent
            </SectionLabel>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["uk", "UK"],
                  ["us", "US"],
                  ["india", "India"],
                ] as const
              ).map(([value, label]) => (
                <SelectPill
                  key={value}
                  label={label}
                  checked={settings.accent === value}
                  disabled
                />
              ))}
            </div>
          </SettingsSection>

          <SettingsSection>
            <SectionLabel icon={Captions} comingSoon>
              Subtitles
            </SectionLabel>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium" style={{ color: theme.darkest }}>
                Enable subtitles
              </span>
              <Switch
                checked={settings.subtitlesEnabled}
                disabled
                onCheckedChange={(checked) =>
                  update({ subtitlesEnabled: checked })
                }
                className="data-[state=checked]:bg-[#659287] data-[state=unchecked]:bg-[rgba(101,146,135,0.35)]"
              />
            </div>
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
                        ? "scale-105 ring-2 ring-[#659287] ring-offset-2 ring-offset-white"
                        : "ring-1 ring-[rgba(101,146,135,0.35)] hover:scale-105",
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
