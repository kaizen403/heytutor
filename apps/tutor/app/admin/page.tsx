import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { AdminPlayground, syllabusTreeFromTaxonomy } from "@/features/admin";
import { parseProbeFile, type ProbeQuestion } from "@/features/admin/lib/probes";

export const metadata: Metadata = {
  title: "Syllabus Playground",
};

function repoDataPath(...segments: string[]): string {
  return join(process.cwd(), "../../data", ...segments);
}

function loadSyllabusTaxonomy(): unknown {
  return JSON.parse(readFileSync(repoDataPath("question-bank/syllabus-taxonomy.json"), "utf8")) as unknown;
}

function loadProbeQuestions(): ProbeQuestion[] {
  const probesDir = repoDataPath("syllabus-probes");
  const files = readdirSync(probesDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const questions: ProbeQuestion[] = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(probesDir, file), "utf8")) as unknown;
    questions.push(...parseProbeFile(raw));
  }
  return questions;
}

export default function AdminPage() {
  const tree = syllabusTreeFromTaxonomy(loadSyllabusTaxonomy());
  const probes = loadProbeQuestions();

  return <AdminPlayground tree={tree} probes={probes} />;
}
