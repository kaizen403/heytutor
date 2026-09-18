import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { AdminPlayground, syllabusTreeFromTaxonomy } from "@/features/admin";
import { parseProbeFile, type ProbeQuestion } from "@/features/admin/lib/probes";
import { auth } from "@/auth";
import { isAuthDisabled } from "@/lib/authDisabled";
import { isAdminEmail } from "@/lib/auth/admins";

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

export default async function AdminPlaygroundPage() {
  if (!isAuthDisabled()) {
    const session = await auth();
    if (!(await isAdminEmail(session?.user?.email))) {
      redirect("/login?next=/admin/playground");
    }
  }

  const tree = syllabusTreeFromTaxonomy(loadSyllabusTaxonomy());
  const probes = loadProbeQuestions();

  return (
    <div className="relative">
      {/* The playground is full-bleed by design (AdminPlayground owns its own
          h-screen layout), so the way back to the panel is a floating chip
          rather than a header bar. */}
      <Link
        href="/admin"
        className="glass fixed bottom-4 left-4 z-40 flex items-center gap-1.5 rounded-full px-3 py-2 type-accent-xs text-soft transition-colors hover:text-frost"
      >
        <LayoutDashboard className="h-3.5 w-3.5" aria-hidden />
        Admin panel
      </Link>
      <AdminPlayground tree={tree} probes={probes} />
    </div>
  );
}
