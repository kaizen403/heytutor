import assert from "node:assert/strict";
import { assertWavePanels, clampedSamples, clippedSamples, sineSamples, type WavePanel } from "../../src/devices/waveforms";

let checks = 0;
const ok = (cond: unknown, msg: string) => { checks += 1; assert.ok(cond, msg); };

const input: WavePanel = { id: "input", title: "Input", frame: { x: 420, y: 80, width: 340, height: 240 }, vMin: -6, vMax: 6, levels: [{ label: "0", value: 0 }], samples: sineSamples(2, 5) };
const clipped: WavePanel = { id: "output", title: "Clipped output", frame: { x: 800, y: 80, width: 340, height: 240 }, vMin: -6, vMax: 6, levels: [{ label: "clip", value: 2 }], samples: clippedSamples(2, 5, 2), clipLevel: 2 };
ok(assertWavePanels([input, clipped]).length === 0, "side by side input and clipped output panels pass");
ok(Math.max(...clipped.samples.map((s) => s.v)) <= 2 + 1e-9, "clipped samples never pass the clip level");
ok(assertWavePanels([input, { ...clipped, frame: { x: 700, y: 80, width: 340, height: 240 } }]).some((i) => i.code === "panel_overlap"), "overlapping panels are refused");
ok(assertWavePanels([{ ...input, levels: [{ label: "high", value: 9 }] }]).some((i) => i.code === "level_out_of_range"), "a level outside its panel is refused");
ok(assertWavePanels([{ ...clipped, samples: sineSamples(2, 5) }]).some((i) => i.code === "clip_level_passed"), "an unclipped wave on a clipping panel is refused");
const clamped = clampedSamples(1, 3, 3);
ok(clamped.every((s) => s.v >= 0 - 1e-9), "a positively clamped wave never goes negative");
ok(assertWavePanels([{ id: "osc", title: "Oscillator output", frame: { x: 420, y: 80, width: 700, height: 300 }, vMin: -4, vMax: 4, levels: [{ label: "0", value: 0 }], samples: sineSamples(3, 3.5) }]).length === 0, "a single oscillator panel passes");

console.log(`waveform panels verification passed (${checks} checks)`);
