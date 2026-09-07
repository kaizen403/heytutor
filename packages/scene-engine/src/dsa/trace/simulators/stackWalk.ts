/**
 * Stacks and queues drawn as the structure the algorithm actually keeps.
 *
 * Every walk here has the same shape: an input being consumed left to right,
 * and a helper beside it that grows and shrinks. The helper is the lesson.
 * Narrating "we push the bracket onto the stack" over a picture of a string
 * teaches nothing, because the stack the sentence is about is not on the
 * board; the five simulators below put it there as ink, in an `aside`, and
 * let the caption carry only the decision.
 *
 * Three drawing rules are shared, and each one exists because the obvious
 * alternative teaches the wrong thing.
 *
 * **A stack is a column that grows upward from cell 0.** `aside` lays a
 * column out with index 0 lowest, so the natural bottom-to-top order of the
 * stack array is exactly the order to pass. Reversing it (top first) puts the
 * top of the stack on the floor of the drawing, which is upside down from
 * every board a student has ever seen.
 *
 * **A queue is a row that grows to the right, front at index 0.** The whole
 * point of the stack-versus-queue lesson is that the two disagree about which
 * end leaves, so the two must be drawn along different axes or the difference
 * is invisible.
 *
 * **Capacity is the worst case, fixed for the whole trace.** An aside that
 * grew as the stack grew would move every cell address between frames, and
 * the trace-versus-render gate compares addresses. Pre-sizing also means the
 * student watches the ink fill a container of known size, which is the
 * picture of "depth" the recursion lesson needs.
 *
 * Cell text is kept to three characters. The array cell is a fixed width in
 * world units and the compiler fits the whole figure, asides included, into
 * one zone, so a four letter word inside a cell of a seven cell row with two
 * columns beside it spills over its own wall. The caption names the operation
 * in full; the cell carries its code.
 */
import {
  aside,
  type AlgorithmTrace,
  type ArrayFrameState,
  type TraceAside,
  type TraceCell,
  type TraceFrame,
  type TraceMark,
} from "../types";

/** The lesson budget the trace gate enforces. A longer walk declines. */
const MAX_FRAMES = 16;

/**
 * A trace whose frames share a narration intent fails the gate, and a design
 * problem's call list can legitimately repeat one call against one state:
 * `top` twice in a row is the same picture described twice. Naming the call's
 * position is the honest way to separate them, rather than inventing a
 * difference between two frames that really are alike.
 */
function distinctIntent(used: string[], intent: string, position: number): string {
  const unique = used.includes(intent) ? `${intent} This is call ${position} in the list.` : intent;
  used.push(unique);
  return unique;
}

/** Marks for a stack column: the top is what the algorithm is touching. */
function topMark(depth: number, mark: TraceMark = "active"): Map<number, TraceMark> {
  return depth > 0 ? new Map([[depth - 1, mark]]) : new Map();
}

/** A row of cells with per-index marks, written the way each walk needs it. */
function row(texts: readonly string[], marks: ReadonlyMap<number, TraceMark>): TraceCell[] {
  return texts.map((text, index) => {
    const mark = marks.get(index);
    return mark ? { text, mark } : { text };
  });
}

// --------------------------------------------------------------------------
// Valid Parentheses (LC 20)
// --------------------------------------------------------------------------

export interface BracketInput {
  /** The characters of the string, one per cell. */
  characters: string[];
}

const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
const OPENERS = new Set(["(", "[", "{"]);

/**
 * Valid Parentheses: the stack is the answer, so the stack is the picture.
 *
 * The canonical Example 1 for this problem is "()[]{}", and it is the wrong
 * example to draw: its stack never holds more than one bracket, so the board
 * shows a one cell column and the student never sees why a stack is needed at
 * all. The default here nests three deep, which is what rules 1 and 2 of the
 * statement are actually about. A pasted question still walks its own string.
 */
export function simulateStackMatching(input: BracketInput): AlgorithmTrace | null {
  const chars = input.characters;
  if (chars.length < 2 || chars.length > 10) return null;
  if (chars.some((ch) => !OPENERS.has(ch) && !(ch in CLOSERS))) return null;

  // The column is pre-sized to the deepest the stack ever gets, computed
  // before the walk so no frame changes its capacity. A string that only ever
  // nests one deep still gets a two cell column, because a single box does not
  // read as a container.
  let running = 0;
  let deepest = 0;
  for (const ch of chars) {
    if (OPENERS.has(ch)) {
      running += 1;
      deepest = Math.max(deepest, running);
    } else if (running > 0) {
      running -= 1;
    }
  }
  const capacity = Math.max(2, deepest);

  const settled = new Map<number, TraceMark>();
  const stack: Array<{ ch: string; index: number }> = [];
  const frames: TraceFrame[] = [];
  const intents: string[] = [];
  const text = chars.join("");

  const state = (
    activeIndex: number,
    override: ReadonlyMap<number, TraceMark>,
    note: string,
    columnMark: TraceMark = "active",
  ): ArrayFrameState => {
    const marks = new Map(settled);
    for (const [index, mark] of override) marks.set(index, mark);
    if (activeIndex >= 0 && !override.has(activeIndex)) marks.set(activeIndex, "active");
    return {
      kind: "array",
      cells: row(chars, marks),
      showIndices: true,
      ...(activeIndex >= 0 ? { pointers: [{ name: "i", index: activeIndex }] } : {}),
      note,
      // Bottom to top, unreversed: the top of the stack belongs at the top of
      // the column, and `aside` counts a column upward from index 0. The mark
      // travels with the top, because the top is the only cell any step of
      // this algorithm ever looks at.
      asides: [aside("stack", "stack", "column", stack.map((entry) => entry.ch), capacity, topMark(stack.length, columnMark))],
    };
  };

  frames.push({
    id: "input",
    caption: `Is ${text} balanced?`.slice(0, 60),
    narrationIntent:
      `Reading left to right, an opening bracket is a promise that has to be kept later, and the promises have to be kept in the reverse of the order they were made. ` +
      `That is exactly what a stack remembers, so every opener goes on the stack and every closer has to match whatever is on top.`,
    state: state(-1, new Map(), "stack empty"),
  });

  let valid = true;
  let failedAt: number | null = null;

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    if (OPENERS.has(ch)) {
      stack.push({ ch, index: i });
      frames.push({
        id: `at${i}`,
        caption: `${ch} opens, so it waits on the stack`,
        narrationIntent: distinctIntent(
          intents,
          `${ch} is an opening bracket, so nothing can be decided yet. It goes on top of the stack and waits for its partner, and the stack is now ${stack.length} deep.`,
          i + 1,
        ),
        state: state(i, new Map(), `top is ${ch}`),
      });
      continue;
    }

    const want = CLOSERS[ch]!;
    const open = stack[stack.length - 1];
    if (!open || open.ch !== want) {
      // The mismatch is the whole failure case, so both offenders are struck
      // through in the same frame. Marking only the closer would leave the
      // student guessing which opener it was measured against.
      valid = false;
      failedAt = i;
      const override = new Map<number, TraceMark>([[i, "excluded"]]);
      if (open) override.set(open.index, "excluded");
      settled.set(i, "excluded");
      if (open) settled.set(open.index, "excluded");
      frames.push({
        id: `at${i}`,
        caption: open
          ? `${ch} does not close ${open.ch}, so it is not valid`.slice(0, 60)
          : `${ch} closes nothing, so it is not valid`,
        narrationIntent: distinctIntent(
          intents,
          open
            ? `${ch} needs ${want} on top of the stack, but the top is ${open.ch} from index ${open.index}. The promises are being kept out of order, so the string fails here and the rest of it never has to be read.`
            : `${ch} is a closing bracket with an empty stack under it, so there is no opener for it to match. The string fails here and nothing later can rescue it.`,
          i + 1,
        ),
        state: state(-1, override, "no match", "excluded"),
      });
      break;
    }

    stack.pop();
    settled.set(open.index, "done");
    settled.set(i, "done");
    frames.push({
      id: `at${i}`,
      caption: `${ch} closes ${open.ch} from index ${open.index}`.slice(0, 60),
      narrationIntent: distinctIntent(
        intents,
        `${ch} needs ${want}, and ${want} is exactly what is on top of the stack, put there at index ${open.index}. The pair is settled, that opener comes off, and the stack drops to ${stack.length}.`,
        i + 1,
      ),
      state: state(i, new Map([[open.index, "done"]]), stack.length > 0 ? `top is ${stack[stack.length - 1]!.ch}` : "stack empty"),
    });
  }

  if (valid && stack.length > 0) valid = false;

  // The rule students forget is the last one: an empty stack at the end is
  // part of the answer, not a formality. It gets its own frame so the empty
  // column is something they watched happen.
  if (failedAt === null) {
    // Unmatched openers are the reason the answer is no, so they are struck in
    // the row too; leaving them clean would put the whole verdict in the
    // caption and none of it on the board.
    const leftover = new Map<number, TraceMark>(stack.map((entry) => [entry.index, "excluded" as TraceMark]));
    frames.push({
      id: "answer",
      caption: valid
        ? "Stack is empty at the end, so it is valid"
        : `${stack.length} opener${stack.length === 1 ? "" : "s"} left over, not valid`.slice(0, 60),
      narrationIntent: valid
        ? `Every closer found its partner and the stack finished empty, which is the second half of the test: a string can match every bracket it closes and still be invalid if it left something open. This one did not, so the answer is valid.`
        : `The string ran out before the stack did. ${stack.length} opening bracket${stack.length === 1 ? " has" : "s have"} no partner, and an unmatched opener makes the string invalid just as surely as a wrong closer does.`,
      state: state(-1, leftover, valid ? "stack empty" : "still waiting", valid ? "active" : "excluded"),
    });
  }

  if (frames.length < 2 || frames.length > MAX_FRAMES) return null;
  return {
    algorithmId: "stack_matching",
    title: "Valid parentheses with a stack",
    input: { characters: chars },
    result: valid,
    resultText: valid ? "valid" : "not valid",
    earlyExit: failedAt !== null && failedAt < chars.length - 1,
    frames,
  };
}

// --------------------------------------------------------------------------
// Min Stack (LC 155)
// --------------------------------------------------------------------------

export type MinStackOp =
  | { op: "push"; value: number }
  | { op: "pop" }
  | { op: "top" }
  | { op: "getMin" };

export interface MinStackInput {
  ops: MinStackOp[];
}

/** The three character code a call carries in its cell. */
function minStackCode(op: MinStackOp): string {
  return op.op === "push" ? String(op.value) : op.op === "getMin" ? "min" : op.op;
}

/**
 * Min Stack: two stacks that move in step.
 *
 * The naive drawing is one stack plus a "minimum" written above it, and it
 * teaches the wrong data structure: with a single number there is no way to
 * restore the old minimum when the smallest value is popped, which is the
 * entire difficulty of the problem. Drawing the min stack as a second column
 * of the same height makes the answer visible: every push writes to both, so
 * every pop can undo both, and getMin is a read of one cell.
 */
export function simulateMinStack(input: MinStackInput): AlgorithmTrace | null {
  const ops = input.ops;
  if (ops.length < 3 || ops.length > 12) return null;
  // A push of a four digit number would not fit its own cell, and a pop or a
  // read on an empty stack is not a case this walk can draw honestly.
  if (ops.some((op) => op.op === "push" && (!Number.isInteger(op.value) || Math.abs(op.value) > 99))) return null;
  let depth = 0;
  let deepest = 0;
  for (const op of ops) {
    if (op.op === "push") {
      depth += 1;
      deepest = Math.max(deepest, depth);
    } else if (op.op === "pop") {
      if (depth === 0) return null;
      depth -= 1;
    } else if (depth === 0) {
      return null;
    }
  }
  if (deepest === 0) return null;
  const capacity = Math.max(2, deepest);

  const codes = ops.map(minStackCode);
  const values: number[] = [];
  const mins: number[] = [];
  const outputs: Array<number | null> = [];
  const settled = new Map<number, TraceMark>();
  const frames: TraceFrame[] = [];
  const intents: string[] = [];

  const state = (activeIndex: number, note: string, mark: TraceMark = "active"): ArrayFrameState => {
    const marks = new Map(settled);
    if (activeIndex >= 0) marks.set(activeIndex, mark);
    return {
      kind: "array",
      cells: row(codes, marks),
      showIndices: true,
      ...(activeIndex >= 0 ? { pointers: [{ name: "call", index: activeIndex }] } : {}),
      note,
      // Two columns, same height, same top index: that alignment is the claim
      // the algorithm makes, so it has to be drawable at a glance.
      asides: [
        // Two columns sit one aside-step apart, and each title is centred over
        // its own column, so a long title runs straight into its neighbour's.
        // Four characters each keeps them clear and keeps them parallel.
        aside("stack", "vals", "column", values, capacity, topMark(values.length)),
        aside("mins", "mins", "column", mins, capacity, topMark(mins.length, "candidate")),
      ],
    };
  };

  frames.push({
    id: "input",
    caption: `${ops.length} calls against two stacks`,
    narrationIntent:
      `A stack that can also report its smallest value cannot just remember one number, because popping the smallest would leave nothing to fall back to. ` +
      `The fix is a second stack of the same height: beside every value we store the smallest value seen up to and including it.`,
    state: state(-1, "both empty"),
  });

  ops.forEach((op, index) => {
    const position = index + 1;
    if (op.op === "push") {
      const carried = mins.length === 0 ? op.value : Math.min(mins[mins.length - 1]!, op.value);
      values.push(op.value);
      mins.push(carried);
      outputs.push(null);
      settled.set(index, "done");
      frames.push({
        id: `op${index}`,
        caption:
          carried === op.value && (mins.length === 1 || mins[mins.length - 2]! > op.value)
            ? `push ${op.value}, a new minimum`
            : `push ${op.value}, minimum stays ${carried}`,
        narrationIntent: distinctIntent(
          intents,
          `Pushing ${op.value} writes to both columns. The value column takes ${op.value}, and the min column takes ${carried}, which is the smaller of ${op.value} and whatever the min column was already carrying. Both stacks are now ${values.length} deep.`,
          position,
        ),
        state: state(index, `min is ${carried}`),
      });
      return;
    }
    if (op.op === "pop") {
      const gone = values.pop()!;
      mins.pop();
      outputs.push(null);
      settled.set(index, "done");
      frames.push({
        id: `op${index}`,
        caption: `pop removes ${gone} from both stacks`,
        narrationIntent: distinctIntent(
          intents,
          `pop takes ${gone} off the value column and takes the cell beside it off the min column at the same time. That second removal is what restores the earlier minimum, and it is the reason a single remembered number would not work here.`,
          position,
        ),
        state: state(index, values.length > 0 ? `min is ${mins[mins.length - 1]}` : "both empty"),
      });
      return;
    }
    const answer = op.op === "top" ? values[values.length - 1]! : mins[mins.length - 1]!;
    outputs.push(answer);
    settled.set(index, "done");
    frames.push({
      id: `op${index}`,
      caption: `${op.op} returns ${answer} in one step`,
      narrationIntent: distinctIntent(
        intents,
        op.op === "top"
          ? `top reads the cell on top of the value column, which is ${answer}, and changes nothing. No search, no loop, one read.`
          : `getMin reads the cell on top of the min column, which is ${answer}. Nothing is scanned: the answer was computed on the way in, one push at a time, so the read is constant time.`,
        position,
      ),
      state: state(index, `min is ${mins[mins.length - 1]}`),
    });
  });

  if (frames.length < 2 || frames.length > MAX_FRAMES) return null;

  // The closing caption has to state the answer the walk produced, and what
  // the walk produced depends on the last call: a query has a value, a push or
  // a pop leaves the minimum standing as the thing worth saying.
  const lastOp = ops[ops.length - 1]!;
  const lastOutput = outputs[outputs.length - 1];
  const finalMin = mins.length > 0 ? mins[mins.length - 1]! : null;
  const resultText =
    lastOutput !== null && lastOutput !== undefined
      ? `${lastOp.op} returns ${lastOutput}`
      : finalMin !== null
        ? `min is ${finalMin}`
        : "both stacks empty";
  const closing = frames[frames.length - 1]!;
  closing.caption =
    lastOutput !== null && lastOutput !== undefined
      ? `${lastOp.op} returns ${lastOutput} in one step`
      : finalMin !== null
        ? `${lastOp.op} done, min is ${finalMin}`
        : `${lastOp.op} done, both stacks empty`;

  return {
    algorithmId: "min_stack",
    title: "Min stack",
    input: { ops },
    result: outputs,
    resultText: resultText.slice(0, 60),
    frames,
  };
}

// --------------------------------------------------------------------------
// Implement Queue using Stacks (LC 232)
// --------------------------------------------------------------------------

export type QueueOp =
  | { op: "push"; value: number }
  | { op: "pop" }
  | { op: "peek" }
  | { op: "empty" };

export interface QueueTwoStacksInput {
  ops: QueueOp[];
}

function queueCode(op: QueueOp): string {
  return op.op === "push" ? String(op.value) : op.op === "peek" ? "pek" : op.op === "empty" ? "emp" : "pop";
}

/**
 * Implement Queue using Stacks: the pour is the algorithm.
 *
 * Every frame that shows only the two stacks side by side hides the one move
 * that matters, which is that emptying the in stack into the out stack
 * reverses it, and a reversed stack pops in arrival order. So the pour gets
 * its own frame, and the logical queue is drawn underneath as a row so the
 * student can check that the FIFO order the two columns are faking is the
 * order the row already shows.
 */
export function simulateQueueTwoStacks(input: QueueTwoStacksInput): AlgorithmTrace | null {
  const ops = input.ops;
  if (ops.length < 3 || ops.length > 6) return null;
  if (ops.some((op) => op.op === "push" && (!Number.isInteger(op.value) || op.value < 0 || op.value > 99))) return null;

  // Depth for the columns and width for the row: the worst case of each, taken
  // before the walk so nothing resizes mid-trace.
  let held = 0;
  let widest = 0;
  for (const op of ops) {
    if (op.op === "push") held += 1;
    else if (op.op === "pop") {
      if (held === 0) return null;
      held -= 1;
    } else if (op.op === "peek" && held === 0) return null;
    widest = Math.max(widest, held);
  }
  if (widest === 0) return null;
  const capacity = Math.max(2, widest);

  const codes = ops.map(queueCode);
  const inStack: number[] = [];
  const outStack: number[] = [];
  const settled = new Map<number, TraceMark>();
  const outputs: Array<number | boolean | null> = [];
  const frames: TraceFrame[] = [];
  const intents: string[] = [];
  let firstPopped: number | null = null;
  let firstPeeked: number | null = null;

  /** Arrival order: the bottom of `in` is oldest, and `out` is already reversed. */
  const queueOrder = (): number[] => [...outStack].reverse().concat(inStack);

  const state = (activeIndex: number, note: string, mark: TraceMark = "active"): ArrayFrameState => {
    const marks = new Map(settled);
    if (activeIndex >= 0) marks.set(activeIndex, mark);
    const asides: TraceAside[] = [
      aside("in", "in", "column", inStack, capacity, topMark(inStack.length)),
      aside("out", "out", "column", outStack, capacity, topMark(outStack.length)),
      // The row is the thing the two columns are pretending to be. Drawing it
      // is what turns "trust me, this is FIFO" into something checkable.
      aside("q", "queue", "row", queueOrder(), capacity, queueOrder().length > 0 ? new Map([[0, "candidate" as TraceMark]]) : new Map()),
    ];
    return {
      kind: "array",
      cells: row(codes, marks),
      showIndices: true,
      ...(activeIndex >= 0 ? { pointers: [{ name: "call", index: activeIndex }] } : {}),
      note,
      asides,
    };
  };

  frames.push({
    id: "input",
    caption: `${ops.length} queue calls, two stacks underneath`,
    narrationIntent:
      `A stack hands back the newest value and a queue has to hand back the oldest, so one stack alone can never be a queue. ` +
      `Two can: everything arrives on the in stack, and when the out stack is empty we pour the in stack into it, which reverses the order and puts the oldest value on top.`,
    state: state(-1, "both empty"),
  });

  ops.forEach((op, index) => {
    const position = index + 1;
    if (op.op === "push") {
      inStack.push(op.value);
      outputs.push(null);
      settled.set(index, "done");
      frames.push({
        id: `op${index}`,
        caption: `push ${op.value} onto the in stack`,
        narrationIntent: distinctIntent(
          intents,
          `push always goes to the in stack and nothing else moves, so a push is one operation no matter how much is already stored. The in stack now holds ${inStack.length}, with ${op.value} on top, and the row underneath shows it is last in line.`,
          position,
        ),
        state: state(index, `in holds ${inStack.length}`),
      });
      return;
    }
    if (op.op === "empty") {
      const answer = inStack.length === 0 && outStack.length === 0;
      outputs.push(answer);
      settled.set(index, "done");
      frames.push({
        id: `op${index}`,
        caption: `empty is ${answer}, both stacks are checked`,
        narrationIntent: distinctIntent(
          intents,
          `empty has to look at both columns, because a value waiting on the in stack is still in the queue even when the out stack is bare. Here the two hold ${inStack.length} and ${outStack.length}, so the answer is ${answer}.`,
          position,
        ),
        state: state(index, `in ${inStack.length}, out ${outStack.length}`),
      });
      return;
    }

    // pop and peek both need the front, and the front only exists on the out
    // stack. The pour that puts it there is drawn as its own frame, because
    // it is the step that turns two stacks into a queue.
    if (outStack.length === 0) {
      const moved = inStack.length;
      while (inStack.length > 0) outStack.push(inStack.pop()!);
      frames.push({
        id: `pour${index}`,
        caption: `Pour ${moved} across, ${outStack[outStack.length - 1]} rises to the top`.slice(0, 60),
        narrationIntent: distinctIntent(
          intents,
          `The out stack is empty, so every value comes off the in stack and goes straight onto the out stack. Popping one and pushing the other reverses the order, so ${outStack[outStack.length - 1]}, which arrived first, is now on top and ready to leave first. Each value is poured at most once, which is why this stays cheap on average.`,
          position,
        ),
        state: state(index, "pouring", "candidate"),
      });
    }

    const front = outStack[outStack.length - 1]!;
    if (op.op === "peek") {
      if (firstPeeked === null) firstPeeked = front;
      outputs.push(front);
      settled.set(index, "done");
      frames.push({
        id: `op${index}`,
        caption: `peek returns ${front} without removing it`,
        narrationIntent: distinctIntent(
          intents,
          `peek reads the top of the out stack, which is ${front}, and leaves it there. Because the pour already reversed the order, the top of the out stack is the front of the queue, so this read needs no searching.`,
          position,
        ),
        state: state(index, `front is ${front}`),
      });
      return;
    }
    outStack.pop();
    if (firstPopped === null) firstPopped = front;
    outputs.push(front);
    settled.set(index, "done");
    frames.push({
      id: `op${index}`,
      caption: `pop removes ${front}, the oldest value`,
      narrationIntent: distinctIntent(
        intents,
        `pop takes ${front} off the out stack. That is the value that arrived first, which is exactly what a queue promises, and the out stack still holds ${outStack.length} in the right order for the next call.`,
        position,
      ),
      state: state(index, outStack.length > 0 ? `front is ${outStack[outStack.length - 1]}` : `in holds ${inStack.length}`),
    });
  });

  // A closing frame with no active call: the two columns at rest, and the
  // sentence the whole walk was for.
  const resultText =
    firstPopped !== null
      ? `pop returned ${firstPopped} first`
      : firstPeeked !== null
        ? `peek returned ${firstPeeked} first`
        : `queue holds ${queueOrder().length} values`;
  frames.push({
    id: "answer",
    caption:
      firstPopped !== null
        ? `Two stacks gave FIFO, pop returned ${firstPopped} first`.slice(0, 60)
        : firstPeeked !== null
          ? `Two stacks gave FIFO, peek returned ${firstPeeked} first`.slice(0, 60)
          : `Nothing left yet, the queue holds ${queueOrder().length} values`.slice(0, 60),
    narrationIntent:
      `Nothing here is a queue on its own. The in stack takes arrivals, the out stack hands out departures, and the single pour between them is what turns last in first out into first in first out. ` +
      `Averaged over all the calls, each value is pushed twice and popped twice, so every operation is constant time on average.`,
    state: state(-1, `in ${inStack.length}, out ${outStack.length}`),
  });

  if (frames.length < 2 || frames.length > MAX_FRAMES) return null;
  return {
    algorithmId: "queue_two_stacks",
    title: "Queue from two stacks",
    input: { ops },
    result: outputs,
    resultText: resultText.slice(0, 60),
    frames,
  };
}

// --------------------------------------------------------------------------
// Recursion and the call stack (textbook ask: factorial)
// --------------------------------------------------------------------------

export interface FactorialInput {
  n: number;
}

/**
 * Recursion drawn as the call stack growing and then unwinding.
 *
 * The half students miss is the unwind. A picture of factorial that shows
 * 4 times 3 times 2 times 1 shows the arithmetic and hides the machine: it
 * never says where 3! was kept while 2! was being worked out, which is the
 * question recursion actually raises. So the call column fills to the base
 * case and then empties, and a second column beside it records what each
 * depth handed back on the way out. Watching the right column fill downward
 * while the left column empties is the whole idea.
 */
export function simulateRecursionCallStack(input: FactorialInput): AlgorithmTrace | null {
  const n = input.n;
  if (!Number.isInteger(n) || n < 3 || n > 6) return null;

  // The chain of calls, left to right: n! then n-1! down to 1!. Index is
  // depth, which is also the index into both columns.
  const chain = Array.from({ length: n }, (_, depth) => `${n - depth}!`);
  const callColumn = Array.from({ length: n }, () => "");
  const backColumn = Array.from({ length: n }, () => "");
  const settled = new Map<number, TraceMark>();
  const frames: TraceFrame[] = [];

  const state = (
    activeDepth: number,
    note: string,
    mark: TraceMark = "active",
    columnMark: TraceMark = "active",
  ): ArrayFrameState => {
    const marks = new Map(settled);
    if (activeDepth >= 0) marks.set(activeDepth, mark);
    const live = callColumn.filter((text) => text.length > 0).length;
    const returned = new Map<number, TraceMark>();
    backColumn.forEach((text, index) => {
      if (text.length > 0) returned.set(index, "done");
    });
    return {
      kind: "array",
      cells: row(chain, marks),
      showIndices: false,
      ...(activeDepth >= 0 ? { pointers: [{ name: "here", index: activeDepth }] } : {}),
      note,
      // Two columns side by side, so the titles have to stay short enough not
      // to run into each other: the left one empties while the right fills.
      asides: [
        aside("calls", "calls", "column", callColumn, n, topMark(live, columnMark)),
        aside("back", "back", "column", backColumn, n, returned),
      ],
    };
  };

  frames.push({
    id: "start",
    caption: `factorial(${n}) calls itself down to 1`,
    narrationIntent:
      `factorial is written in terms of itself: n factorial is n times the factorial of n minus one, and factorial of 1 is just 1. ` +
      `That means the first call cannot finish until the second one does, and the second cannot finish until the third does, so the unfinished calls have to be kept somewhere. That somewhere is the call stack.`,
    state: state(-1, "stack empty"),
  });

  // Growing: every call but the base case pushes and then waits.
  for (let depth = 0; depth < n - 1; depth += 1) {
    const value = n - depth;
    callColumn[depth] = `${value}!`;
    frames.push({
      id: `call${value}`,
      caption: `${value}! waits, it needs ${value - 1}! first`,
      narrationIntent:
        `${value} factorial cannot be worked out yet, because it is ${value} times ${value - 1} factorial and nobody has computed ${value - 1} factorial. ` +
        `So the machine writes down where it was, stacks the unfinished call, and goes off to compute ${value - 1} factorial. The stack is now ${depth + 1} deep.`,
      state: state(depth, `depth is ${depth + 1}`),
    });
  }

  // The base case: the only call that answers without asking for another.
  const baseDepth = n - 1;
  callColumn[baseDepth] = "1!";
  backColumn[baseDepth] = "1";
  settled.set(baseDepth, "done");
  frames.push({
    id: "base",
    caption: "1! is the base case and returns 1",
    narrationIntent:
      `1 factorial is the base case: it is defined outright as 1, so this call answers without making another. ` +
      `Without a base case the stack would keep growing until the machine ran out of room, which is what a stack overflow is. This is the deepest the stack gets, and from here everything unwinds.`,
    state: state(baseDepth, "1! = 1", "done"),
  });

  // Unwinding: each frame comes off carrying its answer up to its caller.
  //
  // The child popped when it returned, so its cell clears at the top of this
  // step; the caller stays on the column while it does its multiplication and
  // clears on the step after. The outermost call has no caller to return to,
  // so it clears in its own frame, which is what makes the closing claim that
  // the stack is empty true rather than nearly true.
  let carried = 1;
  for (let depth = n - 2; depth >= 0; depth -= 1) {
    const value = n - depth;
    const product = value * carried;
    callColumn[depth + 1] = "";
    if (depth === 0) callColumn[0] = "";
    backColumn[depth] = String(product);
    settled.set(depth, "done");
    frames.push({
      id: `back${value}`,
      caption: `${value}! = ${value} x ${carried} = ${product}`,
      narrationIntent:
        `${value - 1} factorial came back as ${carried}, so the waiting call finally has what it was missing. It multiplies ${value} by ${carried} to get ${product}, hands that to whoever called it, and comes off the stack. ` +
        `Nothing was recomputed: each answer is used exactly once on the way out.`,
      state: state(depth, `${value}! = ${product}`, "done", "done"),
    });
    carried = product;
  }

  const closing = frames[frames.length - 1]!;
  closing.caption = `${n}! = ${n} x ${carried / n} = ${carried}, the stack is empty`.slice(0, 60);

  if (frames.length < 2 || frames.length > MAX_FRAMES) return null;
  return {
    algorithmId: "recursion_call_stack",
    title: "Recursion and the call stack",
    input: { n },
    result: carried,
    resultText: `${n}! = ${carried}`,
    frames,
  };
}

// --------------------------------------------------------------------------
// Stack against queue on one set of values (textbook ask)
// --------------------------------------------------------------------------

export interface StackQueueInput {
  values: number[];
}

/**
 * Push and pop beside enqueue and dequeue, on the same values.
 *
 * Told as two separate pictures this lesson does not land, because the
 * difference is a comparison and a comparison needs both things on screen at
 * once. So the frame is stacked: the same values in the same order twice, the
 * stack above with its column and the queue below with its row, and one
 * removal applied to both at the same instant. The struck through cells then
 * say it without a sentence: the stack empties from the right, the queue
 * empties from the left.
 *
 * The value rows deliberately never shrink. Redrawing only the live contents
 * would make a removal look like the whole row sliding, and a student reading
 * that sees two rows moving rather than two ends being chosen.
 */
export function simulateStackQueueOps(input: StackQueueInput): AlgorithmTrace | null {
  const values = input.values;
  if (values.length < 2 || values.length > 5) return null;
  if (values.some((value) => !Number.isInteger(value) || Math.abs(value) > 99)) return null;

  const texts = values.map((value) => String(value));
  const capacity = values.length;
  const frames: TraceFrame[] = [];
  const intents: string[] = [];

  /** How many values have been added, and how many taken off each end. */
  const build = (added: number, taken: number, active: number | null): TraceFrame["state"] => {
    const stackMarks = new Map<number, TraceMark>();
    const queueMarks = new Map<number, TraceMark>();
    for (let i = 0; i < values.length; i += 1) {
      if (i >= added) continue;
      // The stack loses its newest, which is the right end of the row; the
      // queue loses its oldest, which is the left end.
      if (i >= added - taken) stackMarks.set(i, "excluded");
      if (i < taken) queueMarks.set(i, "excluded");
    }
    if (active !== null) {
      if (!stackMarks.has(active)) stackMarks.set(active, "active");
      if (!queueMarks.has(active)) queueMarks.set(active, "active");
    }
    const stackTop = added - taken - 1;
    const queueFront = taken;
    const liveStack = texts.slice(0, added - taken);
    const liveQueue = texts.slice(taken, added);
    return {
      kind: "stacked",
      parts: [
        {
          label: "stack",
          state: {
            kind: "array",
            cells: row(texts, stackMarks),
            showIndices: false,
            ...(stackTop >= 0 ? { pointers: [{ name: "top", index: stackTop }] } : {}),
            asides: [aside("lifo", "top", "column", liveStack, capacity, topMark(liveStack.length))],
          },
        },
        {
          label: "queue",
          state: {
            kind: "array",
            cells: row(texts, queueMarks),
            showIndices: false,
            ...(queueFront < added && added > taken ? { pointers: [{ name: "front", index: queueFront }] } : {}),
            asides: [
              aside(
                "fifo",
                "front",
                "row",
                liveQueue,
                capacity,
                liveQueue.length > 0 ? new Map([[0, "active" as TraceMark]]) : new Map(),
              ),
            ],
          },
        },
      ],
      note: added === 0 ? "same values, two rules" : `stack ${added - taken}, queue ${added - taken}`,
    };
  };

  frames.push({
    id: "empty",
    caption: `${values.length} values, and two rules for giving them back`.slice(0, 60),
    narrationIntent:
      `A stack and a queue hold the same things and accept them the same way. The only difference is which end gives a value back, and that single choice is what every use of either one turns on. ` +
      `The same values go into both, in the same order, so the difference is the only thing left to see.`,
    state: build(0, 0, null),
  });

  values.forEach((value, index) => {
    frames.push({
      id: `add${index}`,
      caption: `Push ${value} on the stack, enqueue ${value} on the queue`.slice(0, 60),
      narrationIntent: distinctIntent(
        intents,
        `${value} goes on top of the stack and on the back of the queue, and at this point the two look identical: both hold ${index + 1} values in the order they arrived. ` +
          `Adding is where a stack and a queue agree, which is why nothing has been decided yet.`,
        index + 1,
      ),
      state: build(index + 1, 0, index),
    });
  });

  // Removals: as many as leave something behind, so the two ends end up
  // holding different values and the difference is the last thing on screen.
  const takes = values.length - 1;
  for (let taken = 1; taken <= takes; taken += 1) {
    const popped = values[values.length - taken]!;
    const dequeued = values[taken - 1]!;
    frames.push({
      id: `take${taken}`,
      caption: `Pop gives ${popped}, dequeue gives ${dequeued}`,
      narrationIntent: distinctIntent(
        intents,
        `Now they part. The stack hands back ${popped}, the value that went in most recently, because a stack takes from the end it was last written to. The queue hands back ${dequeued}, the value that has been waiting longest, because a queue takes from the other end. ` +
          `Same values, same order in, different value out.`,
        taken,
      ),
      state: build(values.length, taken, null),
    });
  }

  const stackLeft = values[0]!;
  const queueLeft = values[values.length - 1]!;
  const popped = values.slice(values.length - takes).reverse();
  const dequeued = values.slice(0, takes);
  const closing = frames[frames.length - 1]!;
  closing.caption = `Stack pops ${popped[0]}, queue pops ${dequeued[0]}`.slice(0, 60);
  closing.narrationIntent =
    `After the same additions and the same number of removals the stack is holding ${stackLeft} and the queue is holding ${queueLeft}, which is the whole lesson in one line. ` +
    `Last in first out reaches for the newest, first in first out reaches for the oldest, and everything else about the two structures follows from that.`;

  if (frames.length < 2 || frames.length > MAX_FRAMES) return null;
  return {
    algorithmId: "stack_queue_ops",
    title: "Stack against queue",
    input: { values },
    result: { popped, dequeued },
    resultText: `stack pops ${popped[0]}, queue pops ${dequeued[0]}`.slice(0, 60),
    frames,
  };
}
