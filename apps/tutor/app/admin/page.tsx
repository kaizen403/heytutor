import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { AdminPlayground, parseSyllabus } from "@/features/admin";

export const metadata: Metadata = {
  title: "Syllabus Playground",
};

function loadSyllabusMarkdown(): string {
  const docPath = join(process.cwd(), "../../docs/jee-syllabus-checklist.md");
  return readFileSync(docPath, "utf8");
}

export default function AdminPage() {
  const markdown = loadSyllabusMarkdown();
  const tree = parseSyllabus(markdown);

  return <AdminPlayground tree={tree} />;
}
