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

interface TaxonomyTopic {
  topic_id: string;
  label: string;
}

interface TaxonomyUnit {
  unit_id: string;
  unit_number: number | null;
  name: string;
  topics: TaxonomyTopic[];
}

interface TaxonomySubject {
  subject_id: string;
  units: TaxonomyUnit[];
}

interface SyllabusTaxonomy {
  subjects: TaxonomySubject[];
}

/**
 * Product-focus chips from the local checklist. Taxonomy has no tag field;
 * keep these on the admin tree so Calculus / Mensuration units still badge.
 */
const UNIT_TAGS: Record<string, string[]> = {
  "maths|3": ["MENSURATION"],
  "maths|7": ["CALCULUS"],
  "maths|8": ["CALCULUS", "MENSURATION"],
  "maths|9": ["CALCULUS"],
  "maths|10": ["MENSURATION"],
  "maths|11": ["MENSURATION"],
};

function isSyllabusSubject(value: string): value is SyllabusSubject {
  return value === "physics" || value === "maths";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTaxonomy(value: unknown): SyllabusTaxonomy {
  if (!isRecord(value) || !Array.isArray(value.subjects)) {
    throw new Error("syllabus taxonomy is missing subjects");
  }

  const subjects: TaxonomySubject[] = [];
  for (const subject of value.subjects) {
    if (!isRecord(subject) || typeof subject.subject_id !== "string" || !Array.isArray(subject.units)) {
      throw new Error("syllabus taxonomy subject is malformed");
    }

    const units: TaxonomyUnit[] = [];
    for (const unit of subject.units) {
      if (
        !isRecord(unit) ||
        typeof unit.unit_id !== "string" ||
        typeof unit.name !== "string" ||
        (unit.unit_number !== null && typeof unit.unit_number !== "number") ||
        !Array.isArray(unit.topics)
      ) {
        throw new Error(`syllabus taxonomy unit is malformed: ${String(isRecord(unit) ? unit.unit_id : unit)}`);
      }

      const topics: TaxonomyTopic[] = [];
      for (const topic of unit.topics) {
        if (!isRecord(topic) || typeof topic.topic_id !== "string" || typeof topic.label !== "string") {
          throw new Error(`syllabus taxonomy topic is malformed under ${unit.unit_id}`);
        }
        topics.push({ topic_id: topic.topic_id, label: topic.label });
      }

      units.push({
        unit_id: unit.unit_id,
        unit_number: unit.unit_number,
        name: unit.name,
        topics,
      });
    }

    subjects.push({ subject_id: subject.subject_id, units });
  }

  return { subjects };
}

/**
 * Builds the admin tree from `data/question-bank/syllabus-taxonomy.json`.
 * Item ids are stable `topic_id`s, not markdown checkbox indexes.
 */
export function syllabusTreeFromTaxonomy(raw: unknown): SyllabusTree {
  const taxonomy = readTaxonomy(raw);
  const tree: SyllabusTree = {
    subjects: { physics: [], maths: [] },
  };

  for (const subject of taxonomy.subjects) {
    const subjectId = subject.subject_id;
    if (!isSyllabusSubject(subjectId)) {
      continue;
    }

    for (const unit of subject.units) {
      const unitNumber = unit.unit_number;
      if (typeof unitNumber !== "number") {
        continue;
      }

      const tags = UNIT_TAGS[unit.unit_id] ?? [];
      const items: SyllabusItem[] = unit.topics.map((topic) => ({
        id: topic.topic_id,
        subject: subjectId,
        unitNumber,
        unitTitle: unit.name,
        tags,
        text: topic.label,
      }));

      tree.subjects[subjectId].push({
        subject: subjectId,
        number: unitNumber,
        title: unit.name,
        tags,
        items,
      });
    }
  }

  if (tree.subjects.physics.length === 0 || tree.subjects.maths.length === 0) {
    throw new Error("syllabus taxonomy is missing physics or maths units");
  }

  return tree;
}

export function flattenItems(tree: SyllabusTree): SyllabusItem[] {
  return [...tree.subjects.physics, ...tree.subjects.maths].flatMap((unit) => unit.items);
}

export function countItems(tree: SyllabusTree): number {
  return flattenItems(tree).length;
}
