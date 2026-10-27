/**
 * Waveform panels for clipping, clamping and oscillators. Each panel owns a
 * frame rectangle; two panels may never overlap, and every drawn level must
 * sit inside its panel and agree with the samples. Any failure is fatal:
 * the caller draws no panel at all. This mirrors the coming
 * axes_frames_overlap rule locally until that rule lands on main.
 */

export interface WaveFrame { x: number; y: number; width: number; height: number }
export interface WaveSample { t: number; v: number }
export interface WavePanel {
  id: string;
  title: string;
  frame: WaveFrame;
  vMin: number;
  vMax: number;
  /** Named horizontal levels drawn on the panel, in the same units as v. */
  levels: readonly { label: string; value: number }[];
  samples: readonly WaveSample[];
  /** For a clipping panel, the level the output may never pass. */
  clipLevel?: number;
}

export interface WaveIssue { code: string; message: string }

const overlaps = (a: WaveFrame, b: WaveFrame): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function assertWavePanels(panels: readonly WavePanel[]): WaveIssue[] {
  const issues: WaveIssue[] = [];
  for (let i = 0; i < panels.length; i += 1) {
    for (let j = i + 1; j < panels.length; j += 1) {
      if (overlaps(panels[i]!.frame, panels[j]!.frame)) {
        issues.push({ code: "panel_overlap", message: `waveform panels ${panels[i]!.id} and ${panels[j]!.id} overlap` });
      }
    }
  }
  for (const panel of panels) {
    if (![panel.frame.x, panel.frame.y, panel.frame.width, panel.frame.height, panel.vMin, panel.vMax].every(Number.isFinite)) {
      issues.push({ code: "panel_not_finite", message: `waveform panel ${panel.id} has a non finite frame or range` });
    }
    if (!(panel.frame.width > 0 && panel.frame.height > 0)) issues.push({ code: "panel_degenerate", message: `waveform panel ${panel.id} has no area` });
    if (!(panel.vMax > panel.vMin)) issues.push({ code: "panel_range", message: `waveform panel ${panel.id} has an empty value range` });
    for (const level of panel.levels) {
      if (!Number.isFinite(level.value)) issues.push({ code: "level_not_finite", message: `level ${level.label} in panel ${panel.id} is not finite` });
      else if (level.value < panel.vMin || level.value > panel.vMax) issues.push({ code: "level_out_of_range", message: `level ${level.label} (${level.value}) sits outside panel ${panel.id}` });
    }
    let lastT = -Infinity;
    for (const sample of panel.samples) {
      if (!Number.isFinite(sample.t) || !Number.isFinite(sample.v)) issues.push({ code: "sample_not_finite", message: `a sample in panel ${panel.id} is not finite` });
      else {
        if (!(sample.t > lastT)) issues.push({ code: "sample_time_not_increasing", message: `samples in panel ${panel.id} are not in increasing time order` });
        if (sample.v < panel.vMin - 1e-9 || sample.v > panel.vMax + 1e-9) issues.push({ code: "sample_out_of_range", message: `a sample in panel ${panel.id} leaves the panel range` });
        if (panel.clipLevel !== undefined && sample.v > panel.clipLevel + 1e-9) issues.push({ code: "clip_level_passed", message: `panel ${panel.id} draws past its clip level ${panel.clipLevel}` });
      }
      lastT = Number.isFinite(sample.t) ? sample.t : lastT;
    }
    if (panel.clipLevel !== undefined && (!Number.isFinite(panel.clipLevel) || panel.clipLevel < panel.vMin || panel.clipLevel > panel.vMax)) {
      issues.push({ code: "level_out_of_range", message: `clip level of panel ${panel.id} is not a finite value inside the panel` });
    }
  }
  return issues;
}

export const sineSamples = (cycles: number, amplitude: number, points = 97, phase = 0): WaveSample[] => {
  if (!Number.isInteger(points) || points < 2) throw new Error("sineSamples needs at least two points");
  return Array.from({ length: points }, (_, i) => { const t = i / (points - 1); return { t, v: amplitude * Math.sin(2 * Math.PI * cycles * t + phase) }; });
};

export const clippedSamples = (cycles: number, amplitude: number, clipLevel: number, points = 97): WaveSample[] =>
  sineSamples(cycles, amplitude, points).map((s) => ({ ...s, v: Math.min(s.v, clipLevel) }));

export const clampedSamples = (cycles: number, amplitude: number, shift: number, points = 97): WaveSample[] =>
  sineSamples(cycles, amplitude, points).map((s) => ({ ...s, v: s.v + shift }));
