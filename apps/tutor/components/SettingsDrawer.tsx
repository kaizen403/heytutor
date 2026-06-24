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
import { Separator } from "@/components/ui/separator";

export const MARKER_COLORS = [
  { id: "blue", color: "#81A6C6", label: "Blue" },
  { id: "black", color: "#222222", label: "Black" },
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
const SPEED_STEP = 0.5;

function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 pb-1.5 pt-1">
      <Icon className="h-3.5 w-3.5 text-[#77B0AA]" />
      <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-[#77B0AA]">
        {children}
      </span>
    </div>
  );
}

function ComingSoonChip() {
  return (
    <span className="absolute -right-1 -top-1.5 rounded-full bg-[rgba(119,176,170,0.18)] px-1.5 py-0.5 text-[0.5rem] font-semibold uppercase leading-none tracking-wide text-[#77B0AA]">
      soon
    </span>
  );
}

function SelectPill({
  label,
  checked,
  disabled = false,
  comingSoon = false,
  onClick,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  comingSoon?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "relative rounded-md border px-2.5 py-1 text-xs transition-all",
        checked
          ? "border-[#77B0AA] bg-[rgba(119,176,170,0.14)] text-[#C4E8DE]"
          : "border-[rgba(119,176,170,0.15)] text-[#9BC4BE] hover:border-[rgba(119,176,170,0.3)]",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      ].join(" ")}
    >
      {label}
      {comingSoon && <ComingSoonChip />}
    </button>
  );
}

export function getMarkerColorHex(id: MarkerColorId): string {
  return MARKER_COLORS.find((entry) => entry.id === id)?.color ?? "#81A6C6";
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
      <SheetContent side="right" className="w-[300px] sm:max-w-[300px]">
        <SheetHeader className="px-5 pt-5 pb-1">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4 text-[#77B0AA]" />
            Settings
          </SheetTitle>
          <SheetDescription className="text-xs">
            Playback, audio, and board preferences
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-0 px-5 pb-5 pt-2 overflow-y-auto">
          <SectionLabel icon={Gauge}>Playback Speed</SectionLabel>
          <div className="flex items-center gap-3 py-1">
            <input
              type="range"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={SPEED_STEP}
              value={settings.speedMultiplier}
              onChange={(event) =>
                update({ speedMultiplier: Number(event.target.value) })
              }
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[rgba(119,176,170,0.2)] accent-[#77B0AA]"
            />
            <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-[#C4E8DE]">
              {settings.speedMultiplier}x
            </span>
          </div>

          <Separator className="my-2.5" />

          <SectionLabel icon={Volume2}>Audio Language</SectionLabel>
          <div className="flex flex-wrap gap-1.5 py-1">
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

          <Separator className="my-2.5" />

          <SectionLabel icon={Mic2}>Accent</SectionLabel>
          <div className="flex flex-wrap gap-1.5 py-1">
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
                comingSoon
              />
            ))}
          </div>

          <Separator className="my-2.5" />

          <SectionLabel icon={Captions}>Subtitles</SectionLabel>
          <div className="relative flex items-center justify-between rounded-md border border-[rgba(119,176,170,0.15)] px-2.5 py-2">
            <span className="text-xs text-[#C4E8DE]">Enable subtitles</span>
            <Switch
              checked={settings.subtitlesEnabled}
              disabled
              onCheckedChange={(checked) =>
                update({ subtitlesEnabled: checked })
              }
            />
            <ComingSoonChip />
          </div>

          <Separator className="my-2.5" />

          <SectionLabel icon={PenLine}>Marker Color</SectionLabel>
          <div className="flex flex-wrap gap-2 py-1">
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
                    "h-7 w-7 rounded-full border-2 transition-transform",
                    selected
                      ? "scale-110 border-[#C4E8DE]"
                      : "border-transparent hover:scale-105",
                  ].join(" ")}
                  style={{ backgroundColor: color }}
                />
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
