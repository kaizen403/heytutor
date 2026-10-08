import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileSceneDocument } from "../../../src/compile/compiler";
import { validateSceneDocument } from "../../../src/document/validation";
import { validateProblemIR } from "../../../src/ir/problemIR";
import { consumePhysicalModel, standardCases, topicDispositions } from "../../../src/physics/em20261007/consume";
import { synthesizeFamilyScene } from "../../../src/synthesize/familyScene";
import type { RenderScene, SceneDocument } from "../../../src/types";

const failures: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}
function close(actual: number, expected: number, message: string): void {
  if (!(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)))) {
    failures.push(`${message}: ${actual} != ${expected}`);
  }
}

const expected: Record<string, { ordinary: Record<string, number>; altered: Record<string, number> }> = {
  "ce.drift": { ordinary: { I: 240 }, altered: { I: 300 } },
  "ce.current_density": { ordinary: { J: 4, mu: 2 }, altered: { J: 3, mu: 2 } },
  "ce.power": { ordinary: { P: 12 }, altered: { P: 48 } },
  "ce.joule": { ordinary: { H: 48 }, altered: { H: 60 } },
  "ce.resistivity": { ordinary: { sigma: 0.5 }, altered: { sigma: 0.25 } },
  "ce.resistance": { ordinary: { R: 4 }, altered: { R: 2 } },
  "ce.temperature": { ordinary: { R: 20 }, altered: { R: 10 } },
  "ce.cell": { ordinary: { V: 10 }, altered: { V: 12 } },
  "ce.iv_ohmic": { ordinary: { v1: 2, v2: 4, slope: 2 }, altered: { v1: 3, v2: 6, slope: 3 } },
  "ce.iv_declared": { ordinary: {}, altered: {} },
  "ce.carrier_density": { ordinary: { vd: 12, J: -120, I: -240 }, altered: { vd: 12, J: 120, I: 360 } },
  "ce.joule_piecewise": { ordinary: { H: 102, duration: 11 }, altered: { H: 78, duration: 6 } },
  "ce.stretched_wire": { ordinary: { L: 12, A: 1.5, R: 16, R0: 4 }, altered: { L: 2, A: 4, R: 1.5, R0: 6 } },
  "ce.cell_signed": { ordinary: { V: 14, P_emf: -24, P_heat: 4, P_terminal: -28 }, altered: { V: 0, P_emf: 144, P_heat: 144, P_terminal: 0 } },
  "ce.temperature_range": { ordinary: { R: 8, Rmin: 12, Rmax: 7 }, altered: { R: 16, Rmin: 14, Rmax: 24 } },
  "ce.iv_samples": { ordinary: {}, altered: {} },
  "ce.temperature_samples": { ordinary: {}, altered: {} },
  "ce.material_comparison": { ordinary: { sigma1: 0.5, sigma2: 0.2, R1: 4, R2: 10 }, altered: { sigma1: 0.25, sigma2: 1, R1: 6, R2: 1.5 } },
  "dc.ohm": { ordinary: { I_S: 2, I_R: 2, V: 6 }, altered: { I_S: 2, I_R: 2, V: 10 } },
  "dc.series": { ordinary: { I_S: 1, I_R1: 1, I_R2: 1 }, altered: { I_S: 2, I_R1: 2, I_R2: 2 } },
  "dc.parallel": { ordinary: { I_S: 3, I_R6: 1, I_R3: 2, V: 6 }, altered: { I_S: 2.4, I_R6: 1.2, I_R3: 1.2, V: 7.2 } },
  "dc.mixed": { ordinary: { I_S: 2, I_RS: 2, I_Aload: 1, I_Bload: 1 }, altered: { I_S: 3, I_RS: 3, I_Aload: 1.5, I_Bload: 1.5 } },
  "dc.cells": { ordinary: { I_S1: 1, I_S2: 1, I_R: 1 }, altered: { I_S1: 1.5, I_S2: 1.5, I_R: 1.5 } },
  "dc.kirchhoff": { ordinary: { I_S1: 1, I_M: 1, I_CA: 3, I_S2: 2 }, altered: { I_S1: 3, I_M: 3, I_CA: 4, I_S2: 1 } },
  "dc.wheatstone": { ordinary: { I_S: 3, I_LT: -1.5, I_TR: -1.5, I_LB: -1.5, I_BR: -1.5, I_G: 0 }, altered: { I_S: 1.5, I_LT: -0.75, I_TR: -0.75, I_LB: -0.75, I_BR: -0.75, I_G: 0 } },
  "dc.metre_bridge": { ordinary: { balance: 25, unknown: 6 }, altered: { balance: 30, unknown: 6 } },
  "dc.potentiometer": { ordinary: { balance: 25 }, altered: { balance: 20 } },
  "dc.wheatstone_declared": {
    ordinary: { I_S: 1.8, I_WL: 1.8, I_WR: 1.8, I_LT: -1, I_TR: -1.2, I_LB: -0.8, I_BR: -0.6, I_G: 0.2, V_R: 10, V_T: 5, V_B: 4 },
    altered: { I_S: -1.8, I_WL: -1.8, I_WR: -1.8, I_LT: 1, I_TR: 1.2, I_LB: 0.8, I_BR: 0.6, I_G: -0.2, V_R: -10, V_T: -5, V_B: -4 },
  },
  "dc.potentiometer_loaded": { ordinary: { E: 2, V: 1.6, r: 2, gradient: 0.04 }, altered: { E: 3, V: 1.5, r: 5, gradient: 0.05 } },
  "dc.potentiometer_comparison": { ordinary: { E1: 1, E2: 2.4, ratio: 5 / 12, gradient: 0.04 }, altered: { E1: 4, E2: 2, ratio: 2, gradient: 0.05 } },
  "dc.cells_signed": {
    ordinary: { V: 4, I_S1: 1, I_S2: 1, I_R: 1, P_source1: 10, P_source2: -4, P_internal1: 1, P_internal2: 1, P_load: 4 },
    altered: { V: -4.5, I_S1: -1.5, I_S2: -1.5, I_R: -1.5, P_source1: 9, P_source2: 4.5, P_internal1: 2.25, P_internal2: 4.5, P_load: 6.75 },
  },
  "dc.cells_parallel": {
    ordinary: { V: 4.5, I_S1: 2.75, I_S2: -0.5, I_R: 2.25, P_source1: 27.5, P_source2: -2, P_internal1: 15.125, P_internal2: 0.25, P_load: 10.125 },
    altered: { V: 0, I_S1: 4, I_S2: -4, I_R: 0, P_source1: 32, P_source2: 16, P_internal1: 32, P_internal2: 16, P_load: 0 },
  },
  "dc.metre_bridge_observed": {
    ordinary: { balance: 25, unknown: 16 / 3, rho: 0.032, correctedLeft: 30, correctedRight: 80 },
    altered: { balance: 75, unknown: 16 / 3, rho: 0.032, correctedLeft: 80, correctedRight: 30 },
  },
  "dc.kirchhoff_declared": { ordinary: { V_B: 8, V_C: 0, I_S1: 2, I_S2: -2, I_M: 2, I_CA: 0 }, altered: { V_B: -6, V_C: 0, I_S1: -2, I_S2: 2, I_M: -2, I_CA: 0 } },
  "dc.ohm_open": { ordinary: { I_S: 0, I_R: 0, V: 12 }, altered: { I_S: 0, I_R: 0, V: -8 } },
  "ef.coulomb": { ordinary: { F: 1 }, altered: { F: 3 } },
  "ef.point": { ordinary: { Ex: 0.24, Ey: 0.32, E: 0.4 }, altered: { Ex: 0.12, Ey: 0.16, E: 0.2 } },
  "ef.superposition": { ordinary: { Ex: 0, Ey: 0 }, altered: { Ex: 0.5, Ey: 0 } },
  "ef.dipole": { ordinary: { Ex: -0.1875, Ey: 0 }, altered: { Ex: -0.375, Ey: 0 } },
  "ef.torque": { ordinary: { tau: 2 }, altered: { tau: -2 } },
  "ef.energy": { ordinary: { U: -12 }, altered: { U: 0 } },
  "ef.equipotential": { ordinary: { radius: 2, V: 1 }, altered: { radius: 2, V: 2 } },
  "ef.lines": { ordinary: {}, altered: {} },
  "ef.ring": { ordinary: { E: 0.064 }, altered: { E: 0 } },
  "ef.gauss": { ordinary: { flux: 4 }, altered: { flux: 0 } },
  "ef.shell_in": { ordinary: { flux: 0, E: 0 }, altered: { flux: 0, E: 0 } },
  "ef.shell_out": { ordinary: { E: 1 }, altered: { E: 2 } },
  "ef.line": { ordinary: { E: 3 }, altered: { E: 4 } },
  "ef.sheet": { ordinary: { E: 1 }, altered: { E: 1.5 } },
  "ef.finite_dipole": { ordinary: { Ex: 3 / 16, Ey: 0, E: 3 / 16 }, altered: { Ex: -2 / 10 ** 1.5, Ey: 0, E: 2 / 10 ** 1.5 } },
  "ef.discrete": { ordinary: { Ex: 0, Ey: 2 }, altered: { Ex: -2, Ey: -2 } },
  "ef.finite_line": { ordinary: { Ex: 0, Ey: Math.SQRT2 }, altered: { Ex: -2 * Math.SQRT2, Ey: 0 } },
  "ef.disk": { ordinary: { E: 0.4 * Math.PI }, altered: { E: 0.8 * Math.PI } },
  "ef.dipole_contour": { ordinary: { V: 0 }, altered: { V: 2 } },
  "ef.dipole_lines": { ordinary: {}, altered: {} },
  "ef.shell": { ordinary: { E: 0 }, altered: { E: 1 } },
  "ef.closed_flux": { ordinary: { Qenclosed: 4, flux: 2 }, altered: { Qenclosed: -2, flux: 1 } },
  "ef.line_gaussian": { ordinary: { E: 0.5, Qenclosed: 6 * Math.PI, sideFlux: 6 * Math.PI, capFlux: 0, flux: 6 * Math.PI }, altered: { E: -1, Qenclosed: -8 * Math.PI, sideFlux: -4 * Math.PI, capFlux: 0, flux: -4 * Math.PI } },
  "ef.sheet_gaussian": { ordinary: { Eabove: 1, Ebelow: -1, jump: 2, capFlux: 3, sideFlux: 0, flux: 6, Qenclosed: 12 }, altered: { Eabove: -3, Ebelow: 3, jump: -6, capFlux: -6, sideFlux: 0, flux: -12, Qenclosed: -12 } },
  "ep.conservation": { ordinary: {}, altered: {} },
  "ep.potential": { ordinary: { V: 2 }, altered: { V: 4 } },
  "ep.dipole_potential": { ordinary: { V: 2 }, altered: { V: 0 } },
  "ep.pair_energy": { ordinary: { U: 6 }, altered: { U: -6 } },
  "ep.conductor": { ordinary: {}, altered: {} },
  "ep.polarization": { ordinary: {}, altered: {} },
  "ep.sharing": { ordinary: { V: 1, Q1: 2, Q2: 4, total: 6 }, altered: { V: 1, Q1: 2, Q2: 2, total: 4 } },
  "ep.series": { ordinary: { Ceq: 1 }, altered: { Ceq: 4 / 3 } },
  "ep.parallel": { ordinary: { Ceq: 4 }, altered: { Ceq: 4 } },
  "ep.plate": { ordinary: { C: 4 }, altered: { C: 6 } },
  "ep.dielectric": { ordinary: { C: 12 }, altered: { C: 4 } },
  "ep.slab": { ordinary: { C: 4 }, altered: { C: 3 } },
  "ep.stored": { ordinary: { U: 9 }, altered: { U: 8 } },
  "ep.paths": { ordinary: { VA: 3, VB: -1, deltaV: -4, integral1: 4, integral2: 4 }, altered: { VA: 0, VB: 1.5, deltaV: 1.5, integral1: -1.5, integral2: -1.5 } },
  "ep.system": { ordinary: { V: -0.3, U: -77 / 60, W1: 0, W2: 2 / 3, W3: -39 / 20 }, altered: { V: -0.3, U: -77 / 60, W1: 0, W2: -6 / 5, W3: -1 / 12 } },
  "ep.transfer": { ordinary: { Q1: 1, Q2: 1, total: 2, earthChange: 0 }, altered: { Q1: 0, Q2: -1, total: -1, earthChange: 3 } },
  "ep.materials": { ordinary: {}, altered: {} },
  "ep.linear_polarization": { ordinary: { E: 2, P: 8, sigmaBoundUpper: -8, sigmaBoundLower: 8 }, altered: { E: -2, P: 0, sigmaBoundUpper: 0, sigmaBoundLower: 0 } },
  "ep.spheres": { ordinary: { V: 2, Q1: 2, Q2: 4, reservoirCharge: 0 }, altered: { V: 0, Q1: 0, Q2: 0, reservoirCharge: 6 } },
  "ep.mixed": { ordinary: { Ceq: 4, Qseries: 4, Q3: 12, V1: 2, V2: 2, Qsource: 16, middleCharge: 0 }, altered: { Ceq: 7 / 3, Qseries: -4, Q3: -3, V1: -2, V2: -1, Qsource: -7, middleCharge: 0 } },
  "ep.insertion": { ordinary: { C0: 4, C: 8, Q: 16, V: 2, U0: 8, U: 16, batteryWork: 16, externalWork: -8 }, altered: { C0: 4, C: 8, Q: 8, V: 1, U0: 8, U: 4, batteryWork: 0, externalWork: -4 } },
  "ep.floating_slab": { ordinary: { C: 4, V: 3, Q: 12, Eslab: 0, Eair: 1, Vlower: 1, Vupper: 2, U: 18, batteryWork: 9, externalWork: -4.5 }, altered: { C: 4, V: 2.25, Q: 9, Eslab: 0, Eair: 0.75, Vlower: 1.5, Vupper: 0.75, U: 10.125, batteryWork: 0, externalWork: -3.375 } },
  "ep.charge_discharge": { ordinary: { Q: 6, U: 9, sourceWork: 18, chargingHeat: 9, dischargeHeat: 9 }, altered: { Q: -8, U: 8, sourceWork: 16, chargingHeat: 8, dischargeHeat: 8 } },
  "ep.pair_voltage": { ordinary: { Ceq: 4 / 3, Qsource: 8, Q1: 8, Q2: 8, V1: 4, V2: 2, middleCharge: 0 }, altered: { Ceq: 6, Qsource: -18, Q1: -6, Q2: -12, V1: -3, V2: -3 } },
  "mf.wire": { ordinary: { B: 1 }, altered: { B: 2 } },
  "mf.arc": { ordinary: { B: Math.PI }, altered: { B: 2 * Math.PI } },
  "mf.loop": { ordinary: { B: 2 }, altered: { B: 1 / Math.sqrt(2) } },
  "mf.solenoid": { ordinary: { B: 24 }, altered: { B: 0 } },
  "mf.toroid": { ordinary: { B: 2 }, altered: { B: 4 } },
  "mm.lines": { ordinary: {}, altered: {} },
  "mm.equivalent": { ordinary: { m: 60 }, altered: { m: 48 } },
  "mm.dipole": { ordinary: { B: 0.5 }, altered: { B: -0.25 } },
  "mm.earth": { ordinary: { B: 5, dip: Math.atan2(4, 3) }, altered: { B: 10, dip: Math.atan2(6, 8) } },
  "mm.materials": { ordinary: {}, altered: {} },
  "mf.lorentz": { ordinary: { Fx: 0, Fy: -24, Fz: 0, F: 24 }, altered: { Fx: 0, Fy: 0, Fz: 0, F: 0 } },
  "mf.selector": { ordinary: { v: 3 }, altered: { v: 4 } },
  "mf.cyclotron": { ordinary: { radius: 3 }, altered: { radius: 3 } },
  "mf.helix": { ordinary: { radius: 3, pitch: 8 * Math.PI }, altered: { radius: 4, pitch: 4 * Math.PI } },
  "mf.conductor": { ordinary: { Fx: 0, Fy: -24, Fz: 0 }, altered: { Fx: 0, Fy: -12, Fz: 0 } },
  "mf.parallel": { ordinary: { perLength: 4, attract: 1 }, altered: { perLength: -4, attract: 0 } },
  "mf.ampere": { ordinary: {}, altered: {} },
  "mf.loop_torque": { ordinary: { taux: -24, tauy: 0, tauz: 0, tau: 24 }, altered: { taux: -12, tauy: 0, tauz: 0, tau: 12 } },
  "mf.dipole_moment": { ordinary: { m: 10 }, altered: { m: 12 } },
  "mf.revolving": { ordinary: { m: 12 }, altered: { m: 16 } },
  "mf.galvanometer": { ordinary: { theta: 0.2 }, altered: { theta: 0.4 } },
  "mf.shunt": { ordinary: { S: 10 }, altered: { S: 5 } },
  "mf.voltmeter": { ordinary: { R: 1900 }, altered: { R: 2900 } },
  "mf.dipole_torque": { ordinary: { taux: -12, tauy: 0, tauz: 0 }, altered: { taux: -8, tauy: 0, tauz: 0 } },
  "ind.faraday": { ordinary: { phi: 20, emf: -12 }, altered: { phi: 12, emf: -8 } },
  "ind.motional": { ordinary: { emf: 24 }, altered: { emf: 30 } },
  "ind.eddy": { ordinary: {}, altered: {} },
  "ind.self": { ordinary: { L: 360 }, altered: { L: 144 } },
  "ind.mutual": { ordinary: { M: 3 }, altered: { M: 6 } },
  "ind.lc": { ordinary: { omega: 1, U: 8 }, altered: { omega: 1, U: 32 } },
  "ind.resistor": { ordinary: { Z: 5 }, altered: { Z: 7 } },
  "ind.reactance": { ordinary: { XL: 8, XC: 1 }, altered: { XL: 4, XC: 2 } },
  "ind.lcr": { ordinary: { X: 4, Z: 5 }, altered: { X: 4, Z: Math.hypot(8, 4) } },
  "ind.phasor": { ordinary: { Ireal: 1.2, Iimag: -1.6, I: 2, P: 12, powerFactor: 0.6 }, altered: { Ireal: 0.6, Iimag: -0.8, I: 1, P: 3, powerFactor: 0.6 } },
  "ind.resonance": { ordinary: { omega: 1, Z: 5 }, altered: { omega: 1, Z: 8 } },
  "ind.wattless": { ordinary: { XL: 8, I: 1.25, P: 0 }, altered: { XL: 16, I: 0.625, P: 0 } },
  "ind.generator": { ordinary: { peakEmf: 120 }, altered: { peakEmf: 48 } },
  "ind.transformer": { ordinary: { Vs: 20, Is: 5 }, altered: { Vs: 50, Is: 2 } },
  "ind.flux_loop": { ordinary: { phi: 50, emf: -40, I: -4, P: 160 }, altered: { phi: 0, emf: -24 } },
  "ind.self_state": { ordinary: { L: 5, I: 3, linkage: 15, emf: -4, U: 22.5 }, altered: { L: 5, I: 2, linkage: 10, emf: -15, U: 10 } },
  "ind.mutual_state": { ordinary: { M: -3, emf1: -3, emf2: 12, U: 6.5 }, altered: { M: 0, emf1: 0, emf2: 0, U: 12.5 } },
  "ind.lc_state": { ordinary: { omega: 1, Q: 0, I: -2, V: 0, UL: 8, UC: 0, U: 8 }, altered: { omega: 1, Q: 4, I: 0, V: 16, UL: 0, UC: 32, U: 32 } },
  "ind.motional_circuit": { ordinary: { emf: 24, I: 4, Fx: -24, P: 96 }, altered: { emf: 12 * Math.SQRT2 } },
  "ind.sinusoid": { ordinary: { Vrms: 10 / Math.SQRT2, Irms: 4 / Math.SQRT2, phase: 1, P: 20 * Math.cos(1), v: 10 * Math.sin(0.4), i: 4 * Math.sin(-0.6) }, altered: { Vrms: 8 / Math.SQRT2, Irms: Math.SQRT2, phase: -Math.PI / 2, P: 0, v: 0, i: 2 } },
  "ind.eddy_motion": { ordinary: {}, altered: {} },
  "ind.rc_transient": { ordinary: { tau: 1, state: 10 - 8 / Math.E, current: 4 / Math.E, stored: (10 - 8 / Math.E) ** 2 / 4 }, altered: { tau: 1, state: 8 / Math.E, current: -4 / Math.E, stored: 16 / Math.E ** 2 } },
  "ind.lr_transient": { ordinary: { tau: 2, state: 5 - 4 / Math.E, current: 5 - 4 / Math.E, stored: 2 * (5 - 4 / Math.E) ** 2 }, altered: { tau: 2, state: 4 / Math.E, current: 4 / Math.E, stored: 32 / Math.E ** 2 } },
  "ind.generator_state": { ordinary: { phi: 0, emf: -120, peakEmf: 120, I: -10, P: 1200 }, altered: { phi: 0, emf: -48, peakEmf: 48 } },
  "ind.transformer_load": { ordinary: { Vs: -20, Is: 5, Pout: 100, Pin: 110, Ip: 1.1, efficiency: 10 / 11 }, altered: { Vs: 100, Is: 5, Pout: 500, Pin: 500, Ip: 25, efficiency: 1 } },
  "ind.dc_limits": { ordinary: {}, altered: {} },
  "ind.series_response": { ordinary: { XL: 8, XC: 4, Zreal: 3, Zimag: 4, Z: 5, Ireal: 1.2, Iimag: -1.6, I: 2, lag: Math.atan2(4, 3), P: 12, Q: 16, VR: 6, VL: 16, VC: 8 }, altered: { XL: 4, XC: 8, Zreal: 3, Zimag: -4, Z: 5, Ireal: -1.6, Iimag: 1.2, I: 2, lag: Math.atan2(-4, 3), P: 12, Q: -16, VR: 6, VL: 8, VC: 16 } },
  "emw.triad": { ordinary: {}, altered: {} },
  "emw.amplitude": { ordinary: { E: 6 }, altered: { E: 12 } },
  "emw.speed": { ordinary: { c: 1 }, altered: { c: 0.5 } },
  "emw.energy": { ordinary: { u: 18, momentum: 6 }, altered: { u: 32, momentum: 16 } },
  "emw.production": { ordinary: {}, altered: {} },
  "emw.spectrum": { ordinary: {}, altered: {} },
  "emw.applications": { ordinary: {}, altered: {} },
  "emw.displacement": { ordinary: { id: 10 }, altered: { id: 8 } },
};

function certifiedOf(document: SceneDocument): Record<string, number> {
  const certified = document.source.certified;
  if (typeof certified !== "object" || certified === null) throw new Error("missing certified record");
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(certified)) {
    if (typeof value !== "number") throw new Error(`${key} is not a certified number`);
    values[key] = value;
  }
  return values;
}

function compile(document: SceneDocument, label: string): RenderScene | null {
  const validated = validateSceneDocument(document);
  if (!validated.document) {
    failures.push(`${label} validation: ${validated.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    return null;
  }
  const compiled = compileSceneDocument(validated.document);
  if (!compiled.ok || !compiled.renderScene || compiled.report.issues.some((issue) => issue.severity === "fatal")) {
    failures.push(`${label} compile: ${compiled.report.issues.map((issue) => issue.message).join("; ")}`);
    return null;
  }
  if (document.visualDecision.mode === "text_only") {
    check(compiled.renderScene.primitives.length === 0, `${label} text_only render must be empty`);
  } else {
    check(compiled.renderScene.primitives.length > 0, `${label} scene render is empty`);
  }
  return compiled.renderScene;
}

function matches(actual: Record<string, number>, wanted: Record<string, number>, label: string): void {
  const keys = [...new Set([...Object.keys(actual), ...Object.keys(wanted)])].sort();
  for (const key of keys) {
    if (!(key in actual) || !(key in wanted)) failures.push(`${label} certified keys ${JSON.stringify(actual)} != ${JSON.stringify(wanted)}`);
    else close(actual[key]!, wanted[key]!, `${label} ${key}`);
  }
}

const cases = standardCases();
check(cases.length === Object.keys(expected).length, `case count ${cases.length} != oracle count ${Object.keys(expected).length}`);
const renders = new Map<string, RenderScene>();
for (const item of cases) {
  const oracle = expected[item.modelName];
  if (!oracle) {
    failures.push(`missing oracle ${item.modelName}`);
    continue;
  }
  for (const sample of ["ordinary", "altered"] as const) {
    const consumed = consumePhysicalModel(item.modelName, sample === "ordinary" ? item.ordinary : item.altered);
    if (consumed.status !== "scene") {
      failures.push(`${item.modelName} ${sample} ${consumed.status === "rejected" ? consumed.reason : consumed.status}`);
      continue;
    }
    try {
      matches(certifiedOf(consumed.document), oracle[sample], `${item.modelName} ${sample}`);
    } catch (error) {
      failures.push(`${item.modelName} ${sample} ${error instanceof Error ? error.message : String(error)}`);
    }
    const rendered = compile(consumed.document, `${item.modelName} ${sample}`);
    if (rendered && sample === "ordinary") renders.set(item.modelName, rendered);
  }
  check(item.rejections.length > 0, `${item.modelName} has no rejection`);
  for (const rejection of item.rejections) {
    const consumed = consumePhysicalModel(item.modelName, rejection);
    check(consumed.status === "rejected", `${item.modelName} accepted ${JSON.stringify(rejection)}`);
  }
}

check(consumePhysicalModel("math.circle", {}).status === "unclaimed", "foreign prefix stays unclaimed");
check(consumePhysicalModel("ce.not_a_model", { n: 1 }).status === "rejected", "owned unknown model is rejected");
check(consumePhysicalModel("ce.drift", { n: 10, e: 2, A: 3, vd: 4, extra: 1 }).status === "rejected", "extra input is rejected");

const assignmentDir = resolve(import.meta.dirname, "../../../../../docs/plans/diagram-topic-matrix/work-logs/em20261007-assignments");
const assigned = new Set<string>();
for (let agent = 1; agent <= 8; agent += 1) {
  const rows = JSON.parse(readFileSync(resolve(assignmentDir, `agent${agent}.json`), "utf8")) as Array<{ topic_id: string }>;
  for (const row of rows) {
    check(!assigned.has(row.topic_id), `duplicate assignment ${row.topic_id}`);
    assigned.add(row.topic_id);
  }
}
const covered = new Set(topicDispositions().map((topic) => topic.topicId));
check(assigned.size === 86, `assignment has ${assigned.size} ids`);
for (const id of assigned) if (!covered.has(id)) failures.push(`missing disposition ${id}`);
for (const id of covered) if (!assigned.has(id)) failures.push(`unexpected disposition ${id}`);
const byChapter = new Map<string, number>();
for (const topic of topicDispositions()) byChapter.set(topic.chapter, (byChapter.get(topic.chapter) ?? 0) + 1);
check(byChapter.get("Current Electricity") === 17, `current electricity ${byChapter.get("Current Electricity")}`);
check(byChapter.get("Electrostatics") === 24, `electrostatics ${byChapter.get("Electrostatics")}`);
check(byChapter.get("Magnetic Effects of Current and Magnetism") === 23, `magnetism ${byChapter.get("Magnetic Effects of Current and Magnetism")}`);
check(byChapter.get("Electromagnetic Induction and Alternating Currents") === 14, `induction ${byChapter.get("Electromagnetic Induction and Alternating Currents")}`);
check(byChapter.get("Electromagnetic Waves") === 8, `waves ${byChapter.get("Electromagnetic Waves")}`);

function rejectSynthetic(model: string, inputs: Record<string, number>): void {
  const question = "Use the explicit model for this source.";
  const raw = {
    schemaVersion: "problem-ir/v1",
    id: "emFixture",
    question,
    facts: [{ id: "fact", kind: "given", statement: "The explicit model is the source.", evidence: { source: "question", start: 8, end: 23, quote: "explicit model" } }],
    entities: [],
    expressions: [],
    constraints: [],
    representationIntents: [],
    solveRequests: [{ id: "explicitModel", kind: "explicit_physical_model", model, inputs, evidenceFactIds: ["fact"] }],
  };
  const validated = validateProblemIR(raw, question);
  check(!validated.problem, `${model} synthetic explicit-model request must not validate`);
  check(synthesizeFamilyScene({ question, problemIR: raw }) === null, `${model} synthetic request must not emit a scene`);
}

for (const item of cases) rejectSynthetic(item.modelName, item.ordinary);

function svg(scene: RenderScene, title: string): string {
  const points = scene.primitives.flatMap((primitive) => primitive.points);
  const minX = Math.min(...points.map((point) => point.x), 0);
  const minY = Math.min(...points.map((point) => point.y), 0);
  const maxX = Math.max(...points.map((point) => point.x), 1);
  const maxY = Math.max(...points.map((point) => point.y), 1);
  const pad = 24;
  const body = scene.primitives.map((primitive) => {
    const coords = primitive.points.map((point) => `${point.x},${point.y}`).join(" ");
    if (primitive.kind === "circle" && primitive.radius) {
      const center = primitive.points[0];
      return center ? `<circle cx="${center.x}" cy="${center.y}" r="${primitive.radius}" fill="none" stroke="#1d4e89" stroke-width="2"/>` : "";
    }
    if (primitive.kind === "label" && primitive.text) {
      const at = primitive.points[0];
      return at ? `<text x="${at.x}" y="${at.y}" font-size="14" fill="#1d4e89">${primitive.text}</text>` : "";
    }
    if (primitive.kind === "point") {
      const at = primitive.points[0];
      return at ? `<circle cx="${at.x}" cy="${at.y}" r="3" fill="#1d4e89"/>` : "";
    }
    const closed = primitive.kind === "rectangle" || primitive.kind === "polygon";
    return `<polyline points="${coords}" fill="${closed ? "none" : "none"}" stroke="#1d4e89" stroke-width="2"/>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}" width="720" height="420">\n<title>${title}</title>\n<rect x="${minX - pad}" y="${minY - pad}" width="100%" height="100%" fill="#f7f4ee"/>\n${body}\n</svg>`;
}

const figures: Array<[string, string]> = [
  ["current-electricity.svg", "dc.wheatstone"],
  ["electrostatics.svg", "ef.point"],
  ["magnetism.svg", "mm.lines"],
  ["induction.svg", "ind.faraday"],
  ["em-waves.svg", "emw.triad"],
];
const renderDir = process.env.EM_FIVE_RENDER_DIR;
if (failures.length === 0 && renderDir && !renderDir.includes("/bridgetown/.context/em20261007")) {
  const destinations = [renderDir];
  for (const [file, model] of figures) {
    const scene = renders.get(model);
    if (!scene) {
      failures.push(`missing render ${model}`);
      continue;
    }
    const markup = svg(scene, model);
    for (const directory of destinations) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, file), markup);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`em-five verification failed\n${failures.slice(0, 30).join("\n")}`);
}
console.log(`em-five verification passed (${cases.length} models, ${assigned.size} topics)`);
