/**
 * What each family is, in one line, plus the shape its code must have.
 *
 * The code planner used to see only the question. It wrote whatever solution
 * it liked while the board walked a trace of a different one: Two Sum drew a
 * one-pass map and the panel typed a two-pass build-then-scan, and the tutor
 * narrated both in the same lesson. These facts travel with the detected
 * family into the planner prompt, and `codeShape` is what a deterministic
 * gate checks the returned program against.
 *
 * `mechanism` is written to be read aloud: it is the sentence the lesson
 * should be able to say about the picture and the code at the same time.
 */

export interface FamilyCodeShape {
  /** The program must contain each of these. */
  require?: RegExp[];
  /** The program must contain none of these. */
  forbid?: RegExp[];
  /** Loops in the section that returns the answer. */
  maxLoopsInMain?: number;
  /** "none" means a one-function algorithm; a helper would be invented. */
  helpers?: "none" | "allowed";
}

export interface FamilyTeachingFacts {
  /** One line, spoken: what the algorithm does, in order. */
  mechanism: string;
  /** Words a student meeting this for the first time needs defined. */
  terms: string[];
  /** Titles that would name a different technique from the one drawn. */
  forbidTitles?: RegExp[];
  codeShape?: FamilyCodeShape;
}

const MAP_LIKE = /\{\s*\}|dict\(|new Map\(|HashMap|defaultdict|Counter\(/;
const SORT_CALL = /\bsorted\s*\(|\.sort\s*\(|Arrays\.sort|Collections\.sort/;
const SET_LIKE = /set\(\)|\{\s*\}|new Set\(|HashSet/;
const XOR_OP = /\^/;
const CLEAR_LOW_BIT = /&=?\s*\(?\s*\w+\s*-\s*1\s*\)?/;
const MATRIX_ROTATE_TRICK = /\bzip\s*\(|\btranspose\b/;
const HEAP_CALL = /\bheapq\b|\bheappush\b|\bheappop\b|\bnlargest\b|\bnsmallest\b|PriorityQueue|MinHeap|MaxHeap/;
/**
 * The path being copied before it is recorded.
 *
 * Appending the live path to the answer list is THE bug in every one of these
 * problems: the walk pops the path afterwards, so every recorded answer ends
 * up empty. The board shows a node being written down and then unwound, and a
 * program that records the reference contradicts the picture it sits beside.
 */
const COPY_OF_PATH = /\[\s*:\s*\]|\.\.\.|\bcopy\s*\(|\bslice\s*\(|\blist\s*\(|new ArrayList<>\(/;

export const FAMILY_TEACHING: Record<string, FamilyTeachingFacts> = {
  binary_search: {
    mechanism:
      "keep a low and a high marker around the part of the sorted array that could still hold the target; compare the middle value and throw away the half it cannot be in, until the markers cross.",
    terms: ["invariant"],
    forbidTitles: [/\blinear\b|\bscan\b|\bbrute\b/i],
    codeShape: { forbid: [SORT_CALL], maxLoopsInMain: 1, helpers: "none" },
  },
  two_pointers: {
    mechanism:
      "start one marker at each end of the sorted array; if the pair sums too high move the right marker in, if too low move the left marker in, so each step rules out a whole side.",
    terms: ["pointer"],
    forbidTitles: [/\bhash\b|\bmap\b|\bdict\b/i],
    codeShape: { forbid: [MAP_LIKE], maxLoopsInMain: 1, helpers: "none" },
  },
  sliding_window_fixed: {
    mechanism:
      "add the first k values, then slide one step at a time by subtracting the value leaving the window and adding the one entering it, keeping the best sum seen.",
    terms: ["window"],
    forbidTitles: [/\bbrute\b|\bnested\b/i],
    codeShape: { maxLoopsInMain: 1, helpers: "none" },
  },
  sliding_window_unique: {
    mechanism:
      "grow the window one character at a time; when a character repeats, jump the start marker past its previous position, and record the longest window seen.",
    terms: ["window", "hash map"],
    codeShape: { require: [MAP_LIKE], maxLoopsInMain: 1, helpers: "none" },
  },
  merge_sort: {
    mechanism:
      "split the range in half, sort each half by the same method, then merge the two sorted halves by repeatedly taking the smaller of their two front values.",
    terms: ["recursion", "merge"],
    codeShape: { helpers: "allowed" },
  },
  bubble_sort: {
    mechanism:
      "walk the array comparing each neighbouring pair and swapping them when they are out of order; after each pass the largest value left has reached the end, and a pass with no swap means it is sorted.",
    terms: ["swap", "pass"],
    codeShape: { forbid: [SORT_CALL], helpers: "none" },
  },
  reverse_linked_list: {
    mechanism:
      "walk the list with prev, curr and next; save next, point curr back at prev, then move prev and curr forward one node, until curr runs off the end.",
    terms: ["pointer", "node"],
    // A linked-list program needs its node class and a builder, so "one
    // function" is about the algorithm, not about the file.
    codeShape: { forbid: [/\breversed\s*\(/], maxLoopsInMain: 1 },
  },
  linked_list_cycle: {
    mechanism:
      "move a slow pointer one node and a fast pointer two nodes at a time; inside a loop the fast one gains a step each time and must land on the slow one, and off a loop it runs off the end.",
    terms: ["pointer"],
    codeShape: { forbid: [MAP_LIKE], maxLoopsInMain: 1 },
  },
  tree_traversal: {
    mechanism:
      "visit the tree recursively, writing each node down before, between, or after its two children depending on the order asked for.",
    terms: ["recursion", "node"],
    codeShape: { helpers: "allowed" },
  },
  bst_search: {
    mechanism:
      "compare the target with the current node and move left when it is smaller or right when it is larger, so each comparison discards an entire subtree.",
    terms: ["node", "subtree"],
    codeShape: { maxLoopsInMain: 1, helpers: "none" },
  },
  graph_traversal: {
    mechanism:
      "put the start node in a container, then repeatedly take one out, mark it visited, and put its unvisited neighbours in; a queue gives breadth first, a stack gives depth first.",
    terms: ["queue", "adjacency"],
    codeShape: { helpers: "allowed" },
  },
  grid_islands: {
    mechanism:
      "read the map cell by cell, and the first time you meet land that has not been struck off, walk every land cell joined to it and strike them all off before adding one to the count, so each island is counted once no matter how many cells it has.",
    terms: ["component", "visited"],
    // Union-find also counts the islands, and the board walks a flood, so a
    // program titled for it would contradict the picture beside it.
    forbidTitles: [/\bunion[- ]find\b|\bdisjoint\s+set\b/i],
    codeShape: { helpers: "allowed" },
  },
  grid_dfs_fill: {
    mechanism:
      "read the starting pixel's colour first, then walk out from it through neighbours that still hold that colour, repainting each one as you reach it and stopping wherever the colour is different.",
    terms: ["recursion", "pixel"],
    codeShape: { helpers: "allowed" },
  },
  grid_bfs_multi_source: {
    mechanism:
      "put every already rotten orange in the queue before the first minute, then take the whole queue one layer at a time; each layer is one minute, and the answer is the number of layers, with any fresh orange left over meaning it can never be reached.",
    terms: ["queue", "layer"],
    // A depth-first walk reaches every reachable orange and gets the count of
    // minutes wrong, which is the whole answer.
    forbidTitles: [/\bdepth[- ]first\b|\bdfs\b/i],
    codeShape: { helpers: "allowed" },
  },
  grid_bipartite: {
    mechanism:
      "give one node a side, then walk the graph giving every neighbour the opposite side to the node you came from; the graph splits in two exactly when no edge is ever found joining two nodes already on the same side.",
    terms: ["colouring", "adjacency"],
    forbidTitles: [/\bmatching\b|\bunion[- ]find\b/i],
    codeShape: { helpers: "allowed" },
  },
  topological_sort: {
    mechanism:
      "count the prerequisites of every node, start with those that have none, and each time one is taken decrement its dependents, adding any that reach zero.",
    terms: ["in-degree", "queue"],
    codeShape: { helpers: "allowed" },
  },
  floyd_warshall: {
    mechanism:
      "hold a table of the best distance between every pair, then allow each node in turn as a stopover and keep the shorter of the direct route and the route through it.",
    terms: ["matrix"],
    codeShape: { helpers: "none" },
  },
  dijkstra: {
    mechanism:
      "keep the best known distance to each node, repeatedly settle the nearest unsettled node, and relax its edges to see whether they give its neighbours a shorter route.",
    terms: ["priority queue", "relax"],
    codeShape: { helpers: "allowed" },
  },
  kruskal: {
    mechanism:
      "sort every edge by weight and take them cheapest first, skipping any edge whose two ends are already connected, which union-find answers without walking the graph.",
    terms: ["union-find", "spanning tree"],
    codeShape: { require: [SORT_CALL], helpers: "allowed" },
  },
  prim: {
    mechanism:
      "grow one tree from a starting node, each step adding the cheapest edge that crosses from the tree to a node outside it.",
    terms: ["spanning tree"],
    codeShape: { helpers: "allowed" },
  },
  lcs: {
    mechanism:
      "fill a table where each cell is the answer for two prefixes: on matching letters take the diagonal plus one, otherwise the better of the cell above and the cell to the left.",
    terms: ["subsequence", "table"],
    codeShape: { helpers: "none" },
  },
  edit_distance: {
    mechanism:
      "fill a table of costs between prefixes: matching letters carry the diagonal down unchanged, otherwise pay one and take the cheapest of replace, delete and insert.",
    terms: ["table"],
    codeShape: { helpers: "none" },
  },
  knapsack: {
    mechanism:
      "fill a table over items and capacities, each cell being the better of leaving the item out, which is the cell above, and taking it, which is its value plus the cell its weight to the left on the row above.",
    terms: ["capacity", "table"],
    codeShape: { helpers: "none" },
  },
  dp_grid_paths: {
    mechanism:
      "fill a table where each cell is the number of ways to stand on it: the whole top row and left column are one, and every other cell is the cell above plus the cell to the left, because the robot's last move was one or the other.",
    terms: ["table"],
    codeShape: {
      // The closed form is C(m+n-2, m-1) and it is correct, but the board
      // walks a table one cell at a time. A one-line binomial in the panel
      // leaves the figure narrating a method the code never uses.
      forbid: [/\bmath\.comb\b|\bcomb\s*\(|\bfactorial\b|\bfactorial\s*\(/i],
      helpers: "none",
    },
  },
  monotonic_stack: {
    mechanism:
      "walk the array keeping a stack of positions still waiting for an answer; when the current value is larger it answers each of them as they pop, so every index is pushed and popped once.",
    terms: ["stack"],
    codeShape: { maxLoopsInMain: 2, helpers: "none" },
  },
  stack_matching: {
    mechanism:
      "walk the string once, pushing every opening bracket onto a stack, and on every closing bracket check that the top of the stack is its matching opener and pop it; the string is valid when nothing mismatched and the stack ends empty.",
    terms: ["stack", "nesting"],
    forbidTitles: [/\bcount(?:er|ing)?\b|\bregex\b|\breplace\b/i],
    // The classic wrong answer strips "()" repeatedly with replace, which is
    // quadratic and is not the algorithm the board walks.
    codeShape: { require: [/\bpop\s*\(/], forbid: [/\.replace\s*\(/, SORT_CALL], maxLoopsInMain: 1, helpers: "none" },
  },
  min_stack: {
    mechanism:
      "keep a second stack the same height as the first, and on every push store the smaller of the new value and the current minimum beside it, so pop undoes both and getMin is a single read of the top.",
    terms: ["stack", "constant time"],
    forbidTitles: [/\bsort\b|\bscan\b|\bheap\b|\bpriority\b/i],
    // Every method is O(1), so the section that returns an answer must not
    // loop: a getMin that scans the stack is the wrong solution, and it is
    // the one a planner reaches for.
    codeShape: { require: [/\bclass\b/], maxLoopsInMain: 0, helpers: "allowed" },
  },
  queue_two_stacks: {
    mechanism:
      "push everything onto an in stack, and when the out stack is empty pour the whole in stack into it, which reverses the order so the oldest value sits on top and pop and peek take from there.",
    terms: ["stack", "queue", "amortized"],
    forbidTitles: [/\bdeque\b|\bcircular\b|\blinked\s*list\b/i],
    // Reaching for a real queue is the way to fail this problem while
    // appearing to solve it.
    codeShape: {
      require: [/\bclass\b/, /\bpop\s*\(/],
      forbid: [/\bpop\s*\(\s*0\s*\)/, /\.shift\s*\(/, /\bdeque\b/i, /\bQueue\s*\(/],
      helpers: "allowed",
    },
  },
  recursion_call_stack: {
    mechanism:
      "a function that calls itself stacks each unfinished call with its own arguments, grows until it reaches the base case that answers outright, then unwinds, each waiting call taking the value below it and returning its own.",
    terms: ["recursion", "base case", "call stack"],
    forbidTitles: [/\biterative\b|\bloop\b|\bmemo/i],
    // Recursion with a loop in it is not recursion, and math.factorial is
    // not an explanation.
    codeShape: {
      require: [/\bfactorial\s*\(/i],
      forbid: [/\bmath\.factorial\b/i, /\breduce\s*\(/],
      maxLoopsInMain: 0,
      helpers: "allowed",
    },
  },
  stack_queue_ops: {
    mechanism:
      "both take values in the same order; a stack gives back the one added most recently and a queue gives back the one that has waited longest, so the same three pushes leave a different value in each.",
    terms: ["stack", "queue", "LIFO", "FIFO"],
    forbidTitles: [/\bdeque\b|\bpriority\b|\bheap\b/i],
    codeShape: { require: [/\bclass\b/, /\bpop\s*\(/], forbid: [SORT_CALL], helpers: "allowed" },
  },
  hash_map_two_sum: {
    mechanism:
      "walk the array once, and for each value look up the number that would complete the target in a map of the values already passed; if it is there the pair is found, otherwise store this value with its index.",
    terms: ["hash map", "complement"],
    forbidTitles: [/\btwo[- ]?pointer\b|\bsort\b|\bbrute\b/i],
    codeShape: { require: [MAP_LIKE], forbid: [SORT_CALL], maxLoopsInMain: 1, helpers: "none" },
  },
  hash_set_membership: {
    mechanism:
      "walk the array once keeping a set of every value already passed, and before storing each value ask the set whether it is there; the first time the answer is yes the array has a repeat and the walk can stop.",
    terms: ["hash set", "membership"],
    forbidTitles: [/\bsort\b|\bbrute\b|\bnested\s+loops?\b/i],
    codeShape: { require: [SET_LIKE], forbid: [SORT_CALL], maxLoopsInMain: 1, helpers: "none" },
  },
  hash_map_counting: {
    mechanism:
      "keep one map from letter to a running count, add one for each letter of the first string and take one away for the letter at the same position of the second, and the two are anagrams exactly when every count finishes at zero.",
    terms: ["hash map", "frequency count"],
    forbidTitles: [/\bsort(?:ed|ing)?\b/i],
    codeShape: { require: [MAP_LIKE], forbid: [SORT_CALL], maxLoopsInMain: 2, helpers: "none" },
  },
  hash_map_grouping: {
    mechanism:
      "sort the letters of each word to get a key every anagram of it shares, then use that key to drop the word into a bucket in a map, so no word is ever compared with another word.",
    terms: ["hash map", "signature"],
    forbidTitles: [/\bbrute\b|\bcompare\s+every\b|\bpairwise\b/i],
    // The sort call is required here rather than forbidden: sorting each word
    // is the step that manufactures the key, and a solution without one has
    // found a different technique from the one the board walks.
    codeShape: { require: [MAP_LIKE, SORT_CALL], maxLoopsInMain: 1, helpers: "allowed" },
  },
  char_count_pairing: {
    mechanism:
      "count how often each letter appears, take two from every count for the two sides of the palindrome, and add one more if any letter is left over to sit in the middle.",
    terms: ["frequency count", "parity"],
    forbidTitles: [/\btwo[- ]?pointers?\b|\bexpand\b|\bsubstring\b/i],
    codeShape: { require: [MAP_LIKE], maxLoopsInMain: 2, helpers: "none" },
  },
  hash_map_buckets: {
    mechanism:
      "turn each key into a bucket number with a hash, here the remainder after dividing by the number of buckets, and when two keys land on the same bucket hang the second off the first as a chain that a lookup then walks.",
    terms: ["bucket", "collision", "chaining"],
    forbidTitles: [/\btwo[- ]?sum\b|\bcomplement\b/i],
    // A dictionary literal is forbidden rather than required. This is the one
    // family whose subject IS the dictionary, so reaching for the language's
    // own hash map to implement a hash map answers the question with itself.
    codeShape: {
      require: [/%/, /\[\s*\]|list\(\)|ArrayList/],
      forbid: [MAP_LIKE],
      helpers: "allowed",
    },
  },
  union_find: {
    mechanism:
      "give every element its own parent, then join two sets by pointing one root at the other, and answer whether two elements are connected by climbing to their roots.",
    terms: ["root", "component"],
    codeShape: { helpers: "allowed" },
  },
  dp_fibonacci: {
    mechanism:
      "fill one cell per stair with the number of ways to arrive at it: standing at the bottom and standing on stair one are one way each, and after that every cell is the sum of the two before it, because the last move was either a single step or a double step and those two sets of routes cannot overlap.",
    terms: ["base case", "table"],
    forbidTitles: [/\bbrute\b|\bexponential\b|\bnaive\b/i],
    // A memo dictionary is the top-down version; the board walks the table
    // being filled left to right, and the two must not disagree on screen.
    codeShape: { forbid: [MAP_LIKE], maxLoopsInMain: 1, helpers: "none" },
  },
  dp_min_cost_stairs: {
    mechanism:
      "fill one cell per step with the cheapest way to be standing on it: the first two are free to start from, and every later cell pays the cost of leaving whichever of the two steps below it works out cheaper, with the answer one past the last step because the top of the floor costs nothing to stand on.",
    terms: ["base case", "table"],
    codeShape: { forbid: [SORT_CALL], maxLoopsInMain: 1, helpers: "none" },
  },
  dp_house_robber: {
    mechanism:
      "walk the street holding the best haul up to each house: at every house take the larger of skipping it, which is the previous cell unchanged, and robbing it, which is its money plus the cell two back because the house next door is then off limits.",
    terms: ["adjacent", "table"],
    // "Take every other house" is the confident wrong answer and it fails on
    // [2,7,9,3,1], where the optimum is houses 0, 2 and 4 for 12.
    forbidTitles: [/\bgreedy\b|\balternat/i],
    codeShape: { forbid: [SORT_CALL], maxLoopsInMain: 1, helpers: "none" },
  },
  dp_coin_change: {
    mechanism:
      "fill one cell per amount from zero upwards with the fewest coins that make it: spend each coin in turn, look up the cell for whatever is left, and keep the smallest of those plus one; an amount no coin can reach stays at infinity and is what makes the final answer minus one.",
    terms: ["denomination", "table"],
    // Largest coin first gives three coins on [1,3,4] for 6, where the table
    // finds two. A greedy title would name the algorithm the board disproves.
    forbidTitles: [/\bgreedy\b/i],
    codeShape: { forbid: [SORT_CALL], maxLoopsInMain: 2, helpers: "none" },
  },
  dp_lis: {
    mechanism:
      "fill one cell per position with the length of the longest increasing run that ends exactly there: look back at every earlier value smaller than this one, take the largest of their cells and add one; the answer is the largest cell in the table, not the last one.",
    terms: ["subsequence", "table"],
    // The O(n log n) tails version never builds this table, so its code would
    // not be the picture on the board.
    forbidTitles: [/\bbinary\s+search\b|\bn\s*log\s*n\b|\bpatience\b/i],
    codeShape: { forbid: [/\bbisect\b|\bbisect_left\b|\bbinary_?search\b/i], maxLoopsInMain: 2, helpers: "none" },
  },
  kadane: {
    mechanism:
      "walk the array once holding the best sum of a subarray that ends at the current position: either carry the previous run forward or throw it away and start again at this value, whichever is larger, and remember the largest such sum seen anywhere.",
    terms: ["subarray", "running sum"],
    forbidTitles: [/\bbrute\b|\bnested\b|\bdivide\s+and\s+conquer\b/i],
    codeShape: { forbid: [MAP_LIKE], maxLoopsInMain: 1, helpers: "none" },
  },
  greedy_jump: {
    mechanism:
      "scan left to right holding the furthest index reached so far; if the scan ever arrives at an index past that reach it is blocked and the answer is false, and otherwise every index was standable on and the last one is reachable.",
    terms: ["greedy", "reach"],
    // A quadratic reachability table answers the same question with a
    // different program, and the board draws one number, not a table.
    forbidTitles: [/\bdynamic\s+programming\b|\bdp\b|\bmemo/i],
    codeShape: { forbid: [MAP_LIKE], maxLoopsInMain: 1, helpers: "none" },
  },
  rotated_binary_search: {
    mechanism:
      "before throwing a half away, compare the low value with the middle one to find out which half is still in plain sorted order; that half's two endpoints say whether the target can be inside it, so one of the two halves goes every step.",
    terms: ["invariant", "pivot"],
    forbidTitles: [/\blinear\b|\bscan\b|\bbrute\b/i],
    // Sorting the array is the whole bug this family exists to avoid: it
    // destroys the rotation and searches a different array.
    codeShape: { forbid: [SORT_CALL], maxLoopsInMain: 1, helpers: "none" },
  },
  binary_search_on_answer: {
    mechanism:
      "the answer itself is the thing being searched: every speed below the true one fails and every speed above it works, so binary search the range of speeds and ask a yes or no question at each midpoint.",
    terms: ["predicate", "monotonic"],
    forbidTitles: [/\blinear\b|\bbrute\b|\bsimulat/i],
    // The feasibility check is a real function, so a helper is expected here
    // even though the search itself is one loop.
    codeShape: { forbid: [SORT_CALL], maxLoopsInMain: 1, helpers: "allowed" },
  },
  merge_two_sorted_arrays: {
    mechanism:
      "fill the first array from its last slot backwards, each step writing the larger of the two values still unmerged, so every write lands on a slot that is either empty or already spent and nothing has to shift.",
    terms: ["in place", "pointer"],
    forbidTitles: [/\bsort\s*\(\)|\bbuilt[- ]in\b|\bconcat/i],
    // Appending nums2 and calling sort is the cheat solution for this
    // problem, and it is a different picture from the one on the board.
    codeShape: { forbid: [SORT_CALL], maxLoopsInMain: 1, helpers: "none" },
  },
  three_sum_two_pointers: {
    mechanism:
      "sort first, then fix each value in turn and run two markers inward over the rest, raising the left one when the sum is short and lowering the right one when it overshoots, skipping any fixed value equal to the last.",
    terms: ["pointer", "duplicate"],
    forbidTitles: [/\bhash\b|\bbrute\b|\bcubic\b/i],
    // The sort is not bookkeeping here, it is what makes the pair scan
    // possible, so its absence is a different algorithm.
    codeShape: { require: [SORT_CALL], forbid: [MAP_LIKE], maxLoopsInMain: 2, helpers: "none" },
  },
  trapping_rain_water_two_pointers: {
    mechanism:
      "walk two markers inward and always move the shorter side, because that side's water is already decided by the tallest wall behind it: the column keeps that wall's height minus its own.",
    terms: ["prefix maximum", "invariant"],
    forbidTitles: [/\bstack\b|\bdynamic\s+programming\b|\bbrute\b/i],
    // The monotonic stack and the two prefix arrays both solve this and
    // neither is what the board draws.
    codeShape: { forbid: [SORT_CALL, /\bstack\b/i], maxLoopsInMain: 1, helpers: "none" },
  },
  single_pass_min_tracking: {
    mechanism:
      "walk the prices once carrying the cheapest day seen so far; at each day subtract that minimum from today's price and keep the best difference, so no two days are ever compared directly.",
    terms: ["running minimum"],
    forbidTitles: [/\bbrute\b|\bnested\b|\bkadane\b/i],
    // Sorting the prices destroys the ordering that makes buy before sell
    // mean anything, which is the classic wrong answer here.
    codeShape: { forbid: [SORT_CALL], maxLoopsInMain: 1, helpers: "none" },
  },
  tree_invert_recursion: {
    mechanism:
      "at every node swap its two children, then do the same to each of them; the leaves need nothing, so the whole algorithm is one exchange repeated by the recursion.",
    terms: ["recursion", "subtree"],
    forbidTitles: [/\bmirror\s+check\b|\bsymmetric\b/i],
    codeShape: { helpers: "allowed" },
  },
  bst_validate_bounds: {
    mechanism:
      "carry a low and a high bound down each branch: a node must sit strictly inside its own bounds, its left child inherits the same low with the node as the new high, and its right child inherits the node as the new low.",
    terms: ["bound", "subtree"],
    // Comparing a node with its own two children is the wrong algorithm and
    // passes the counterexample the board walks, so a program without a
    // helper carrying two extra arguments is not this lesson.
    forbidTitles: [/\bin[- ]?order\b|\bsorted\s+check\b/i],
    codeShape: { require: [/def\s+\w+\s*\([^)]*,[^)]*,[^)]*\)|\(\s*node\s*,\s*\w+\s*,\s*\w+\s*\)/], helpers: "allowed" },
  },
  bst_lca: {
    mechanism:
      "start at the root and compare both targets with the node: if both are smaller go left, if both are larger go right, and the first node they straddle is the lowest common ancestor.",
    terms: ["ancestor", "descendant"],
    forbidTitles: [/\bpath\b.*\bcompare\b|\bparent\s+pointers?\b/i],
    codeShape: { maxLoopsInMain: 1, helpers: "none" },
  },
  tree_max_path_sum: {
    mechanism:
      "return from each node the most one of its branches can contribute upward, never both, while separately recording the best path that bends at that node using both branches; a negative branch contributes zero.",
    terms: ["recursion", "gain"],
    forbidTitles: [/\broot[- ]to[- ]leaf\b|\bbrute\b/i],
    // The running best cannot be the return value, and a program that only
    // returns is the classic wrong answer, so the shape asks for both.
    codeShape: { require: [/\bmax\s*\(/], helpers: "allowed" },
  },
  tree_serialize_preorder: {
    mechanism:
      "write each node's value in preorder and write a marker for every empty child, so the reader can rebuild the tree by taking tokens in the same order and stopping a branch at each marker.",
    terms: ["preorder", "marker"],
    forbidTitles: [/\blevel[- ]order\b|\bbfs\b/i],
    codeShape: { helpers: "allowed" },
  },
  bst_insert: {
    mechanism:
      "for each new value walk down from the root, going left when it is smaller and right when it is larger, and hang it on the first empty branch you reach; the walk is the same one a search would take.",
    terms: ["node", "subtree"],
    forbidTitles: [/\bsort\b|\bbalanc\w*\b/i],
    codeShape: { forbid: [/\bsorted\s*\(|\.sort\s*\(/], helpers: "allowed" },
  },
  merge_intervals: {
    mechanism:
      "sort the intervals by their start, then sweep once holding one open run: if the next interval starts at or before the run's end it belongs to the run and only the end can grow, and otherwise the run is finished and written out and the next interval opens a new one.",
    terms: ["interval", "sweep"],
    forbidTitles: [/\bbrute\b|\bnested\b|\bevery\s+pair\b/i],
    // Sorting by start is not a preprocessing step here, it is the reason one
    // comparison is enough, so a program without it is a different algorithm.
    codeShape: { require: [SORT_CALL], maxLoopsInMain: 1, helpers: "none" },
  },
  quick_sort: {
    mechanism:
      "pick one value as the pivot and walk the rest of the range, keeping a boundary with everything at most the pivot behind it and swapping each smaller value across; then drop the pivot onto the boundary, where it is in its final place, and sort the two sides the same way.",
    terms: ["pivot", "partition"],
    forbidTitles: [/\bmerge\b|\bbubble\b|\bbuilt[- ]in\b/i],
    // A partition helper and a recursive call are the algorithm, not invented
    // scaffolding, so helpers are allowed here where they are not for a
    // single-pass family.
    codeShape: { forbid: [SORT_CALL], helpers: "allowed" },
  },
  insertion_sort: {
    mechanism:
      "grow a sorted region from the left: take the next value out, slide every sorted value larger than it one place right to open a gap, and drop it into the gap, so the region on the left is sorted again and one wider.",
    terms: ["key", "shift"],
    forbidTitles: [/\bselection\b|\bbubble\b|\bbuilt[- ]in\b/i],
    // The outer walk over the keys and the inner slide are both the algorithm.
    codeShape: { forbid: [SORT_CALL], maxLoopsInMain: 2, helpers: "none" },
  },
  xor_fold: {
    mechanism:
      "fold every value together with XOR: a value XOR itself is zero and the order does not matter, so every value that appears twice cancels itself out and what is left standing is the one that appears once.",
    terms: ["xor", "bit"],
    forbidTitles: [/\bhash\b|\bmap\b|\bdict\b|\bcount\b|\bsort\b/i],
    codeShape: { require: [XOR_OP], forbid: [MAP_LIKE, SORT_CALL], maxLoopsInMain: 1, helpers: "none" },
  },
  bit_count: {
    mechanism:
      "repeatedly replace n with n AND n minus 1, which clears exactly the lowest 1 and nothing else, and count the turns; the loop runs once per set bit rather than once per bit.",
    terms: ["bit", "mask"],
    forbidTitles: [/\bstring\b|\bbinary\s+string\b|\bconvert\b/i],
    // Stringifying the number and counting the ones is a correct answer to a
    // different question: it costs one step per column, which is the exact
    // point the board is making.
    codeShape: {
      require: [CLEAR_LOW_BIT],
      forbid: [/\bbin\s*\(|toString\s*\(\s*2\s*\)/],
      maxLoopsInMain: 1,
      helpers: "none",
    },
  },
  trie_insert_search: {
    mechanism:
      "store each word as a path of one letter per edge, so a shared prefix is stored once; insert walks the path and hangs a new node wherever the walk falls off, and search walks the same path and answers true only if the node it lands on is marked as the end of a word.",
    terms: ["prefix", "node"],
    forbidTitles: [/\bhash\s*set\b|\bbrute\b|\blist\s+of\s+words\b/i],
    // A node class plus insert plus search is three real functions and all
    // three are the data structure.
    codeShape: { helpers: "allowed" },
  },
  spiral_layers: {
    mechanism:
      "hold four boundaries, top, bottom, left and right, and read the top row, the right column, the bottom row and the left column in turn, stepping each boundary inwards as its side is read, until the boundaries cross.",
    terms: ["boundary", "layer"],
    forbidTitles: [/\brecursion\b|\bvisited\b|\bflag\b/i],
    // Popping the top row and rotating the rest is a neat trick and a different
    // algorithm from the one the board draws; it also copies the whole grid.
    //
    // No loop budget: the honest spiral is one while around four for loops,
    // and `verify-dsa-teaching` caps a declared bound at 4, so any number this
    // family could state would fail the program the figure is drawing. The
    // four boundaries are the shape here, not the loop count.
    codeShape: { forbid: [MATRIX_ROTATE_TRICK], helpers: "none" },
  },
  merge_two_lists: {
    mechanism:
      "keep one cursor on the front of each sorted list and a tail on the end of the answer; take whichever front is smaller, point the tail at that node, and step that list on, until one list empties and the other is hung on whole.",
    terms: ["splice", "dummy head"],
    // A program that reads both lists into an array and sorts it gets the
    // right values while the board shows arrows being rewired.
    forbidTitles: [/\bsort\b|\bbrute\b|\barray\b/i],
    codeShape: { forbid: [SORT_CALL], maxLoopsInMain: 1, helpers: "allowed" },
  },
  two_pass_or_gap_pointers: {
    mechanism:
      "walk a fast cursor n nodes ahead of a slow one, then move both together until the fast one reaches the last node; the slow one is now on the node before the one to remove, so a single next pointer skips it.",
    terms: ["gap", "dummy node"],
    // Counting the length first and walking again is the two-pass solution;
    // the board draws the one-pass gap, so the panel must too.
    forbidTitles: [/\btwo[- ]pass\b|\bcount\s+the\s+length\b/i],
    codeShape: { require: [/\bfast\b/i], forbid: [SORT_CALL], maxLoopsInMain: 2, helpers: "allowed" },
  },
  digit_carry_list: {
    mechanism:
      "walk both lists together adding the two digits and the carry, write the units digit into a new node and keep the tens as the next carry, and stop only when both lists and the carry are all empty.",
    terms: ["carry", "dummy head"],
    // Turning the lists into integers, adding, and splitting the digits back
    // out is a different algorithm and overflows on the real constraints.
    forbidTitles: [/\bconvert\b|\bstring\b|\binteger\b/i],
    codeShape: { require: [/\bcarry\b/i], forbid: [SORT_CALL], maxLoopsInMain: 1, helpers: "allowed" },
  },
  reverse_k_group: {
    mechanism:
      "count k nodes ahead before touching anything, reverse just that block, then point the tail left by the previous block at the new head; when fewer than k nodes remain, leave them exactly as they are.",
    terms: ["block", "pointer"],
    forbidTitles: [/\bvalues?\s+swap\b|\barray\b/i],
    // Reversing one block is the natural helper here, and "may not alter the
    // values" rules out the array round trip.
    codeShape: { forbid: [/\breversed\s*\(/, SORT_CALL], helpers: "allowed" },
  },
  heap_sift: {
    mechanism:
      "keep the array so every parent is at most its children; a new value goes in the next free cell and swaps upward while it is smaller than its parent, and a pop takes the root, moves the last cell into the hole, and swaps downward with the smaller child until the rule holds again.",
    terms: ["heap", "sift"],
    forbidTitles: [/\bsort\b|\bbinary\s+search\s+tree\b|\bbst\b/i],
    // The board walks the sifts by hand, so a program that calls heapq does
    // something the picture never shows. This is the one heap family where
    // the library is the wrong answer.
    codeShape: { forbid: [SORT_CALL, HEAP_CALL], helpers: "allowed" },
  },
  heap_top_k: {
    mechanism:
      "keep a min heap of only the k largest values seen so far; the root is the smallest of them, so a new value that cannot beat the root cannot be in the top k either, and one that can beats it takes its place.",
    terms: ["min heap", "root"],
    forbidTitles: [/\bsort\b|\bbrute\b|\bquickselect\b/i],
    // Sorting answers this in one line and teaches nothing the board shows,
    // and the statement itself asks for a solution without sorting.
    codeShape: { require: [HEAP_CALL], forbid: [SORT_CALL], maxLoopsInMain: 1, helpers: "none" },
  },
  heap_frequency: {
    mechanism:
      "count every value in one pass, then walk the distinct values through a min heap of size k that is ordered by the count, so the root is the weakest count kept and anything that cannot beat it is dropped; what remains inside is the k most frequent.",
    terms: ["hash map", "min heap", "frequency"],
    forbidTitles: [/\bsort\b|\bbrute\b|\bbucket\b/i],
    // The counting map is half the algorithm and the heap is the other half.
    // Sorting every count is the O(n log n) solution the follow-up rules out.
    codeShape: { require: [HEAP_CALL, MAP_LIKE], forbid: [SORT_CALL], maxLoopsInMain: 2, helpers: "none" },
  },
  heap_k_way_merge: {
    mechanism:
      "put the head of every list into a min heap, then repeatedly take the root, which has to be the smallest value left anywhere, and refill from the list it came from, so each value passes through the heap once and every comparison is against only k values.",
    terms: ["min heap", "head"],
    forbidTitles: [/\bbrute\b|\bconcatenate\b|\bdivide\s+and\s+conquer\b/i],
    // Collecting every value and sorting is the anti-solution this walk
    // exists to displace, and the board never shows a sort.
    codeShape: { require: [HEAP_CALL], forbid: [SORT_CALL], maxLoopsInMain: 2, helpers: "allowed" },
  },
  backtracking_subsets: {
    mechanism:
      "walk a recursion tree where each node is a subset and each edge adds one value from further right than the last; record every node on arrival, then undo the last choice and try the next value.",
    terms: ["backtracking", "recursion tree"],
    forbidTitles: [/\bbit\s*mask\b|\biterative\b|\bpower\s+of\s+two\s+loop\b/i],
    codeShape: { require: [COPY_OF_PATH], helpers: "allowed" },
  },
  backtracking_permutations: {
    mechanism:
      "walk a recursion tree where each level places one more value; a value already on the path is not offered again, so the pool shrinks by one at every level and only the leaves are complete arrangements.",
    terms: ["backtracking", "recursion tree"],
    forbidTitles: [/\bnext\s+permutation\b|\bheap'?s\s+algorithm\b|\bitertools\b/i],
    // A library call is not a walk-through. The board draws the pool
    // shrinking, so the program has to be the recursion that shrinks it.
    codeShape: { forbid: [/\bitertools\b|\bnext_permutation\b/], helpers: "allowed" },
  },
  backtracking_combination_sum: {
    mechanism:
      "walk a recursion tree carrying the running total; recurse from the same index so a candidate may be reused, collect a path when the total equals the target, and stop the row as soon as a candidate pushes the total past it.",
    terms: ["backtracking", "pruning"],
    forbidTitles: [/\bdynamic\s+programming\b|\bcoin\s+change\b|\bmemo(?:isation|ization)\b/i],
    // The board draws the row stopping at the first overshoot, and that break
    // is only sound on candidates read smallest first, so a program without
    // the sort would contradict the figure beside it.
    codeShape: { require: [SORT_CALL], helpers: "allowed" },
  },
  backtracking_phone_letters: {
    mechanism:
      "walk a recursion tree one digit per level, taking every letter on that digit's key in turn; nothing is ever rejected, so every leaf is an answer and the count is the letters on one key multiplied by the letters on the next.",
    terms: ["backtracking", "recursion tree"],
    forbidTitles: [/\bbit\s*mask\b|\bregular\s+expression\b/i],
    // MAP_LIKE is deliberately not required even though the keypad is a map:
    // it matches an empty literal or a constructor call, and the natural way
    // to write a keypad is a filled literal, so requiring it would fail
    // correct programs.
    codeShape: { forbid: [/\bitertools\b|\bproduct\s*\(/], helpers: "allowed" },
  },
};

export function familyTeachingFacts(familyId: string): FamilyTeachingFacts | null {
  return FAMILY_TEACHING[familyId] ?? null;
}
