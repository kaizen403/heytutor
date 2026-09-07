/**
 * Structural gate for stacked frames.
 *
 * `verify-dsa-trace` reads `frame.state` at the top level, so every one of its
 * structural checks — array width, pointer range, bar against cell, bracket
 * range, grid shape, aside capacity — is a silent no-op on a `stacked` frame,
 * whose real content lives one level down in `state.parts`. Two lanes hit this
 * independently: a stacked family passes every gate in the suite while its
 * panels could have been ragged, mislabelled or growing.
 *
 * This gate is the same rules applied to each panel, addressed by panel index
 * so a claim about "the dp table" means the same row in every frame.
 */
import { ALGORITHM_FAMILIES, familyById } from "../../src/dsa/algorithmCatalog";
import type {
  AlgorithmTrace,
  TraceFrame,
  TraceFrameState,
} from "../../src/dsa/trace/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type PanelState = Exclude<TraceFrameState, { kind: "stacked" }>;

/** Every drawable state in a frame, with an address that is stable across frames. */
function panelsOf(frame: TraceFrame): Array<{ at: string; state: PanelState }> {
  if (frame.state.kind !== "stacked") return [];
  return frame.state.parts.map((part, index) => ({
    at: `${frame.id}/panel${index}`,
    state: part.state,
  }));
}

/** The board caps a drawn label here; the compiler fails the whole trace past it. */
const MAX_LABEL_CHARS = 16;

let stackedFamilies = 0;
let panelCount = 0;

for (const family of ALGORITHM_FAMILIES) {
  const run = family.run("");
  assert(run, `family ${family.id} could not produce its own default example`);
  const trace: AlgorithmTrace = run.trace;
  const stacked = trace.frames.filter((frame) => frame.state.kind === "stacked");
  if (stacked.length === 0) continue;
  stackedFamilies += 1;

  assert(
    stacked.length === trace.frames.length,
    `${family.id}: mixes stacked and unstacked frames, so a panel address means nothing`,
  );

  // A panel index has to mean the same figure in every frame. Without this a
  // walk could show the table above the input in one frame and below in the
  // next, and every claim about "panel 1" would be about two different things.
  const shapes = trace.frames.map((frame) =>
    panelsOf(frame).map((panel) => panel.state.kind).join(","),
  );
  assert(
    new Set(shapes).size === 1,
    `${family.id}: panel kinds change between frames (${[...new Set(shapes)].join(" | ")})`,
  );

  const widths = new Map<string, Set<number>>();
  const asideCapacities = new Map<string, Set<number>>();
  const asideTitles = new Map<string, Set<string>>();

  for (const frame of trace.frames) {
    const panels = panelsOf(frame);
    assert(panels.length >= 2, `${family.id}/${frame.id}: a stack of one is not a stack`);
    for (const [index, panel] of panels.entries()) {
      panelCount += 1;
      const key = `panel${index}`;
      const state = panel.state;

      for (const item of state.asides ?? []) {
        const slot = `${key}/${item.id}`;
        (asideCapacities.get(slot) ?? asideCapacities.set(slot, new Set()).get(slot)!).add(item.capacity);
        (asideTitles.get(slot) ?? asideTitles.set(slot, new Set()).get(slot)!).add(item.title);
        assert(
          item.title.length <= 12,
          `${panel.at}: aside title ${JSON.stringify(item.title)} is over 12 characters`,
        );
        assert(
          item.cells.length === item.capacity,
          `${panel.at}: aside ${item.id} holds ${item.cells.length} cells for capacity ${item.capacity}`,
        );
        for (const cell of item.cells) {
          assert(
            cell.text.length <= MAX_LABEL_CHARS,
            `${panel.at}: aside cell ${JSON.stringify(cell.text)} is over ${MAX_LABEL_CHARS} characters`,
          );
        }
      }

      if (state.kind === "array") {
        (widths.get(key) ?? widths.set(key, new Set()).get(key)!).add(state.cells.length);
        for (const pointer of state.pointers ?? []) {
          assert(
            pointer.index >= 0 && pointer.index < state.cells.length,
            `${panel.at}: pointer ${pointer.name} points outside its own row`,
          );
        }
        if (state.bars) {
          assert(
            state.bars.length === state.cells.length,
            `${panel.at}: ${state.bars.length} bars for ${state.cells.length} cells`,
          );
          for (const [at, bar] of state.bars.entries()) {
            assert(
              String(bar) === state.cells[at]!.text,
              `${panel.at}: bar ${at} measures ${bar} while its cell reads "${state.cells[at]!.text}"`,
            );
          }
        }
        for (const bracket of state.brackets ?? []) {
          assert(
            bracket.from >= 0 && bracket.to < state.cells.length && bracket.from <= bracket.to,
            `${panel.at}: bracket ${bracket.from} to ${bracket.to} runs outside its row`,
          );
          assert(
            bracket.label.trim().length > 0 && bracket.label.length <= MAX_LABEL_CHARS,
            `${panel.at}: bracket label ${JSON.stringify(bracket.label)} must be 1 to ${MAX_LABEL_CHARS} characters`,
          );
        }
        for (const cell of state.cells) {
          assert(
            cell.text.length <= MAX_LABEL_CHARS,
            `${panel.at}: cell ${JSON.stringify(cell.text)} is over ${MAX_LABEL_CHARS} characters`,
          );
        }
      }

      if (state.kind === "grid") {
        assert(
          state.cells.length === state.rowLabels.length,
          `${panel.at}: ${state.cells.length} rows for ${state.rowLabels.length} row labels`,
        );
        for (const [at, row] of state.cells.entries()) {
          assert(
            row.length === state.colLabels.length,
            `${panel.at}: row ${at} has ${row.length} cells for ${state.colLabels.length} column labels`,
          );
        }
      }

      if (state.kind === "matrix") {
        const columns = new Set(state.cells.map((row) => row.length));
        assert(columns.size <= 1, `${panel.at}: ragged matrix rows (${[...columns].join(",")})`);
      }
    }
  }

  for (const [key, seen] of widths) {
    assert(
      seen.size === 1,
      `${family.id}: ${key} changes width between frames (${[...seen].join(",")}), so a cell address means nothing`,
    );
  }
  for (const [key, seen] of asideCapacities) {
    assert(seen.size === 1, `${family.id}: aside ${key} changes capacity (${[...seen].join(",")})`);
  }
  for (const [key, seen] of asideTitles) {
    assert(seen.size === 1, `${family.id}: aside ${key} changes title (${[...seen].join(" | ")})`);
  }
}

assert(
  stackedFamilies > 0,
  "no stacked families found; if the last one was removed, remove this gate too rather than leaving it passing vacuously",
);
assert(familyById("stack_queue_ops") !== null, "stack_queue_ops is the reference stacked family for this gate");

console.log(
  `verify-dsa-stacked: ${stackedFamilies} stacked families, ${panelCount} panels, all checks passed`,
);
