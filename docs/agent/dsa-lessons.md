# DSA lessons

A LeetCode question does not take the physics path. It takes the code lane: a
validated program types into an editor on the left of the board while a worked
example is drawn frame by frame on the right, and the tutor narrates both.

## The turn

```text
question
  -> classifyDsaQuestion            is this a coding problem at all
  -> detectAlgorithm                which of 22 families, or decline
  -> familyTeachingFacts            what that family is, in one line
  -> planCodeLessonV1(context)      a program for THAT technique on THAT example
  -> simulator -> AlgorithmTrace    a real run, frame by frame
  -> compileTraceScenes             one SceneDocument per frame
  -> codeLessonBeatPlan             the running order of the lesson
  -> teaching stream                [FOCUS:frame] figure beats, [TYPE:block] code beats
  -> conductor                      enforces the order, holds early tags
```

Everything the board draws comes from the simulator, never from the model. A
number is in a cell because the algorithm put it there, and a fatal
`label_attached` assertion plus `traceRenderMismatches` prove the drawn text
equals the trace value at every address.

## The trace layer (`packages/scene-engine/src/dsa/`)

| File | Owns |
|---|---|
| `algorithmCatalog.ts` | 22 families: cues, hints, vetoes, how to lift the question's own example, which simulator to run |
| `exampleSlots.ts` | Parsers scoped to the Input line of Example 1 first, so an Output list can never stand in for the input |
| `detectAlgorithm.ts` | Scored routing; declines on a weak or contested win |
| `familyTeaching.ts` | The one-line mechanism, the terms a new student needs, and the shape the code must have |
| `trace/simulators/*` | Pure deterministic runs producing `TraceFrame[]` |
| `traceToScene.ts` | Frames into compiled figures |

### What a frame may carry

`TraceFrameState` is `array`, `list`, `tree`, `graph`, `grid`, `matrix`,
`numberline`, or `stacked`. On top of the structure itself a frame can carry:

- **marks**, which are ink, not a dim: `active` fills, `done` ticks, `excluded`
  strikes through, `candidate` and `window` outline dashed;
- **asides**: a labelled row or column beside the figure, pre-sized so cell ids
  stay stable across frames. This is the queue in a breadth-first search, the
  stack in a bracket check, the key-to-index map in a hash two sum, the
  distance table in Dijkstra, the output list under a traversal;
- **notes**: a short line of state above the figure ("target = 9", "sum = 7");
- pointers, brackets, swap arcs, magnitude bars and overlays on an array;
- read arrows into the cell a dynamic-programming table just wrote;
- annotations and a fixed layout on a tree, direction and positions on a graph.

Every frame of one walk also carries an invisible extent box, the union of all
the frames' geometry, so the compiler fits them identically and nothing moves
or rescales as the walk advances. The box is dropped before the board draws.

## Length and shape

`codeLessonBeatPlan` builds the running order: an opening, the slow way, the
figure frames (a second beat on each while the band allows), an early-exit
beat, one beat per code block, a trace-through, and a close on complexity. New
adds a concept beat per term; Revision replaces the motivation with the
invariant, the edge cases and the real bugs. `CODE_LESSON_STEP_WORDS` states
the floor per step, and `CODE_LESSON_TARGET_BY_FAMILIARITY` the band.

A step count alone did not work: the model hits whatever count it is given, so
the count has to come from the material and every beat has to say what it is
for.

## Rules learned the hard way

- **Text-only beats a wrong picture.** A family whose simulator cannot honour
  the question declines, and the routing gate treats a wrong family as fatal
  and a decline as budgeted.
- **The planner must see the board.** Given only the question it writes a
  correct but different solution, and the lesson then narrates a figure of one
  algorithm over the code of another. `codeTraceGate.ts` checks the returned
  program against the traced technique and example; it blocks the first
  attempt and only warns on the repair, because losing the code panel is worse.
- **A walk must end on its answer.** `verify-dsa-trace` requires `resultText`
  and a closing caption that states it.
- **The tag may arrive before the words.** The model writes `[STEP]`, the tag,
  then the sentence, so the conductor holds a command-only segment until the
  narration it belongs to arrives, and `finish()` flushes a trailing one.
- **A code lesson replaces the base prompt.** Overriding the physics teaching
  prompt did not work; it was obeyed often enough to shorten lessons and leak
  handwriting into them.

## Coverage

Seventy-five families. `verify-dsa-routing` scores all 104 probes in
`data/leetcode-probes` against the live catalog: a probe whose declared pattern
has a family must route to it, and a probe carrying a `catalogNote` must draw
nothing. Eighty-six of 104 probes draw a simulated walk; the rest have no
family yet and say so.

Adding a family means four things in one change: the simulator, an
`ALGORITHM_FAMILIES` entry, a `familyTeaching` record, and hand-computed
assertions in `verify-dsa-trace`. Skip the teaching record and
`resolveCodeLessonBoardContext` returns null, the planner is handed no board
context, and it writes a correct solution to a different algorithm from the one
on the board. `verify-dsa-teaching` fails the build rather than let that ship.

A question whose own example will not compile falls back to the family's
canonical one rather than losing the figure, and the planner is told which one
won. Five points is ten weighted edges, and the board used to go blank on a
question it had routed correctly and could draw perfectly well on four.

## When there is no simulator

A question the catalog does not cover still gets a figure: the planner's own
`diagramHint` is compiled, one frame per step. That path is as load-bearing as
the trace path and it failed silently in four ways, each of which showed the
student a blank board for a whole lesson.

- **The table cap is a drawing limit, not a bound.** It was 6 rows while a
  dynamic programming table over two strings needs 8, and truncating the labels
  made the cells stop matching them, which discards the whole hint. Measured:
  14 by 12 compiles. It is 12 by 12, and past that it still fails closed rather
  than drawing a corner as though it were the whole table.
- **A table walks its steps.** Each step carries its own grid, which is what a
  dynamic programming lesson is. Steps inherit the row and column headings from
  the hint: they state the values that changed, not the axes, which do not.
  Identical grids across steps are still refused, because that is one figure
  shown five times.
- **Pointers on the same cell share one arrow**, labelled with both names. One
  arrow each put two identical vectors at one point and the compiler refused
  the figure. Left equal to right is the normal state of expand around centre,
  of a two pointer walk ending, of slow meeting fast.

With no walk-through there are no frames for the marker to visit, and a spoken
step then carried no board command at all. The conductor takes
`fallbackPointIds`, the static figure's own anchors, so the pen walks the one
figure that is there. With nothing on the board at all it stays put, which is
the one case where standing still is honest.

## Layout invariants

Every frame of a walk is fitted to the diagram zone on its own, so anything
sized or placed from *that frame's* extent moves when the figure changes. Three
things were measured moving for reasons that had nothing to do with the
algorithm, and all three are now anchored across the whole trace by a first
measuring pass in `compileTraceScenes`:

- **Asides and notes** hang from the union of every frame's figure extent, not
  from this frame's. An insertion walk's in-order output row used to slide
  further down the board on every frame as the tree deepened.
- **Stacked panels** are placed and sized by each panel's extent across the
  trace. A `window` run on a dynamic programming input row adds a bracket under
  it, and that alone dropped the table beneath by 93 measured pixels between
  two frames of one walk.
- **A panel's title** is placed against its slot, not against the panel's own
  extent in this frame.

`verify-dsa-trace-render` pins all of it: every id shared by every frame whose
name starts `as_` or `p<n>_` must sit within 1.5px of where it sat in frame 1.
Marks are exempt, because a wash, a tick and a strike are different shapes on
the same cell. A cell of the main figure is exempt too: merge sort's blocks
regroup as the array splits, and that is the algorithm.

Two smaller rules worth knowing. A drawn label is capped at **16** characters,
not the 20 `TraceBracket` used to claim: the document validator rejects longer
and the compiler fails closed, so one long bracket label costs the whole trace
its figure. And `barHeights` accepts zero, because an elevation map with an
empty column is exactly the figure Trapping Rain Water is about; a zero bar is
simply not drawn.

## The marker

Most of a DSA lesson is speech, not ink: the figure is up, the code is typed,
and the tutor explains. Three paths used to leave the pen dead through exactly
those minutes, and a still pen reads as a lesson that has stalled.

`features/tutor-session/lib/board/markerTour.ts` is the shared answer.
`markerTourStops` builds a route across the entities under discussion (one stop
each, or three across a single wide one) and `tourMarker` walks it for as long
as the words last, drawing nothing. Three callers use it:

- **A spoken step with no board tag.** The conductor emits a runtime-only
  `POINT` carrying the frame's stops, and the executor walks them. The tag
  cannot come from the model: the parser maps a `[POINT]` tag to something
  else, so only the conductor can produce one.
- **A code-lesson focus.** The veil holds for `CODE_FOCUS_SPOTLIGHT_MS`, then
  lifts, and the pen keeps walking over the undimmed figure for the rest of the
  step. A spotlight is a glance, not a state: held for a whole beat it greys
  the figure and reads as the frozen board it was meant to fix.
- **A code block being typed.** The pen follows the caret line by line.

Three sizing rules matter. `narrationTourMs` takes 85% of the segment runner's
own 85ms-per-character estimate, because a walk that outlasts its words holds
the next segment up. It is then capped by `speechShareMs`, the command's own
slice of the segment: 14% of beats carry two board actions, and sized from the
whole beat a frame swap and the focus after it each claimed all of it, so the
board ran tens of seconds behind its own audio and the commands that type the
code never arrived. A command that fills time rather than drawing ink must be
bounded by its share of the beat, never by the beat. And
`resolveCommandInkBudgetMs` needs `||` rather than `??` for `POINT`: pointing
costs no ink, so its matched speech window is zero, and `??` would hand the
walk a zero-length budget.

`pointEntityIds` on a frame is a spread across the figure, not the first two
anchors: on a bubble sort those are cell 0 and the bar above it, a centimetre
apart, so the pen "moved" and still looked parked.

## Gates

| Gate | Package | Proves |
|---|---|---|
| `verify-dsa-trace` | scene-engine | each simulator against a hand-computed expectation, the answer contract, aside stability |
| `verify-dsa-stacked` | scene-engine | the same structural rules applied to a stacked frame's panels, which the gate above reads straight past |
| `verify-dsa-trace-render` | scene-engine | drawn text equals the trace at every address, labels fit and do not overlap, frames fit the zone (`--render <dir>` writes SVGs) |
| `verify-dsa-routing` | scene-engine | statements route to their family; a wrong family is fatal, declines are budgeted; physics never routes. Its corpus section scores all 104 probes against the live catalog, so a new family that steals another's statement fails the day it lands |
| `verify-dsa-teaching` | scene-engine | every family has a teaching record, without which the planner is handed no board context and writes a solution the figure does not match |
| `verify-dsa-classifier` | tutor-core | LeetCode statements reach the lane, physics stems do not |
| `verify-code-lesson-plan` / `-teaching` | tutor-core | the plan contract, the beat plan, the band on a real lesson shape, familiarity |
| `verify-code-lesson-conductor` / `-pace` | tutor | adversarial tag streams still produce the planned lesson; typing stays readable |
| `verify-marker-tour` | tutor | the pen walks the figure for the whole spoken step and is never set to `idle` (opacity 0) |
| `verify-spotlight-lifecycle` | tutor | the veil comes down on completion, cancel, throw and teardown |

Measure changes with the bench, not by reading: `docs/agent/lecture-lab.md`.
