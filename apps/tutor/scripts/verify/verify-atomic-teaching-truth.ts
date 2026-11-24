/** Scientific model checks survive the actual lesson, doubt and resume paths. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as core from "@heytutor/tutor-core";
import * as sourcePrompt from "../../../../packages/tutor-core/src/llm/systemPrompt";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const assembly = path.join(app, "features/tutor-session/lib/turn/turnTeachingPrompt.ts");
const compiled = ts.transpileModule(readFileSync(assembly, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} as Record<string, unknown> };
new Function("require", "module", "exports", compiled)((id: string) => {
  if (id === "@heytutor/tutor-core") return { ...core, ...sourcePrompt };
  return requireApp(id.startsWith("@/") ? path.join(app, id.slice(2))
    : id.startsWith(".") ? path.resolve(path.dirname(assembly), id) : id);
}, mod, mod.exports);
const prompts = mod.exports as unknown as typeof import("../../features/tutor-session/lib/turn/turnTeachingPrompt");

function promptPaths(question: string) {
  const turnPlan = { schemaVersion: "turn-plan/v3" as const, question,
    givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "none" as const };
  const common = { diagramPromptAddon: null, turnPlan, solverProjection: null,
    familiarity: "normal" as const, fastMode: false };
  const lesson = prompts.buildTurnTeachingPrompt({ ...common, question, codeLesson: null, isDsa: false });
  const doubt = prompts.buildDoubtTeachingPrompt({ ...common, lessonQuestion: question,
    boardRows: [{ workId: "w1", text: "Previous law" }], rowsLeftOnPage: 4, nextRowY: 220, codePanelShowing: false });
  const resumes = (["stop", "doubt"] as const).map(reason => prompts.buildResumeTeachingPrompt({ ...common,
    lessonQuestion: question, reason, boardRows: [{ workId: "w1", text: "Previous law" }],
    rowsLeftOnPage: 4, nextRowY: 220, codePanelShowing: false,
  }));
  return [lesson, doubt, ...resumes].flatMap(result => [result.systemPrompt, result.continuationPrompt]);
}

for (const question of ["Explain the Balmer series.", "Compare an isolated parent population with its activity.",
  "Explain energy conservation in a physical model."]) {
  for (const prompt of promptPaths(question)) {
    assert(prompt.includes("SCIENTIFIC MODEL AND OBSERVABLE CHECKS"), "scientific checks must survive every teaching path without topic routing");
    assert(/fixed-target scattering.*impact parameter b.*perpendicular distance.*undeflected incoming asymptote/i.test(prompt),
      "Impact parameter retains its original incoming-line meaning, not a changing radial distance");
    assert(/Distinguish b.*instantaneous radial separation.*actual distance of closest approach/i.test(prompt),
      "Impact parameter must remain distinct from both radial separation and closest approach");
    assert(/scattering angle.*forward incident direction.*outgoing asymptotic direction.*not.*backward incident arm/i.test(prompt),
      "Scattering uses the forward incident direction rather than a supplementary angle");
    assert(/requested experimental setup.*input preparation and control.*interaction region.*detector\/readout.*observations/i.test(prompt),
      "The requested setup survives figure unavailability without a chapter-specific teaching route");
    assert(prompt.includes('"the marked angle"') && /Define an angle.*in words.*absent figure/i.test(prompt),
      "No-figure prompts forbid claiming that an absent angle mark is visible");
    assert(/one-electron.*many-electron/i.test(prompt), "state the atomic model validity limit");
    assert(/electron is not an atom.*no constituent protons/i.test(prompt), "do not transfer the atom's composition to its electron");
    assert(/nuclear charge \+Ze.*Z k e\^2\/r\^2/i.test(prompt), "one electron alone does not establish a unit nuclear charge");
    assert(/one-electron nonrelativistic fixed-nucleus circular Coulomb model/i.test(prompt), "classical centripetal balance must not govern an explicitly relativistic source");
    assert(/Z=1.*hydrogen.*explicitly stated illustrative case/i.test(prompt), "a hydrogen specialization must remain conditional when unstated");
    assert(/radius is radial.*velocity is tangential.*perpendicular/i.test(prompt), "an orbit explanation retains the required radius and velocity relationship");
    assert(/Balmer.*ultraviolet/i.test(prompt), "visible examples cannot certify a complete spectral series");
    assert(/atomic.*nuclear mass convention/i.test(prompt), "do not mix measured atom and nucleus masses");
    assert(prompt.includes("M_atom = M_nucleus + Z m_e - B_e/c^2") && /B_e is its positive total electronic binding energy/i.test(prompt),
      "atomic and nuclear masses retain the electronic binding correction");
    assert(/neglecting electronic binding.*approximation.*approximately equal.*speech and WRITE/i.test(prompt),
      "an approximate mass sum cannot become an exact work-row equality");
    assert(/free neutral carbon-12 atom at rest in its ground state/i.test(prompt),
      "the atomic mass unit retains its reference-state definition");
    assert(/Binding energy per nucleon B\/A.*complete nuclear disassembly.*not the separation energy.*particular nucleon/i.test(prompt),
      "average binding and an individual nucleon separation are distinct observables");
    assert(/total rest energy.*electronic/i.test(prompt), "nuclear reaction Q states are distinct from electron energy states");
    assert(/Q.*initial.*final/i.test(prompt), "Q sign retains its stated initial-minus-final convention");
    assert(/signed system change.*final minus initial/i.test(prompt) && /positive photon energy.*initial minus final/i.test(prompt),
      "An emitted photon's positive energy must remain distinct from the negative change in the emitting atom");
    assert(/every participant on both sides.*incident.*emitted/i.test(prompt),
      "Conservation includes the incoming projectile as well as every outgoing product");
    assert(/Bq.*seconds/i.test(prompt), "activity includes its time-unit conversion");
    assert(/decay constant.*instantaneous probability rate.*not a finite-interval probability/i.test(prompt),
      "a decay constant exceeding one per time unit must not become a probability exceeding one");
    assert(/constant.*1-exp\(-lambda\*dt\).*lambda\*dt.*small-interval approximation/i.test(prompt),
      "finite-interval decay probability retains exponential survival and its approximation limit");
    assert(/normalized.*dimensionless/i.test(prompt), "fractions cannot be labelled as raw counts or activity");
    assert(/own board working cannot override.*solver-bound/i.test(prompt), "preserve the existing numeric authority boundary");
  }
}

// Copied-runtime checks keep evaluator answers outside the deployed source.
// The preflight runs this prompt contract and the external evaluator as two
// separately required jobs. Ordinary invocations still run both here.
if (!process.argv.includes("--prompt-only")) {
  execFileSync("python3", [path.join(app, "../../output/atoms-nuclei-implementation-2026-11-16/evaluate-teaching.py"), "--self-test"], { stdio: "inherit" });
}
console.log(`verify-atomic-teaching-truth: all8 teaching paths retain model, mass, Q, spectrum and observable checks${process.argv.includes("--prompt-only") ? "; external evaluator is a separate preflight job" : "; evaluator negative controls pass"}`);
