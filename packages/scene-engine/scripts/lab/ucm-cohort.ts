import { readFileSync } from "node:fs";
import { readUniformCircularSource, synthesizeUniformCircularScene } from "../../src";
const contract = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
for (const group of ["positives", "negatives", "holdouts", "nativeResiduals"]) for (const c of contract[group] ?? []) {
  const q = c.question ?? c.stem; if (!q) continue;
  const s = readUniformCircularSource(q) as any; const r = synthesizeUniformCircularScene(q);
  console.log(c.id.padEnd(24), (s?.status ?? "null").padEnd(8), s?.status === "numeric" ? `r=${s.radiusM} ω=${s.signedAngularVelocity ?? "±" + s.angularSpeed} v=${s.speed} a=${s.centripetalAcceleration} φ=${s.phase}` : s?.status === "reject" ? s.code : "", "|", r?.status ?? "null");
}
