import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve } from "node:path";
import { readGalleryEntries, type GalleryEntry } from "./gallery";
import type { AnchorVerdict, DiagramAnchor } from "./anchors";

interface Candidate {
  arm: DiagramAnchor["arm"];
  subject: string;
  part12Verdict: AnchorVerdict;
  roundDir: string;
  entry: GalleryEntry;
}

function candidates(roundDir: string, arm: Candidate["arm"]): Candidate[] {
  return readGalleryEntries(roundDir).flatMap((entry) => {
    const verdict = entry.judgment?.verdict;
    if (!entry.png || (verdict !== "right" && verdict !== "partial" && verdict !== "wrong")) return [];
    return [{
      arm,
      subject: entry.id.split("|")[0] ?? "unknown",
      part12Verdict: verdict,
      roundDir,
      entry,
    }];
  });
}

/** Round-robin across arm × subject × prior verdict; stable ids break ties. */
export function selectAnchorCandidates(input: readonly Candidate[], limit = 40): Candidate[] {
  const buckets = new Map<string, Candidate[]>();
  for (const candidate of [...input].sort((a, b) => a.entry.id.localeCompare(b.entry.id))) {
    const key = `${candidate.arm}|${candidate.subject}|${candidate.part12Verdict}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  }
  const keys = [...buckets.keys()].sort();
  const selected: Candidate[] = [];
  for (let depth = 0; selected.length < limit; depth += 1) {
    let added = 0;
    for (const key of keys) {
      const candidate = buckets.get(key)?.[depth];
      if (!candidate) continue;
      selected.push(candidate);
      added += 1;
      if (selected.length === limit) break;
    }
    if (added === 0) break;
  }
  if (selected.length !== limit) throw new Error(`only ${selected.length} judged Part 12 figures were available`);
  return selected;
}

function html(cards: readonly Omit<DiagramAnchor, "verdict" | "note" | "markedBy">[]): string {
  const payload = JSON.stringify(cards).replaceAll("<", "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Diagram anchor marking</title><style>
  body{margin:0;background:#f3f0e9;color:#18212b;font:15px/1.45 system-ui,sans-serif}header{position:sticky;top:0;z-index:2;padding:16px 24px;background:#f3f0e9ee;border-bottom:1px solid #ccd3d9;display:flex;justify-content:space-between;align-items:center}h1{margin:0;font:700 23px Georgia,serif}.count{color:#54616d}button{padding:9px 14px;border:0;border-radius:7px;background:#0f6472;color:white;font-weight:700}main{width:min(1320px,calc(100% - 32px));margin:20px auto 60px;display:grid;gap:16px}.card{background:white;border:1px solid #d4dbe0;border-radius:12px;overflow:hidden}.head{padding:14px 18px;border-bottom:1px solid #d4dbe0}.head h2{font-size:17px;margin:0}.meta{color:#63707b;font:12px ui-monospace,monospace;margin-top:5px}.body{display:grid;grid-template-columns:minmax(420px,1.3fr) minmax(300px,.7fr)}.visual{padding:16px;border-right:1px solid #d4dbe0}.visual img{display:block;width:100%;max-height:560px;object-fit:contain;border:1px solid #d4dbe0}.review{padding:16px}.expect h3{font-size:11px;text-transform:uppercase;color:#63707b;margin:12px 0 4px}.expect ul{margin:0;padding-left:18px}.choices{display:flex;gap:10px;margin:18px 0 10px}.choices label{border:1px solid #aab5bd;border-radius:999px;padding:7px 11px}.choices label:has(input:checked){background:#dceff1;border-color:#0f6472}textarea{width:100%;min-height:64px;padding:8px}.unmarked{outline:3px solid #d48b30}@media(max-width:850px){.body{grid-template-columns:1fr}.visual{border-right:0;border-bottom:1px solid #d4dbe0}}</style></head><body>
  <header><div><h1>Part 12 diagram anchors</h1><div class="count" id="count">0 / ${cards.length} marked</div></div><button id="export">Export anchors.jsonl</button></header><main id="cards"></main><script>
  const cards=${payload}; const key="heytutor-owner-diagram-anchors-v1"; let saved={}; try{saved=JSON.parse(localStorage.getItem(key)||"{}")}catch{}
  const esc=s=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  const list=(title,items)=>'<section class="expect"><h3>'+title+'</h3>'+(items.length?'<ul>'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'—')+'</section>';
  const root=document.getElementById("cards");
  for(const card of cards){const state=saved[card.id]||{};const el=document.createElement("article");el.className="card";el.dataset.id=card.id;el.innerHTML='<div class="head"><h2>'+esc(card.question)+'</h2><div class="meta">'+esc(card.id)+' · '+esc(card.subject)+' · '+esc(card.arm)+'</div></div><div class="body"><div class="visual"><img loading="lazy" src="'+esc(card.figurePath)+'"></div><div class="review">'+list("must show",card.mustShow)+list("must label",card.mustLabel)+list("must not show",card.mustNotShow)+'<div class="choices">'+["right","partial","wrong"].map(v=>'<label><input type="radio" name="'+esc(card.id)+'" value="'+v+'" '+(state.verdict===v?'checked':'')+'> '+v+'</label>').join('')+'</div><textarea placeholder="Optional owner note">'+esc(state.note||"")+'</textarea></div></div>';root.append(el)}
  const store=()=>{for(const el of root.children){saved[el.dataset.id]={verdict:el.querySelector('input:checked')?.value||"",note:el.querySelector('textarea').value}}localStorage.setItem(key,JSON.stringify(saved));const marked=cards.filter(c=>saved[c.id]?.verdict).length;document.getElementById("count").textContent=marked+" / "+cards.length+" marked"};root.addEventListener("change",store);root.addEventListener("input",store);store();
  document.getElementById("export").onclick=()=>{store();const missing=cards.filter(c=>!saved[c.id]?.verdict);for(const el of root.children)el.classList.toggle("unmarked",missing.some(c=>c.id===el.dataset.id));if(missing.length){alert("Mark all "+missing.length+" remaining cards first.");return}const lines=cards.map(c=>JSON.stringify({...c,verdict:saved[c.id].verdict,note:saved[c.id].note||"",markedBy:"owner"})).join("\\n")+"\\n";const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([lines],{type:"application/x-ndjson"}));a.download="anchors.jsonl";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),0)};
  </script></body></html>`;
}

export function writeAnchorGallery(options: {
  currentDir: string;
  strictDir: string;
  outputHtml: string;
  assetDir: string;
}): string {
  const selected = selectAnchorCandidates([
    ...candidates(options.currentDir, "current"),
    ...candidates(options.strictDir, "planner_examples_strict"),
  ]);
  mkdirSync(options.assetDir, { recursive: true });
  const galleryDir = dirname(options.outputHtml);
  const cards = selected.map((candidate, index) => {
    const source = resolve(candidate.roundDir, candidate.entry.png!);
    const fileName = `${String(index + 1).padStart(2, "0")}-${candidate.arm === "current" ? "current" : "strict"}-${basename(source)}`;
    const target = join(options.assetDir, fileName);
    copyFileSync(source, target);
    const bytes = readFileSync(target);
    return {
      id: `${candidate.arm}::${candidate.entry.id}`,
      rowId: candidate.entry.id,
      arm: candidate.arm,
      subject: candidate.subject,
      question: candidate.entry.question,
      figureNeed: candidate.entry.figureNeed,
      figureKind: candidate.entry.figureKind,
      mustShow: candidate.entry.mustShow,
      mustLabel: candidate.entry.mustLabel,
      mustNotShow: candidate.entry.mustNotShow,
      figurePath: relative(galleryDir, target).replaceAll("\\", "/"),
      figureSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  mkdirSync(dirname(options.outputHtml), { recursive: true });
  writeFileSync(options.outputHtml, html(cards));
  writeFileSync(resolve(dirname(options.outputHtml), "diagram-anchor-selection.jsonl"),
    cards.map((card) => JSON.stringify(card)).join("\n") + "\n");
  return options.outputHtml;
}

if (process.argv[1]?.endsWith("anchor-gallery.ts")) {
  const root = resolve(process.cwd(), ".lecture-lab/diagram-eval-300-fast-20261009");
  const output = writeAnchorGallery({
    currentDir: resolve(root, "current"),
    strictDir: resolve(root, "planner_examples_strict"),
    outputHtml: resolve(process.cwd(), "../../.context/diagram-anchor-gallery.html"),
    assetDir: resolve(process.cwd(), "../../data/diagram-eval/v1/anchor-images"),
  });
  console.log(`anchor gallery: ${output}`);
}
