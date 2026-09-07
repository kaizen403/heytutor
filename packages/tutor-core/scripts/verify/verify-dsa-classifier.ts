/**
 * Routing gate for the code lesson lane.
 *
 * The old router was a keyword regex, so a real LeetCode prompt — "Given an
 * array nums and an integer target, return indices of the two numbers such
 * that they add up to target" — named no technique, used no code-intent verb,
 * and fell through to the physics pipeline. These cases are written the way a
 * problem is actually pasted in, not the way a topic is named.
 *
 * The negatives matter as much: a physics or maths stem that mentions a
 * "graph", a "tree diagram" or a "stack of coins" must stay on the standard
 * pipeline.
 */
import { classifyDsaQuestion, detectCodeLessonLanguage } from "../../src/code/classifyDsaQuestion";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- Bare problem statements, pasted as a student would paste them. ---
const STATEMENTS: string[] = [
  "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.",
  "Given the head of a singly linked list, reverse the list, and return the reversed list.",
  "Given a string s, find the length of the longest substring without repeating characters.",
  "You are given an array prices where prices[i] is the price of a given stock on the ith day. Return the maximum profit you can achieve.",
  "Given the root of a binary tree, return the inorder traversal of its nodes' values.",
  "There are a total of numCourses courses you have to take. Some courses have prerequisites. Return true if you can finish all courses.",
  "Given an m x n grid of characters board and a string word, return true if word exists in the grid.",
  "Example 1: Input: nums = [2,7,11,15], target = 9 Output: [0,1]. Constraints: 2 <= nums.length <= 10^4",
];
for (const question of STATEMENTS) {
  const result = classifyDsaQuestion(question);
  assert(result.isDsa, `problem statement must route to the code lane: "${question.slice(0, 60)}…"`);
}

// --- Named techniques resolve to a family we can trace. ---
const NAMED: Array<[string, string]> = [
  ["explain merge sort", "merge_sort"],
  ["reverse a linked list in java", "reverse_linked_list"],
  ["walk me through floyd warshall", "floyd_warshall"],
  ["implement dijkstra in python", "dijkstra"],
  ["how does kruskal's algorithm work", "kruskal"],
  ["explain binary search", "binary_search"],
  ["what is the edit distance between two strings", "edit_distance"],
  ["teach me the longest common subsequence", "lcs"],
  ["explain topological sort", "topological_sort"],
  ["what is a monotonic stack, next greater element", "monotonic_stack"],
];
for (const [question, algorithmId] of NAMED) {
  const result = classifyDsaQuestion(question);
  assert(result.isDsa, `"${question}" must route to the code lane`);
  assert(
    result.confidence === "algorithm" && result.algorithmId === algorithmId,
    `"${question}" should resolve to ${algorithmId}, got ${result.algorithmId ?? result.confidence}`,
  );
}

// --- Physics and maths stems must stay on the standard pipeline. ---
const NOT_DSA: string[] = [
  "A car accelerates from rest at 2 m/s^2 for 5 seconds. Find its final velocity.",
  "Draw the velocity-time graph for a body thrown vertically upward.",
  "Find the area under the curve y = x^2 between x = 0 and x = 3.",
  "A convex lens of focal length 20 cm forms an image of an object placed 30 cm away.",
  "Two point charges of 2 microcoulomb are placed 5 cm apart. Find the force between them.",
  "Draw a tree diagram for tossing three coins and find the probability of two heads.",
  "A stack of coins of mass 200 g rests on a table. Find the normal reaction.",
  "Prove that the sum of angles in a triangle is 180 degrees.",
  "Find the equation of the tangent to the circle x^2 + y^2 = 25 at the point (3, 4).",
];
for (const question of NOT_DSA) {
  const result = classifyDsaQuestion(question);
  assert(!result.isDsa, `"${question.slice(0, 56)}…" must NOT route to the code lane (got ${result.confidence})`);
}

// --- Language detection drives which code the panel shows. ---
const LANGUAGES: Array<[string, string]> = [
  ["reverse a linked list in java", "java"],
  ["implement quicksort in c++", "cpp"],
  ["write binary search in typescript", "typescript"],
  ["solve two sum in javascript", "javascript"],
  ["explain merge sort", "python"],
];
for (const [question, language] of LANGUAGES) {
  assert(
    detectCodeLessonLanguage(question) === language,
    `"${question}" should be ${language}, got ${detectCodeLessonLanguage(question)}`,
  );
}

// --- A named technique inside a guarded stem still declines. ---
assert(
  !classifyDsaQuestion("draw a tree diagram for the probability of two heads").isDsa,
  "a probability tree diagram must not be read as a binary tree",
);

console.log(
  `verify-dsa-classifier: ${STATEMENTS.length} statements, ${NAMED.length} named families, ` +
    `${NOT_DSA.length} negatives — all routed correctly`,
);
