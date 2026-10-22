/** Composing source-bound radiation with restored sample identities. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { readRadiationSource } from "../../src/physics/radiationSource";
import { buildAtomicRadiationScene } from "../../src/chemistry/atomicRadiation";
import { OPTICS_GENERATORS } from "../../src/archetypes/generators/optics";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";

interface Row { id: string; question: string; draw: boolean; photon?: number; phi?: number; derived?: boolean; symbolic?: boolean }
const rows: Row[] = [
  { id: "named-plate-computational-hc", question: "The work function of sodium is 2 eV. Light of wavelength 400 nm falls on sodium plate A. Take hc = 1240.0 eV nm. Draw the photoelectric energy balance.", draw: true, photon: 3.1 },
  { id: "named-plate-threshold-conservation", question: "Sodium plate A has work function 2 eV and threshold wavelength 620 nm. Light falls on plate A and the stopping potential is 2 V. Take hc = 1240 eV nm. Draw the photoelectric energy balance.", draw: true, photon: 4, derived: true },
  { id: "collector-computational-hc", question: "The sodium emitter has work function 2 eV. Light of wavelength 400 nm falls on the emitter. The emitted electrons reach a collector. Take hc = 1240.0 eV nm. Draw the photoelectric energy balance.", draw: true, photon: 3.1 },
  { id: "collector-threshold-conservation", question: "The sodium emitter has work function 2 eV and threshold wavelength 620 nm. Light falls on the emitter and the stopping potential is 2 V. The emitted electrons reach a collector. Take hc = 1240 eV nm. Draw the photoelectric energy balance.", draw: true, photon: 4, derived: true },
  { id: "named-plate-missing-work-function", question: "Photons of energy 3 eV fall on sodium plate A. Draw the photoelectric energy balance.", draw: false },
  { id: "named-plate-missing-incident-source", question: "The work function of sodium is 2 eV. Light falls on sodium plate A. Draw the photoelectric energy balance.", draw: false },
  { id: "generic-symbolic-preserved", question: "Explain the photoelectric effect. The Planck constant is unreadable J s. Draw a photoelectric energy schematic.", draw: true, symbolic: true },
  { id: "foreign-illuminated-plate", question: "The work function of sodium is 2 eV. Photons of energy 3 eV fall on copper plate A. Draw the photoelectric energy balance.", draw: false },
  { id: "named-plate-agreeing-repeat-wavelength", question: "The work function of sodium is 2 eV. Light of wavelength 400 nm falls on sodium plate A. The wavelength is 400 nm. Take hc = 1240.0 eV nm. Draw the photoelectric energy balance.", draw: true, photon: 3.1 },
  { id: "same-metal-bounded-ellipsis", question: "The work function of caesium is 2.1 eV; that of cesium is also 2.1 eV. Light of frequency 1e15 Hz falls on Cs. Draw the photoelectric diagram.", draw: true, phi: 2.1, photon: 4.135667696923859 },
  { id: "kinetic-intervening-ellipsis-not-work-function", question: "The work function of caesium is 2.1 eV. The kinetic energy is 2.1 eV; that of cesium is also 2.1 eV. Light of frequency 1e15 Hz falls on Cs. Draw the photoelectric diagram.", draw: false },
  { id: "named-plate-conflicting-repeat-wavelength", question: "The work function of sodium is 2 eV. Light of wavelength 400 nm falls on sodium plate A. The wavelength is 350 nm. Take hc = 1240.0 eV nm. Draw the photoelectric energy balance.", draw: false },
];
const results = rows.map(row => {
  const radiation = readRadiationSource(row.question);
  const outputs: Array<{ route: string; document: SceneDocument | null; compiled: ReturnType<typeof compileSceneDocument> | null }> = [];
  try {
    assert.equal(radiation.status, row.symbolic ? "symbolic" : row.draw ? "source" : "declined");
    for (const route of ["chemistry", "physics"] as const) {
      const document = route === "chemistry" ? buildAtomicRadiationScene(row.question, [], false)
        : OPTICS_GENERATORS.photoelectric!({ question: row.question, slots: {}, sources: {}, quantities: [], schematic: false });
      const compiled = document ? compileSceneDocument(document) : null;
      outputs.push({ route, document, compiled });
      assert.equal(Boolean(document), row.draw && (!row.symbolic || route === "physics"));
      if (!document) continue;
      assert.ok(compiled?.ok && compiled.renderScene, "ordinary compiler accepts the whole source-derived scene");
      assert.equal(document.source.question, row.question);
      const texts = compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text] : []);
      if (row.symbolic) { assert.equal(document.quantities.length, 0); assert.equal(document.source.nonMetric, true); continue; }
      assert.ok(radiation.status === "source" && radiation.model.kind === "photoelectric");
      assert.ok(Math.abs(radiation.model.photonEnergyEV - row.photon!) < 1e-12);
      assert.equal(radiation.model.workFunctionEV, row.phi ?? 2);
      assert.equal(radiation.model.photonEnergyBasis === "conservation_from_emitted_result", !!row.derived);
      if (row.derived) {
        assert.ok(document.quantities.some(quantity => quantity.symbol === "E" && quantity.value === 4 && quantity.provenance === "derived"));
        assert.ok(document.quantities.some(quantity => quantity.symbol === "Vstop" && quantity.value === 2));
        assert.ok(texts.some(text => /derived/i.test(text)));
        assert.ok(texts.some(text => /λ0=620/.test(text)), "threshold is retained as a threshold, never an incident wavelength");
      } else {
        const visible = texts.map(text => /^(?:E|hν)=([0-9]+(?:\.[0-9]+)?) eV$/.exec(text)).find(Boolean);
        assert.ok(visible && Math.abs(Number(visible[1]) - row.photon!) <= 0.005, "source photon-energy ink follows the supplied datum or constant");
      }
      for (const binding of radiation.model.bindings) assert.equal(row.question.slice(binding.reading.source.span.start, binding.reading.source.span.end), binding.reading.source.text);
    }
    return { id: row.id, error: null, radiation, outputs };
  } catch (error) { return { id: row.id, error: String(error), radiation, outputs }; }
});
const report = { checks: rows.length, failed: results.filter(result => result.error !== null).length, results };
const output = process.argv.indexOf("--out");
if (output >= 0) fs.writeFileSync(process.argv[output + 1]!, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ checks: report.checks, passed: report.checks - report.failed, failed: report.failed }));
if (report.failed) process.exitCode = 1;
