/**
 * Singly linked list pointer surgery.
 *
 * Reversal is drawn by recording the real `links` array after each step, so
 * the arrows on the board flip when the algorithm flips them, and by drawing
 * `prev`, `curr` and `next` as markers under the nodes. Those three names are
 * the entire content of the algorithm: without them the board showed arrows
 * changing for no visible reason while the narration talked about pointers
 * the student could not see.
 */
import type { AlgorithmTrace, TraceEdge, TraceFrame, TraceNode, TracePointer } from "../types";

export interface LinkedListInput {
  values: Array<string | number>;
  /** Index the tail links back to, for the cycle walk. */
  cycleEntry?: number;
}

const MAX_FRAMES = 10;

function nodesOf(values: Array<string | number>, active: Set<string>): TraceNode[] {
  return values.map((value, index) => {
    const id = `n${index}`;
    return { id, label: String(value), ...(active.has(id) ? { mark: "active" as const } : {}) };
  });
}

export function simulateReverseLinkedList(input: LinkedListInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 3 || values.length > 6) return null;

  const ids = values.map((_, index) => `n${index}`);
  const frames: TraceFrame[] = [];
  const nameOf = (id: string | null) => (id === null ? "null" : String(values[ids.indexOf(id)]));

  // links[i] = the id this node currently points at, or null for the tail.
  const links = new Map<string, string | null>();
  ids.forEach((id, index) => links.set(id, ids[index + 1] ?? null));

  const edgesNow = (markedEdge?: string): TraceEdge[] => {
    const out: TraceEdge[] = [];
    for (const [from, to] of links) {
      if (!to) continue;
      out.push({ from, to, ...(from === markedEdge ? { mark: "active" as const } : {}) });
    }
    return out;
  };

  const pointersFor = (prev: string | null, curr: string | null, next: string | null): TracePointer[] => {
    const out: TracePointer[] = [];
    if (prev) out.push({ name: "prev", index: ids.indexOf(prev) });
    if (curr) out.push({ name: "curr", index: ids.indexOf(curr) });
    if (next) out.push({ name: "next", index: ids.indexOf(next) });
    return out;
  };

  const push = (
    id: string,
    caption: string,
    say: string,
    marks: { prev: string | null; curr: string | null; next: string | null },
    markedEdge?: string,
  ) => {
    frames.push({
      id,
      caption,
      narrationIntent: say,
      state: {
        kind: "list",
        nodes: nodesOf(values, new Set([marks.curr, marks.prev].filter((value): value is string => value !== null))),
        links: edgesNow(markedEdge),
        pointers: pointersFor(marks.prev, marks.curr, marks.next),
      },
    });
  };

  let previous: string | null = null;
  let current: string | null = ids[0]!;

  push(
    "input",
    `List of ${values.length} nodes`,
    `Every node points at the next one and the last points at null. Reversing means making every one of those arrows point the other way. Three markers do it: prev is what we have already reversed, curr is the node being turned round, and next holds the rest of the list so we do not lose it.`,
    { prev: null, curr: current, next: links.get(current) ?? null },
  );

  let step = 0;
  while (current && frames.length < MAX_FRAMES - 1) {
    const next: string | null = links.get(current) ?? null;
    links.set(current, previous);
    step += 1;
    push(
      `flip${step}`,
      previous ? `${nameOf(current)} now points back at ${nameOf(previous)}` : `${nameOf(current)} now points at null`,
      previous
        ? `next is holding ${nameOf(next)}, so it is safe to turn ${nameOf(current)} round: its arrow now points back at ${nameOf(previous)}. prev moves to ${nameOf(current)} and curr moves to ${nameOf(next)}.`
        : `${nameOf(current)} is the head, and it becomes the tail, so its arrow points at null. next is already holding ${nameOf(next)}, which is why the rest of the list is not lost.`,
      { prev: previous, curr: current, next },
      current,
    );
    previous = current;
    current = next;
  }

  // Finish any remaining links so the last frame is the true final state.
  while (current) {
    const next: string | null = links.get(current) ?? null;
    links.set(current, previous);
    previous = current;
    current = next;
  }

  push(
    "reversed",
    `Reversed: ${[...values].reverse().join(" ")}`.slice(0, 60),
    `Every arrow now points the other way and prev is standing on the new head, ${nameOf(previous)}. One pass over the list, and the only extra memory is those three markers.`,
    { prev: previous, curr: null, next: null },
  );

  return {
    algorithmId: "reverse_linked_list",
    title: "Reverse a linked list",
    input: { values },
    result: [...values].reverse(),
    resultText: [...values].reverse().join(" "),
    frames,
  };
}

export function simulateCycleDetection(input: LinkedListInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 4 || values.length > 6) return null;

  const ids = values.map((_, index) => `n${index}`);
  // `pos` from the statement when it gave one; otherwise a cycle from the
  // tail back to the middle, which is the canonical teaching shape.
  const cycleEntry = input.cycleEntry !== undefined && input.cycleEntry >= 0 && input.cycleEntry < values.length - 1
    ? input.cycleEntry
    : Math.floor(values.length / 2);
  const links: TraceEdge[] = ids.map((id, index) => ({
    from: id,
    to: index === ids.length - 1 ? ids[cycleEntry]! : ids[index + 1]!,
  }));

  const frames: TraceFrame[] = [];
  let slow = 0;
  let fast = 0;
  const nextOf = (index: number) => (index === ids.length - 1 ? cycleEntry : index + 1);

  const push = (id: string, caption: string, say: string) => {
    frames.push({
      id,
      caption,
      narrationIntent: say,
      state: {
        kind: "list",
        nodes: values.map((value, index) => ({
          id: ids[index]!,
          label: String(value),
          ...(index === slow || index === fast ? { mark: "active" as const } : {}),
        })),
        links,
        pointers: [
          { name: "slow", index: slow },
          { name: "fast", index: fast },
        ],
      },
    });
  };

  push(
    "input",
    `The tail links back to ${values[cycleEntry]}`,
    `The last node points back into the list instead of at null, so walking it never ends. Both markers start at the head: slow takes one step at a time, fast takes two.`,
  );

  for (let step = 0; step < MAX_FRAMES - 2; step += 1) {
    slow = nextOf(slow);
    fast = nextOf(nextOf(fast));
    push(
      `step${step + 1}`,
      slow === fast ? `slow and fast meet at ${values[slow]}: there is a cycle` : `slow at ${values[slow]}, fast at ${values[fast]}`,
      slow === fast
        ? `Both markers are on the same node. Inside a loop the fast marker gains one position on the slow one every step, so it must eventually land on it, and that meeting is the proof that a cycle exists.`
        : `slow moves to ${values[slow]} and fast moves two to ${values[fast]}. On a list that ends, fast would run off the end by now; here it keeps coming round.`,
    );
    if (slow === fast) break;
  }

  return {
    algorithmId: "linked_list_cycle",
    title: "Detect a cycle in a linked list",
    input: { values, cycleEntry },
    result: true,
    resultText: "there is a cycle",
    earlyExit: true,
    frames,
  };
}
