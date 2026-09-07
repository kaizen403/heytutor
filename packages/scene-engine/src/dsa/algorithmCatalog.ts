/**
 * The algorithm families this engine can draw truthfully.
 *
 * Each entry owns four things: the phrases that identify it, the phrases that
 * rule it out, how to lift a concrete example out of the question, and the
 * simulator that turns that example into frames. A family whose slots cannot
 * be honoured returns null and the caller falls back to a structure-only
 * figure — never a guessed one. This mirrors the rule the archetype layer
 * already enforces for physics: text-only beats a wrong picture.
 *
 * Coverage is deliberately the high-frequency LeetCode patterns rather than
 * every algorithm. A family that is not here draws nothing rather than
 * something plausible.
 */
import {
  exampleInputSegment,
  letterEdgesFromWords,
  nodesFromEdges,
  parseAdjacencyList,
  parseBracketString,
  parseCallArgument,
  parseCharacters,
  parseCountedNoun,
  parseDesignCalls,
  parseFactorialArgument,
  parseInsertSequence,
  parseInsertValue,
  parseKeyList,
  parseLetterEdges,
  parseLevelOrder,
  parseListPair,
  parseLooseNumberList,
  parseMatrix,
  parseMergeSlots,
  parseNamedArray,
  parseNamedNumber,
  parseNodePair,
  parseNthFromEnd,
  parseNumberArray,
  parseNumberLists,
  parsePairs,
  parsePhoneDigits,
  parseSearchTarget,
  parseStartNode,
  parseStringArray,
  parseStringPair,
  parseTriples,
  parseTrieWords,
  parseWeightedEdges,
  type ExampleSource,
} from "./exampleSlots";
import {
  simulateBestTimeToBuy,
  simulateBinarySearchOnAnswer,
  simulateMergeFromBack,
  simulateRotatedBinarySearch,
  simulateThreeSum,
  simulateTrappingRainWater,
} from "./trace/simulators/arrayScans";
import {
  simulateCombinationSum,
  simulatePermutations,
  simulatePhoneLetters,
  simulateSubsets,
} from "./trace/simulators/backtracking";
import { simulateBinarySearch } from "./trace/simulators/binarySearch";
import {
  simulateClimbingStairs,
  simulateCoinChange,
  simulateHouseRobber,
  simulateJumpGame,
  simulateKadane,
  simulateLongestIncreasingSubsequence,
  simulateMinCostStairs,
} from "./trace/simulators/dpLinear";
import {
  simulateEditDistance,
  simulateKnapsack,
  simulateLongestCommonSubsequence,
} from "./trace/simulators/dpTable";
import { simulateGraphTraversal, simulateTopologicalSort } from "./trace/simulators/graph";
import {
  simulateBipartite,
  simulateFloodFill,
  simulateGridIslands,
  simulateRottingOranges,
  simulateUniquePaths,
} from "./trace/simulators/gridWalk";
import {
  simulateCharCountPairing,
  simulateHashMapBuckets,
  simulateHashMapCounting,
  simulateHashMapGrouping,
  simulateHashSetMembership,
} from "./trace/simulators/hashWalk";
import {
  simulateHeapFrequency,
  simulateHeapKWayMerge,
  simulateHeapSift,
  simulateHeapTopK,
} from "./trace/simulators/heap";
import { simulateCycleDetection, simulateReverseLinkedList } from "./trace/simulators/linkedList";
import {
  simulateAddTwoNumbers,
  simulateMergeTwoLists,
  simulateRemoveNthFromEnd,
  simulateReverseKGroup,
} from "./trace/simulators/listOps";
import {
  simulateBitCount,
  simulateInsertionSort,
  simulateMergeIntervals,
  simulateQuickSort,
  simulateSpiralLayers,
  simulateTrieInsertSearch,
  simulateXorFold,
} from "./trace/simulators/misc";
import { simulateKruskal, simulatePrim } from "./trace/simulators/mst";
import { simulateDijkstra, simulateFloydWarshall } from "./trace/simulators/shortestPath";
import { simulateBubbleSort, simulateMergeSort } from "./trace/simulators/sorting";
import {
  simulateHashMapTwoSum,
  simulateNextGreaterElement,
  simulateUnionFind,
} from "./trace/simulators/stackAndMap";
import {
  simulateMinStack,
  simulateQueueTwoStacks,
  simulateRecursionCallStack,
  simulateStackMatching,
  simulateStackQueueOps,
  type MinStackOp,
  type QueueOp,
} from "./trace/simulators/stackWalk";
import { simulateFixedWindow, simulateLongestUniqueWindow } from "./trace/simulators/slidingWindow";
import { simulateBstSearch, simulateTreeTraversal, type TraversalOrder } from "./trace/simulators/tree";
import {
  simulateBstInsert,
  simulateBstLca,
  simulateBstValidate,
  simulateTreeInvert,
  simulateTreeMaxPathSum,
  simulateTreeSerialize,
} from "./trace/simulators/treeRecursion";
import { simulateTwoPointers } from "./trace/simulators/twoPointers";
import type { AlgorithmTrace, TraceStructure } from "./trace/types";

export interface FamilyRun {
  trace: AlgorithmTrace;
  exampleSource: ExampleSource;
}

export interface AlgorithmFamily {
  id: string;
  title: string;
  structure: TraceStructure;
  /** Phrases that positively name this family. Weighted highest. */
  cues: RegExp[];
  /** Weaker signals — worth a point, never enough alone. */
  hints?: RegExp[];
  /** Present in the question means this family is wrong, whatever else matched. */
  vetoes?: RegExp[];
  /** Runs the simulator on the question's example, or the canonical one. */
  run(question: string): FamilyRun | null;
}

/** Try the question's own example first, then the family default. */
function grounded<T>(
  fromQuestion: T | null,
  fallback: T,
  simulate: (input: T) => AlgorithmTrace | null,
): FamilyRun | null {
  if (fromQuestion) {
    const trace = simulate(fromQuestion);
    if (trace) return { trace, exampleSource: "question" };
  }
  const trace = simulate(fallback);
  return trace ? { trace, exampleSource: "default" } : null;
}

const DEFAULT_EDGES = [
  { from: "A", to: "B", weight: 3 },
  { from: "A", to: "C", weight: 8 },
  { from: "B", to: "C", weight: 2 },
  { from: "B", to: "D", weight: 5 },
  { from: "C", to: "D", weight: 4 },
];

/**
 * The MST families need a graph where a cheap edge closes a cycle *before*
 * the tree is complete. On DEFAULT_EDGES the spanning tree finishes after
 * three accepts and Kruskal never rejects anything, which hides the only
 * reason union-find is in the algorithm at all.
 */
const MST_EDGES = [
  { from: "A", to: "B", weight: 1 },
  { from: "B", to: "C", weight: 2 },
  { from: "A", to: "C", weight: 3 },
  { from: "C", to: "D", weight: 4 },
];

/** The calls a MinStack walk knows how to draw; anything else declines. */
const MIN_STACK_CALLS = new Set(["push", "pop", "top", "getMin"]);
/** The calls a two-stack queue walk knows how to draw. */
const QUEUE_CALLS = new Set(["push", "pop", "peek", "empty"]);

export const ALGORITHM_FAMILIES: readonly AlgorithmFamily[] = [
  {
    id: "binary_search",
    title: "Binary search",
    structure: "array",
    cues: [
      /\bbinary\s+search\b/i,
      /\bsearch\s+(?:a\s+)?sorted\s+(?:array|list)\b/i,
      // Statement form: "sorted in ascending order ... search target in nums
      // ... return its index".
      /\bsearch\s+target\s+in\b/i,
      /\bsorted[\s\S]{0,140}\breturn\s+its\s+index\b/i,
      // Search Insert Position never says "search" or "its index": it says
      // "return the index if the target is found. If not, return the index
      // where it would be if it were inserted in order". It scored 2 against a
      // floor of 4 and drew nothing, on one of the most asked easy problems
      // there is. The walk is an ordinary binary search; only the miss case
      // returns a different number.
      /\bindex\s+where\s+it\s+would\s+be\s+if\s+it\s+were\s+inserted\b/i,
      /\bsearch\s+insert\s+position\b/i,
    ],
    hints: [/\bo\(\s*log\s*n\s*\)/i, /\bhalve\b/i, /\bsorted\b/i],
    // A rotated array is not sorted, and run() sorts the values before
    // searching, so the board would quietly search a different array.
    vetoes: [/\bbinary\s+search\s+tree\b/i, /\bbst\b/i, /\brotated\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          const target = parseNamedNumber(question, ["target", "key", "value"]) ?? parseSearchTarget(question);
          if (!values || target === null) return null;
          return { values: [...values].sort((a, b) => a - b), target };
        })(),
        { values: [2, 5, 8, 12, 16, 23, 38], target: 16 },
        simulateBinarySearch,
      ),
  },
  {
    id: "two_pointers",
    title: "Two pointers",
    structure: "array",
    cues: [
      /\btwo[- ]pointers?\b/i,
      /\bopposite\s+ends?\b/i,
      // The sorted pair-sum statement. Sorted input is what separates this
      // from the hash-map two sum, so the sortedness has to be in the cue.
      /\bsorted[\s\S]{0,140}\btwo\s+numbers\s+such\s+that\s+they\s+add\s+up\b/i,
      /\bnon[- ]decreasing[\s\S]{0,140}\badd\s+up\s+to\b/i,
    ],
    hints: [/\bsorted\b.*\bpair\b/i, /\bleft\b.*\bright\b/i],
    // Container With Most Water and palindrome checks are two-pointer walks,
    // but this simulator only knows the sorted pair-sum. Until they have
    // their own variants the honest answer is a decline, never this picture.
    vetoes: [/\bmost\s+water\b/i, /\bpalindrome\b/i, /\bmove\s+all\s+0'?s\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          const target = parseNamedNumber(question, ["target", "sum", "k"]);
          if (!values || target === null) return null;
          return { values: [...values].sort((a, b) => a - b), target };
        })(),
        { values: [1, 3, 4, 6, 8, 11], target: 10 },
        simulateTwoPointers,
      ),
  },
  {
    id: "sliding_window_fixed",
    title: "Fixed sliding window",
    structure: "array",
    cues: [
      /\bsliding\s+window\b/i,
      // "A window of size 2 m by 3 m is fitted in a wall" is a physics stem.
      /\bwindow\s+of\s+(?:size|length|width)\s+(?:k\b|\d{1,3}\s+(?:in|over|across|moving|sliding|that|elements?|items?|numbers?)\b)/i,
      /\bsubarray\s+of\s+(?:size|length)\b/i,
      // "Find a contiguous subarray whose length is equal to k"
      /\bsubarray\s+whose\s+(?:length|size)\s+is\s+(?:equal\s+to\s+)?k\b/i,
    ],
    hints: [/\bmaximum\s+sum\b/i, /\bconsecutive\b/i, /\bmaximum\s+average\b/i],
    // Sliding Window Maximum wants the largest value per window, which this
    // running-sum walk would confidently misdraw.
    vetoes: [/\blongest\s+substring\b/i, /\bmax(?:imum)?\s+sliding\s+window\b|\bsliding\s+window\s+max(?:imum)?\b|\bdeque\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          const width = parseNamedNumber(question, ["k", "size", "length", "width"]);
          if (!values || width === null) return null;
          return { values, width };
        })(),
        { values: [2, 1, 5, 1, 3, 2, 4], width: 3 },
        simulateFixedWindow,
      ),
  },
  {
    id: "sliding_window_unique",
    title: "Longest substring without repeating characters",
    structure: "array",
    cues: [
      /\blongest\s+substring\s+without\s+(?:repeat(?:ing|ed)?|duplicate)\s+(?:characters?|letters?)\b/i,
      /\bwithout\s+(?:repeating|duplicate)\s+characters?\b/i,
    ],
    hints: [/\bunique\s+characters?\b/i, /\bno\s+duplicates?\b/i],
    run: (question) =>
      grounded(
        (() => {
          const characters = parseCharacters(question);
          return characters ? { characters } : null;
        })(),
        { characters: [..."abcabcbb"] },
        simulateLongestUniqueWindow,
      ),
  },
  {
    id: "merge_sort",
    title: "Merge sort",
    structure: "array",
    cues: [/\bmerge\s*sort\b/i, /\bdivide\s+and\s+conquer\s+sort\b/i],
    hints: [/\bn\s*log\s*n\b/i, /\bstable\s+sort\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values && values.length >= 4 ? { values } : null;
        })(),
        { values: [38, 27, 43, 3, 9, 82] },
        simulateMergeSort,
      ),
  },
  {
    id: "bubble_sort",
    title: "Bubble sort",
    structure: "array",
    cues: [/\bbubble\s*sort\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values && values.length >= 4 && values.length <= 8 ? { values } : null;
        })(),
        { values: [5, 1, 4, 2, 8] },
        simulateBubbleSort,
      ),
  },
  {
    id: "reverse_linked_list",
    title: "Reverse a linked list",
    structure: "list",
    cues: [
      /\breverse\s+(?:a\s+|the\s+)?(?:singly\s+)?linked\s+list\b/i,
      // "Given the head of a singly linked list, reverse the list, and return
      // the reversed list." — the second mention drops the word "linked".
      /\blinked\s+list[\s\S]{0,120}\breverse\s+the\s+list\b/i,
      /\breturn\s+the\s+reversed\s+list\b/i,
      /\blinked\s+list\b[\s\S]{0,80}\breverse\s+(?:one|it)\b/i,
    ],
    hints: [/\bprev\b.*\bcurr\b/i, /\bin[- ]place\b/i],
    vetoes: [
      /\bcycle\b/i,
      /\bdoubly\b/i,
      // Reversing k at a time is its own family; a tie here declines and the
      // student gets no picture at all.
      /\bk\s+at\s+a\s+time\b|\bk[- ]groups?\b|\bgroups\s+of\s+k\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values && values.length >= 3 && values.length <= 6 ? { values } : null;
        })(),
        { values: [1, 2, 3, 4] },
        simulateReverseLinkedList,
      ),
  },
  {
    id: "linked_list_cycle",
    title: "Detect a cycle in a linked list",
    structure: "list",
    cues: [
      /\b(?:detect|find)\s+(?:a\s+)?cycle\b/i,
      /\bfloyd'?s?\s+(?:cycle|tortoise)/i,
      // "determine if the linked list has a cycle in it"
      /\bhas\s+(?:a\s+)?cycle\b/i,
    ],
    hints: [/\bslow\b.*\bfast\b/i, /\btortoise\b/i],
    vetoes: [/\bfloyd[- ]warshall\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          if (!values || values.length < 4 || values.length > 6) return null;
          // `pos` names the node the tail links back to. Ignoring it drew a
          // different cycle from the one the student is reading about.
          const pos = parseNamedNumber(question, ["pos"]);
          return pos !== null && pos >= 0 && pos < values.length
            ? { values, cycleEntry: pos }
            : { values };
        })(),
        { values: [3, 2, 0, 4] },
        simulateCycleDetection,
      ),
  },
  {
    id: "tree_traversal",
    title: "Binary tree traversal",
    structure: "tree",
    cues: [/\b(?:in|pre|post)[- ]?order\s+traversal\b/i, /\blevel[- ]order\s+traversal\b/i, /\btraverse\s+(?:a\s+|the\s+)?binary\s+tree\b/i],
    hints: [/\bbinary\s+tree\b/i, /\bdepth\s+of\s+(?:a\s+|the\s+)?tree\b/i],
    // The BST-insertion veto is gone and the key with it: `bst_insert` now
    // draws that walk and outscores this family 10 to 4 on the textbook ask,
    // so the line only ever cost a lesson the frames it was protecting.
    run: (question) => {
      const order: TraversalOrder = /\bpre[- ]?order\b/i.test(question)
        ? "preorder"
        : /\bpost[- ]?order\b/i.test(question)
          ? "postorder"
          : /\blevel[- ]?order\b/i.test(question) || /\bbfs\b/i.test(question)
            ? "levelorder"
            : "inorder";
      return grounded(
        (() => {
          const levelOrder = parseLevelOrder(question) ?? (() => {
            const values = parseNumberArray(question);
            return values && values.length >= 3 && values.length <= 9
              ? (values as Array<number | null>)
              : null;
          })();
          return levelOrder ? { levelOrder, order } : null;
        })(),
        { levelOrder: [8, 3, 10, 1, 6, null, 14] as Array<number | null>, order },
        simulateTreeTraversal,
      );
    },
  },
  {
    id: "bst_search",
    title: "Search a binary search tree",
    structure: "tree",
    cues: [/\bbinary\s+search\s+tree\b/i, /\bbst\b/i],
    hints: [/\bsearch\b.*\btree\b/i],
    // This simulator walks one search. Validation, deletion and kth-smallest
    // are different walks on the same tree, and a search for an accidental
    // target is a wrong lesson.
    //
    // The ancestor and insertion lines are gone: `bst_lca` outscores this
    // family 14 to 9 on LC 235 and 5 to 4 on the prose ask, and `bst_insert`
    // outscores it 10 to 5 on the textbook ask, so both statements now reach
    // a family that draws them rather than being vetoed into nothing.
    vetoes: [
      /\bvalid(?:ate|ity)?\b/i,
      /\bdelet(?:e|es|ed|ing|ion)\b/i,
      /\bkth\s+(?:smallest|largest)\b/i,
      /\b(?:build|built|construct(?:ed)?)\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const levelOrder = parseLevelOrder(question) ?? (parseNumberArray(question) as Array<number | null> | null);
          const target = parseNamedNumber(question, ["target", "val", "key"]) ?? parseSearchTarget(question);
          if (!levelOrder || target === null) return null;
          return { levelOrder, target };
        })(),
        { levelOrder: [8, 3, 10, 1, 6, null, 14] as Array<number | null>, target: 6 },
        simulateBstSearch,
      ),
  },
  {
    id: "graph_traversal",
    title: "Graph traversal",
    structure: "graph",
    cues: [/\bbreadth[- ]first\b/i, /\bdepth[- ]first\b/i, /\bconnected\s+components?\b/i],
    hints: [/\bbfs\b/i, /\bdfs\b/i, /\badjacency\b/i, /\bvisit(?:ed)?\b/i],
    // A grid of cells is a different picture from a lettered node graph, and
    // the grid families below now own those statements: this line hands them
    // over rather than standing in for a family that does not exist. Split
    // into two entries so a future family can retire one half without the
    // other. Measured: dropping either lets "number of islands with depth
    // first search" tie graph_traversal against grid_islands at 4, and a tie
    // inside MIN_MARGIN declines, so the question that has a family draws
    // nothing.
    vetoes: [/\btopological\b/i, /\bshortest\s+path\b/i, /\bbinary\s+tree\b/i, /\bgrid\b/i, /\bislands?\b/i],
    run: (question) => {
      const mode: "bfs" | "dfs" = /\bdepth[- ]first\b|\bdfs\b/i.test(question) ? "dfs" : "bfs";
      // A traversal is unweighted, so any weights in the statement are dropped
      // rather than drawn: labelling every edge of a BFS with a number the
      // algorithm never reads is a claim about the wrong thing.
      const parsed = parseLetterEdges(question);
      const start = parseStartNode(question) ?? undefined;
      const plain = (edges: ReadonlyArray<{ from: string; to: string }>) =>
        edges.map((edge) => ({ from: edge.from, to: edge.to }));
      return grounded(
        parsed ? { nodes: nodesFromEdges(parsed), edges: plain(parsed), mode, ...(start ? { start } : {}) } : null,
        { nodes: nodesFromEdges(DEFAULT_EDGES), edges: plain(DEFAULT_EDGES), mode },
        simulateGraphTraversal,
      );
    },
  },
  {
    id: "grid_islands",
    title: "Number of islands",
    structure: "matrix",
    cues: [
      /\bnumber\s+of\s+islands\b/i,
      // "an island is ... formed by connecting adjacent lands" and "a map of
      // '1's (land) and '0's (water)" both land here. The word island alone is
      // not enough: it also appears in a question about one island's area.
      /\bislands?\b[\s\S]{0,160}\b(?:land|water)\b|\b(?:land|water)\b[\s\S]{0,160}\bislands?\b/i,
      /\bcount\s+the\s+islands?\b/i,
    ],
    hints: [/\bgrid\b/i, /\bhorizontally\s+or\s+vertically\b/i, /\b4[- ]directional/i, /\bbinary\s+grid\b/i],
    // This walk counts components. Measuring one island, tracing its outline,
    // capturing enclosed regions and de-duplicating shapes are four different
    // answers over the same picture, and each would be drawn confidently wrong.
    vetoes: [
      /\b(?:max(?:imum)?|largest)\s+area\s+of\s+(?:an\s+)?island\b/i,
      /\bperimeter\b/i,
      /\bclosed\s+islands?\b/i,
      /\bdistinct\s+islands?\b/i,
      /\bcaptur(?:e|es|ed|ing)\b/i,
      /\bflood\s+fill\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const grid = parseMatrix(question, ["grid", "map", "board"]);
          return grid ? { grid } : null;
        })(),
        {
          grid: [
            ["1", "1", "0", "0", "1"],
            ["1", "1", "0", "0", "1"],
            ["0", "0", "0", "0", "0"],
            ["1", "0", "0", "0", "0"],
          ],
        },
        simulateGridIslands,
      ),
  },
  {
    id: "grid_dfs_fill",
    title: "Flood fill",
    structure: "matrix",
    cues: [
      /\bflood\s+fill\b/i,
      /\bimage\s*\[\s*sr\s*\]\s*\[\s*sc\s*\]/i,
      /\bsr\b[\s\S]{0,40}\bsc\b[\s\S]{0,40}\bcolor\b/i,
      /\bpixels?\b[\s\S]{0,120}\bsame\s+colou?r\b/i,
    ],
    hints: [/\bimage\b/i, /\bpixel\b/i, /\bcolou?r\b/i],
    // A fill spreads through one colour from one pixel. Counting components
    // and spreading from many sources are the two neighbours, and both would
    // draw a different number of frames over the same map.
    vetoes: [/\bislands?\b/i, /\bminutes?\b/i, /\bbipartite\b/i],
    run: (question) =>
      grounded(
        (() => {
          const image = parseMatrix(question, ["image", "grid", "screen"]);
          const startRow = parseNamedNumber(question, ["sr"]);
          const startColumn = parseNamedNumber(question, ["sc"]);
          const colour = parseNamedNumber(question, ["color", "colour", "newColor"]);
          if (!image || startRow === null || startColumn === null || colour === null) return null;
          return { image, startRow, startColumn, colour: String(colour) };
        })(),
        {
          image: [
            ["1", "1", "1"],
            ["1", "1", "0"],
            ["1", "0", "1"],
          ],
          startRow: 1,
          startColumn: 1,
          colour: "2",
        },
        simulateFloodFill,
      ),
  },
  {
    id: "grid_bfs_multi_source",
    title: "Rotting oranges",
    structure: "matrix",
    cues: [
      /\brotting\s+oranges?\b/i,
      /\brotten\s+orange\b/i,
      /\bfresh\s+orange\b/i,
      /\bminim(?:um|al)\s+number\s+of\s+minutes\b/i,
    ],
    hints: [/\bevery\s+minute\b/i, /\b4[- ]directionally\s+adjacent\b/i, /\bgrid\b/i],
    vetoes: [/\bislands?\b/i, /\bflood\s+fill\b/i],
    run: (question) =>
      grounded(
        (() => {
          const grid = parseMatrix(question, ["grid", "oranges", "board"]);
          return grid ? { grid } : null;
        })(),
        {
          grid: [
            ["2", "1", "1"],
            ["1", "1", "0"],
            ["0", "1", "1"],
          ],
        },
        simulateRottingOranges,
      ),
  },
  {
    id: "grid_bipartite",
    title: "Is the graph bipartite",
    structure: "graph",
    cues: [
      /\bbipartite\b/i,
      /\btwo\s+independent\s+sets\b/i,
      /\btwo[- ]colou?r(?:ing|ed|able)?\b/i,
      /\bpartitioned?\s+into\s+two\s+(?:independent\s+)?sets\b/i,
    ],
    hints: [/\bgraph\s*\[\s*u\s*\]/i, /\badjacency\s+list\b/i, /\bundirected\s+graph\b/i],
    // Bipartite matching and max flow run over a bipartite graph and are not
    // this two-colouring; the picture would be right and the lesson wrong.
    vetoes: [/\bmatching\b/i, /\bhopcroft\b/i, /\bmax(?:imum)?\s+flow\b/i],
    run: (question) =>
      grounded(
        (() => {
          const adjacency = parseAdjacencyList(question);
          return adjacency ? { adjacency } : null;
        })(),
        { adjacency: [[1, 2, 3], [0, 2], [0, 1, 3], [0, 2]] },
        simulateBipartite,
      ),
  },
  {
    id: "topological_sort",
    title: "Topological sort",
    structure: "graph",
    cues: [
      /\btopological\s+(?:sort|order)/i,
      /\bcourse\s+schedule\b/i,
      /\bprerequisites?\b/i,
      /\balien\s+(?:language|dictionary)\b/i,
      /\border\s+of\s+the\s+letters\s+is\s+unknown\b/i,
    ],
    hints: [/\bin[- ]?degree\b/i, /\bdirected\s+acyclic\b/i, /\bdag\b/i],
    run: (question) => {
      const fallback = [
        { from: "A", to: "C" },
        { from: "B", to: "C" },
        { from: "C", to: "D" },
        { from: "D", to: "E" },
      ];
      const fromQuestion = (() => {
        // "wrt, wrf, er, ett, rftt": each adjacent pair fixes one letter order.
        const words = parseStringArray(question);
        if (words && /\balien\b|\border\s+of\s+the\s+letters\b/i.test(question)) {
          const edges = letterEdgesFromWords(words);
          if (edges) return { nodes: nodesFromEdges(edges), edges };
        }
        // `prerequisites[i] = [a, b]` means b must be taken before a.
        const pairs = parsePairs(question, ["prerequisites"]);
        if (pairs) {
          const edges = pairs.map(([after, before]) => ({ from: String(before), to: String(after) }));
          return { nodes: nodesFromEdges(edges), edges };
        }
        const letters = parseLetterEdges(question);
        if (letters) {
          const edges = letters.map((edge) => ({ from: edge.from, to: edge.to }));
          return { nodes: nodesFromEdges(edges), edges };
        }
        return null;
      })();
      return grounded(
        fromQuestion,
        { nodes: nodesFromEdges(fallback), edges: fallback },
        simulateTopologicalSort,
      );
    },
  },
  {
    id: "floyd_warshall",
    title: "Floyd-Warshall all-pairs shortest paths",
    structure: "grid",
    cues: [/\bfloyd[- ]?warshall\b/i, /\ball[- ]pairs\s+shortest\b/i],
    hints: [/\bdistance\s+matrix\b/i, /\bintermediate\s+vertex\b/i],
    run: (question) => {
      const parsed = parseWeightedEdges(question);
      return grounded(
        parsed ? { nodes: nodesFromEdges(parsed), edges: parsed } : null,
        { nodes: nodesFromEdges(DEFAULT_EDGES), edges: DEFAULT_EDGES },
        simulateFloydWarshall,
      );
    },
  },
  {
    id: "dijkstra",
    title: "Dijkstra's shortest path",
    structure: "graph",
    cues: [
      /\bdijkstra\b/i,
      // "the shortest path between two points is a straight line" is geometry.
      /\bshortest\s+path\b[\s\S]{0,80}\b(?:vertex|vertices|node|nodes|graph|source|edges?)\b|\b(?:vertex|vertices|node|nodes|graph|source|edges?)\b[\s\S]{0,80}\bshortest\s+path\b/i,
      /\btimes\s*\[\s*i\s*\]\s*=\s*\(\s*u\s*i?\s*,\s*v\s*i?\s*,\s*w\s*i?\s*\)/i,
      /\bnetwork\s+delay\s+time\b/i,
      /\bminimum\s+time\s+(?:it\s+takes\s+)?for\s+all\s+(?:the\s+)?(?:n\s+)?nodes\s+to\s+receive\b/i,
    ],
    hints: [/\bweighted\s+graph\b/i, /\bpriority\s+queue\b/i, /\brelax\b/i, /\bdirected\s+edges?\b/i],
    vetoes: [/\bfloyd[- ]?warshall\b/i, /\ball[- ]pairs\b/i, /\bbellman[- ]ford\b/i],
    run: (question) => {
      const fromQuestion = (() => {
        // `times[i] = (u, v, w)` is the LeetCode form; `k` is the source.
        const triples = parseTriples(question, ["times", "edges", "flights"]);
        if (triples) {
          const edges = triples.map(([from, to, weight]) => ({ from: String(from), to: String(to), weight }));
          const source = parseNamedNumber(question, ["k", "src", "source", "start"]);
          return {
            nodes: nodesFromEdges(edges),
            edges,
            ...(source !== null ? { start: String(source) } : {}),
          };
        }
        const letters = parseWeightedEdges(question);
        if (letters) {
          const start = parseStartNode(question) ?? undefined;
          return { nodes: nodesFromEdges(letters), edges: letters, ...(start ? { start } : {}) };
        }
        return null;
      })();
      return grounded(
        fromQuestion,
        { nodes: nodesFromEdges(DEFAULT_EDGES), edges: DEFAULT_EDGES },
        simulateDijkstra,
      );
    },
  },
  {
    id: "kruskal",
    title: "Kruskal's minimum spanning tree",
    structure: "graph",
    cues: [
      /\bkruskal\b/i,
      /\bminimum\s+spanning\s+tree\b/i,
      /\bmst\b/i,
      /\bminimum\s+cost\s+to\s+(?:make\s+all\s+points\s+connected|connect\s+all\s+(?:the\s+)?points)\b/i,
      /\bexactly\s+one\s+simple\s+path\s+between\s+any\s+two\b/i,
    ],
    hints: [/\bspanning\b/i, /\bcheapest\s+edge\b/i, /\bmanhattan\s+distance\b/i],
    vetoes: [/\bprim'?s\b/i],
    run: (question) => {
      const fromQuestion = (() => {
        const letters = parseWeightedEdges(question);
        if (letters) return { nodes: nodesFromEdges(letters), edges: letters };
        // "minimum cost to connect all points": the graph is complete and the
        // weight of an edge is the Manhattan distance between its two points.
        const points = parsePairs(question, ["points"]);
        if (points && points.length >= 3 && points.length <= 5) {
          const edges: Array<{ from: string; to: string; weight: number }> = [];
          for (let i = 0; i < points.length; i += 1) {
            for (let j = i + 1; j < points.length; j += 1) {
              edges.push({
                from: String(i),
                to: String(j),
                weight: Math.abs(points[i]![0] - points[j]![0]) + Math.abs(points[i]![1] - points[j]![1]),
              });
            }
          }
          const positions: Record<string, { x: number; y: number }> = {};
          points.forEach(([x, y], index) => { positions[String(index)] = { x, y }; });
          return { nodes: nodesFromEdges(edges), edges, positions };
        }
        return null;
      })();
      return grounded(
        fromQuestion,
        { nodes: nodesFromEdges(MST_EDGES), edges: MST_EDGES },
        simulateKruskal,
      );
    },
  },
  {
    id: "prim",
    title: "Prim's minimum spanning tree",
    structure: "graph",
    cues: [/\bprim'?s?\s+algorithm\b/i],
    hints: [/\bgrow\b.*\btree\b/i],
    run: (question) => {
      const parsed = parseWeightedEdges(question);
      return grounded(
        parsed ? { nodes: nodesFromEdges(parsed), edges: parsed } : null,
        { nodes: nodesFromEdges(MST_EDGES), edges: MST_EDGES },
        simulatePrim,
      );
    },
  },
  {
    id: "lcs",
    title: "Longest common subsequence",
    structure: "grid",
    cues: [/\blongest\s+common\s+subsequence\b/i, /\blcs\b/i],
    hints: [/\bsubsequence\b/i, /\bdp\s+table\b/i],
    run: (question) =>
      grounded(parseStringPair(question), { a: "ABCB", b: "BDCB" }, simulateLongestCommonSubsequence),
  },
  {
    id: "edit_distance",
    title: "Edit distance",
    structure: "grid",
    cues: [
      /\bedit\s+distance\b/i,
      /\blevenshtein\b/i,
      // "the minimum number of operations required to convert word1 to word2"
      /\bmin(?:imum)?\s+(?:number\s+of\s+)?operations[\s\S]{0,60}\bconvert\b/i,
    ],
    hints: [/\binsert\b.*\bdelete\b.*\breplace\b/i, /\bmin(?:imum)?\s+operations\b/i],
    run: (question) => grounded(parseStringPair(question), { a: "horse", b: "ros" }, simulateEditDistance),
  },
  {
    id: "knapsack",
    title: "0/1 knapsack",
    structure: "grid",
    cues: [/\bknapsack\b/i],
    hints: [/\bcapacity\b/i, /\bmaximi[sz]e\s+value\b/i],
    // Only the capacity ever parsed, and the items were the canned ones, so a
    // half-parsed example was reported as the student's own. Either the whole
    // example comes from the question or the canonical one runs and says so.
    run: () => {
      const trace = simulateKnapsack({ weights: [1, 3, 4, 5], values: [1, 4, 5, 7], capacity: 7 });
      return trace ? { trace, exampleSource: "default" as ExampleSource } : null;
    },
  },
  {
    id: "dp_grid_paths",
    title: "Unique paths",
    structure: "grid",
    cues: [
      /\bunique\s+paths\b/i,
      /\brobot\b[\s\S]{0,200}\bmove\s+either\s+down\s+or\s+right\b/i,
      /\bnumber\s+of\s+(?:possible\s+)?unique\s+paths\b/i,
      /\bhow\s+many\s+(?:different\s+|distinct\s+)?paths\b[\s\S]{0,120}\b(?:grid|corner)\b/i,
    ],
    hints: [/\bdown\s+or\s+right\b/i, /\bbottom[- ]right\s+corner\b/i, /\bm\s*x\s*n\s+grid\b/i],
    // This table counts paths on an empty grid. Obstacles, a cost to minimise
    // and a Hamiltonian walk all fill the same shaped table with different
    // numbers, so the figure would be exactly as convincing and wrong.
    vetoes: [
      /\bobstacle\b/i,
      /\bminimum\s+path\s+sum\b/i,
      /\bcollect\s+(?:the\s+)?maximum\b/i,
      /\bwalk\s+over\s+every\s+empty\s+square\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const rows = parseNamedNumber(question, ["m"]);
          const columns = parseNamedNumber(question, ["n"]);
          if (rows === null || columns === null) return null;
          return { rows, columns };
        })(),
        { rows: 3, columns: 3 },
        simulateUniquePaths,
      ),
  },
  {
    id: "monotonic_stack",
    title: "Next greater element",
    structure: "grid",
    cues: [/\bnext\s+greater\b/i, /\bmonotonic\s+stack\b/i, /\bdaily\s+temperatures\b/i],
    hints: [/\bstack\b.*\bgreater\b/i, /\bspan\b/i],
    run: (question) => {
      const answer: "value" | "distance" = /\bdays\s+you\s+have\s+to\s+wait\b|\bdaily\s+temperatures\b|\bhow\s+many\s+days\b/i.test(question)
        ? "distance"
        : "value";
      return grounded(
        (() => {
          const values = parseNumberArray(question);
          return values && values.length >= 4 && values.length <= 8 ? { values, answer } : null;
        })(),
        { values: [2, 1, 2, 4, 3], answer },
        simulateNextGreaterElement,
      );
    },
  },
  {
    id: "stack_matching",
    title: "Valid parentheses with a stack",
    structure: "array",
    cues: [
      /\bvalid\s+parenthes[ei]s\b/i,
      /\bbalanced\s+(?:parenthes[ei]s|brackets?)\b/i,
      /\bopen\s+brackets?\s+must\s+be\s+closed\b/i,
      /\bevery\s+close\s+bracket\s+has\s+a\s+corresponding\s+open\s+bracket\b/i,
      /\bdetermine\s+if\s+the\s+input\s+string\s+is\s+valid\b/i,
      /\bmatch(?:ing)?\s+(?:the\s+)?brackets?\b/i,
    ],
    // "stack" is deliberately NOT a hint here: it is the one word Daily
    // Temperatures and Next Greater Element also use, and monotonic_stack
    // owns those. LC 20's own statement never says "stack" at all.
    hints: [/\bbrackets?\b/i, /\bparenthes[ei]s\b/i, /\bnest(?:ed|ing)\b/i],
    vetoes: [
      // Generate Parentheses is backtracking, and Longest Valid Parentheses
      // is a DP scan. Both would get a confident picture of the wrong walk.
      /\bgenerate\b[\s\S]{0,80}\bparenthes[ei]s\b/i,
      /\bwell[- ]formed\b/i,
      /\blongest\s+valid\s+parenthes[ei]s\b/i,
      /\bmin(?:imum)?\s+(?:number\s+of\s+)?(?:add|remove|insert|delet)/i,
      /\bremove\s+(?:the\s+)?(?:minimum|invalid)\b/i,
      // A stack that evaluates an expression is a different aside entirely.
      /\bcalculator\b|\bpostfix\b|\bpolish\s+notation\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const characters = parseBracketString(question);
          return characters ? { characters } : null;
        })(),
        // Example 1 of the statement, "()[]{}", never gets the stack more
        // than one deep, so the picture would never show why a stack is
        // needed. The default nests three deep; a pasted question still
        // walks its own string.
        { characters: [..."{[()]}"] },
        simulateStackMatching,
      ),
  },
  {
    id: "min_stack",
    title: "Min stack",
    structure: "array",
    cues: [
      /\bmin\s*stack\b/i,
      /\bretriev(?:e|ing)\s+the\s+min(?:imum)?\s+element\s+in\s+constant\s+time\b/i,
      /\bstack\s+that\s+supports\s+push,\s*pop,\s*top\b/i,
      /\bgetmin\b/i,
    ],
    hints: [/\bconstant\s+time\b/i, /\bo\(\s*1\s*\)/i, /\bdesign\s+a\s+stack\b/i, /\bauxiliary\s+stack\b/i],
    // The queue veto is what keeps this family off LC 232, which says
    // "stack" nine times. A monotonic stack answers a different question.
    vetoes: [/\bqueue\b/i, /\bmax\s*stack\b/i, /\bmonotonic\b/i, /\bnext\s+greater\b/i],
    run: (question) =>
      grounded(
        (() => {
          const calls = parseDesignCalls(question, "MinStack");
          if (!calls || calls.some((call) => !MIN_STACK_CALLS.has(call.name))) return null;
          if (calls.some((call) => call.name === "push" && call.args.length !== 1)) return null;
          const ops = calls.map((call): MinStackOp =>
            call.name === "push" ? { op: "push", value: call.args[0]! } : ({ op: call.name } as MinStackOp),
          );
          return { ops };
        })(),
        {
          ops: [
            { op: "push", value: -2 },
            { op: "push", value: 0 },
            { op: "push", value: -3 },
            { op: "getMin" },
            { op: "pop" },
            { op: "top" },
            { op: "getMin" },
          ] as MinStackOp[],
        },
        simulateMinStack,
      ),
  },
  {
    id: "queue_two_stacks",
    title: "Queue from two stacks",
    structure: "array",
    cues: [
      /\bqueue\s+using\s+(?:only\s+)?(?:two\s+)?stacks?\b/i,
      /\bmyqueue\b/i,
      /\bimplement\s+a\s+first\s+in\s+first\s+out\b/i,
      /\bpush\s+to\s+top,\s*peek\/pop\s+from\s+top\b/i,
    ],
    hints: [/\bfifo\b/i, /\bamortized\b/i, /\btwo\s+stacks\b/i, /\bdesign\b/i],
    vetoes: [
      // LC 225 is the mirror problem and this walk would draw it backwards.
      /\bstack\s+using\s+(?:only\s+)?(?:two\s+)?queues?\b/i,
      /\bcircular\s+queue\b/i,
      // NOT a bare /\bdeque\b/: LC 232's own notes say "deque (double-ended
      // queue)", so a bare deque veto rules this family out of its own
      // statement. The two patterns below catch what the veto was for.
      /\bmonotonic\s+deque\b/i,
      /\bmax(?:imum)?\s+sliding\s+window\b|\bsliding\s+window\s+max(?:imum)?\b/i,
      /\bpriority\s+queue\b/i,
      /\bmonotonic\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const calls = parseDesignCalls(question, "MyQueue");
          if (!calls || calls.some((call) => !QUEUE_CALLS.has(call.name))) return null;
          if (calls.some((call) => call.name === "push" && call.args.length !== 1)) return null;
          const ops = calls.map((call): QueueOp =>
            call.name === "push" ? { op: "push", value: call.args[0]! } : ({ op: call.name } as QueueOp),
          );
          return { ops };
        })(),
        {
          ops: [
            { op: "push", value: 1 },
            { op: "push", value: 2 },
            { op: "peek" },
            { op: "pop" },
            { op: "empty" },
          ] as QueueOp[],
        },
        simulateQueueTwoStacks,
      ),
  },
  {
    id: "recursion_call_stack",
    title: "Recursion and the call stack",
    structure: "array",
    cues: [
      /\bcall\s+stack\b/i,
      /\bexplain\s+recursion\b/i,
      /\brecursion\s+(?:using|with|and)\s+factorial\b/i,
      /\bfactorial\s*\(\s*\d{1,2}\s*\)/i,
      /\bhow\s+does\s+recursion\s+work\b/i,
    ],
    hints: [/\bbase\s+case\b/i, /\bunwind(?:s|ing)?\b/i, /\bstack\s+overflow\b/i, /\brecursive(?:ly)?\b/i, /\bfactorial\b/i],
    // This walk draws one recursion, factorial. Every other recursive shape
    // is a different picture, and drawing factorial beside a question about
    // memoised Fibonacci or a tree traversal would teach the wrong thing.
    vetoes: [
      /\bmemoi[sz]ation\b|\bdynamic\s+programming\b|\bmemo\s+table\b/i,
      /\bfibonacci\b|\bfib\s*\(/i,
      /\brecursion\s+tree\b/i,
      /\bhanoi\b/i,
      /\bmerge\s*sort\b|\bquick\s*sort\b/i,
      /\bbacktrack/i,
      /\bpermutations?\b|\bsubsets?\b|\bcombinations?\b/i,
      /\btraversal\b|\blinked\s+list\b|\bbinary\s+tree\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const n = parseFactorialArgument(question);
          return n !== null ? { n } : null;
        })(),
        { n: 4 },
        simulateRecursionCallStack,
      ),
  },
  {
    id: "stack_queue_ops",
    title: "Stack against queue",
    structure: "stacked",
    cues: [
      /\bdifference\s+between\s+(?:a\s+)?stacks?\s+and\s+(?:a\s+)?queues?\b/i,
      /\bstacks?\s+(?:and|vs\.?|versus)\s+(?:a\s+)?queues?\b/i,
      /\bqueues?\s+(?:and|vs\.?|versus)\s+(?:a\s+)?stacks?\b/i,
      /\blifo\b[\s\S]{0,80}\bfifo\b|\bfifo\b[\s\S]{0,80}\blifo\b/i,
    ],
    hints: [/\bpush\b[\s\S]{0,40}\bpop\b/i, /\benqueue\b|\bdequeue\b/i, /\bdata\s+structures?\b/i],
    // Naming both structures is the comparison lesson. Building one out of
    // the other, or asking for a stack that also reports its minimum, is a
    // specific algorithm with its own family, and each of those states both
    // words too, so every one of them has to be vetoed by name.
    vetoes: [
      /\bqueue\s+using\s+(?:only\s+)?(?:two\s+)?stacks?\b/i,
      /\bstack\s+using\s+(?:only\s+)?(?:two\s+)?queues?\b/i,
      /\bmin\s*stack\b/i,
      /\bmonotonic\b/i,
      /\bpriority\s+queue\b/i,
      /\bnext\s+greater\b/i,
      /\bvalid\s+parenthes[ei]s\b/i,
      /\bcall\s+stack\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const values = parseLooseNumberList(question);
          return values ? { values } : null;
        })(),
        { values: [1, 2, 3] },
        simulateStackQueueOps,
      ),
  },
  {
    id: "hash_map_two_sum",
    title: "Two sum with a hash map",
    structure: "array",
    cues: [
      /\btwo\s*sum\b/i,
      // "hash map" alone names a data structure, not this algorithm; it only
      // counts when the statement is also about a pair summing to a target.
      /\bhash\s*(?:map|table)\b[\s\S]{0,120}\b(?:two\s*sum|pair|complement|add(?:s|ing)?\s+up\s+to|sum(?:s|ming)?\s+to)\b/i,
      /\b(?:pair|complement|two\s*sum)\b[\s\S]{0,120}\bhash\s*(?:map|table)\b/i,
      // The canonical statement names no technique at all.
      /\breturn\s+indices\s+of\s+the\s+two\s+numbers\b/i,
      /\btwo\s+numbers\s+such\s+that\s+they\s+add\s+up\s+to\s+(?:the\s+)?target\b/i,
    ],
    hints: [/\bcomplement\b/i, /\bseen\b/i, /\bdictionary\b/i, /\bhash\s*(?:map|table)\b/i],
    vetoes: [
      /\bsorted\b/i,
      /\btwo[- ]pointers?\b/i,
      // "How does a hash map work internally?" is about buckets and collisions.
      /\bbuckets?\b|\bcollisions?\b|\bload\s+factor\b|\bhash\s+function\b|\bhow\s+does\s+a\s+hash\s*(?:map|table)\s+work\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          const target = parseNamedNumber(question, ["target", "sum", "k"]);
          if (!values || target === null) return null;
          return { values, target };
        })(),
        { values: [2, 7, 11, 15], target: 26 },
        simulateHashMapTwoSum,
      ),
  },
  {
    id: "hash_set_membership",
    title: "Contains duplicate with a hash set",
    structure: "array",
    cues: [
      /\bcontains\s+duplicate\b/i,
      /\bany\s+value\s+appears\s+at\s+least\s+twice\b/i,
      /\bevery\s+element\s+is\s+distinct\b/i,
      /\bcheck\s+(?:for\s+|whether\s+there\s+are\s+|if\s+there\s+are\s+)?duplicates?\b/i,
      /\bhash\s*set\b[\s\S]{0,120}\b(?:duplicates?|seen\s+before|membership)\b/i,
      /\b(?:duplicates?|seen\s+before)\b[\s\S]{0,120}\bhash\s*set\b/i,
    ],
    hints: [/\bhash\s*set\b/i, /\bdistinct\b/i, /\bmembership\b/i],
    vetoes: [
      /\bevery\s+element\s+appears\s+twice\s+except\b/i,
      /\bsingle\s+one\b/i,
      /\bwithout\s+(?:repeating|duplicate)\s+characters?\b/i,
      /\banagram\b/i,
      /\bremove\s+(?:the\s+)?duplicates?\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values ? { values } : null;
        })(),
        { values: [1, 2, 3, 1] },
        simulateHashSetMembership,
      ),
  },
  {
    id: "hash_map_counting",
    title: "Valid anagram with one count map",
    structure: "array",
    cues: [
      /\bvalid\s+anagram\b/i,
      /\bis\s+an\s+anagram\s+of\b/i,
      /\banagram\s+of\s+(?:s|t|the\s+other|another)\b/i,
      /\bare\s+(?:they\s+|these\s+|the\s+two\s+)?anagrams\b/i,
      /\bcharacter\s+counts?\s+(?:match|agree|are\s+equal)\b/i,
    ],
    hints: [/\banagram\b/i, /\brearrang(?:e|ed|ing)\b/i, /\bfrequency\s+(?:map|count)\b/i],
    vetoes: [/\bgroup\s+(?:the\s+)?anagrams?\b/i, /\bgroup\s+anagrams\b/i],
    run: (question) => grounded(parseStringPair(question), { a: "anagram", b: "nagaram" }, simulateHashMapCounting),
  },
  {
    id: "hash_map_grouping",
    title: "Group anagrams with a hash map",
    structure: "array",
    cues: [
      /\bgroup\s+anagrams?\b/i,
      /\bgroup\s+the\s+anagrams\s+together\b/i,
      /\banagrams?\b[\s\S]{0,60}\b(?:together|into\s+groups)\b/i,
      /\bgroup\b[\s\S]{0,40}\bthat\s+are\s+anagrams\b/i,
    ],
    hints: [/\barray\s+of\s+strings\b/i, /\bsorted\s+letters\b/i, /\banagrams\b/i],
    vetoes: [/\bis\s+an\s+anagram\s+of\b/i, /\bvalid\s+anagram\b/i],
    run: (question) =>
      grounded(
        (() => {
          const words = parseStringArray(question);
          return words ? { words } : null;
        })(),
        { words: ["eat", "tea", "tan", "ate", "nat", "bat"] },
        simulateHashMapGrouping,
      ),
  },
  {
    id: "char_count_pairing",
    title: "Longest palindrome from letter counts",
    structure: "array",
    cues: [
      /\blongest\s+palindrome\s+that\s+can\s+be\s+built\b/i,
      /\blength\s+of\s+the\s+longest\s+palindrome\b/i,
      /\bpalindrome\s+that\s+can\s+be\s+built\s+with\s+those\s+letters\b/i,
      /\bbuild\s+(?:a\s+|the\s+)?longest\s+palindrome\b/i,
    ],
    hints: [/\bcase\s+sensitive\b/i, /\bodd\s+counts?\b/i, /\bletter\s+counts?\b/i],
    vetoes: [
      /\bpalindromic\s+substring\b/i,
      /\breads\s+the\s+same\s+forward(?:s)?\s+and\s+backward\b/i,
      /\bpartition\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const characters = parseCharacters(question);
          return characters ? { characters } : null;
        })(),
        { characters: [..."abccccdd"] },
        simulateCharCountPairing,
      ),
  },
  {
    id: "hash_map_buckets",
    title: "How a hash map stores keys",
    structure: "stacked",
    cues: [
      /\bhow\s+(?:does|do)\s+(?:a\s+|an\s+)?hash\s*(?:map|table|set)s?\s+work\b/i,
      /\bhash\s*(?:map|table)\b[\s\S]{0,160}\b(?:buckets?|collisions?|chaining|load\s+factor)\b/i,
      /\b(?:buckets?|collisions?|chaining)\b[\s\S]{0,160}\bhash\s*(?:map|table|function)\b/i,
      /\bexplain\s+hashing\b/i,
      /\bexplain\s+(?:a\s+|the\s+|how\s+)?(?:hash\s*(?:map|table|set)s?|hashing)\b/i,
      /\bhash\s+function\b[\s\S]{0,160}\bbuckets?\b/i,
    ],
    hints: [/\bload\s+factor\b/i, /\bchaining\b/i, /\bopen\s+addressing\b/i],
    vetoes: [/\btwo\s*sum\b/i, /\breturn\s+indices\b/i, /\banagram\b/i],
    run: (question) =>
      grounded(
        (() => {
          const keys = parseKeyList(question) ?? parseNumberArray(question);
          const buckets = parseCountedNoun(question, ["buckets", "slots"]) ?? parseNamedNumber(question, ["buckets", "slots", "m"]);
          if (!keys || buckets === null) return null;
          return { keys, buckets };
        })(),
        { keys: [12, 7, 22, 3], buckets: 5 },
        simulateHashMapBuckets,
      ),
  },
  {
    id: "union_find",
    title: "Union-find",
    structure: "grid",
    cues: [
      /\bunion[- ]find\b/i,
      /\bdisjoint\s+set\b/i,
      /\bnumber\s+of\s+provinces\b/i,
      /\bedge\s+that\s+can\s+be\s+removed\b/i,
      /\bone\s+additional\s+edge\s+added\b/i,
      /\bredundant\s+connection\b/i,
    ],
    hints: [/\bconnected\b.*\bcomponents?\b/i, /\bpath\s+compression\b/i],
    run: (question) => {
      const fromQuestion = (() => {
        // `edges = [[1,2],[1,3],[2,3]]` is 1-based; the third edge closes the
        // cycle, which is the whole answer to Redundant Connection.
        const pairs = parsePairs(question, ["edges", "connections"]);
        if (pairs) {
          const ids = [...new Set(pairs.flat())].sort((a, b) => a - b);
          const index = new Map(ids.map((id, at) => [id, at]));
          const unions = pairs.map(([a, b]): [number, number] => [index.get(a)!, index.get(b)!]);
          return { size: ids.length, unions };
        }
        // `isConnected[i][j] = 1` means city i and city j are joined.
        const matrix = parseMatrix(question, ["isConnected", "grid", "matrix"]);
        if (matrix) {
          const unions: Array<[number, number]> = [];
          for (let i = 0; i < matrix.length; i += 1) {
            for (let j = i + 1; j < matrix[i]!.length; j += 1) {
              if (matrix[i]![j] === "1") unions.push([i, j]);
            }
          }
          if (unions.length > 0) return { size: matrix.length, unions };
        }
        return null;
      })();
      return grounded(
        fromQuestion,
        { size: 6, unions: [[0, 1], [2, 3], [1, 3], [4, 5]] as Array<[number, number]> },
        simulateUnionFind,
      );
    },
  },

  // --- One-dimensional dynamic programming and the two greedy scans. ---
  {
    id: "dp_fibonacci",
    title: "Climbing stairs",
    structure: "stacked",
    cues: [
      /\bclimb(?:ing)?\s+(?:a\s+|the\s+)?stair(?:case|s)\b/i,
      // "In how many distinct ways can you climb to the top?" The climb has to
      // be in the cue: "how many distinct ways can light pass through the
      // prism" is an optics stem and matched the bare phrase.
      /\bhow\s+many\s+distinct\s+ways\b[\s\S]{0,60}\bclimb\b/i,
      // Digits, not words: LC 746 says "climb one or two steps", and matching
      // both spellings would put Min Cost Climbing Stairs in this family.
      /\bclimb\s+1\s+or\s+2\s+steps\b/i,
      /\bfibonacci\b/i,
      /\bfib\s*\(\s*\d{1,2}\s*\)/i,
    ],
    hints: [/\bmemo(?:ization|isation)\b/i, /\bstaircase\b/i, /\brecursion\s+tree\b/i, /\bdistinct\s+ways\b/i],
    // A staircase question that mentions a cost is the other problem, and its
    // recurrence is a min over two sums rather than a plain sum.
    vetoes: [
      /\bmin(?:imum)?\s+cost\b/i,
      /\bcost\s*\[/i,
      /\bcost\s*=\s*\[/i,
      /\bjump\s+game\b/i,
      /\bmaximum\s+jump\s+length\b/i,
      // "print the first 10 fibonacci numbers" is a loop-and-print exercise,
      // not the stairs table. The bare `fibonacci` cue took it on 4 points
      // with no runner up, and the board answered "how many ways to climb 6
      // stairs" over a question that only wants the sequence echoed. The ask
      // this family is really for, "explain dynamic programming and
      // memoization using fib(6)", says neither phrase.
      /\bprints?\s+(?:out\s+)?the\s+first\b/i,
      /\bfirst\s+\d{1,3}\s+fibonacci\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          // "fib(6)" is how a textbook ask names its example; "n = 5" is how a
          // statement does. Climbing Stairs states n = 2, which is under the
          // walk's floor, so the canonical n = 6 runs and says so.
          const n = parseCallArgument(question, ["fib", "fibonacci", "climbstairs"])
            ?? parseNamedNumber(question, ["n", "stairs", "steps"]);
          return n === null ? null : { n };
        })(),
        { n: 6 },
        simulateClimbingStairs,
      ),
  },
  {
    id: "dp_min_cost_stairs",
    title: "Min cost climbing stairs",
    structure: "stacked",
    cues: [
      /\bmin(?:imum)?\s+cost\s+climbing\s+stairs\b/i,
      /\bmin(?:imum)?\s+cost\s+to\s+reach\s+the\s+top\b/i,
      /\bcost\s*\[\s*i\s*\]\s+is\s+the\s+cost\s+of\b/i,
      /\bpay\s+the\s+cost[\s\S]{0,60}\bclimb\s+(?:one|1)\s+or\s+(?:two|2)\s+steps?\b/i,
    ],
    hints: [/\bstaircase\b/i, /\bstep\s+with\s+index\b/i, /\btop\s+of\s+the\s+floor\b/i],
    // "Min Cost to Connect All Points" is an MST, not a staircase.
    vetoes: [/\bconnect\s+all\s+(?:the\s+)?points\b/i, /\bspanning\s+tree\b/i, /\bjump\s+game\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values ? { cost: values } : null;
        })(),
        { cost: [1, 100, 1, 1, 1, 100] },
        simulateMinCostStairs,
      ),
  },
  {
    id: "dp_house_robber",
    title: "House robber",
    structure: "stacked",
    cues: [
      /\bhouse\s+robber\b/i,
      /\brob\s+houses?\b/i,
      /\badjacent\s+houses\b/i,
      /\bmaximum\s+amount\s+of\s+money\s+you\s+can\s+rob\b/i,
      /\bwithout\s+alerting\s+the\s+police\b/i,
    ],
    hints: [/\bnon[- ]adjacent\b/i, /\bsecurity\s+system/i, /\bstashed\b/i],
    // House Robber II wraps the street into a circle and House Robber III puts
    // it on a tree. Both are different recurrences; this walk would confidently
    // draw the wrong answer for either.
    vetoes: [/\bcircular\b|\barranged\s+in\s+a\s+circle\b/i, /\bbinary\s+tree\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values ? { values } : null;
        })(),
        { values: [2, 7, 9, 3, 1] },
        simulateHouseRobber,
      ),
  },
  {
    id: "dp_coin_change",
    title: "Coin change",
    structure: "stacked",
    cues: [
      /\bcoin\s+change\b/i,
      /\bfewest\s+(?:number\s+of\s+)?coins\b/i,
      /\bcoins\s+of\s+different\s+denominations\b/i,
      /\bmin(?:imum)?\s+(?:number\s+of\s+)?coins\b[\s\S]{0,80}\bamount\b/i,
      /\binfinite\s+number\s+of\s+each\s+kind\s+of\s+coin\b/i,
    ],
    hints: [/\bdenominations?\b/i, /\bamount\s*=\s*\d/i, /\bunbounded\b/i],
    // Coin Change II counts combinations rather than minimising a count, and
    // its table is filled coin by coin rather than amount by amount.
    vetoes: [
      /\bnumber\s+of\s+(?:ways|combinations)\b[\s\S]{0,80}\b(?:make\s+up|amount)\b/i,
      /\bcoin\s+change\s+(?:2|ii)\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          // Keyed on "coins": the generic array parser would happily read the
          // Output list or a constraints bracket as the denominations.
          const coins = parseNamedArray(exampleInputSegment(question), ["coins", "denominations"]);
          const amount = parseNamedNumber(question, ["amount", "target"]);
          if (!coins || amount === null) return null;
          return { coins, amount };
        })(),
        { coins: [1, 3, 4], amount: 6 },
        simulateCoinChange,
      ),
  },
  {
    id: "dp_lis",
    title: "Longest increasing subsequence",
    structure: "stacked",
    cues: [
      /\blongest\s+(?:strictly\s+)?increasing\s+subsequence\b/i,
      /\blength\s+of\s+the\s+longest\s+(?:strictly\s+)?increasing\b/i,
      // Case sensitive on purpose: the abbreviation, not the word "lis".
      /\bLIS\b/,
    ],
    hints: [/\bstrictly\s+increasing\b/i, /\bsubsequence\b/i],
    // The simulator walks the O(n^2) table. The tails-and-binary-search
    // version is a different program and the board would not match it.
    vetoes: [/\bcommon\s+subsequence\b/i, /\bpatience\s+sort(?:ing)?\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values ? { values } : null;
        })(),
        { values: [10, 9, 2, 5, 3, 7, 101, 18] },
        simulateLongestIncreasingSubsequence,
      ),
  },
  {
    id: "kadane",
    title: "Maximum subarray",
    structure: "array",
    cues: [
      /\bkadane'?s?\b/i,
      /\bmaximum\s+subarray\b/i,
      /\bsubarray\s+with\s+the\s+largest\s+sum\b/i,
      /\bcontiguous\s+subarray[\s\S]{0,60}\blargest\s+sum\b/i,
      /\blargest\s+sum[\s\S]{0,40}\bcontiguous\s+subarray\b/i,
    ],
    hints: [/\brunning\s+sum\b/i, /\bbest\s+so\s+far\b/i],
    // Maximum Product Subarray needs the running minimum too, the circular
    // variant needs the total minus the worst run, a fixed width is the
    // sliding window family, and "sums to k" is a prefix-sum map.
    vetoes: [
      /\bproduct\b/i,
      /\bcircular\b/i,
      /\bsubarray\s+of\s+(?:size|length)\b/i,
      /\bsliding\s+window\b/i,
      /\bsums?\s+(?:equals?|to)\s+k\b/i,
      /\bat\s+most\s+k\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values ? { values } : null;
        })(),
        { values: [-2, 1, -3, 4, -1, 2, 1] },
        simulateKadane,
      ),
  },
  {
    id: "greedy_jump",
    title: "Jump game",
    structure: "array",
    cues: [
      /\bjump\s+game\b/i,
      /\bmaximum\s+jump\s+length\b/i,
      /\bcan\s+(?:you\s+)?reach\s+the\s+last\s+index\b/i,
      /\bfurthest\s+reach\b|\bgreedy\s+reach\b/i,
    ],
    hints: [/\bgreedy\b/i, /\breach\b/i],
    // Jump Game II counts the jumps, which is a different scan with a window
    // boundary; this one only answers yes or no.
    vetoes: [
      /\bmin(?:imum)?\s+number\s+of\s+jumps\b/i,
      /\bfewest\s+(?:number\s+of\s+)?jumps\b/i,
      /\bjump\s+game\s+(?:2|ii)\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values ? { values } : null;
        })(),
        { values: [2, 3, 1, 1, 4] },
        simulateJumpGame,
      ),
  },

  // --- Array scans and the binary-search variants. ---
  {
    id: "rotated_binary_search",
    title: "Search in a rotated sorted array",
    structure: "array",
    cues: [
      /\brotated\s+sorted\s+array\b/i,
      /\bsearch\s+in\s+(?:a\s+)?rotated\b/i,
      // The statement never says "rotated sorted array" in one phrase: it
      // says the array "is possibly left rotated at an unknown index k" and
      // then asks for the index of target.
      /\brotat(?:ed|ion)\b[\s\S]{0,160}\breturn\s+the\s+index\s+of\s+target\b/i,
      /\bpossibly\s+(?:left\s+)?rotated\b/i,
    ],
    hints: [/\bo\(\s*log\s*n\s*\)/i, /\bpivot\b/i, /\bunknown\s+index\s+k\b/i],
    // Find Minimum in a Rotated Sorted Array is a different walk on the same
    // picture, and the version with duplicates loses the O(log n) guarantee
    // the sorted-half test depends on.
    vetoes: [
      /\bfind\s+minimum\b|\bminimum\s+element\b/i,
      /\bmay\s+contain\s+duplicates\b|\bwith\s+duplicates\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          // Deliberately NOT sorted: sorting a rotated array is exactly the
          // bug that made binary_search veto these statements.
          const values = parseNumberArray(question);
          const target = parseNamedNumber(question, ["target", "key"]) ?? parseSearchTarget(question);
          if (!values || target === null) return null;
          return { values, target };
        })(),
        { values: [4, 5, 6, 7, 0, 1, 2], target: 0 },
        simulateRotatedBinarySearch,
      ),
  },
  {
    id: "binary_search_on_answer",
    title: "Binary search on the answer",
    structure: "array",
    cues: [
      /\bbinary\s+search\s+on\s+the\s+answer\b/i,
      /\bkoko\b/i,
      /\bbananas[- ]per[- ]hour\b|\beating\s+speed\b/i,
      /\breturn\s+the\s+min(?:imum)?\s+(?:integer\s+)?k\s+such\s+that\b/i,
      /\bminimum\s+(?:eating\s+)?speed\b/i,
    ],
    hints: [
      /\bpiles\b/i,
      /\bh\s+hours\b|\bwithin\s+\w+\s+hours\b/i,
      /\bslowest\b/i,
      // Breaks the 4-4 tie with binary_search on the bare phrase
      // "binary search on the answer", which would otherwise decline.
      /\bon\s+the\s+answer\b|\banswer\s+space\b/i,
    ],
    // Capacity To Ship Packages and Split Array Largest Sum are the same
    // technique with a different feasibility test, and this simulator's row
    // is speeds with a ceiling division under it.
    vetoes: [/\bship(?:ping)?\s+(?:within|packages)\b/i, /\bsplit\s+array\b/i],
    run: (question) =>
      grounded(
        (() => {
          const piles = parseNumberArray(question);
          const hours = parseNamedNumber(question, ["h", "hours"]);
          if (!piles || hours === null) return null;
          return { piles, hours };
        })(),
        { piles: [3, 6, 7, 11], hours: 8 },
        simulateBinarySearchOnAnswer,
      ),
  },
  {
    id: "merge_two_sorted_arrays",
    title: "Merge two sorted arrays in place",
    structure: "array",
    cues: [
      /\bmerge\s+nums1\s+and\s+nums2\b/i,
      /\bmerge\s+(?:the\s+)?two\s+sorted\s+(?:arrays?|lists?)\b/i,
      /\bstored\s+inside\s+the\s+array\s+nums1\b/i,
      /\blast\s+n\s+elements\s+are\s+set\s+to\s+0\b/i,
    ],
    hints: [/\bnon[- ]decreasing\s+order\b/i, /\bin[- ]place\b/i, /\bfrom\s+the\s+back\b/i],
    // The "lists" alternative in cue two is what reaches a paraphrased ask;
    // the linked-list veto is what stops it swallowing LeetCode 21, whose
    // picture is nodes and arrows rather than one row of cells.
    vetoes: [/\bmerge\s*sort\b/i, /\blinked\s+list\b/i, /\bk\s+sorted\b/i, /\bmedian\b/i],
    run: (question) =>
      grounded(
        parseMergeSlots(question),
        { first: [1, 2, 3, 0, 0, 0], m: 3, second: [2, 5, 6] },
        simulateMergeFromBack,
      ),
  },
  {
    id: "three_sum_two_pointers",
    title: "3Sum with two pointers",
    structure: "array",
    cues: [
      /\b3\s*sum\b|\bthree\s*sum\b/i,
      /\btriplets?\b[\s\S]{0,160}\b(?:==|=|equals?|sum(?:s)?\s+to)\s*0\b/i,
      // The statement's own condition, which names no technique at all.
      /\bnums\s*\[\s*i\s*\]\s*\+\s*nums\s*\[\s*j\s*\]\s*\+\s*nums\s*\[\s*k\s*\]/i,
      /\bmust\s+not\s+contain\s+duplicate\s+triplets\b/i,
    ],
    hints: [/\bi\s*!=\s*j\b/i, /\bsort\s+(?:the\s+)?(?:array|nums)\b/i, /\btwo[- ]pointers?\b/i],
    // 4Sum needs a second fixed value and 3Sum Closest keeps a best distance
    // rather than an exact hit; both would be narrated over the wrong walk.
    vetoes: [/\b4\s*sum\b|\bfour\s*sum\b|\bquadruplets?\b/i, /\bclosest\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values ? { values } : null;
        })(),
        { values: [-1, 0, 1, 2, -1, -4] },
        simulateThreeSum,
      ),
  },
  {
    id: "trapping_rain_water_two_pointers",
    title: "Trapping rain water with two pointers",
    structure: "array",
    cues: [
      /\btrapping\s+rain\s*water\b|\btrap(?:ping)?\s+rain\b/i,
      /\bhow\s+much\s+water\s+it\s+can\s+trap\b/i,
      /\belevation\s+map\b/i,
      /\bwater\s+(?:it\s+can\s+)?trap\s+after\s+raining\b/i,
    ],
    hints: [
      /\bnon[- ]negative\s+integers\b/i,
      /\bwidth\s+of\s+each\s+bar\s+is\s+1\b/i,
      /\bunits\s+of\s+(?:rain\s+)?water\b/i,
    ],
    // Container With Most Water picks two lines and ignores everything
    // between them; Largest Rectangle in a Histogram measures a rectangle
    // rather than a fill. Both share this figure and neither shares this walk.
    vetoes: [/\bmost\s+water\b|\bcontainer\s+with\b/i, /\bhistogram\b|\blargest\s+rectangle\b/i],
    run: (question) =>
      grounded(
        (() => {
          const heights = parseNumberArray(question);
          return heights ? { heights } : null;
        })(),
        { heights: [0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1] },
        simulateTrappingRainWater,
      ),
  },
  {
    id: "single_pass_min_tracking",
    title: "Best time to buy and sell stock",
    structure: "array",
    cues: [
      /\bbest\s+time\s+to\s+buy\s+and\s+sell\b/i,
      /\bmaximi[sz]e\s+(?:your\s+)?profit\b/i,
      /\bbuy\s+one\s+(?:and\s+only\s+one\s+)?share\b/i,
      /\bmaximum\s+profit\s+you\s+can\s+achieve\b/i,
    ],
    hints: [/\bprices?\s*\[/i, /\bith\s+day\b|\bday\s+i\b/i, /\bstock\b/i],
    // The sequels (II, III, IV, with cooldown) all keep more than one running
    // number, and this board keeps exactly one.
    vetoes: [
      /\bas\s+many\s+transactions\b|\bmultiple\s+transactions\b/i,
      /\bcooldown\b/i,
      /\bat\s+most\s+two\s+transactions\b|\bk\s+transactions\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const prices = parseNumberArray(question);
          return prices ? { prices } : null;
        })(),
        { prices: [7, 1, 5, 3, 6, 4] },
        simulateBestTimeToBuy,
      ),
  },

  // --- Tree recursion: the walks that are not a search. ---
  {
    id: "tree_invert_recursion",
    title: "Invert a binary tree",
    structure: "tree",
    cues: [
      /\binvert\s+(?:a\s+|the\s+)?(?:binary\s+)?tree\b/i,
      /\bbinary\s+tree\b[\s\S]{0,80}\binvert\b/i,
      /\bmirror\s+(?:of\s+)?(?:a\s+|the\s+)?binary\s+tree\b/i,
      /\bswap\s+(?:the\s+)?(?:left\s+and\s+right|every\s+node'?s)\s+child(?:ren)?\b/i,
    ],
    hints: [/\bbinary\s+tree\b/i, /\brecursion\b/i],
    // "Invert the matrix" is linear algebra, and the word alone is the whole
    // cue here, so the one collision worth naming is named.
    vetoes: [/\binvert\s+(?:a\s+|the\s+)?matrix\b/i],
    run: (question) =>
      grounded(
        (() => {
          const levelOrder = parseLevelOrder(question);
          return levelOrder ? { levelOrder } : null;
        })(),
        { levelOrder: [4, 2, 7, 1, 3, 6, 9] as Array<number | null> },
        simulateTreeInvert,
      ),
  },
  {
    id: "bst_validate_bounds",
    title: "Validate a binary search tree",
    structure: "tree",
    cues: [
      /\bvalid(?:ate)?\s+(?:a\s+)?binary\s+search\s+tree\b/i,
      /\bvalid\s+bst\b/i,
      /\b(?:bst|binary\s+search\s+tree)\b[\s\S]{0,40}\bis\s+(?:a\s+)?valid\b/i,
      /\bdetermine\s+if\s+it\s+is\s+a\s+valid\b/i,
      /\bleft\s+subtree\s+of\s+a\s+node\s+contains\s+only\s+nodes\s+with\s+keys\s+less\b/i,
    ],
    hints: [/\bbinary\s+search\s+tree\b/i, /\bsubtree\b/i],
    // Balanced, Symmetric and Same Tree are all "is this tree ok" checks with
    // completely different recursions, and none of them carries a bound.
    vetoes: [/\bbalanced\b/i, /\bsymmetric\b/i, /\bsame\s+tree\b/i],
    run: (question) =>
      grounded(
        (() => {
          const levelOrder = parseLevelOrder(question);
          return levelOrder ? { levelOrder } : null;
        })(),
        { levelOrder: [5, 1, 4, null, null, 3, 6] as Array<number | null> },
        simulateBstValidate,
      ),
  },
  {
    id: "bst_lca",
    title: "Lowest common ancestor in a BST",
    structure: "tree",
    cues: [
      /\blowest\s+common\s+ancestor\b/i,
      /\blca\b/i,
      /\bancestor[\s\S]{0,60}\btwo\s+(?:given\s+)?nodes\b/i,
    ],
    hints: [/\bbinary\s+search\s+tree\b|\bbst\b/i, /\bdescendants?\b/i],
    // LeetCode 236 is the same question on a plain binary tree and needs a
    // postorder walk that returns from both children; the one comparison per
    // node drawn here is only correct because the tree is ordered. A statement
    // that asks for an ancestor and never says "search tree" is that problem,
    // so the veto is a whole-text absence check rather than a keyword.
    vetoes: [/^(?![\s\S]*(?:binary\s+search\s+tree|\bbst\b))[\s\S]*\blowest\s+common\s+ancestor\b/i],
    run: (question) =>
      grounded(
        (() => {
          const levelOrder = parseLevelOrder(question);
          const pair = parseNodePair(question);
          return levelOrder && pair ? { levelOrder, p: pair.p, q: pair.q } : null;
        })(),
        { levelOrder: [6, 2, 8, 0, 4, 7, 9] as Array<number | null>, p: 0, q: 4 },
        simulateBstLca,
      ),
  },
  {
    id: "tree_max_path_sum",
    title: "Binary tree maximum path sum",
    structure: "tree",
    cues: [
      /\bmaximum\s+path\s+sum\b/i,
      /\bpath\s+sum\b/i,
      /\bpath\s+does\s+not\s+need\s+to\s+pass\s+through\s+the\s+root\b/i,
    ],
    hints: [/\bbinary\s+tree\b/i, /\bnon[- ]empty\s+path\b/i],
    // "Path sum" alone is also LeetCode 112 and 113, which are root to leaf
    // against a target and have no upward return at all, and 543 measures a
    // length rather than a sum.
    vetoes: [/\broot[- ]to[- ]leaf\b/i, /\btargetsum\b/i, /\bdiameter\b/i],
    run: (question) =>
      grounded(
        (() => {
          const levelOrder = parseLevelOrder(question);
          return levelOrder ? { levelOrder } : null;
        })(),
        { levelOrder: [-10, 9, 20, null, null, 15, 7] as Array<number | null> },
        simulateTreeMaxPathSum,
      ),
  },
  {
    id: "tree_serialize_preorder",
    title: "Serialize a binary tree",
    structure: "tree",
    cues: [
      /\bserialize\s+and\s+deserialize\b/i,
      /\bserializ(?:e|es|ed|ation|ing)\b[\s\S]{0,140}\bbinary\s+tree\b/i,
      /\bdeserializ(?:e|es|ed|ation|ing)\b/i,
    ],
    hints: [/\bbinary\s+tree\b/i, /\breconstruct(?:ed|ion)?\b/i],
    // An n-ary tree serializes with a child count per node, which is a
    // different string and a different reader.
    vetoes: [/\bn[- ]ary\b/i],
    run: (question) =>
      grounded(
        (() => {
          const levelOrder = parseLevelOrder(question);
          return levelOrder ? { levelOrder } : null;
        })(),
        { levelOrder: [1, 2, 3, null, null, 4, 5] as Array<number | null> },
        simulateTreeSerialize,
      ),
  },
  {
    id: "bst_insert",
    title: "Build a binary search tree by insertion",
    structure: "tree",
    cues: [
      /\b(?:bst|binary\s+search\s+tree)\b[\s\S]{0,120}\binsert(?:s|ed|ing|ion)?\b/i,
      /\binsert(?:s|ed|ing|ion)?\b[\s\S]{0,120}\b(?:into\s+)?(?:a\s+|the\s+)?(?:bst|binary\s+search\s+tree)\b/i,
      /\b(?:bst|binary\s+search\s+tree)\s+insert(?:ion|ing)?\b/i,
      /\b(?:bst|binary\s+search\s+tree)\b[\s\S]{0,60}\b(?:built|build|construct(?:ed|ing)?)\b/i,
    ],
    hints: [/\bin\s+that\s+order\b/i, /\bin[- ]order\s+traversal\b/i],
    // Deletion is three cases and a successor hunt, and a self balancing tree
    // rotates after the insert, so both are a different walk from this one.
    vetoes: [
      /\bdelet(?:e|es|ed|ing|ion)\b/i,
      /\bavl\b|\bred[- ]black\b|\brotat(?:e|es|ion|ions)\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          // The insert sequence first: a bare bracket list in a tree question
          // is usually a level order, and reading it as an arrival order would
          // silently build a different tree.
          const values = parseInsertSequence(question) ?? parseNumberArray(question);
          return values && values.length >= 3 && values.length <= 7 ? { values } : null;
        })(),
        { values: [8, 3, 10, 1, 6, 14] },
        simulateBstInsert,
      ),
  },

  // --- Shapes of their own: intervals, sorts, bits, a trie and a spiral. ---
  {
    id: "merge_intervals",
    title: "Merge intervals",
    structure: "numberline",
    cues: [
      /\bmerge\s+intervals?\b/i,
      /\bmerge\s+(?:all\s+)?(?:the\s+)?overlapping\s+intervals?\b/i,
      /\bnon[- ]overlapping\s+intervals?\b/i,
      // "intervals[i] = [starti, endi]" — the statement names no technique.
      /\bintervals?\s*\[\s*i\s*\]\s*=\s*\[\s*start/i,
    ],
    hints: [/\bsort\s+by\s+start\b/i, /\bsweep\b/i, /\boverlap(?:s|ping)?\b/i],
    // Insert Interval, Non-overlapping Intervals and the Meeting Rooms pair are
    // all interval problems with a different answer, and two of them would be
    // caught by the "non-overlapping intervals" cue on their own wording.
    vetoes: [
      /\binsert\s+interval\b/i,
      /\bminimum\s+number\s+of\s+intervals\s+you\s+need\s+to\s+remove\b/i,
      /\bmeeting\s+rooms?\b/i,
      /\bminimum\s+number\s+of\s+conference\s+rooms\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const pairs = parsePairs(question, ["intervals", "ranges", "meetings"]);
          return pairs && pairs.length >= 2 ? { intervals: pairs } : null;
        })(),
        { intervals: [[1, 3], [2, 6], [8, 10], [15, 18]] as Array<[number, number]> },
        simulateMergeIntervals,
      ),
  },
  {
    id: "quick_sort",
    title: "Quick sort",
    structure: "array",
    cues: [/\bquick\s*sort\b/i, /\bpartition\s+step\b/i, /\blomuto\b|\bhoare\s+partition\b/i],
    hints: [/\bpivot\b/i, /\bpartition(?:s|ed|ing)?\b/i, /\bin[- ]place\b/i],
    // Quickselect partitions around a pivot too and answers a different
    // question, and its statements say "kth largest" rather than "quicksort".
    vetoes: [/\bquick\s*select\b/i, /\bkth\s+(?:largest|smallest)\b/i, /\bmedian\s+of\s+two\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values && values.length >= 4 && values.length <= 6 ? { values } : null;
        })(),
        { values: [5, 3, 8, 4, 2] },
        simulateQuickSort,
      ),
  },
  {
    id: "insertion_sort",
    title: "Insertion sort",
    structure: "array",
    cues: [
      /\binsertion\s*sort\b/i,
      /\bsorted\s+prefix\b/i,
      /\binsert(?:ing)?\s+each\s+(?:value|element|number|card)\s+into\s+(?:the\s+)?sorted\b/i,
    ],
    hints: [/\bshift(?:s|ed|ing)?\s+(?:them\s+)?right\b/i, /\bnearly\s+sorted\b/i, /\bplaying\s+cards?\b/i],
    // Insertion Sort List (LC 147) is the same algorithm on a list, which is a
    // different picture entirely, and this simulator only draws the array.
    vetoes: [/\blinked\s+list\b/i, /\bbucket\s+sort\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values && values.length >= 4 && values.length <= 6 ? { values } : null;
        })(),
        { values: [5, 3, 8, 4, 2] },
        simulateInsertionSort,
      ),
  },
  {
    id: "xor_fold",
    title: "Single number by XOR",
    structure: "array",
    cues: [
      /\bsingle\s+number\b/i,
      /\bevery\s+element\s+appears\s+twice\s+except\b/i,
      /\bfind\s+that\s+single\s+one\b/i,
      /\bxor\b/i,
    ],
    hints: [/\bconstant\s+extra\s+space\b/i, /\bbit\s+manipulation\b/i, /\blinear\s+runtime\b/i],
    // Single Number II and III fold differently, and Missing Number can be
    // solved by XOR but the walk that teaches it is not this one.
    vetoes: [
      /\bappears?\s+(?:three|3)\s+times\b/i,
      /\btwo\s+elements?\s+appear\s+(?:only\s+)?once\b/i,
      /\bmissing\s+number\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values ? { values } : null;
        })(),
        { values: [4, 1, 2, 1, 2] },
        simulateXorFold,
      ),
  },
  {
    id: "bit_count",
    title: "Count set bits",
    structure: "array",
    cues: [
      /\bhamming\s+weight\b/i,
      /\bnumber\s+of\s+set\s+bits\b/i,
      /\bnumber\s+of\s+1\s+bits\b/i,
      /\bcount(?:ing)?\s+(?:the\s+)?(?:number\s+of\s+)?(?:set\s+)?bits\b/i,
      /\bn\s*&\s*\(\s*n\s*-\s*1\s*\)/,
    ],
    hints: [/\bbit\s+manipulation\b/i, /\bbinary\s+representation\b/i],
    // Counting Bits (LC 338) wants one answer per number from 0 to n, which is
    // a table and not this row, and the loose "counting bits" cue would take it.
    // Reverse Bits (LC 190) touches every column instead of every 1.
    vetoes: [
      /\breverse\s+bits\b/i,
      /\breturn\s+an\s+array\s+ans\b/i,
      /\bans\s*\[\s*i\s*\]\s+is\s+the\s+number\s+of\s+1'?s\b/i,
      /\bfor\s+each\s+i\s+in\s+the\s+range\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const n = parseNamedNumber(question, ["n", "num", "x"]);
          return n !== null && n >= 1 ? { n } : null;
        })(),
        { n: 11 },
        simulateBitCount,
      ),
  },
  {
    id: "trie_insert_search",
    title: "Trie insert and search",
    structure: "tree",
    cues: [/\btrie\b/i, /\bprefix\s+tree\b/i, /\bstartsWith\s*\(/i, /\bautocomplete\b/i],
    hints: [/\bprefix\b/i, /\bspellchecker\b/i],
    // Word Search II and Add and Search Word both build a trie and then do
    // something else with it; the walk they need is the backtracking, not this.
    vetoes: [/\bword\s+search\b/i, /\bboard\b/i, /\badd\s+and\s+search\s+word\b/i, /\breplace\s+words\b/i],
    run: (question) =>
      grounded(
        parseTrieWords(question),
        { words: ["cat", "car", "dog"], search: "car" },
        simulateTrieInsertSearch,
      ),
  },
  {
    id: "spiral_layers",
    title: "Spiral matrix",
    structure: "matrix",
    cues: [/\bspiral\s+order\b/i, /\bspiral\s+matrix\b/i, /\bin\s+spiral\b/i],
    hints: [/\bclockwise\b/i, /\blayers?\b/i, /\bm\s*x\s*n\s+matrix\b/i],
    // Rotate Image shares the layer vocabulary and reverses them in place;
    // Spiral Matrix II fills a grid rather than reading one.
    vetoes: [
      /\brotate\s+the\s+(?:image|matrix)\b/i,
      /\brotate\s+image\b/i,
      /\bgenerate\s+an?\s+n\s*x\s*n\s+matrix\b/i,
      /\bspiral\s+matrix\s+ii\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const rows = parseMatrix(question, ["matrix", "grid"]);
          return rows ? { rows } : null;
        })(),
        { rows: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] },
        simulateSpiralLayers,
      ),
  },

  // --- Linked list surgery: the walks that rewire arrows. ---
  {
    id: "merge_two_lists",
    title: "Merge two sorted lists",
    structure: "list",
    cues: [
      /\bmerge\s+(?:the\s+)?two\s+sorted\s+(?:linked\s+)?lists?\b/i,
      /\bheads\s+of\s+two\s+sorted\s+linked\s+lists?\b/i,
      /\bmerge\s+the\s+two\s+lists\s+into\s+one\s+sorted\s+list\b/i,
      /\bsplicing\s+together\s+the\s+nodes\b/i,
      /\breturn\s+the\s+head\s+of\s+the\s+merged\s+(?:linked\s+)?list\b/i,
    ],
    hints: [/\blist1\b[\s\S]{0,120}\blist2\b/i, /\bsorted\s+linked\s+lists?\b/i, /\bnon[- ]decreasing\s+order\b/i],
    // Merge k lists is a heap problem, merge sort is an array walk, merge
    // intervals is a different structure entirely, and LeetCode 88 merges two
    // ARRAYS in place. Each would be drawn confidently and wrongly by this
    // simulator, so each is named rather than left to the scoring.
    vetoes: [
      /\bmerge\s*sort\b/i,
      /\bmerge\s+k\b|\bk\s+(?:sorted\s+)?linked[- ]lists?\b|\bk\s+sorted\s+lists?\b/i,
      /\bintervals?\b/i,
      /\bnums1\b|\binteger\s+arrays?\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const pair = parseListPair(question);
          return pair ? { list1: pair.first, list2: pair.second } : null;
        })(),
        { list1: [1, 2, 4], list2: [1, 3, 4] },
        simulateMergeTwoLists,
      ),
  },
  {
    id: "two_pass_or_gap_pointers",
    title: "Remove the nth node from the end",
    structure: "list",
    cues: [
      /\bnth\s+node\s+from\s+the\s+end\b/i,
      /\b(?:remove|delete)\s+the\s+(?:\d{1,2}(?:st|nd|rd|th)|n(?:th)?)\s+(?:node|element)\s+from\s+the\s+end\b/i,
      /\bgap\s+of\s+n\s+nodes\b|\btwo\s+pointers?\s+(?:kept\s+)?n\s+apart\b/i,
    ],
    hints: [/\bone\s+pass\b/i, /\bfast\b[\s\S]{0,60}\bslow\b/i, /\bdummy\s+node\b/i],
    // "kth node from the end" is a find, not a remove: this walk would draw a
    // deletion the question never asked for. Middle-of-the-list and cycle
    // detection are the other two gap-pointer walks and are not this one.
    vetoes: [/\bcycle\b/i, /\bkth\s+node\s+from\s+the\s+end\b/i, /\bmiddle\s+of\s+the\s+(?:linked\s+)?list\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          const n = parseNamedNumber(question, ["n"]) ?? parseNthFromEnd(question);
          if (!values || n === null) return null;
          return { values, n };
        })(),
        { values: [1, 2, 3, 4, 5], n: 2 },
        simulateRemoveNthFromEnd,
      ),
  },
  {
    id: "digit_carry_list",
    title: "Add two numbers stored as lists",
    structure: "list",
    cues: [
      /\badd\s+(?:the\s+)?two\s+numbers\b/i,
      /\bdigits\s+are\s+stored\s+in\s+reverse\s+order\b/i,
      /\breturn\s+the\s+sum\s+as\s+a\s+linked\s+list\b/i,
      /\blinked\s+lists?\s+representing\s+(?:two\s+)?(?:non[- ]negative\s+)?(?:integers?|numbers?)\b/i,
    ],
    hints: [/\bcarry\b/i, /\bsingle\s+digit\b/i, /\bnon[- ]empty\s+linked\s+lists?\b/i],
    // Two Sum returns indices into an array and shares the word "two"; adding
    // two binary strings is the same column walk on a different structure.
    vetoes: [/\btwo\s*sum\b/i, /\breturn\s+indices\b/i, /\bbinary\b/i],
    run: (question) =>
      grounded(
        (() => {
          const pair = parseListPair(question);
          return pair ? { l1: pair.first, l2: pair.second } : null;
        })(),
        { l1: [2, 4, 3], l2: [5, 6, 4] },
        simulateAddTwoNumbers,
      ),
  },
  {
    id: "reverse_k_group",
    title: "Reverse nodes in k-group",
    structure: "list",
    cues: [
      /\breverse\s+the\s+nodes\s+of\s+the\s+list\s+k\s+at\s+a\s+time\b/i,
      /\bk\s+at\s+a\s+time\b/i,
      /\breverse\s+(?:the\s+)?nodes\s+in\s+k[- ]groups?\b/i,
      /\bk[- ]groups?\b|\bgroups?\s+of\s+k\b/i,
    ],
    hints: [/\bnot\s+a\s+multiple\s+of\s+k\b/i, /\bleft[- ]?out\s+nodes\b/i, /\bmay\s+not\s+alter\s+the\s+values\b/i],
    vetoes: [/\bcycle\b/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          const k = parseNamedNumber(question, ["k"]);
          if (!values || k === null) return null;
          return { values, k };
        })(),
        { values: [1, 2, 3, 4, 5], k: 2 },
        simulateReverseKGroup,
      ),
  },

  // --- Heaps: the tree and the array that backs it, drawn together. ---
  {
    id: "heap_sift",
    title: "Min heap sift up and sift down",
    structure: "stacked",
    cues: [
      /\bmin[- ]?heap\b/i,
      /\bbinary\s+heap\b/i,
      /\bheapify\b/i,
      /\bsift[- ](?:up|down)\b/i,
      /\bpriority\s+queue\b/i,
    ],
    hints: [/\bheap\b/i, /\bcomplete\s+binary\s+tree\b/i, /\bpop\s+the\s+min(?:imum)?\b/i],
    // The board draws a MIN heap and one insert followed by one pop. A max
    // heap is the mirror walk, heapsort is a different walk again, and the
    // three LeetCode heap problems each have their own family: routing any
    // of them here would draw a heap doing something other than what was
    // asked. Dijkstra names a priority queue in passing and owns its own
    // picture.
    vetoes: [
      /\bmax[- ]?heap\b/i,
      /\bheap\s*sort\b/i,
      /\bdijkstra\b/i,
      /\bk\s*-?\s*th\s+(?:largest|smallest)\b/i,
      /\btop\s+k\b/i,
      /\bk\s+most\s+frequent\b/i,
      /\bmerge\s+k\b/i,
      /\bk[- ]way\s+merge\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          // The array has to already be a heap: quietly heapifying an
          // arbitrary list would put an arrangement on the board that the
          // question never wrote down. simulateHeapSift declines a non-heap,
          // so the canonical example runs and says so.
          const values = parseNumberArray(question);
          const insert = parseInsertValue(question);
          if (!values || insert === null) return null;
          return { values, insert };
        })(),
        { values: [4, 5, 20, 9, 11, 25], insert: 15 },
        simulateHeapSift,
      ),
  },
  {
    id: "heap_top_k",
    title: "Kth largest with a size-k heap",
    structure: "stacked",
    cues: [
      // "return the kth largest element in the array", and the k-th spelling.
      /\bk\s*-?\s*th\s+largest\b/i,
      /\bk\s+largest\s+elements?\b/i,
      /\bsize[- ]k\s+min[- ]?heap\b/i,
    ],
    hints: [/\bmin[- ]?heap\b/i, /\bwithout\s+sorting\b/i, /\bheap\b/i, /\bpriority\s+queue\b/i],
    // Kth smallest is the mirror problem and wants a max heap; quickselect is
    // a different picture entirely; kth largest in a BST is a tree walk. Top
    // K Frequent is worded alike and orders by a count, not by the value, so
    // it is vetoed here and cued in its own family.
    vetoes: [
      /\bk\s*-?\s*th\s+smallest\b/i,
      /\bquickselect\b/i,
      /\bbinary\s+search\s+tree\b|\bbst\b/i,
      /\bk\s+most\s+frequent\b|\btop\s+k\s+frequent\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          const k = parseNamedNumber(question, ["k"]);
          if (!values || k === null) return null;
          return { values, k };
        })(),
        { values: [3, 2, 1, 5, 6, 4], k: 2 },
        simulateHeapTopK,
      ),
  },
  {
    id: "heap_frequency",
    title: "Top k frequent elements",
    structure: "stacked",
    cues: [
      /\btop\s+k\s+frequent\b/i,
      // "return the k most frequent elements"
      /\bk\s+most\s+frequent\b/i,
      /\bmost\s+frequent\s+(?:k\s+)?elements?\b/i,
    ],
    hints: [/\bfrequency\b/i, /\bcounts?\b/i, /\bhash\s*(?:map|table)\b/i, /\bheap\b/i],
    // The bucket-sort follow-up is a different picture, and Kth Largest is
    // the family next door: neither may be answered with this board.
    vetoes: [/\bbucket\s+sort\b/i, /\bk\s*-?\s*th\s+largest\b/i, /\bwords?\b.*\blexicograph/i],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          const k = parseNamedNumber(question, ["k"]);
          if (!values || k === null) return null;
          return { values, k };
        })(),
        { values: [1, 1, 1, 2, 2, 3], k: 2 },
        simulateHeapFrequency,
      ),
  },
  {
    id: "heap_k_way_merge",
    title: "Merge k sorted lists with a heap",
    structure: "stacked",
    cues: [
      /\bmerge\s+k\s+sorted\b/i,
      /\bk[- ]way\s+merge\b/i,
      // "You are given an array of k linked-lists lists, each linked-list is
      // sorted in ascending order."
      /\barray\s+of\s+k\s+linked[- ]?lists\b/i,
      /\bmerge\s+all\s+the\s+linked[- ]?lists\b/i,
    ],
    hints: [/\bpriority\s+queue\b/i, /\bmin[- ]?heap\b/i, /\bheap\b/i, /\bsorted\s+in\s+ascending\s+order\b/i],
    // Merge sort is the family next door and shares the word; Merge Two
    // Sorted Lists is a two-pointer splice with no heap in it; the
    // divide-and-conquer solution to this same problem pairs lists up and
    // never builds a heap, so this board would be a picture of a different
    // program.
    vetoes: [
      /\bmerge\s*sort\b/i,
      /\btwo\s+sorted\s+(?:linked\s+)?lists\b/i,
      /\bdivide\s+and\s+conquer\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const lists = parseNumberLists(question, ["lists"]);
          return lists ? { lists } : null;
        })(),
        { lists: [[1, 4, 5], [1, 3, 4], [2, 6]] },
        simulateHeapKWayMerge,
      ),
  },

  // --- Backtracking, drawn as the recursion tree it is. ---
  {
    id: "backtracking_subsets",
    title: "Subsets",
    structure: "tree",
    cues: [
      /\ball\s+possible\s+subsets\b/i,
      /\bpower\s+set\b/i,
      /\bduplicate\s+subsets\b/i,
      /\breturn\s+all\s+subsets\b/i,
    ],
    hints: [/\bsubsets?\b/i, /\bbacktrack(?:ing)?\b/i, /\brecursion\s+tree\b/i],
    // Subsets II is the same sentence with duplicates in nums, and this
    // simulator refuses a repeated value, so it would quietly fall back to
    // the canonical distinct example and teach the wrong problem. Word
    // Search, N-Queens and Sudoku are grid searches drawn by another lane.
    vetoes: [
      /\bmay\s+contain\s+duplicates\b|\bsubsets\s+ii\b/i,
      /\bboard\b|\bgrid\b|\bmatrix\b|\bchessboard\b|\bsudoku\b|\bqueens?\b/i,
      /\bsubset\s+sum\b|\bsum\s+to\s+target\b/i,
      /\bsubsequences?\b|\bsubarray\b|\bsubstring\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values ? { values } : null;
        })(),
        { values: [1, 2, 3] },
        simulateSubsets,
      ),
  },
  {
    id: "backtracking_permutations",
    title: "Permutations",
    structure: "tree",
    cues: [
      /\ball\s+(?:the\s+)?(?:possible\s+)?permutations\b/i,
      /\bevery\s+permutation\b/i,
      /\bpermutations\s+of\s+(?:the\s+)?(?:array|list|nums|distinct\s+integers)\b/i,
    ],
    hints: [/\bbacktrack(?:ing)?\b/i, /\bdistinct\s+integers\b/i, /\brecursion\s+tree\b/i],
    // Next Permutation walks one step, Permutations II has duplicates, and
    // Permutation in String is a sliding window. All three would be drawn as
    // the full arrangement tree, which is a different algorithm.
    vetoes: [
      /\bnext\s+permutation\b/i,
      /\bmay\s+contain\s+duplicates\b|\bpermutations?\s+ii\b/i,
      /\bpermutation\s+of\s+s1\b|\bpermutation\s+in\s+(?:a\s+)?string\b|\bpalindrome\b/i,
      /\bboard\b|\bgrid\b|\bmatrix\b|\bchessboard\b|\bsudoku\b|\bqueens?\b/i,
      /\bcount\s+(?:the\s+)?(?:number\s+of\s+)?permutations\b|\bhow\s+many\s+permutations\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const values = parseNumberArray(question);
          return values ? { values } : null;
        })(),
        { values: [1, 2, 3] },
        simulatePermutations,
      ),
  },
  {
    id: "backtracking_combination_sum",
    title: "Combination sum",
    structure: "tree",
    cues: [
      /\bcombination\s+sum\b/i,
      /\bunique\s+combinations\b/i,
      /\bchosen\s+numbers\s+sum\s+to\b/i,
      /\bcandidates\b[\s\S]{0,160}\bsum\s+to\s+target\b/i,
      /\bunlimited\s+number\s+of\s+times\b/i,
    ],
    hints: [/\bcandidates\b/i, /\bbacktrack(?:ing)?\b/i, /\bprun(?:e|ed|ing)\b/i],
    // The reuse rule is the whole difference between this and its sequels.
    // Combination Sum II and III use each number at most once, and Coin
    // Change counts coins rather than listing combinations.
    vetoes: [
      /\bmay\s+only\s+be\s+used\s+once\b|\bused\s+at\s+most\s+once\b|\bcombination\s+sum\s+(?:ii|iii|iv)\b/i,
      /\bcoin\s+change\b|\bfewest\s+number\s+of\s+coins\b|\bnumber\s+of\s+combinations\s+that\s+make\s+up\b/i,
      /\bboard\b|\bgrid\b|\bmatrix\b|\bchessboard\b|\bsudoku\b|\bqueens?\b/i,
      /\bletter\s+combinations\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const candidates = parseNumberArray(question);
          const target = parseNamedNumber(question, ["target"]);
          if (!candidates || target === null) return null;
          return { candidates, target };
        })(),
        { candidates: [2, 3, 6, 7], target: 7 },
        simulateCombinationSum,
      ),
  },
  {
    id: "backtracking_phone_letters",
    title: "Letter combinations of a phone number",
    structure: "tree",
    cues: [
      /\bletter\s+combinations\b/i,
      /\btelephone\s+buttons?\b/i,
      /\bdigits?\s+(?:from\s+)?2\s*(?:-|to|through)\s*9\b/i,
      /\bphone\s+number\b[\s\S]{0,160}\bcombinations?\b/i,
    ],
    hints: [/\bkeypad\b/i, /\bbacktrack(?:ing)?\b/i, /\bcartesian\s+product\b/i],
    vetoes: [
      /\bboard\b|\bgrid\b|\bmatrix\b|\bchessboard\b|\bsudoku\b|\bqueens?\b/i,
      /\bword\s+search\b/i,
    ],
    run: (question) =>
      grounded(
        (() => {
          const digits = parsePhoneDigits(question);
          return digits ? { digits } : null;
        })(),
        { digits: "23" },
        simulatePhoneLetters,
      ),
  },
];

export function familyById(id: string): AlgorithmFamily | null {
  return ALGORITHM_FAMILIES.find((family) => family.id === id) ?? null;
}
