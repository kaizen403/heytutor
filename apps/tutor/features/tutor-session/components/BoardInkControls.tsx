"use client";

import { instrumentInkStyle } from "@heytutor/whiteboard";
import {
  getMarkerColorHex,
  INK_THICKNESS_MAX,
  INK_THICKNESS_MIN,
  INK_THICKNESS_STEP,
  MARKER_COLORS,
  type SettingsState,
} from "@/lib/account/lessonSettings";

type BoardInkSettings = Pick<
  SettingsState,
  "markerColor" | "pencilColor" | "markerThickness" | "pencilThickness"
>;

interface BoardInkControlsProps {
  settings: BoardInkSettings;
  onChange: (patch: Partial<BoardInkSettings>) => void;
}

export function BoardInkControls({ settings, onChange }: BoardInkControlsProps) {
  return (
    <div className="space-y-4">
      {(["marker", "pencil"] as const).map((instrument) => {
        const isPencil = instrument === "pencil";
        const colorKey = isPencil ? "pencilColor" : "markerColor";
        const thicknessKey = isPencil ? "pencilThickness" : "markerThickness";
        const color = settings[colorKey];
        const thickness = settings[thicknessKey];
        const ink = instrumentInkStyle(isPencil ? "pencil" : "pen", getMarkerColorHex(settings.markerColor), {
          pencilColor: getMarkerColorHex(settings.pencilColor),
          markerThickness: settings.markerThickness,
          pencilThickness: settings.pencilThickness,
        });
        const label = isPencil ? "Pencil" : "Marker";

        return (
          <fieldset key={instrument} className="space-y-2.5">
            <legend className="text-xs font-semibold text-frost">{label}</legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label={`${label} color`}>
              {MARKER_COLORS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-label={`${label} ${option.label}`}
                  aria-pressed={color === option.id}
                  title={`${label} ${option.label}`}
                  onClick={() => onChange(isPencil ? { pencilColor: option.id } : { markerColor: option.id })}
                  className={`h-8 w-8 rounded-full border border-white/20 transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${
                    color === option.id ? "ring-2 ring-sky-400 ring-offset-2 ring-offset-ink-850" : ""
                  }`}
                  style={{ backgroundColor: option.color }}
                />
              ))}
            </div>
            <label className="flex items-center gap-3 text-xs text-frost">
              <span className="w-16 shrink-0">Thickness</span>
              <input
                type="range"
                min={INK_THICKNESS_MIN}
                max={INK_THICKNESS_MAX}
                step={INK_THICKNESS_STEP}
                value={thickness}
                aria-label={`${label} thickness`}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  onChange(isPencil ? { pencilThickness: value } : { markerThickness: value });
                }}
                className="min-w-0 flex-1 accent-sky-500"
              />
              <output className="w-10 shrink-0 text-right tabular-nums">{thickness.toFixed(1)}×</output>
            </label>
            <div className="flex h-4 items-center" aria-hidden="true">
              <span
                className="block w-20 rounded-full"
                style={{ backgroundColor: ink.color, height: Math.max(2, 3 * ink.widthScale), opacity: ink.opacity }}
              />
            </div>
          </fieldset>
        );
      })}
      <p className="text-[0.6875rem] leading-4 text-soft">
        Changes apply to the next marks. Existing writing stays as it was drawn.
      </p>
    </div>
  );
}
