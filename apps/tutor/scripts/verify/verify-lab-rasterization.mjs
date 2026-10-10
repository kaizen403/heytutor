import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [require.resolve("next/package.json")] }));
const directory = mkdtempSync(join(tmpdir(), "heytutor-rasterization-gate-"));
const colors = [[230, 10, 40], [10, 190, 70], [20, 40, 220], [210, 150, 10]];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  const fixtures = Array.from({ length: 64 }, (_, index) => {
    const file = join(directory, `${String(index).padStart(3, "0")}.svg`);
    const rgb = colors[index % colors.length];
    writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="rgb(${rgb.join(",")})"/></svg>`);
    return { file, rgb };
  });
  execFileSync(process.execPath, ["scripts/lecture-lab/svg2png.mjs", directory], { stdio: "inherit" });
  for (const { file, rgb } of fixtures) {
    const png = file.replace(/\.svg$/, ".png");
    const pixel = await sharp(png).extract({ left: 600, top: 350, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.deepEqual([...pixel], rgb, `capture must belong to ${file}, not a blank/previous document`);
    const evidence = JSON.parse(readFileSync(file.replace(/\.svg$/, ".render.json"), "utf8"));
    assert.equal(evidence.svgSha256, hash(readFileSync(file)));
    assert.equal(evidence.pngSha256, hash(readFileSync(png)));
    assert.equal(evidence.root, "svg");
    assert.equal(evidence.readyState, "complete");
    assert.equal(evidence.expectedUrl, evidence.actualUrl);
    assert.equal(evidence.paintReady, true);
  }
  console.log("lab rasterization: 64 alternating captures match their SVGs and immutable evidence");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
