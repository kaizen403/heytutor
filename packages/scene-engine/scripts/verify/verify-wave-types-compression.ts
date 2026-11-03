/**
 * The wave_types archetype names a compression and a rarefaction on its row of
 * longitudinal wave particles. Production drew both names a quarter wavelength
 * off, where the particles are evenly spaced, so a student read an ordinary
 * stretch of the wave as a compression. Each name must sit where the drawn
 * particles are closest together (compression) or farthest apart
 * (rarefaction), measured from the compiled ink, never from the generator.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-wave-types-compression.ts
 */
import { synthesizeArchetypeScene } from "../../src/index";

const failures: string[] = [];
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { passed += 1; console.log(`pass ${name}`); return; }
  failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
};

const question = "Draw a labelled diagram for Wave motion and longitudinal and transverse waves.";
const scene = synthesizeArchetypeScene({ question });
check("the wave_types archetype draws", scene?.archetype === "wave_types", `got ${scene?.archetype ?? "nothing"}`);
if (scene) {
  const particles = scene.document.entities
    .filter((entity) => entity.kind === "segment" && /longitudinal wave/.test(entity.role ?? ""))
    .map((entity) => entity.id);
  const primitives = scene.renderScene.primitives;
  const xs = particles.flatMap((id) => {
    const line = primitives.find((primitive) => primitive.entityId === id && primitive.points.length >= 2);
    return line ? [(line.points[0]!.x + line.points.at(-1)!.x) / 2] : [];
  }).sort((a, b) => a - b);
  check("every longitudinal particle line is drawn", xs.length === particles.length && xs.length >= 12, `${xs.length} of ${particles.length}`);
  const gaps = xs.slice(1).map((x, index) => ({ at: (x + xs[index]!) / 2, width: x - xs[index]! }));
  const widths = gaps.map((gap) => gap.width).sort((a, b) => a - b);
  const markX = (id: string) => primitives.find((primitive) => primitive.entityId === id && primitive.kind === "point")?.points[0]?.x;
  // The local spacing at a mark is the gap whose midpoint is nearest to it.
  const spacingAt = (x: number) => gaps.reduce((best, gap) => Math.abs(gap.at - x) < Math.abs(best.at - x) ? gap : best).width;
  const band = Math.max(1, Math.round(widths.length * 0.15));
  const compression = markX("comp"), rarefaction = markX("rare");
  check("the compression is marked", compression !== undefined);
  check("the rarefaction is marked", rarefaction !== undefined);
  if (compression !== undefined) {
    const width = spacingAt(compression);
    check("the compression sits among the closest particles", width <= widths[band - 1]!,
      `spacing ${width.toFixed(1)} px, closest ${widths[0]!.toFixed(1)} px, widest ${widths.at(-1)!.toFixed(1)} px`);
  }
  if (rarefaction !== undefined) {
    const width = spacingAt(rarefaction);
    check("the rarefaction sits among the farthest apart particles", width >= widths[widths.length - band]!,
      `spacing ${width.toFixed(1)} px, closest ${widths[0]!.toFixed(1)} px, widest ${widths.at(-1)!.toFixed(1)} px`);
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
