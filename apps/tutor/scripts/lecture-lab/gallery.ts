import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  needsHumanReview,
  readJudgeQueue,
  readRoundJudgments,
  type DiagramJudgment,
} from "./judging";
import type { DiagramEmptyCause } from "./diagramEval";

export interface GalleryEntry {
  id: string;
  question: string;
  figureNeed: string;
  figureKind: string;
  mustShow: string[];
  mustLabel: string[];
  mustNotShow: string[];
  png: string | null;
  figureSource: string;
  tier: string;
  family: string;
  figureCommitMs: number | null;
  emptyCause: DiagramEmptyCause | null;
  examplesUsed: Array<{ id: string; question: string; family: string | null; archetype: string | null }>;
  judgment?: DiagramJudgment;
  needsHuman?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function list(label: string, items: readonly string[]): string {
  return `<section class="expectation"><h3>${label}</h3>${items.length > 0
    ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : '<p class="muted">none</p>'}</section>`;
}

function metadata(entry: GalleryEntry): string {
  const time = entry.figureCommitMs === null ? "—" : `${(entry.figureCommitMs / 1000).toFixed(1)}s`;
  return `<dl class="metadata">
    <div><dt>source</dt><dd>${escapeHtml(entry.figureSource)}</dd></div>
    <div><dt>tier</dt><dd>${escapeHtml(entry.tier)}</dd></div>
    <div><dt>family</dt><dd>${escapeHtml(entry.family)}</dd></div>
    <div><dt>figure time</dt><dd>${time}</dd></div>
    <div><dt>empty cause</dt><dd>${escapeHtml(entry.emptyCause ?? "—")}</dd></div>
    <div><dt>examples</dt><dd>${escapeHtml(entry.examplesUsed.map((example) => example.id).join(", ") || "—")}</dd></div>
  </dl>`;
}

function figure(entry: GalleryEntry): string {
  return entry.png
    ? `<div class="figure"><img src="${escapeHtml(entry.png)}" alt="Rendered figure for ${escapeHtml(entry.id)}" loading="lazy"></div>`
    : '<div class="figure empty"><p>no figure</p></div>';
}

function shell(title: string, description: string, body: string, script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink:#18212b; --soft:#5d6975; --line:#d8dee5; --paper:#f4f1ea; --card:#fff; --accent:#0f6472; --accent-soft:#e1f1f2; --bad:#9f3131; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font:15px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    header { position:sticky; top:0; z-index:3; border-bottom:1px solid var(--line); background:rgba(244,241,234,.96); backdrop-filter:blur(10px); }
    .header-inner, main { width:min(1480px,calc(100% - 32px)); margin:auto; }
    .header-inner { display:flex; align-items:end; justify-content:space-between; gap:24px; padding:18px 0; }
    h1 { margin:0; font:700 24px/1.2 ui-serif,Georgia,serif; }
    .description { margin:4px 0 0; color:var(--soft); }
    main { padding:20px 0 56px; }
    .cards { display:grid; gap:16px; }
    .card { overflow:hidden; border:1px solid var(--line); border-radius:12px; background:var(--card); }
    .card[hidden] { display:none; }
    .card-head { display:flex; justify-content:space-between; gap:20px; padding:16px 18px; border-bottom:1px solid var(--line); }
    .card-head h2 { margin:0; font-size:17px; line-height:1.35; }
    .row-id { margin:6px 0 0; color:var(--soft); font:12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .badges { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; align-content:start; }
    .badge { border:1px solid #b8d5d9; border-radius:999px; background:var(--accent-soft); color:#164f58; padding:3px 8px; font-size:12px; white-space:nowrap; }
    .card-body { display:grid; grid-template-columns:minmax(360px,1.25fr) minmax(280px,.75fr); }
    .visual { min-width:0; padding:16px; border-right:1px solid var(--line); }
    .figure { display:grid; min-height:300px; place-items:center; overflow:hidden; border:1px solid var(--line); background:#fff; }
    .figure img { display:block; width:100%; height:auto; max-height:640px; object-fit:contain; }
    .figure.empty { background:repeating-linear-gradient(135deg,#fafafa,#fafafa 12px,#f2f4f5 12px,#f2f4f5 24px); color:var(--soft); text-transform:uppercase; letter-spacing:.08em; }
    .review { padding:16px 18px; }
    .expectation + .expectation { margin-top:14px; }
    .expectation h3 { margin:0 0 5px; color:var(--soft); font-size:11px; letter-spacing:.08em; text-transform:uppercase; }
    .expectation ul { margin:0; padding-left:18px; }
    .muted { margin:0; color:var(--soft); }
    .metadata { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin:18px 0 0; padding-top:14px; border-top:1px solid var(--line); }
    .metadata div { min-width:0; }
    .metadata dt { color:var(--soft); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
    .metadata dd { overflow:hidden; margin:2px 0 0; font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; text-overflow:ellipsis; white-space:nowrap; }
    .verdict { display:grid; grid-template-columns:160px 1fr; gap:10px; margin-top:16px; }
    label { color:var(--soft); font-size:12px; font-weight:650; }
    select, textarea, button { font:inherit; }
    select, textarea { width:100%; margin-top:5px; border:1px solid #aeb8c2; border-radius:7px; background:#fff; color:var(--ink); padding:8px; }
    textarea { min-height:72px; resize:vertical; }
    button { border:1px solid #0b5965; border-radius:7px; background:var(--accent); color:#fff; padding:8px 12px; font-weight:700; cursor:pointer; }
    .header-actions { display:flex; align-items:center; gap:14px; }
    .human-filter { display:flex; align-items:center; gap:7px; color:var(--ink); font-size:13px; }
    .human-filter input { width:auto; margin:0; }
    .badge.human { border-color:#e0b66b; background:#fff0cf; color:#704b0d; }
    button:focus-visible, select:focus-visible, textarea:focus-visible { outline:3px solid #82c8d1; outline-offset:2px; }
    .compare-card .card-body { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
    .arm { min-width:0; padding:16px; }
    .arm + .arm { border-left:1px solid var(--line); }
    .arm h3 { margin:0 0 10px; font-size:14px; }
    .compare-expectations { padding:14px 18px; border-top:1px solid var(--line); display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:20px; }
    @media (max-width:900px) {
      .header-inner { align-items:start; flex-direction:column; }
      .card-body, .compare-card .card-body { grid-template-columns:1fr; }
      .visual, .arm + .arm { border:0; border-top:1px solid var(--line); }
      .review { order:-1; }
      .verdict, .compare-expectations { grid-template-columns:1fr; }
    }
  </style>
</head>
<body>
  <header><div class="header-inner"><div><h1>${escapeHtml(title)}</h1><p class="description">${escapeHtml(description)}</p></div>${script ? '<div class="header-actions"><label class="human-filter"><input id="needs-human-filter" type="checkbox"> Needs human</label><button id="export" type="button">Export verdicts.csv</button></div>' : ""}</div></header>
  <main>${body}</main>
  ${script}
</body>
</html>`;
}

function verdictControls(entry: GalleryEntry): string {
  const verdict = entry.judgment?.verdict ?? "";
  const selected = (value: string) => value === verdict ? " selected" : "";
  return `<div class="verdict">
    <label>Verdict
      <select data-verdict aria-label="Verdict for ${escapeHtml(entry.id)}">
        <option value=""${selected("")}>unreviewed</option>
        <option value="right"${selected("right")}>right</option>
        <option value="partial"${selected("partial")}>partial</option>
        <option value="wrong"${selected("wrong")}>wrong</option>
        <option value="empty_ok"${selected("empty_ok")}>empty_ok</option>
        <option value="empty_bad"${selected("empty_bad")}>empty_bad</option>
      </select>
    </label>
    <label>Comment
      <textarea data-comment aria-label="Comment for ${escapeHtml(entry.id)}" placeholder="What is correct or missing?">${escapeHtml(entry.judgment?.reason ?? "")}</textarea>
    </label>
  </div>`;
}

export function buildGalleryHtml(entries: readonly GalleryEntry[], title: string): string {
  const priority = (entry: GalleryEntry): number => {
    if (entry.judgment?.verdict === "wrong") return 0;
    if (entry.needsHuman) return 1;
    if (entry.judgment?.verdict === "partial" || entry.judgment?.verdict === "empty_bad") return 2;
    if (entry.judgment) return 3;
    return 4;
  };
  const ordered = [...entries].sort((left, right) => priority(left) - priority(right) || left.id.localeCompare(right.id));
  const cards = ordered.map((entry) => `<article class="card" data-row-id="${escapeHtml(entry.id)}" data-judge-verdict="${escapeHtml(entry.judgment?.verdict ?? "")}" data-judge-comment="${escapeHtml(entry.judgment?.reason ?? "")}" data-needs-human="${entry.needsHuman ? "true" : "false"}">
    <div class="card-head"><div><h2>${escapeHtml(entry.question)}</h2><p class="row-id">${escapeHtml(entry.id)}</p></div><div class="badges">${entry.needsHuman ? '<span class="badge human">Needs human</span>' : ""}<span class="badge">${escapeHtml(entry.figureNeed)}</span><span class="badge">${escapeHtml(entry.figureKind)}</span></div></div>
    <div class="card-body"><div class="visual">${figure(entry)}${metadata(entry)}</div><div class="review">${list("must show", entry.mustShow)}${list("must label", entry.mustLabel)}${list("must not show", entry.mustNotShow)}${verdictControls(entry)}</div></div>
  </article>`).join("\n");
  const storageKey = JSON.stringify(`heytutor-diagram-verdicts:${title}`).replaceAll("<", "\\u003c");
  const script = `<script>
  (() => {
    const key = ${storageKey};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || "{}"); } catch { saved = {}; }
    const cards = [...document.querySelectorAll("[data-row-id]")];
    const store = () => {
      const next = {};
      for (const card of cards) next[card.dataset.rowId] = { verdict: card.querySelector("[data-verdict]").value, comment: card.querySelector("[data-comment]").value };
      localStorage.setItem(key, JSON.stringify(next));
    };
    for (const card of cards) {
      const prior = saved[card.dataset.rowId];
      card.querySelector("[data-verdict]").value = prior ? prior.verdict : card.dataset.judgeVerdict || "";
      card.querySelector("[data-comment]").value = prior ? prior.comment : card.dataset.judgeComment || "";
      card.addEventListener("change", store);
      card.addEventListener("input", store);
    }
    document.getElementById("needs-human-filter").addEventListener("change", (event) => {
      for (const card of cards) card.hidden = event.target.checked && card.dataset.needsHuman !== "true";
    });
    document.getElementById("export").addEventListener("click", () => {
      store();
      const quote = (value) => '"' + String(value).replaceAll('"', '""') + '"';
      const rows = [["row id", "verdict", "comment"], ...cards.map((card) => [card.dataset.rowId, card.querySelector("[data-verdict]").value, card.querySelector("[data-comment]").value])];
      const blob = new Blob([rows.map((row) => row.map(quote).join(",")).join("\\n") + "\\n"], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "verdicts.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 0);
    });
  })();
  </script>`;
  return shell(title, `${entries.length} evaluation rows · verdicts save in this browser`, `<div class="cards">${cards}</div>`, script);
}

function arm(entry: GalleryEntry | undefined, label: string): string {
  const judgment = entry?.judgment
    ? `<p class="row-id">judge: ${escapeHtml(entry.judgment.verdict)}${entry.needsHuman ? " · Needs human" : ""} · ${escapeHtml(entry.judgment.reason)}</p>`
    : "";
  return `<section class="arm"><h3>${escapeHtml(label)}</h3>${entry ? `${judgment}${figure(entry)}${metadata(entry)}` : '<div class="figure empty"><p>no result</p></div>'}</section>`;
}

export function buildComparisonGalleryHtml(
  left: readonly GalleryEntry[],
  right: readonly GalleryEntry[],
  leftLabel: string,
  rightLabel: string,
): string {
  const leftById = new Map(left.map((entry) => [entry.id, entry]));
  const rightById = new Map(right.map((entry) => [entry.id, entry]));
  const ids = [...new Set([...leftById.keys(), ...rightById.keys()])].sort();
  const cards = ids.map((id) => {
    const leftEntry = leftById.get(id);
    const rightEntry = rightById.get(id);
    const entry = leftEntry ?? rightEntry!;
    return `<article class="card compare-card"><div class="card-head"><div><h2>${escapeHtml(entry.question)}</h2><p class="row-id">${escapeHtml(id)}</p></div><div class="badges"><span class="badge">${escapeHtml(entry.figureNeed)}</span><span class="badge">${escapeHtml(entry.figureKind)}</span></div></div><div class="card-body">${arm(leftEntry, leftLabel)}${arm(rightEntry, rightLabel)}</div><div class="compare-expectations">${list("must show", entry.mustShow)}${list("must label", entry.mustLabel)}${list("must not show", entry.mustNotShow)}</div></article>`;
  }).join("\n");
  return shell(
    `${leftLabel} vs ${rightLabel}`,
    `${ids.length} rows keyed by evaluation id`,
    `<div class="cards">${cards}</div>`,
  );
}

export function readGalleryEntries(roundDir: string): GalleryEntry[] {
  const absolute = resolve(roundDir);
  const runsDir = join(absolute, "runs");
  const judgments = new Map(readRoundJudgments(absolute).map((judgment) => [judgment.id, judgment]));
  const missingLabels = new Map(readJudgeQueue(absolute).map((row) => [row.id, row.missing_labels]));
  return readdirSync(runsDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .flatMap((file) => {
      const raw: unknown = JSON.parse(readFileSync(join(runsDir, file), "utf8"));
      if (!isRecord(raw) || !isRecord(raw.diagram) || !isRecord(raw.evaluation)) return [];
      const row = raw.evaluation;
      const diagram = raw.diagram;
      const timings = isRecord(raw.timings) ? raw.timings : {};
      const id = stringOr(row.id, stringOr(raw.probeId, file.replace(/\.json$/, "")));
      const judgment = judgments.get(id);
      return [{
        id,
        question: stringOr(row.question, stringOr(raw.question, "")),
        figureNeed: stringOr(row.figure_need, "unknown"),
        figureKind: stringOr(row.figure_kind, "unknown"),
        mustShow: strings(row.must_show),
        mustLabel: strings(row.must_label),
        mustNotShow: strings(row.must_not_show),
        png: typeof diagram.png === "string" ? diagram.png : null,
        figureSource: stringOr(diagram.figureSource, "unrecorded"),
        tier: stringOr(diagram.tier, "none"),
        family: stringOr(diagram.family, "none"),
        figureCommitMs: typeof timings.figureCommitMs === "number" ? timings.figureCommitMs : null,
        emptyCause: typeof diagram.emptyCause === "string"
          ? diagram.emptyCause as DiagramEmptyCause
          : null,
        examplesUsed: Array.isArray(diagram.examplesUsed)
          ? diagram.examplesUsed.flatMap((example) => {
              if (!isRecord(example) || typeof example.id !== "string" || typeof example.question !== "string") return [];
              return [{
                id: example.id,
                question: example.question,
                family: typeof example.family === "string" ? example.family : null,
                archetype: typeof example.archetype === "string" ? example.archetype : null,
              }];
            })
          : [],
        judgment,
        needsHuman: judgment ? needsHumanReview(judgment, missingLabels.get(id) ?? []) : false,
      }];
    });
}

export function writeRoundGallery(roundDir: string): string {
  const absolute = resolve(roundDir);
  const path = join(absolute, "gallery.html");
  writeFileSync(path, buildGalleryHtml(readGalleryEntries(absolute), basename(absolute)));
  return path;
}

export function writeComparisonGallery(leftDir: string, rightDir: string): string {
  const left = resolve(leftDir);
  const right = resolve(rightDir);
  const path = join(right, "compare.html");
  const leftEntries = readGalleryEntries(left).map((entry) => ({
    ...entry,
    png: entry.png ? join(relative(right, left), entry.png).replaceAll("\\", "/") : null,
  }));
  writeFileSync(path, buildComparisonGalleryHtml(
    leftEntries,
    readGalleryEntries(right),
    basename(left),
    basename(right),
  ));
  return path;
}
