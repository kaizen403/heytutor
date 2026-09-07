/**
 * Routing gate: does a real problem statement reach the right algorithm family?
 *
 * The DSA lane draws a worked example only when `detectAlgorithm` recognises
 * the question. Everything downstream — the frame walk-through, the figure
 * that moves while the code types — depends on that one call. When it
 * declines, the board draws one static picture and the tutor narrates at it
 * for the rest of the lesson.
 *
 * The families were originally cued on algorithm *names* ("two sum", "merge
 * sort"), but students paste problem *statements*, which name no algorithm at
 * all. "Given an array of integers nums and an integer target, return indices
 * of the two numbers such that they add up to target" scored zero against
 * every family. This corpus is written the way a student actually asks.
 *
 * Two failure modes, weighted the way the engine weighs them everywhere else:
 *
 *   - routing to the WRONG family is fatal, always. A confident picture of a
 *     different algorithm is worse than no picture.
 *   - declining is tolerated up to a budget, because a decline still teaches
 *     from the code; it just teaches beside a static figure.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { familyById } from "../../src/dsa/algorithmCatalog";
import { detectAlgorithm, rankAlgorithms } from "../../src/dsa/detectAlgorithm";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface RoutingCase {
  /** How a student actually types it. */
  question: string;
  /** Family id, or "decline" when nothing may be drawn confidently. */
  expect: string;
}

/**
 * Statements are quoted close to their canonical wording, including the
 * "Given a ... return ..." shape that carries no algorithm name.
 */
const CORPUS: readonly RoutingCase[] = [
  // --- arrays: search, pointers, windows ---
  {
    question:
      "Given an array of integers nums which is sorted in ascending order, and an integer target, write a function to search target in nums. If target exists, then return its index.",
    expect: "binary_search",
  },
  {
    question: "explain binary search on a sorted array with an example",
    expect: "binary_search",
  },
  {
    // Search Insert Position names no technique and never says "its index".
    // It scored 2 against a floor of 4 and drew nothing at all.
    question:
      "Given a sorted array of distinct integers and a target value, return the index if the target is found. If not, return the index where it would be if it were inserted in order. You must write an algorithm with O(log n) runtime complexity.",
    expect: "binary_search",
  },
  {
    question:
      "Given a 1-indexed array of integers numbers that is already sorted in non-decreasing order, find two numbers such that they add up to a specific target number.",
    expect: "two_pointers",
  },
  {
    question:
      "You are given an integer array height of length n. Find two lines that together with the x-axis form a container, such that the container contains the most water.",
    // The pair-sum walk is the wrong picture for this; decline until a
    // container variant exists.
    expect: "decline",
  },
  {
    question:
      "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.",
    expect: "hash_map_two_sum",
  },
  {
    question: "two sum using a hash map in python",
    expect: "hash_map_two_sum",
  },
  {
    question:
      "Given an array of integers and a number k, find the maximum sum of any contiguous subarray of size k.",
    expect: "sliding_window_fixed",
  },
  {
    question:
      "Given a string s, find the length of the longest substring without repeating characters.",
    expect: "sliding_window_unique",
  },
  {
    question:
      "Given an array of integers temperatures represents the daily temperatures, return an array answer such that answer[i] is the number of days you have to wait after the ith day to get a warmer temperature.",
    expect: "monotonic_stack",
  },
  {
    question: "next greater element for every item in an array using a stack",
    expect: "monotonic_stack",
  },

  // --- sorting ---
  { question: "explain merge sort with a worked example", expect: "merge_sort" },
  {
    question: "how does bubble sort work on the array 5 1 4 2 8",
    expect: "bubble_sort",
  },

  // --- linked lists ---
  {
    question:
      "Given the head of a singly linked list, reverse the list, and return the reversed list.",
    expect: "reverse_linked_list",
  },
  { question: "reverse a linked list in java", expect: "reverse_linked_list" },
  {
    question:
      "Given head, the head of a linked list, determine if the linked list has a cycle in it.",
    expect: "linked_list_cycle",
  },

  // --- trees ---
  {
    question:
      "Given the root of a binary tree, return the inorder traversal of its nodes' values.",
    expect: "tree_traversal",
  },
  {
    question:
      "Given the root of a binary tree, return the level order traversal of its nodes' values.",
    expect: "tree_traversal",
  },
  {
    question:
      "You are given the root of a binary search tree and an integer val. Find the node in the BST that the node's value equals val and return the subtree rooted with that node.",
    expect: "bst_search",
  },

  // --- graphs ---
  {
    question:
      "Given an m x n 2D binary grid which represents a map of '1's (land) and '0's (water), return the number of islands.",
    expect: "grid_islands",
  },
  {
    question: "explain breadth first search on a graph step by step",
    expect: "graph_traversal",
  },
  {
    question:
      "There are a total of numCourses courses you have to take, and some courses have prerequisites. Return the ordering of courses you should take to finish all courses.",
    expect: "topological_sort",
  },
  {
    question:
      "Given a weighted graph and a source vertex, find the shortest path from the source to every other vertex.",
    expect: "dijkstra",
  },
  {
    question: "explain floyd warshall all pairs shortest path with the distance matrix",
    expect: "floyd_warshall",
  },
  {
    question: "find the minimum spanning tree of a weighted graph using kruskal's algorithm",
    expect: "kruskal",
  },
  { question: "how does prim's algorithm build an MST", expect: "prim" },
  {
    question:
      "There are n nodes and a list of edges. Return the number of connected components in the undirected graph.",
    // Counting components by traversal is the ordinary teaching answer here;
    // union-find is the alternative and has to be named to win.
    expect: "graph_traversal",
  },
  {
    question:
      "Explain union find with path compression and how it answers whether two elements are in the same set.",
    expect: "union_find",
  },

  // --- dynamic programming ---
  {
    question:
      "Given two strings text1 and text2, return the length of their longest common subsequence.",
    expect: "lcs",
  },
  {
    question:
      "Given two strings word1 and word2, return the minimum number of operations required to convert word1 to word2.",
    expect: "edit_distance",
  },
  {
    question:
      "Given weights and values of n items, put these items in a knapsack of capacity W to get the maximum total value.",
    expect: "knapsack",
  },

  // --- must decline: nothing here identifies one family ---
  {
    // The stack_queue_ops textbook ask verbatim: it scores 8 with no runner
    // up, so this is no longer a question that names no family.
    question: "what is the difference between a stack and a queue",
    expect: "stack_queue_ops",
  },
  {
    question: "explain big o notation to a beginner",
    expect: "decline",
  },
  {
    question: "A block of mass 2 kg slides down a frictionless incline of 30 degrees.",
    expect: "decline",
  },
  {
    question: "Find the derivative of x squared times sin x.",
    expect: "decline",
  },
  {
    question: "write a program that prints the first 10 fibonacci numbers",
    expect: "decline",
  },

  // --- statements that name no technique, from the LeetCode corpus ---
  {
    question:
      "You are given a network of n nodes, labeled from 1 to n. You are also given times, a list of travel times as directed edges times[i] = (ui, vi, wi). We will send a signal from a given node k. Return the minimum time it takes for all the n nodes to receive the signal.",
    expect: "dijkstra",
  },
  {
    question:
      "You are given an array points representing integer coordinates of some points on a 2D-plane. The cost of connecting two points is the manhattan distance between them. Return the minimum cost to make all points connected.",
    expect: "kruskal",
  },
  {
    question:
      "There is a new alien language that uses the English alphabet. However, the order of the letters is unknown to you. Return a string of the unique letters sorted in lexicographically increasing order by the new language's rules.",
    expect: "topological_sort",
  },
  {
    question:
      "In this problem, a tree is an undirected graph that is connected and has no cycles. You are given a graph that started as a tree with one additional edge added. Return an edge that can be removed so that the resulting graph is a tree.",
    expect: "union_find",
  },
  {
    question: "Given a string s, find the length of the longest substring without duplicate characters.",
    expect: "sliding_window_unique",
  },
  {
    question:
      "You are given an integer array nums consisting of n elements, and an integer k. Find a contiguous subarray whose length is equal to k that has the maximum average value.",
    expect: "sliding_window_fixed",
  },
  {
    question:
      "Given an array of integers temperatures represents the daily temperatures, return an array answer such that answer[i] is the number of days you have to wait after the ith day to get a warmer temperature.",
    expect: "monotonic_stack",
  },

  // --- grids, stacks and hash maps: the statements the new families own ---
  {
    question:
      "You are given an image represented by an m x n grid of integers image, where image[i][j] represents the pixel value of the image. You are also given three integers sr, sc, and color. Your task is to perform a flood fill on the image starting from the pixel image[sr][sc].",
    expect: "grid_dfs_fill",
  },
  {
    question:
      "You are given an m x n grid where each cell can have one of three values: 0 representing an empty cell, 1 representing a fresh orange, or 2 representing a rotten orange. Every minute, any fresh orange that is 4-directionally adjacent to a rotten orange becomes rotten. Return the minimum number of minutes that must elapse until no cell has a fresh orange.",
    expect: "grid_bfs_multi_source",
  },
  {
    question:
      "There is an undirected graph with n nodes, where each node is numbered between 0 and n - 1. You are given a 2D array graph, where graph[u] is an array of nodes that node u is adjacent to. Return true if and only if it is bipartite.",
    expect: "grid_bipartite",
  },
  {
    question:
      "There is a robot on an m x n grid. The robot is initially located at the top-left corner. The robot tries to move to the bottom-right corner. The robot can only move either down or right at any point in time. Given the two integers m and n, return the number of possible unique paths that the robot can take to reach the bottom-right corner.",
    expect: "dp_grid_paths",
  },
  {
    question:
      "Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.",
    expect: "stack_matching",
  },
  {
    question:
      "Design a stack that supports push, pop, top, and retrieving the minimum element in constant time.",
    expect: "min_stack",
  },
  {
    question:
      "Implement a first in first out (FIFO) queue using only two stacks. The implemented queue should support all the functions of a normal queue (push, peek, pop, and empty).",
    expect: "queue_two_stacks",
  },
  {
    question:
      "Explain recursion using factorial(4) as the example. Show me the call stack growing and unwinding, then the code.",
    expect: "recursion_call_stack",
  },
  {
    question:
      "What is the difference between a stack and a queue? Show push and pop with the values 1, 2, 3 on both and write a Python class for each.",
    expect: "stack_queue_ops",
  },
  {
    question:
      "Given an integer array nums, return true if any value appears at least twice in the array, and return false if every element is distinct.",
    expect: "hash_set_membership",
  },
  {
    question:
      "Given two strings s and t, return true if t is an anagram of s, and false otherwise.",
    expect: "hash_map_counting",
  },
  {
    question:
      "Given an array of strings strs, group the anagrams together. You can return the answer in any order.",
    expect: "hash_map_grouping",
  },
  {
    question:
      "Given a string s which consists of lowercase or uppercase letters, return the length of the longest palindrome that can be built with those letters.",
    expect: "char_count_pairing",
  },
  {
    question:
      "How does a hash map work internally? Explain hashing, buckets, and collisions by inserting the keys 12, 7, 22, 3 into a table with 5 buckets, and show a simple implementation in Python.",
    expect: "hash_map_buckets",
  },

  // --- a confident wrong picture is worse than none: these must decline ---
  {
    // Unique Paths II fills the same shaped table with different numbers, so
    // the figure would be exactly as convincing and wrong. This pins the
    // obstacle veto on dp_grid_paths.
    question:
      "You are given an m x n integer array obstacleGrid. There is a robot initially located at the top-left corner. An obstacle and space are marked as 1 or 0 respectively in obstacleGrid. Return the number of possible unique paths that the robot can take to reach the bottom-right corner.",
    expect: "decline",
  },
  {
    // The two-pointer simulator walks a sorted pair sum, which is a different
    // problem from the widest container. It drew the default array and its
    // captions asked about a target the question never mentions.
    question:
      "You are given an integer array height of length n. Find two lines that together with the x-axis form a container, such that the container contains the most water.",
    expect: "decline",
  },
  {
    // A grid of land and water is not a lettered node graph, and grid_islands
    // now walks it rather than nothing being drawn at all.
    question:
      "Given an m x n 2D binary grid which represents a map of '1's (land) and '0's (water), return the number of islands.",
    expect: "grid_islands",
  },
  {
    // Validating a tree is not searching it. The board searched for a 5 lifted
    // out of the explanation prose of a different example, and `bst_search`
    // still must not take this. It is no longer a decline: `bst_validate_bounds`
    // walks the bounds down the tree, which is the answer the probe corpus has
    // always declared for this statement, and it wins here 14 to 1.
    question:
      "Given the root of a binary tree, determine if it is a valid binary search tree (BST). The left subtree of a node contains only nodes with keys less than the node's key.",
    expect: "bst_validate_bounds",
  },
  {
    question:
      "Given a binary search tree, find the lowest common ancestor of two given nodes p and q in the BST.",
    expect: "decline",
  },
  {
    // The window maximum is a different quantity from the window sum.
    question:
      "You are given an array of integers nums, there is a sliding window of size k which is moving from the very left of the array to the very right. Return the max sliding window.",
    expect: "decline",
  },
  {
    // Buckets and collisions are the question; the two-sum walk is not, and
    // hash_map_buckets now draws the table rather than nothing being drawn.
    // Keeping this trimmed wording beside the verbatim probe statement pins
    // both halves: it must reach the internals family and not Two Sum.
    question:
      "How does a hash map work internally? Explain hashing, buckets, and collisions by inserting the keys 12, 7, 22, 3 into a table with 5 buckets.",
    expect: "hash_map_buckets",
  },
  {
    // Watching a tree being built is not the same lesson as searching a built
    // one, and `bst_insert` now draws it rather than nothing being drawn.
    question:
      "Explain how a binary search tree is built by inserting 8, 3, 10, 1, 6, 14 in that order, and then how an in-order traversal gives them back sorted.",
    expect: "bst_insert",
  },

  // --- one-dimensional DP and the two greedy scans ---
  {
    question:
      "You are climbing a staircase. It takes n steps to reach the top. Each time you can either climb 1 or 2 steps. In how many distinct ways can you climb to the top?",
    expect: "dp_fibonacci",
  },
  {
    question:
      "You are given an integer array cost where cost[i] is the cost of ith step on a staircase. Once you pay the cost, you can either climb one or two steps. You can either start from the step with index 0, or the step with index 1. Return the minimum cost to reach the top of the floor.",
    expect: "dp_min_cost_stairs",
  },
  {
    question:
      "You are a professional robber planning to rob houses along a street. Each house has a certain amount of money stashed, the only constraint stopping you from robbing each of them is that adjacent houses have security systems connected. Return the maximum amount of money you can rob tonight without alerting the police.",
    expect: "dp_house_robber",
  },
  {
    question:
      "You are given an integer array coins representing coins of different denominations and an integer amount representing a total amount of money. Return the fewest number of coins that you need to make up that amount. You may assume that you have an infinite number of each kind of coin.",
    expect: "dp_coin_change",
  },
  {
    question:
      "Given an integer array nums, return the length of the longest strictly increasing subsequence.",
    expect: "dp_lis",
  },
  {
    question: "Given an integer array nums, find the subarray with the largest sum, and return its sum.",
    expect: "kadane",
  },
  {
    question:
      "You are given an integer array nums. You are initially positioned at the array's first index, and each element in the array represents your maximum jump length at that position. Return true if you can reach the last index, or false otherwise.",
    expect: "greedy_jump",
  },

  // --- array scans and the binary-search variants ---
  {
    question:
      "There is an integer array nums sorted in ascending order with distinct values. Prior to being passed to your function, nums is possibly left rotated at an unknown index k. Given the array nums after the possible rotation and an integer target, return the index of target if it is in nums, or -1 if it is not in nums.",
    expect: "rotated_binary_search",
  },
  {
    question:
      "Koko loves to eat bananas. There are n piles of bananas, the ith pile has piles[i] bananas. The guards have gone and will come back in h hours. Koko can decide her bananas-per-hour eating speed of k. Return the minimum integer k such that she can eat all the bananas within h hours.",
    expect: "binary_search_on_answer",
  },
  {
    question:
      "You are given two integer arrays nums1 and nums2, sorted in non-decreasing order, and two integers m and n. Merge nums1 and nums2 into a single array sorted in non-decreasing order. The final sorted array should be stored inside the array nums1, where the last n elements are set to 0 and should be ignored.",
    expect: "merge_two_sorted_arrays",
  },
  {
    question:
      "Given an integer array nums, return all the triplets [nums[i], nums[j], nums[k]] such that i != j, i != k, and j != k, and nums[i] + nums[j] + nums[k] == 0. Notice that the solution set must not contain duplicate triplets.",
    expect: "three_sum_two_pointers",
  },
  {
    question:
      "Given n non-negative integers representing an elevation map where the width of each bar is 1, compute how much water it can trap after raining.",
    expect: "trapping_rain_water_two_pointers",
  },
  {
    question:
      "You are given an array prices where prices[i] is the price of a given stock on the ith day. You want to maximize your profit by choosing a single day to buy one stock and choosing a different day in the future to sell that stock. Return the maximum profit you can achieve from this transaction.",
    expect: "single_pass_min_tracking",
  },

  // --- tree recursion: the walks that are not a search ---
  {
    question: "Given the root of a binary tree, invert the tree, and return its root.",
    expect: "tree_invert_recursion",
  },
  {
    question:
      "Given the root of a binary tree, determine if it is a valid binary search tree (BST). The left subtree of a node contains only nodes with keys less than the node's key. The right subtree of a node contains only nodes with keys greater than the node's key.",
    expect: "bst_validate_bounds",
  },
  {
    question:
      "Given a binary search tree (BST), find the lowest common ancestor (LCA) node of two given nodes in the BST. The lowest common ancestor is defined between two nodes p and q as the lowest node in T that has both p and q as descendants.",
    expect: "bst_lca",
  },
  {
    question:
      "A path in a binary tree is a sequence of nodes where each pair of adjacent nodes in the sequence has an edge connecting them. Note that the path does not need to pass through the root. Given the root of a binary tree, return the maximum path sum of any non-empty path.",
    expect: "tree_max_path_sum",
  },
  {
    question:
      "Design an algorithm to serialize and deserialize a binary tree. You just need to ensure that a binary tree can be serialized to a string and this string can be deserialized to the original tree structure.",
    expect: "tree_serialize_preorder",
  },

  // --- intervals, sorts, bits, a trie and a spiral ---
  {
    question:
      "Given an array of intervals where intervals[i] = [starti, endi], merge all overlapping intervals, and return an array of the non-overlapping intervals that cover all the intervals in the input.",
    expect: "merge_intervals",
  },
  {
    question:
      "Explain quicksort with the array [8, 3, 7, 1, 9, 2]. I want to see how the partition step moves elements around the pivot.",
    expect: "quick_sort",
  },
  {
    question: "Teach me insertion sort using [4, 3, 2, 10, 12, 1] as the example.",
    expect: "insertion_sort",
  },
  {
    question:
      "Given a non-empty array of integers nums, every element appears twice except for one. Find that single one. You must implement a solution with a linear runtime complexity and use only constant extra space.",
    expect: "xor_fold",
  },
  {
    question:
      "Given a positive integer n, write a function that returns the number of set bits in its binary representation (also known as the Hamming weight).",
    expect: "bit_count",
  },
  {
    question:
      "A trie (pronounced as \"try\") or prefix tree is a tree data structure used to efficiently store and retrieve keys in a dataset of strings. There are various applications of this data structure, such as autocomplete and spellchecker. Implement the Trie class.",
    expect: "trie_insert_search",
  },
  {
    question: "Given an m x n matrix, return all elements of the matrix in spiral order.",
    expect: "spiral_layers",
  },

  // --- linked list surgery ---
  {
    question:
      "You are given the heads of two sorted linked lists list1 and list2. Merge the two lists into one sorted list. The list should be made by splicing together the nodes of the first two lists. Return the head of the merged linked list.",
    expect: "merge_two_lists",
  },
  {
    question:
      "Given the head of a linked list, remove the nth node from the end of the list and return its head.",
    expect: "two_pass_or_gap_pointers",
  },
  {
    question:
      "You are given two non-empty linked lists representing two non-negative integers. The digits are stored in reverse order, and each of their nodes contains a single digit. Add the two numbers and return the sum as a linked list.",
    expect: "digit_carry_list",
  },
  {
    question:
      "Given the head of a linked list, reverse the nodes of the list k at a time, and return the modified list. If the number of nodes is not a multiple of k then left-out nodes, in the end, should remain as it is. You may not alter the values in the list's nodes, only nodes themselves may be changed.",
    expect: "reverse_k_group",
  },

  // --- heaps ---
  {
    question:
      "Explain how a min-heap works. Insert 5, 3, 8, 1 one at a time, show the sift-up on the tree and the array underneath, then pop the minimum.",
    expect: "heap_sift",
  },
  {
    question:
      "Given an integer array nums and an integer k, return the kth largest element in the array. Note that it is the kth largest element in the sorted order, not the kth distinct element. Can you solve it without sorting?",
    expect: "heap_top_k",
  },
  {
    question:
      "Given an integer array nums and an integer k, return the k most frequent elements. You may return the answer in any order.",
    expect: "heap_frequency",
  },
  {
    question:
      "You are given an array of k linked-lists lists, each linked-list is sorted in ascending order. Merge all the linked-lists into one sorted linked-list and return it.",
    expect: "heap_k_way_merge",
  },

  // --- backtracking, drawn as the recursion tree it is ---
  {
    question:
      "Given an integer array nums of unique elements, return all possible subsets (the power set). The solution set must not contain duplicate subsets.",
    expect: "backtracking_subsets",
  },
  {
    question:
      "Given an array nums of distinct integers, return all the possible permutations. You can return the answer in any order.",
    expect: "backtracking_permutations",
  },
  {
    question:
      "Given an array of distinct integers candidates and a target integer target, return a list of all unique combinations of candidates where the chosen numbers sum to target. The same number may be chosen from candidates an unlimited number of times.",
    expect: "backtracking_combination_sum",
  },
  {
    question:
      "Given a string containing digits from 2-9 inclusive, return all possible letter combinations that the number could represent. A mapping of digits to letters, just like on the telephone buttons, is given below.",
    expect: "backtracking_phone_letters",
  },
];

/** Declines cost a static board, so they are budgeted rather than banned. */
const MAX_DECLINE_RATE = 0.1;

const routable = CORPUS.filter((entry) => entry.expect !== "decline");
const wrong: string[] = [];
const declined: string[] = [];
const overreach: string[] = [];

for (const entry of CORPUS) {
  const detected = detectAlgorithm(entry.question);
  const id = detected?.family.id ?? null;
  const preview = entry.question.slice(0, 64);

  if (entry.expect === "decline") {
    if (id !== null) {
      const ranked = rankAlgorithms(entry.question)
        .slice(0, 2)
        .map((match) => `${match.family.id}:${match.score}`)
        .join(" ");
      overreach.push(`"${preview}" drew ${id} (${ranked})`);
    }
    continue;
  }

  if (id === null) {
    declined.push(`"${preview}" -> expected ${entry.expect}`);
    continue;
  }
  if (id !== entry.expect) {
    const ranked = rankAlgorithms(entry.question)
      .slice(0, 3)
      .map((match) => `${match.family.id}:${match.score}`)
      .join(" ");
    wrong.push(`"${preview}" -> ${id}, expected ${entry.expect} (${ranked})`);
  }
}

const declineRate = declined.length / routable.length;

console.log(
  `dsa routing: ${routable.length - declined.length - wrong.length}/${routable.length} routed, ` +
    `${wrong.length} wrong, ${declined.length} declined (${(declineRate * 100).toFixed(1)}%), ` +
    `${overreach.length} overreach`,
);

const failures: string[] = [];
if (wrong.length > 0) {
  failures.push(`routed to the wrong family:\n  ${wrong.join("\n  ")}`);
}
if (overreach.length > 0) {
  failures.push(
    `drew a family for a question that names none:\n  ${overreach.join("\n  ")}`,
  );
}
if (declineRate > MAX_DECLINE_RATE) {
  failures.push(
    `${declined.length} of ${routable.length} statements declined (${(declineRate * 100).toFixed(1)}%, ` +
      `budget ${(MAX_DECLINE_RATE * 100).toFixed(0)}%). A decline leaves the board static for the whole lesson:\n  ` +
      declined.join("\n  "),
  );
}

if (failures.length > 0) {
  throw new Error(`verify-dsa-routing failed\n\n${failures.join("\n\n")}`);
}

// --- The figure walks the example the committed program runs. ---
{
  // A statement with no numbers used to fall back to the family default, so
  // the board traced "find two values summing to 26" while the code panel
  // typed target 9 underneath it. One lesson, two examples, both on screen.
  const statement =
    "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.";
  const driver = "nums = [2, 7, 11, 15]\ntarget = 9\nresult = two_sum(nums, target)\nprint(result)";

  const bare = detectAlgorithm(statement);
  assert(bare !== null, "the statement must still route without an example");
  assert(
    bare.exampleSource === "default",
    "a statement with no numbers has no example of its own",
  );

  const grounded = detectAlgorithm(statement, { exampleText: driver });
  assert(grounded !== null, "grounding must not lose the family");
  assert(
    grounded.family.id === bare.family.id,
    `the example must not change the family: ${bare.family.id} -> ${grounded.family.id}`,
  );
  assert(
    grounded.exampleSource === "question",
    "the program's own driver lines are a real example, not the canned one",
  );
  const input = grounded.trace.input as { values?: number[]; target?: number };
  assert(
    JSON.stringify(input.values) === JSON.stringify([2, 7, 11, 15]) && input.target === 9,
    `the simulator must run the program's example, got ${JSON.stringify(input)}`,
  );

  // A linked-list driver builds its example one node at a time rather than
  // writing a literal, so the figure walked four nodes beside code building
  // five until the extractor learned the constructor form.
  const listStatement =
    "Given the head of a singly linked list, reverse the list, and return the reversed list.";
  const listDriver = [
    "head = ListNode(1)",
    "head.next = ListNode(2)",
    "head.next.next = ListNode(3)",
    "head.next.next.next = ListNode(4)",
    "head.next.next.next.next = ListNode(5)",
    "reversed_head = reverseList(head)",
  ].join("\n");
  const listGrounded = detectAlgorithm(listStatement, { exampleText: listDriver });
  assert(listGrounded?.family.id === "reverse_linked_list", "the list statement must still route");
  assert(
    JSON.stringify((listGrounded.trace.input as { values?: number[] }).values) ===
      JSON.stringify([1, 2, 3, 4, 5]),
    `the figure must walk the list the code builds, got ${JSON.stringify(listGrounded.trace.input)}`,
  );

  // Routing reads the question only. Otherwise a comment or an identifier in
  // the committed code could drag the figure to a different algorithm.
  const misleading = detectAlgorithm(statement, {
    exampleText: "# merge sort dijkstra prim knapsack binary search\nvalues = [9, 8, 7, 6]",
  });
  assert(
    misleading?.family.id === bare.family.id,
    `example text must never reroute the figure, got ${misleading?.family.id}`,
  );
}

/**
 * The whole probe corpus, checked against whatever the catalog can draw today.
 *
 * The hand-written corpus above states what the routing must do; this section
 * states that it keeps doing it as families are added. The rule is
 * self-maintaining: every probe whose declared pattern HAS a family must route
 * to that family, and a probe whose pattern has no family yet is skipped, not
 * failed. Adding a family therefore switches its probes on automatically, and
 * a new family that steals another family's statements fails here the day it
 * lands rather than in a live round.
 *
 * A probe carrying a `catalogNote` must draw nothing. The note is a
 * deliberate decision that no family should answer this question, and it
 * records why, so removing the note is the explicit act of saying a family
 * may now claim it.
 *
 * `inCatalog` is deliberately NOT read here. It restated what the catalog
 * already knows, so it went stale the moment a family landed: a lane adding
 * five families had to hand-flip five flags in a data file to stop this gate
 * demanding that those families decline their own statements. The catalog is
 * the one source of truth for what can be drawn, and the note is the one
 * source of truth for what must not be.
 */
function assertProbeCorpusRoutes(): void {
  const dir = resolve(import.meta.dirname, "../../../../data/leetcode-probes");
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    console.log("dsa routing: probe corpus not present, skipping the corpus check");
    return;
  }
  assert(files.length > 0, "the probe corpus directory is empty");

  interface Probe {
    id: string;
    pattern: string;
    question: string;
    /** Present means a standing decision that nothing may draw this one. */
    catalogNote?: string;
  }
  const probes: Probe[] = [];
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(resolve(dir, file), "utf8")) as { questions?: Probe[] };
    for (const probe of parsed.questions ?? []) probes.push(probe);
  }
  assert(probes.length >= 100, `expected the full corpus, got ${probes.length} probes`);

  const misrouted: string[] = [];
  const silent: string[] = [];
  const overreach: string[] = [];
  let covered = 0;

  for (const probe of probes) {
    const detected = detectAlgorithm(probe.question);
    const id = detected?.family.id ?? null;

    if (probe.catalogNote) {
      // Declining is the point of these, and the note says why. Drawing
      // anything is a wrong picture, so the note has to be removed before a
      // family may claim the question.
      if (id !== null) overreach.push(`${probe.id} drew ${id} despite "${probe.catalogNote.slice(0, 60)}"`);
      continue;
    }
    if (!familyById(probe.pattern)) continue;
    covered += 1;
    if (id === null) {
      silent.push(`${probe.id} declined, expected ${probe.pattern}`);
      continue;
    }
    if (id !== probe.pattern) {
      const ranked = rankAlgorithms(probe.question)
        .slice(0, 3)
        .map((match) => `${match.family.id}:${match.score}`)
        .join(" ");
      misrouted.push(`${probe.id} -> ${id}, expected ${probe.pattern} (${ranked})`);
    }
  }

  console.log(
    `dsa routing corpus: ${covered - misrouted.length - silent.length}/${covered} probes with a family routed, ` +
      `${misrouted.length} wrong, ${silent.length} silent, ${overreach.length} overreach`,
  );

  assert(
    misrouted.length === 0,
    `probes routed to the wrong family:\n  ${misrouted.join("\n  ")}`,
  );
  assert(
    overreach.length === 0,
    `probes that must decline drew a family anyway:\n  ${overreach.join("\n  ")}`,
  );
  // A family that exists and cannot be reached from its own problem statement
  // is a family the student never sees.
  assert(
    silent.length === 0,
    `probes whose family exists but was not reached:\n  ${silent.join("\n  ")}`,
  );
}

assertProbeCorpusRoutes();

console.log("verify-dsa-routing passed");
