/**
 * Live probe of the reference picture pipeline on real questions. Paid: one
 * cheap query call plus up to three Ember-1 judge calls per question. Uses an
 * in-memory store, so it never touches the database.
 *
 *   pnpm --filter @heytutor/tutor exec dotenv -e .env.local -- tsx scripts/live/reference-picture-probe.ts --max-usd 1.5 [--only heart]
 *
 * Writes each accepted picture, its plan, and the judge trail to
 * .context/reference-picture/probe/<slug>/ at the repo root.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReferencePicturePlan, ReferencePictureRecord } from "@heytutor/drawing";
import { actualLlmCost } from "@/lib/billing/paidUsage";
import { parseProviderUsage, usageDetailsFromParsed } from "@/lib/obs/providerUsage";
import { createPictureSpend, findReferencePicture, type FindPictureDeps, type PictureUsage } from "@/lib/reference-picture/findReferencePicture";
import { buildStrokePlan } from "@/lib/reference-picture/strokePlan";

const QUESTIONS: Array<{ slug: string; subject: string; question: string; expect: "picture" | "none" }> = [
  { slug: "animal-cell", subject: "other", question: "Explain the structure of an animal cell with a labelled diagram.", expect: "picture" },
  { slug: "plant-cell", subject: "other", question: "Draw and label a plant cell. How is it different from an animal cell?", expect: "picture" },
  { slug: "heart", subject: "other", question: "Describe the structure of the human heart and how blood flows through it.", expect: "picture" },
  { slug: "nephron", subject: "other", question: "Explain the structure and function of a nephron.", expect: "picture" },
  { slug: "flower", subject: "other", question: "Label the parts of a flower and state the function of each.", expect: "picture" },
  { slug: "neuron", subject: "other", question: "What is a neuron? Describe its structure.", expect: "picture" },
  { slug: "eye", subject: "other", question: "Explain the structure of the human eye.", expect: "picture" },
  { slug: "digestive", subject: "other", question: "Describe the human digestive system.", expect: "picture" },
  { slug: "mitosis", subject: "other", question: "Explain the stages of mitosis.", expect: "picture" },
  { slug: "photosynthesis", subject: "other", question: "Explain the process of photosynthesis.", expect: "picture" },
  { slug: "dna", subject: "other", question: "Describe the double helix structure of DNA.", expect: "picture" },
  { slug: "distillation", subject: "chemistry", question: "Describe the apparatus used for simple distillation of salt water.", expect: "picture" },
  { slug: "ac-generator", subject: "physics", question: "Explain the working of an AC generator with a diagram.", expect: "picture" },
  { slug: "transformer", subject: "physics", question: "Explain the principle and construction of a step up transformer.", expect: "picture" },
  { slug: "hinglish-heart", subject: "other", question: "Dil ki structure samjhao, blood flow ke saath.", expect: "picture" },
  { slug: "quadratic", subject: "maths", question: "Solve x^2 - 5x + 6 = 0.", expect: "none" },
  { slug: "essay", subject: "other", question: "Write a short essay on the causes of the French Revolution.", expect: "none" },
];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function costOf(usages: readonly PictureUsage[]): number {
  return usages.reduce((sum, u) => sum + (u.lane === "generate" ? 0.06 : actualLlmCost(usageDetailsFromParsed(parseProviderUsage(u.usage)), u.model) ?? 0), 0);
}

const maxUsd = Number(arg("max-usd") ?? "1.5");
const only = arg("only");
const apiKey = process.env.FIREWORKS_API_KEY?.trim() ?? "";
if (!apiKey) throw new Error("FIREWORKS_API_KEY is not set");
const outRoot = resolve(process.cwd(), "../../.context/reference-picture/probe");

const pictures = new Map<string, { record: ReferencePictureRecord; plan: ReferencePicturePlan; image: Buffer }>();
const memoryStore: NonNullable<FindPictureDeps["store"]> = {
  readQueryCache: async () => null,
  writeQueryCache: async () => undefined,
  findPictureBySourceKey: async () => null,
  saveReferencePicture: async (input) => {
    const record: ReferencePictureRecord = { ...input.record, imageUrl: `/api/reference-picture/${input.record.id}/image`, planUrl: `/api/reference-picture/${input.record.id}/plan` };
    pictures.set(record.id, { record, plan: input.plan, image: input.image });
    return record;
  },
};

async function main(): Promise<void> {
  let spent = 0;
  const rows: string[] = [];
  for (const probe of QUESTIONS.filter((q) => !only || q.slug.includes(only))) {
    if (spent >= maxUsd) { console.log(`spend cap $${maxUsd} reached, stopping`); break; }
    const started = Date.now();
    const spend = createPictureSpend();
    const outcome = await findReferencePicture(probe.question, probe.subject, { apiKey, spend, store: memoryStore, imageProvider: null, strokePlan: buildStrokePlan });
    const usd = costOf(spend.usages);
    spent += usd;
    const ms = Date.now() - started;
    const dir = resolve(outRoot, probe.slug);
    mkdirSync(dir, { recursive: true });
    const summary = { probe, status: outcome.status, reason: outcome.status === "declined" ? outcome.reason : null, ms, usd, steps: outcome.steps, picture: outcome.status === "ready" ? outcome.picture : null };
    writeFileSync(resolve(dir, "outcome.json"), JSON.stringify(summary, null, 2));
    if (outcome.status === "ready") {
      const stored = pictures.get(outcome.picture.id);
      if (stored) {
        writeFileSync(resolve(dir, "picture.png"), stored.image);
        writeFileSync(resolve(dir, "plan.json"), JSON.stringify(stored.plan));
      }
    }
    const verdict = outcome.status === "ready" ? `READY ${outcome.picture.title}` : `declined ${outcome.reason}`;
    const flag = (outcome.status === "ready") === (probe.expect === "picture") ? "" : "  <-- unexpected";
    const row = `${probe.slug.padEnd(16)} ${String(Math.round(ms / 1000)).padStart(3)}s $${usd.toFixed(4)}  ${verdict}${flag}`;
    rows.push(row);
    console.log(row);
    for (const step of outcome.steps) console.log(`    ${step}`);
  }
  console.log(`\n${rows.length} questions, total $${spent.toFixed(3)} (cap $${maxUsd})`);
  writeFileSync(resolve(outRoot, "summary.txt"), `${rows.join("\n")}\ntotal $${spent.toFixed(3)}\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
