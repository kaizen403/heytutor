import type { DrawCommand } from "@heytutor/drawing";
import type { RenderScene, SceneDocument } from "@heytutor/scene-engine";
import type { StoredSegment, StoredTurn } from "../../lib/boards/boardsClient";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import type { ReplayCue } from "../../lib/replay/replayTimeline";
import {
  completeReplayDiagramTurn,
  drawReplayDiagramTimeline,
} from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

// Live teaching flushes the verified marks narration never named once a turn
// ends (useTurnControl). Replay and seek must leave the same board behind.

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "measured rod" },
  source: { question: "A rod has length L. Show its measured endpoints." },
  quantities: [],
  entities: [
    { id: "rod", kind: "segment", role: "rod" },
    { id: "length", kind: "dimension", role: "length", label: "L" },
  ],
  constructions: [],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["rod", "length"],
  revealGroups: [{ id: "setup", entityIds: ["rod", "length"], dependsOn: [], narrationCue: "Here is the rod." }],
  teachingTimeline: [],
};

const scene: RenderScene = {
  engineVersion: "scene-engine/2.0.0",
  primitives: [
    { id: "rod_ink", entityId: "rod", groupId: "setup", kind: "line", points: [{ x: 750, y: 180 }, { x: 750, y: 420 }] },
    { id: "length_bar", entityId: "length", groupId: "setup", kind: "dimension", points: [{ x: 800, y: 180 }, { x: 800, y: 420 }], provenance: { measurementRole: "bar" } },
    { id: "length_witness_a", entityId: "length", groupId: "setup", kind: "line", points: [{ x: 750, y: 180 }, { x: 805, y: 180 }], provenance: { measurementRole: "witness", dashed: true, strokeRole: "construction" } },
    { id: "length_witness_b", entityId: "length", groupId: "setup", kind: "line", points: [{ x: 750, y: 420 }, { x: 805, y: 420 }], provenance: { measurementRole: "witness", dashed: true, strokeRole: "construction" } },
    { id: "length_label", entityId: "length", groupId: "setup", kind: "label", points: [{ x: 835, y: 300 }], text: "L", labelPlacement: "absolute" },
  ],
  revealGroups: document.revealGroups,
  timeline: [],
  entityBounds: { rod: { x: 750, y: 180, width: 1, height: 240 }, length: { x: 750, y: 180, width: 85, height: 240 } },
};

/** A fresh diagram whose measurement narration never named, as saved. */
function withheldDiagram(layout?: "code_lesson") {
  const { diagram } = buildVerifiedDiagramPresentation(document, scene);
  const withheld = diagram.deferredAnnotations?.flatMap((entry) => entry.commands) ?? [];
  assert(withheld.length === 4, "fixture must withhold the measurement's bar, witnesses and label");
  return layout ? { ...diagram, layout } : diagram;
}

const segment = { narration: "", command: null } as unknown as StoredSegment;
const turn = (sceneArtifacts: unknown = null) =>
  ({ question: "rod", segments: [segment], sceneArtifacts }) as unknown as StoredTurn;

const write = (text: string): DrawCommand => ({
  type: "WRITE",
  params: [30, 80],
  text,
  charPosition: 0,
  narrationBefore: "",
});

const cue = (id: string, turnIndex: number, startMs: number, text: string): ReplayCue => ({
  id,
  turnIndex,
  segmentIndex: 0,
  startMs,
  endMs: startMs + 100,
  durationMs: 100,
  narration: "",
  commands: [write(text)],
  trustedDiagramGeometry: false,
  audioUrl: null,
  durationMsStored: null,
  timings: null,
  segment,
});

type Executed = { label: string; trusted: boolean; applyLayout: boolean | undefined; durationScale: number | undefined };

function recorder() {
  const executed: Executed[] = [];
  const executeCommand = async (
    command: DrawCommand,
    options?: { trustedDiagramGeometry?: boolean; applyLayout?: boolean; durationScale?: number },
  ) => {
    executed.push({
      label: command.semanticRef?.primitiveId ?? command.text ?? command.type,
      trusted: options?.trustedDiagramGeometry === true,
      applyLayout: options?.applyLayout,
      durationScale: options?.durationScale,
    });
  };
  return { executed, executeCommand };
}

const first = cue("t0-a", 0, 0, "first");
const last = cue("t0-b", 0, 100, "last");
const nextTurn = cue("t1-a", 1, 200, "next turn");

(async () => {
  // Mid turn: nothing is released while the turn is still speaking.
  {
    const { executed, executeCommand } = recorder();
    await completeReplayDiagramTurn({ cue: first, nextCue: last, turn: turn(), diagram: withheldDiagram(), executeCommand, shouldCancel: () => false });
    assert(executed.length === 0, "replay released withheld marks before its turn ended");
  }

  // Turn end: every withheld mark lands once, as trusted engine ink in place.
  {
    const diagram = withheldDiagram();
    const { executed, executeCommand } = recorder();
    await completeReplayDiagramTurn({ cue: last, nextCue: nextTurn, turn: turn(), diagram, executeCommand, shouldCancel: () => false, durationScale: 0 });
    assert(executed.length === 4, `turn end released ${executed.length} of 4 withheld marks`);
    assert(executed.some((entry) => entry.label === "length_label"), "the withheld label never reached the replay board");
    assert(executed.every((entry) => entry.trusted && entry.applyLayout === false), "withheld marks must draw as trusted geometry without relayout");
    await completeReplayDiagramTurn({ cue: last, nextCue: nextTurn, turn: turn(), diagram, executeCommand, shouldCancel: () => false });
    assert(executed.length === 4, "a second completion drew the withheld marks twice");
  }

  // The last cue of the lecture is also a turn end.
  {
    const { executed, executeCommand } = recorder();
    await completeReplayDiagramTurn({ cue: last, turn: turn(), diagram: withheldDiagram(), executeCommand, shouldCancel: () => false });
    assert(executed.length === 4, "the lecture's final turn kept its withheld marks hidden");
  }

  // A doubt continues the lesson's page and never flushes its marks, as live.
  {
    const { executed, executeCommand } = recorder();
    await completeReplayDiagramTurn({ cue: last, nextCue: nextTurn, turn: turn(boardContinuationArtifacts("rod")), diagram: withheldDiagram(), executeCommand, shouldCancel: () => false });
    assert(executed.length === 0, "a doubt turn flushed the lesson's withheld marks");
  }

  // Code lessons own their board split; cancelled replays draw nothing.
  {
    const { executed, executeCommand } = recorder();
    await completeReplayDiagramTurn({ cue: last, nextCue: nextTurn, turn: turn(), diagram: withheldDiagram("code_lesson"), executeCommand, shouldCancel: () => false });
    await completeReplayDiagramTurn({ cue: last, nextCue: nextTurn, turn: turn(), diagram: withheldDiagram(), executeCommand, shouldCancel: () => true });
    await completeReplayDiagramTurn({ cue: last, nextCue: nextTurn, turn: undefined, diagram: withheldDiagram(), executeCommand, shouldCancel: () => false });
    await completeReplayDiagramTurn({ cue: last, nextCue: nextTurn, turn: turn(), diagram: null, executeCommand, shouldCancel: () => false });
    assert(executed.length === 0, "completion ran for a code lesson, a cancelled replay, or a missing turn or diagram");
  }

  // Forward playback: the flush sits between the turn's last cue and the next
  // turn's first cue, and every cue still draws once in order.
  {
    const diagram = withheldDiagram();
    const { executed, executeCommand } = recorder();
    const started: number[] = [];
    await drawReplayDiagramTimeline({
      cues: [first, last, nextTurn],
      executeCommand,
      getClockMs: () => Number.MAX_SAFE_INTEGER,
      waitForAdvance: async () => {},
      shouldCancel: () => false,
      onCueStart: (_cue, index) => started.push(index),
      getTurn: () => turn(),
      // The second turn has no figure of its own.
      getDiagram: () => (started.at(-1) === 2 ? null : diagram),
    });
    const order = executed.map((entry) => entry.label);
    assert(started.join(",") === "0,1,2", `cue start indices were ${started.join(",")}`);
    const lastAt = order.indexOf("last");
    const labelAt = order.indexOf("length_label");
    const nextAt = order.indexOf("next turn");
    assert(order.filter((label) => label === "first" || label === "last" || label === "next turn").length === 3, "a cue drew more or less than once");
    assert(lastAt >= 0 && labelAt > lastAt && nextAt > labelAt, `withheld marks must land between turns, got ${order.join(" > ")}`);
    assert(order.filter((label) => label === "length_label").length === 1, "the withheld label drew more than once");
    // The finished lecture's audio has no gap between turns: any animation
    // here would push the next turn's ink behind its own voice.
    const flushed = executed.filter((entry) => entry.trusted);
    assert(flushed.length === 4 && flushed.every((entry) => entry.durationScale === 0), "forward playback must land withheld marks instantly on the audio clock");
  }

  console.log("verify-replay-diagram-completion: ok");
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
