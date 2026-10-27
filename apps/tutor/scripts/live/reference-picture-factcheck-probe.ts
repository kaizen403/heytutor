/** Fact check repeatability probe (paid, ~$0.01 a call). Usage: tsx ... <png> <topic> <runs> */
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { factCheckPasses, factCheckPicture } from "@/lib/reference-picture/pictureJudge";

async function main(): Promise<void> {
  const [file, topic, runs = "3"] = process.argv.slice(2);
  const png = await sharp(readFileSync(file!)).flatten({ background: "#ffffff" }).resize({ width: 1024, withoutEnlargement: true }).png().toBuffer();
  const imageDataUrl = `data:image/png;base64,${png.toString("base64")}`;
  const outcomes = await Promise.all(Array.from({ length: Number(runs) }, async () => {
    const started = Date.now();
    const { result } = await factCheckPicture({ mustShow: topic!, imageDataUrl }, { apiKey: process.env.FIREWORKS_API_KEY! });
    const wrong = result.claims.filter((c) => !c.correct).map((c) => `${c.text}: ${c.why}`);
    const simplified = result.claims.filter((c) => c.simplified).length;
    return `${factCheckPasses(result) ? "PASS" : "FAIL"} ${Date.now() - started}ms claims=${result.claims.length} simplified=${simplified} ${wrong.join(" | ").slice(0, 220)}`;
  }));
  console.log(`${topic}:\n  ${outcomes.join("\n  ")}`);
}
main().catch((error) => { console.error(error); process.exit(1); });
