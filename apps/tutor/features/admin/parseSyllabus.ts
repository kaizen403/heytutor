export type SyllabusSubject = "physics" | "maths";

export interface SyllabusItem {
  id: string;
  subject: SyllabusSubject;
  unitNumber: number;
  unitTitle: string;
  tags: string[];
  subsection?: string;
  text: string;
}

export interface SyllabusUnit {
  subject: SyllabusSubject;
  number: number;
  title: string;
  tags: string[];
  items: SyllabusItem[];
}

export interface SyllabusTree {
  subjects: {
    physics: SyllabusUnit[];
    maths: SyllabusUnit[];
  };
}

const UNIT_HEADER_RE = /^### Unit (\d+): (.+)$/;
const CHECKBOX_RE = /^- \[ \] (.+)$/;
const SUBSECTION_RE = /^\*\*(.+):\*\*$/;
const TAG_RE = /\[([^\]]+)\]/g;

function extractTags(line: string): string[] {
  const tags: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(TAG_RE.source, TAG_RE.flags);
  while ((match = re.exec(line)) !== null) {
    tags.push(match[1]!);
  }
  return tags;
}

function stripTags(title: string): string {
  return title.replace(/\s*\[[^\]]+\]/g, "").trim();
}

function makeItemId(subject: SyllabusSubject, unitNumber: number, itemIndex: number): string {
  return `${subject}|${unitNumber}|${itemIndex}`;
}

/**
 * Parses docs/jee-syllabus-checklist.md into a structured tree.
 * Stops at "## Summary: First-Focus Units".
 */
export function parseSyllabus(markdown: string): SyllabusTree {
  const tree: SyllabusTree = {
    subjects: { physics: [], maths: [] },
  };

  let currentSubject: SyllabusSubject | null = null;
  let currentUnit: SyllabusUnit | null = null;
  let currentSubsection: string | undefined;
  let itemIndex = 0;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();

    if (line.startsWith("## Summary:")) {
      break;
    }

    if (line === "## Physics — All Units") {
      currentSubject = "physics";
      currentUnit = null;
      currentSubsection = undefined;
      continue;
    }

    if (line === "## Mathematics — All Units") {
      currentSubject = "maths";
      currentUnit = null;
      currentSubsection = undefined;
      continue;
    }

    if (!currentSubject) {
      continue;
    }

    const unitMatch = line.match(UNIT_HEADER_RE);
    if (unitMatch) {
      const number = Number.parseInt(unitMatch[1]!, 10);
      const rawTitle = unitMatch[2]!;
      const tags = extractTags(rawTitle);
      const title = stripTags(rawTitle);

      currentUnit = {
        subject: currentSubject,
        number,
        title,
        tags,
        items: [],
      };
      tree.subjects[currentSubject].push(currentUnit);
      itemIndex = 0;
      currentSubsection = undefined;
      continue;
    }

    if (!currentUnit) {
      continue;
    }

    const subsectionMatch = line.match(SUBSECTION_RE);
    if (subsectionMatch) {
      currentSubsection = subsectionMatch[1]!.trim();
      continue;
    }

    const checkboxMatch = line.match(CHECKBOX_RE);
    if (checkboxMatch) {
      const text = checkboxMatch[1]!.trim();
      const id = makeItemId(currentSubject, currentUnit.number, itemIndex);
      itemIndex += 1;

      currentUnit.items.push({
        id,
        subject: currentSubject,
        unitNumber: currentUnit.number,
        unitTitle: currentUnit.title,
        tags: currentUnit.tags,
        subsection: currentSubsection,
        text,
      });
    }
  }

  return tree;
}

export function flattenItems(tree: SyllabusTree): SyllabusItem[] {
  return [...tree.subjects.physics, ...tree.subjects.maths].flatMap((unit) => unit.items);
}

export function countItems(tree: SyllabusTree): number {
  return flattenItems(tree).length;
}
