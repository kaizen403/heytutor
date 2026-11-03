/** Query + search + judge only (no stroke plan, no store). Paid; hard cap via --max-usd. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { actualLlmCost } from "@/lib/billing/paidUsage";
import { parseProviderUsage, usageDetailsFromParsed } from "@/lib/obs/providerUsage";
import { writePictureQuery } from "@/lib/reference-picture/pictureQuery";
import { searchCommons, downloadPicture } from "@/lib/reference-picture/wikimediaSearch";
import { judgePicture, verdictAccepts } from "@/lib/reference-picture/pictureJudge";

const QS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const maxUsd = 0.6;
const apiKey = process.env.FIREWORKS_API_KEY!;
const out = resolve(process.cwd(), "../../.context/reference-picture/judge-probe");
const cost = (u: unknown, m: string) => actualLlmCost(usageDetailsFromParsed(parseProviderUsage(u)), m) ?? 0;
async function main(): Promise<void> {
  let spent = 0;
  for (const [qi, question] of QS.entries()) {
    if (spent > maxUsd) { console.log("cap reached"); break; }
    const t0 = Date.now();
    const q = await writePictureQuery(question, { apiKey });
    spent += cost(q.usage, q.model);
    console.log(`\nQ${qi}: ${question}\n  query ${Date.now() - t0}ms: ${JSON.stringify(q.query)}`);
    if (!q.query?.wantsPicture) continue;
    const t1 = Date.now();
    const cands = (await searchCommons(q.query.queries, { limit: 8 })).slice(0, 3);
    console.log(`  search ${Date.now() - t1}ms: ${cands.map((c) => `${c.title} [${c.license}]`).join(" | ")}`);
    const t2 = Date.now();
    await Promise.all(cands.map(async (c, i) => {
      const { bytes } = await downloadPicture(c.imageUrl);
      const png = await sharp(bytes).flatten({ background: "#ffffff" }).resize({ width: 1024, withoutEnlargement: true }).png().toBuffer();
      writeFileSync(resolve(out, `q${qi}-c${i}.png`), png);
      const r = await judgePicture({ mustShow: q.query!.mustShow, origin: "wikimedia", title: c.title, description: c.description, imageDataUrl: `data:image/png;base64,${png.toString("base64")}` }, { apiKey });
      spent += cost(r.usage, r.model);
      console.log(`  c${i} ${verdictAccepts(r.verdict, "wikimedia") ? "ACCEPT" : "reject"} conf=${r.verdict.confidence} lang=${r.verdict.labelLanguage} labels=${r.verdict.labels.length} ${c.title}\n     shows: ${r.verdict.shows}\n     problems: ${r.verdict.problems.join(" / ")}`);
    }));
    console.log(`  judge wall ${Date.now() - t2}ms`);
  }
  console.log(`\nspent ~$${spent.toFixed(4)} (rates: ember-1 billed at the unknown-model fallback)`);
}

main().catch((error) => { console.error(error); process.exit(1); });
