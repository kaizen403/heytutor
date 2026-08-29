/**
 * Measuring instruments and material-property curves.
 *
 * A divided scale is real geometry: every tick is a segment at a computed
 * position, the vernier's ten divisions span nine main-scale divisions, the
 * thimble's fifty divisions span one pitch. A reading, when the question gives
 * one, is drawn where it belongs; otherwise a declared example reading is used
 * and the figure stays qualitative.
 */
import { SceneBuilder, fmt } from "../document";
import { grounded, maybeNum, num, text, type GeneratorContext, type GeneratorTable } from "./context";

function ticks(scene: SceneBuilder, prefix: string, x0: number, y: number, count: number, step: number, height: (index: number) => number, role: string, up = true): string[] {
  const ids: string[] = [];
  for (let index = 0; index <= count; index += 1) {
    const x = x0 + index * step;
    const h = height(index);
    const a = scene.helper(`${prefix}${index}_a`, { x, y }, `${role} tick base`);
    const b = scene.helper(`${prefix}${index}_b`, { x, y: up ? y + h : y - h }, `${role} tick tip`);
    ids.push(scene.segment(`${prefix}${index}`, a, b, index === 0 ? role : `${role} tick`));
  }
  return ids;
}

function vernierCalliper(context: GeneratorContext) {
  const zeroError = text(context, "zeroError", "none");
  const msr = maybeNum(context, "mainScaleReading");
  const vsd = maybeNum(context, "vernierDivision");
  const exampleMain = zeroError === "none" ? (msr ?? 23) : 0;
  const exampleDivision = zeroError === "none" ? (vsd ?? 4) : zeroError === "positive" ? 3 : 8;
  const leastCount = 0.1;
  const vernierOffset = zeroError === "negative" ? -(10 - exampleDivision) * leastCount : exampleMain + exampleDivision * leastCount;
  const scene = new SceneBuilder(context.question, zeroError === "none"
    ? "vernier calliper: main scale, vernier scale, external and internal jaws and the depth rod"
    : `vernier calliper with jaws closed showing a ${zeroError} zero error`, "vernier_calliper");
  scene.quantity("lc", "LC", leastCount, "mm");
  if (grounded(context, "mainScaleReading") && msr !== null) scene.quantity("msr", "MSR", msr, "mm");
  if (grounded(context, "vernierDivision") && vsd !== null) scene.quantity("vsd", "VSD", vsd, "");

  // Main scale bar 0–60 mm.
  const barY = 0;
  scene.helper("bar_c", { x: 30, y: barY + 2 }, "main scale bar centre");
  scene.rectangle("bar", "bar_c", 64, 4, "main scale bar");
  ticks(scene, "ms", 0, barY, 60, 1, (index) => (index % 10 === 0 ? 2.4 : index % 5 === 0 ? 1.7 : 1.0), "main scale", true);
  for (const value of [0, 10, 20, 30, 40, 50, 60]) {
    scene.point(`ms_label_${value}`, { x: value, y: barY + 3.2 }, "main scale number", `${value}`);
  }
  scene.point("ms_caption", { x: 30, y: barY + 5.8 }, "main scale caption", "main scale (mm)");

  // Vernier plate under the bar: 10 divisions over 9 mm, starting at the reading.
  const v0 = vernierOffset;
  scene.helper("vp_c", { x: v0 + 6, y: barY - 1.6 }, "vernier plate centre");
  scene.rectangle("vernier_plate", "vp_c", 14, 3.2, "vernier scale plate");
  ticks(scene, "vs", v0, barY, 10, 0.9, (index) => (index % 5 === 0 ? 1.9 : 1.2), "vernier scale", false);
  scene.point("vs_zero_label", { x: v0, y: barY - 3.6 }, "vernier zero", "0");
  scene.point("vs_ten_label", { x: v0 + 9, y: barY - 3.6 }, "vernier ten", "10");
  scene.point("vs_caption", { x: v0 + 4.5, y: barY - 5.2 }, "vernier scale caption", "vernier: 10 div = 9 mm");

  // Jaws: fixed lower external jaw at x=0, sliding jaw at the vernier; small internal jaws above.
  scene.helper("fixed_jaw_c", { x: -1.5, y: barY - 6 }, "fixed jaw centre");
  scene.rectangle("fixed_jaw", "fixed_jaw_c", 3, 9, "fixed external jaw", "fixed jaw");
  scene.helper("slide_jaw_c", { x: v0 - 1.5, y: barY - 6 }, "sliding jaw centre");
  scene.rectangle("sliding_jaw", "slide_jaw_c", 3, 9, "sliding external jaw", "sliding jaw");
  scene.helper("fixed_upper_c", { x: -1, y: barY + 8 }, "fixed internal jaw centre");
  scene.rectangle("fixed_upper_jaw", "fixed_upper_c", 2, 5, "fixed internal jaw");
  scene.helper("slide_upper_c", { x: v0 - 1, y: barY + 8 }, "sliding internal jaw centre");
  scene.rectangle("sliding_upper_jaw", "slide_upper_c", 2, 5, "sliding internal jaw");
  if (v0 > 0) {
    scene.helper("depth_a", { x: 62, y: barY + 2 }, "depth rod start");
    scene.helper("depth_b", { x: 62 + v0, y: barY + 2 }, "depth rod end");
    scene.segment("depth_rod", "depth_a", "depth_b", "depth rod", "depth rod");
  }

  // The coinciding division and the reading.
  const coincide = exampleDivision;
  scene.point("coincide_mark", { x: v0 + coincide * 0.9, y: barY - 3.6 }, "coinciding vernier division", `${coincide}th`);
  const reading = zeroError === "none"
    ? `= ${fmt(exampleMain + coincide * leastCount)} mm`
    : zeroError === "positive" ? `error +${fmt(coincide * leastCount)} mm` : `error −${fmt((10 - coincide) * leastCount)} mm`;
  scene.point("reading_note", { x: 30, y: barY - 8.5 }, "reading", reading);
  scene.point("lc_note", { x: 30, y: barY - 10.3 }, "least count", "LC = 0.1 mm");
  scene.assert("vernier_ratio", "distance_ratio", ["vs0_a", "vs10_a", "ms0_a", "ms10_a"], 0.9);
  if (zeroError === "none" && grounded(context, "mainScaleReading") && grounded(context, "vernierDivision") && v0 > 0) {
    // The vernier zero sits at the reading: (MSR + VSD·LC) main-scale millimetres from the main-scale zero.
    scene.assert("reading_position", "distance_ratio", ["ms0_a", "vs0_a", "ms0_a", "ms10_a"], Number((v0 / 10).toFixed(6)));
  }
  scene.assert("scales_parallel", "parallel", ["ms0", "vs0"]);
  scene.labelled("fixed_jaw", "sliding_jaw", "ms_caption");
  scene.group("frame", ["bar_c", "bar", "fixed_jaw_c", "fixed_jaw", "fixed_upper_c", "fixed_upper_jaw"], "the fixed frame: main scale bar and fixed jaws");
  return scene.build();
}

function screwGauge(context: GeneratorContext) {
  const zeroError = text(context, "zeroError", "none");
  const pitch = maybeNum(context, "pitch") ?? 1;
  const divisions = Math.max(10, Math.min(100, Math.round(num(context, "divisions", 50))));
  const leastCount = pitch / divisions;
  const scene = new SceneBuilder(context.question, zeroError === "none"
    ? "screw gauge: U-frame, anvil, spindle, sleeve with the pitch scale and thimble with the circular scale"
    : `screw gauge closed, showing a ${zeroError} zero error on the circular scale`, "screw_gauge");
  scene.quantity("pitch", "pitch", pitch, "mm");
  scene.quantity("n", "N", divisions, "");
  scene.quantity("lc", "LC", leastCount, "mm");

  // U-frame as a polyline: anvil arm, bottom, sleeve arm.
  const frame = [
    { x: 0, y: 6 }, { x: 0, y: -6 }, { x: 4, y: -10 }, { x: 22, y: -10 }, { x: 26, y: -6 }, { x: 26, y: 2 },
  ].map((point, index) => scene.helper(`frame${index}`, point, "frame point"));
  scene.polyline("frame", frame, "U-frame");
  scene.helper("anvil_c", { x: 1.5, y: 6 }, "anvil centre");
  scene.rectangle("anvil", "anvil_c", 3, 2.4, "anvil", "anvil");
  const gap = zeroError === "none" ? 6 : 0;
  scene.helper("spindle_a", { x: 3 + gap, y: 6 }, "spindle tip");
  scene.helper("spindle_b", { x: 26, y: 6 }, "spindle end");
  scene.segment("spindle", "spindle_a", "spindle_b", "spindle", "spindle");
  scene.helper("sleeve_c", { x: 33, y: 6 }, "sleeve centre");
  scene.rectangle("sleeve", "sleeve_c", 14, 4, "sleeve with the pitch scale", "sleeve");
  scene.helper("ref_a", { x: 26, y: 6 }, "reference line start");
  scene.helper("ref_b", { x: 40, y: 6 }, "reference line end");
  scene.segment("reference_line", "ref_a", "ref_b", "reference line of the pitch scale");
  ticks(scene, "ps", 27, 6, 12, 1, (index) => (index % 5 === 0 ? 1.6 : 1.0), "pitch scale", true);
  scene.point("ps_caption", { x: 33, y: 9.6 }, "pitch scale caption", `pitch = ${fmt(pitch)} mm`);
  const thimbleX = 40 + (zeroError === "none" ? 6 : 0);
  scene.helper("thimble_c", { x: thimbleX + 5, y: 6 }, "thimble centre");
  scene.rectangle("thimble", "thimble_c", 10, 7, "thimble with the circular scale", "thimble");
  const shown = 10;
  const zeroShift = zeroError === "positive" ? 1.2 : zeroError === "negative" ? -1.2 : 0;
  for (let index = 0; index <= shown; index += 1) {
    const y = 6 - 3 + index * 0.6 + zeroShift;
    const a = scene.helper(`cs${index}_a`, { x: thimbleX, y }, "circular scale tick base");
    const b = scene.helper(`cs${index}_b`, { x: thimbleX - (index % 5 === 0 ? 1.4 : 0.9), y }, "circular scale tick tip");
    scene.segment(`cs${index}`, a, b, index === 0 ? "circular scale" : "circular scale tick");
  }
  scene.point("cs_zero_label", { x: thimbleX + 1.6, y: 3 + zeroShift }, "circular scale zero", "0");
  scene.point("cs_caption", { x: thimbleX + 5, y: 11 }, "circular scale caption", `${divisions} div`);
  scene.helper("ratchet_c", { x: thimbleX + 12.5, y: 6 }, "ratchet centre");
  scene.rectangle("ratchet", "ratchet_c", 4, 3, "ratchet", "ratchet");
  scene.point("lc_note", { x: 20, y: -13 }, "least count", `LC=${fmt(leastCount, 2)} mm`);
  if (zeroError !== "none") {
    scene.point("ze_note", { x: thimbleX + 5, y: -13 }, "zero error", zeroError === "positive" ? "+ve zero error" : "−ve zero error");
  }
  scene.assert("spindle_on_axis", "parallel", ["spindle", "reference_line"]);
  scene.assert("ticks_perp", "perpendicular", ["ps0", "reference_line"]);
  scene.labelled("anvil", "spindle", "sleeve", "thimble");
  return scene.build();
}

function magneticSusceptibility(context: GeneratorContext) {
  const tc = maybeNum(context, "curieTemperature");
  const T0 = tc ?? 4;
  const tMax = 2.5 * T0;
  const scene = new SceneBuilder(context.question, "susceptibility χ against temperature for diamagnetic, paramagnetic and ferromagnetic materials", "magnetic_susceptibility");
  if (grounded(context, "curieTemperature") && tc !== null) scene.quantity("tc", "T_C", tc, "K");
  const k = tMax / 8;
  scene.axes("axes", -0.1 * tMax, 1.1 * tMax, -1.2 * k, 6 * k, "χ–T axes", "χ-T");
  const tMin = 0.15 * T0;
  scene.curve("paramagnetic", `(${k})*(${T0 * 0.8}/x)`, tMin, tMax, "paramagnetic: Curie law χ = C/T", "para: χ=C/T", 65);
  scene.curve("diamagnetic", `${-0.6 * k}`, tMin, tMax, "diamagnetic: small, negative, temperature independent", "dia: χ<0", 17);
  scene.curve("ferromagnetic", `(${k})*(${T0}/(x-${0.85 * T0}))`, 1.05 * T0, tMax, "ferromagnetic above T_C: Curie–Weiss χ = C/(T−T_C)", "ferro: T>T_C", 65);
  scene.point("tc_mark", { x: T0, y: 0 }, "Curie temperature", grounded(context, "curieTemperature") ? `T_C=${fmt(T0)} K` : "T_C");
  scene.helper("tc_top", { x: T0, y: 5.5 * k }, "Curie line top");
  scene.segment("tc_line", "tc_mark", "tc_top", "Curie temperature line");
  scene.point("ferro_below", { x: 0.5 * T0, y: 5.5 * k }, "ferromagnetic region below T_C", "ferro: large χ");
  scene.assert("para_value", "function_value", ["paramagnetic"], { x: Number(T0.toFixed(6)), y: Number((k * 0.8).toFixed(6)) });
  scene.assert("dia_flat", "function_value", ["diamagnetic"], { x: Number((0.5 * tMax).toFixed(6)), y: Number((-0.6 * k).toFixed(6)) });
  scene.assert("tc_perp", "perpendicular", ["tc_line", "axes"], true, "warning");
  scene.labelled("paramagnetic", "diamagnetic", "ferromagnetic");
  return scene.build();
}

function bindingEnergyCurve(context: GeneratorContext) {
  const massNumber = maybeNum(context, "massNumber");
  // Semi-empirical mass formula with Z ≈ A/2: B/A ≈ a_v − a_s A^(−1/3) − a_c (A/2)² / A^(4/3) (MeV).
  // dB/dA = 0 at A = a_s/(2c); c = 0.1634 puts the peak at A = 56 with B/A ≈ 8.6 MeV.
  const expression = "15.8-18.3*x^(-1/3)-0.1634*x^(2/3)";
  const evaluate = (a: number): number => 15.8 - 18.3 * a ** (-1 / 3) - 0.1634 * a ** (2 / 3);
  const scene = new SceneBuilder(context.question, "binding energy per nucleon against mass number, peaking near iron", "binding_energy_curve");
  const k = 240 / 10;
  scene.axes("axes", -10, 250, -0.5 * k, 10 * k, "B/A axes", "B/A-A");
  scene.curve("curve", `(${k})*(${expression})`, 4, 240, "binding energy per nucleon", "B/A (MeV)", 97);
  let best = 4;
  for (let a = 4; a <= 240; a += 1) if (evaluate(a) > evaluate(best)) best = a;
  scene.point("peak", { x: best, y: evaluate(best) * k }, "most stable nuclei near iron", `Fe ≈ ${fmt(evaluate(best), 2)} MeV`);
  scene.point("peak_foot", { x: best, y: 0 }, "peak mass number", `A≈${best}`);
  scene.segment("peak_drop", "peak", "peak_foot", "ordinate at the peak");
  scene.point("fusion_note", { x: 20, y: 9.3 * k }, "fusion region", "fusion →");
  scene.point("fission_note", { x: 200, y: 9.3 * k }, "fission region", "← fission");
  if (massNumber !== null && massNumber >= 4 && massNumber <= 240) {
    scene.point("asked", { x: massNumber, y: evaluate(massNumber) * k }, "asked nucleus", `A=${massNumber}`);
    scene.assert("asked_on_curve", "function_value", ["curve"], { x: massNumber, y: Number((evaluate(massNumber) * k).toFixed(6)) });
  }
  scene.assert("peak_on_curve", "function_value", ["curve"], { x: best, y: Number((evaluate(best) * k).toFixed(6)) });
  scene.assert("uranium_lower", "function_value", ["curve"], { x: 238, y: Number((evaluate(238) * k).toFixed(6)) });
  scene.labelled("curve", "peak");
  return scene.build();
}

export const INSTRUMENT_GENERATORS: GeneratorTable = {
  vernier_calliper: vernierCalliper,
  screw_gauge: screwGauge,
  magnetic_susceptibility: magneticSusceptibility,
  binding_energy_curve: bindingEnergyCurve,
};
