/**
 * Pull every recorded scene-document/v2 planner response out of lesson
 * recordings (`<root>/<lesson>/chat.json`, one entry per /api/chat request) and
 * write them as replay fixtures. Each fixture keeps the stem, the authoritative
 * turn plan the planner was shown, and the raw document it returned, so a gate
 * can replay validation and compile without a model call.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/extract-recorded-scene-documents.ts \
 *     --out /tmp/recorded.json --root v3=<path>/youtube-full/v3/lessons --root yt=<path>/youtube/lessons
 *
 * `--only <tag/lesson#index,...>` keeps just the named documents.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RecordedSceneDocument {
  id: string;
  phase: "plan" | "repair";
  question: string;
  turnPlan: Record<string, unknown> | null;
  document: Record<string, unknown>;
}

interface ChatEntry { url?: string; req?: string; text?: string; status?: number }

const SCENE_SYSTEM_MARKER = "scene-document/v2 operator program";
const PLAN_MARKER = "AUTHORITATIVE TURN PLAN V3\n";

function parseObject(content: string): Record<string, unknown> | null {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) text = fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    const value: unknown = JSON.parse(text.slice(first, last + 1));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function turnPlanFrom(prompt: string): Record<string, unknown> | null {
  const start = prompt.indexOf(PLAN_MARKER);
  if (start < 0) return null;
  const line = prompt.slice(start + PLAN_MARKER.length).split("\n")[0] ?? "";
  return parseObject(line);
}

function questionFrom(prompt: string): string {
  const match = prompt.match(/(?:^|\n)\s*QUESTION\s+([\s\S]*?)\n\s*\n/);
  return match?.[1]?.trim() ?? "";
}

export function extractRecordedSceneDocuments(roots: Array<[string, string]>): RecordedSceneDocument[] {
  const out: RecordedSceneDocument[] = [];
  for (const [tag, root] of roots) {
    if (!existsSync(root)) throw new Error(`missing root ${root}`);
    for (const lesson of readdirSync(root).sort()) {
      const file = join(root, lesson, "chat.json");
      if (!existsSync(file)) continue;
      const entries = JSON.parse(readFileSync(file, "utf8")) as ChatEntry[];
      entries.forEach((entry, index) => {
        if (typeof entry.req !== "string" || typeof entry.text !== "string") return;
        let request: { messages?: Array<{ role: string; content: string }> };
        try { request = JSON.parse(entry.req); } catch { return; }
        const messages = request.messages ?? [];
        if (!messages[0]?.content.includes(SCENE_SYSTEM_MARKER)) return;
        let content = "";
        try {
          const body = JSON.parse(entry.text) as { choices?: Array<{ message?: { content?: string } }> };
          content = body.choices?.[0]?.message?.content ?? "";
        } catch { return; }
        const document = parseObject(content);
        if (!document) return;
        const prompt = messages[messages.length - 1]?.content ?? "";
        const repair = /Resolve every fatal error/.test(prompt);
        const turnPlan = turnPlanFrom(prompt);
        const recordedQuestion = typeof (document.source as Record<string, unknown> | undefined)?.question === "string"
          ? String((document.source as Record<string, unknown>).question)
          : "";
        const question = questionFrom(prompt) || String(turnPlan?.question ?? "") || recordedQuestion;
        out.push({ id: `${tag}/${lesson}#${index}`, phase: repair ? "repair" : "plan", question, turnPlan, document });
      });
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const roots: Array<[string, string]> = [];
  let outPath = "";
  let only: Set<string> | null = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--out") outPath = args[++i] ?? "";
    else if (args[i] === "--root") {
      const [tag, ...rest] = (args[++i] ?? "").split("=");
      roots.push([tag!, rest.join("=")]);
    } else if (args[i] === "--only") only = new Set((args[++i] ?? "").split(",").filter(Boolean));
  }
  if (!outPath || roots.length === 0) throw new Error("usage: --out <file> --root <tag>=<dir> [--root ...] [--only ids]");
  const documents = extractRecordedSceneDocuments(roots).filter((document) => !only || only.has(document.id));
  writeFileSync(outPath, `${JSON.stringify(documents)}\n`);
  console.log(`extract-recorded-scene-documents: ${documents.length} documents -> ${outPath}`);
}
