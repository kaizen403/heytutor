/**
 * Replay every lane's own probes through its builder, the validator and the
 * compiler, and say per lane: draws, declines, refusals, cue misses, label
 * misses. `tsx scripts/chemistry-lab/status.ts [lane]`.
 */
import { compileForLab } from "./lab";

const LANES: Record<string, string> = {
  vsepr: "../../src/chemistry/vsepr",
  lewis: "../../src/chemistry/lewis",
  mo: "../../src/chemistry/moDiagram",
  orbital: "../../src/chemistry/orbitalBox",
  cft: "../../src/chemistry/crystalField",
  coord: "../../src/chemistry/coordination",
  electrochem: "../../src/chemistry/electrochemistry",
  solid: "../../src/chemistry/unitCell",
  kinetics: "../../src/chemistry/kinetics",
  thermo: "../../src/chemistry/thermoGraphs",
  solutions: "../../src/chemistry/solutionsGraphs",
  periodic: "../../src/chemistry/periodicTrend",
  organic: "../../src/chemistry/organic/index",
};

interface Probe { question: string; expect: "draw" | "decline"; labels?: string[]; forbidLabels?: string[]; note?: string }

const only = process.argv[2];
const summary: string[] = [];
for (const [lane, path] of Object.entries(LANES)) {
  if (only && lane !== only) continue;
  let mod: Record<string, unknown>;
  try {
    mod = (await import(path)) as Record<string, unknown>;
  } catch (error) {
    summary.push(`${lane.padEnd(12)} IMPORT FAILED: ${(error as Error).message.split("\n")[0]}`);
    continue;
  }
  const family = Object.entries(mod).find(([key]) => key.endsWith("_FAMILY"))?.[1] as string | undefined;
  const probes = Object.entries(mod).find(([key]) => key.endsWith("_PROBES"))?.[1] as Probe[] | undefined;
  const cue = Object.entries(mod).find(([key, value]) => /^is[A-Za-z]+Stem$/.test(key) && typeof value === "function")?.[1] as ((q: string) => boolean) | undefined;
  const build = Object.entries(mod).find(([key, value]) => /^build[A-Za-z]+Scene$/.test(key) && typeof value === "function")?.[1] as ((q: string, quantities: unknown[], schematic: boolean) => unknown) | undefined;
  if (!family || !probes || !cue || !build) {
    summary.push(`${lane.padEnd(12)} CONTRACT INCOMPLETE family=${family} probes=${probes?.length} cue=${Boolean(cue)} build=${Boolean(build)}`);
    continue;
  }
  let draws = 0; let declines = 0; let refused = 0; let cueMiss = 0; let labelMiss = 0; let wrongDraw = 0;
  const problems: string[] = [];
  for (const probe of probes) {
    const fired = cue(probe.question);
    let document: unknown = null;
    let buildError: string | null = null;
    try {
      document = build(probe.question, [], false);
    } catch (error) {
      buildError = (error as Error).message;
    }
    const result = document ? compileForLab(document as never) : null;
    const drew = Boolean(result?.ok);
    if (probe.expect === "draw") {
      if (!fired) { cueMiss += 1; problems.push(`cue miss: ${probe.question.slice(0, 70)}`); }
      if (drew) draws += 1;
      else if (document) { refused += 1; problems.push(`REFUSED: ${probe.question.slice(0, 60)} :: ${result?.issues.map((issue) => issue.code + ": " + issue.message).join("; ").slice(0, 160)}`); }
      else { declines += 1; problems.push(`declined (expected draw): ${probe.question.slice(0, 70)}${buildError ? " :: " + buildError.slice(0, 100) : ""}`); }
      if (drew && probe.labels) {
        const missing = probe.labels.filter((label) => !result!.labels.includes(label));
        if (missing.length) { labelMiss += 1; problems.push(`labels missing ${JSON.stringify(missing)} on ${probe.question.slice(0, 50)} :: drawn=${JSON.stringify(result!.labels)}`); }
      }
      if (drew && probe.forbidLabels) {
        const present = probe.forbidLabels.filter((label) => result!.labels.includes(label));
        if (present.length) { labelMiss += 1; problems.push(`forbidden labels ${JSON.stringify(present)} on ${probe.question.slice(0, 50)}`); }
      }
    } else {
      if (drew) { wrongDraw += 1; problems.push(`DREW (expected decline): ${probe.question.slice(0, 70)} labels=${JSON.stringify(result!.labels)}`); }
      else declines += 1;
    }
  }
  summary.push(`${lane.padEnd(12)} ${family.padEnd(18)} probes=${probes.length} draws=${draws} declines=${declines} refused=${refused} cue_miss=${cueMiss} label_miss=${labelMiss} wrong_draw=${wrongDraw}`);
  for (const problem of problems) summary.push(`    ${problem}`);
}
console.log(summary.join("\n"));
