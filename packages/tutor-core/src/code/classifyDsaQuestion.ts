import { detectAlgorithm, looksLikeCodingProblem } from "@heytutor/scene-engine";
import type { CodeLessonLanguage } from "./codeLessonPlan";

export interface DsaClassification {
  isDsa: boolean;
  language: CodeLessonLanguage;
  /**
   * "explicit" names an unambiguous DSA topic; "algorithm" was recognised by
   * the scene-engine catalog; "problem_shape" reads like a coding problem
   * statement even though it names no technique; "inferred" needed code intent.
   */
  confidence: "explicit" | "algorithm" | "problem_shape" | "inferred" | "none";
  /** Set when the catalog recognised a family we can draw a real trace for. */
  algorithmId?: string;
}

/** Topics that only occur in a programming context. */
const EXPLICIT_DSA_TERMS =
  /\b(?:linked\s+list|doubly\s+linked|binary\s+search(?:\s+tree)?|bst\b|binary\s+tree|avl\s+tree|red[- ]black\s+tree|quick\s*sort|merge\s*sort|bubble\s+sort|insertion\s+sort|selection\s+sort|heap\s*sort|counting\s+sort|radix\s+sort|topological\s+sort|dijkstra|bellman[- ]ford|floyd[- ]warshall|kruskal|prim'?s\s+algorithm|breadth[- ]first|depth[- ]first|\bbfs\b|\bdfs\b|dynamic\s+programming|memoi[sz]ation|two[- ]pointers?|sliding\s+window|backtracking|hash\s*(?:map|table)|hashmap|priority\s+queue|(?:min|max)[- ]heap|adjacency\s+(?:list|matrix)|\btrie\b|union[- ]find|disjoint\s+set|prefix\s+sum|segment\s+tree|fenwick|\bleetcode\b|\bdsa\b|data\s+structures?|big[- ]o\s+notation|time\s+complexity|space\s+complexity|kadane|longest\s+common\s+subsequence|edit\s+distance|knapsack|n[- ]queens|tower\s+of\s+hanoi|fizz\s*buzz|palindrome\s+(?:check|string)|reverse\s+a?\s*string|two\s+sum|three\s+sum|call\s+stack)\b/i;

/** Structures that also appear in physics/maths stems; need code intent too. */
const AMBIGUOUS_DSA_TERMS =
  /\b(?:stack|queue|tree|graph|heap|array|string|recursion|recursive|sorting|searching|traversal|algorithm|pointer)s?\b/i;

const CODE_INTENT =
  /\b(?:implement|pseudo\s*code|pseudocode|write\s+(?:a\s+|the\s+)?(?:code|program|function|method|class)|code\s+(?:for|to|of|it|this)|(?:show|write|see|give)\s+(?:me\s+)?(?:the\s+)?code\b|then\s+the\s+code\b|program\s+(?:for|to)|function\s+(?:that|to|which)|coding|source\s+code|solve\s+.{0,30}\bin\s+(?:python|java(?:script)?|typescript|c\+\+|cpp|js|ts)\b)\b/i;

const LANGUAGE_PATTERNS: Array<{ language: CodeLessonLanguage; pattern: RegExp }> = [
  { language: "typescript", pattern: /\b(?:typescript|\bts\b)\b/i },
  // `node` alone matched "the head node" and "n nodes", which put a
  // JavaScript panel on every list, tree and graph statement that named no
  // language, and pulled a standing-wave stem ("every node and antinode")
  // into the code lane.
  { language: "javascript", pattern: /\bjavascript\b|\bjs\b|\bnode\.js\b|\bnodejs\b/i },
  { language: "java", pattern: /\bjava\b(?!\s*script)/i },
  { language: "cpp", pattern: /(?:\bc\+\+|\bcpp\b)/i },
  { language: "python", pattern: /\b(?:python|py)\b/i },
];

/** Physics/maths phrasings that must never route to the code lesson. */
const NON_DSA_GUARDS =
  /\b(?:graph\s+of\s+|plot\s+the\s+graph|velocity[- ]time\s+graph|distance[- ]time\s+graph|v-t\s+graph|stack\s+of\s+(?:coins|blocks|books|plates)|heap\s+of\s+(?:sand|stones)|tree\s+diagram|probability\s+tree|family\s+tree|number\s+line)\b/i;

export function detectCodeLessonLanguage(question: string): CodeLessonLanguage {
  for (const { language, pattern } of LANGUAGE_PATTERNS) {
    if (pattern.test(question)) return language;
  }
  return "python";
}

/**
 * Routes a question to the DSA code-lesson pipeline. Deterministic and
 * conservative: an ambiguous structure word alone ("graph", "stack") stays on
 * the standard pipeline unless the question also shows code intent or names a
 * programming language.
 */
export function classifyDsaQuestion(question: string): DsaClassification {
  const language = detectCodeLessonLanguage(question);
  const guarded = NON_DSA_GUARDS.test(question);

  // The algorithm catalog is the strongest signal: if it recognises a family
  // it can also produce a real execution trace for the figure.
  if (!guarded) {
    const detected = detectAlgorithm(question);
    if (detected) {
      return { isDsa: true, language, confidence: "algorithm", algorithmId: detected.family.id };
    }
  }

  if (!guarded && EXPLICIT_DSA_TERMS.test(question)) {
    return { isDsa: true, language, confidence: "explicit" };
  }

  const namesLanguage = LANGUAGE_PATTERNS.some(({ pattern }) => pattern.test(question));
  if (!guarded && AMBIGUOUS_DSA_TERMS.test(question) && (CODE_INTENT.test(question) || namesLanguage)) {
    return { isDsa: true, language, confidence: "inferred" };
  }
  if (CODE_INTENT.test(question)) {
    return { isDsa: true, language, confidence: "inferred" };
  }

  // A bare LeetCode statement names no technique and uses no code-intent verb
  // — "Given an array nums and an integer target, return indices…" — so the
  // keyword router sent it to the physics pipeline. Match the shape instead.
  if (!guarded && looksLikeCodingProblem(question)) {
    return { isDsa: true, language, confidence: "problem_shape" };
  }

  return { isDsa: false, language, confidence: "none" };
}
