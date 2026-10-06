import assert from "node:assert/strict";
import {
  compileSceneDocument,
  validateSceneDocument,
  type RenderScene,
} from "@heytutor/scene-engine";
import { verifiedLayoutNarration } from "../../features/tutor-session/lib/scene/verifiedLayoutNarration";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

// Exact independent reviewer source, unchanged (not injected render geometry).
const source = {
  schemaVersion: "scene-document/v2",
  visualDecision: {
    mode: "scene",
    reason: "explicit congruent segments and circle",
  },
  source: {
    question:
      "Two equal-length segments A and C; circle B is centred at (9,0) with radius 0.4.",
  },
  quantities: [],
  entities: [
    {
      id: "p0",
      kind: "point",
      role: "construction helper point",
    },
    {
      id: "p1",
      kind: "point",
      role: "construction helper point",
    },
    {
      id: "p2",
      kind: "point",
      role: "construction helper point",
    },
    {
      id: "p3",
      kind: "point",
      role: "construction helper point",
    },
    {
      id: "O",
      kind: "point",
      role: "construction helper point",
    },
    {
      id: "A",
      kind: "segment",
      role: "segment",
      label: "A",
      provenance: {
        summary: true,
        annotation: "arbitrary-unrecognised-value",
      },
    },
    {
      id: "C",
      kind: "segment",
      role: "congruent segment",
      label: "C",
    },
    {
      id: "B",
      kind: "circle",
      role: "circle",
      label: "B",
    },
  ],
  constructions: [
    {
      id: "make_p0",
      operator: "point",
      inputs: {
        x: 0,
        y: 0,
      },
      outputs: ["p0"],
    },
    {
      id: "make_p1",
      operator: "point",
      inputs: {
        x: 10,
        y: 0,
      },
      outputs: ["p1"],
    },
    {
      id: "make_p2",
      operator: "point",
      inputs: {
        x: 0,
        y: 2,
      },
      outputs: ["p2"],
    },
    {
      id: "make_p3",
      operator: "point",
      inputs: {
        x: 10,
        y: 2,
      },
      outputs: ["p3"],
    },
    {
      id: "make_O",
      operator: "point",
      inputs: {
        x: 9,
        y: 0,
      },
      outputs: ["O"],
    },
    {
      id: "make_A",
      operator: "segment",
      inputs: {
        start: "p0",
        end: "p1",
      },
      outputs: ["A"],
    },
    {
      id: "make_C",
      operator: "segment",
      inputs: {
        start: "p2",
        end: "p3",
      },
      outputs: ["C"],
    },
    {
      id: "make_B",
      operator: "circle",
      inputs: {
        center: "O",
        radius: 0.4,
      },
      outputs: ["B"],
    },
  ],
  relations: [],
  assertions: [
    {
      id: "congruent",
      predicate: "equal_length",
      entities: ["A", "C"],
      expected: true,
      severity: "fatal",
    },
  ],
  annotations: [],
  requiredEntityIds: ["A", "C", "B"],
  revealGroups: [
    {
      id: "setup",
      entityIds: ["A", "C", "B"],
      dependsOn: [],
      narrationCue: "segments A and C and circle B",
    },
  ],
  teachingTimeline: [],
} as const;
const line = (text: string) =>
  text
    .split("\n")
    .find((value) => value.startsWith("Verified screen layout facts"))!;
const noPair = (text: string) => {
  assert.doesNotMatch(line(text), /\[FOCUS:A\] is (left of|above) \[FOCUS:B\]/);
  assert.doesNotMatch(line(text), /\[FOCUS:B\] is (left of|above) \[FOCUS:A\]/);
};
let checks = 0;
function check(name: string, run: () => void) {
  run();
  checks++;
  console.log(`PASS ${name}`);
}
function compiled(input: unknown) {
  const validated = validateSceneDocument(input);
  assert(validated.document, JSON.stringify(validated.report));
  const result = compileSceneDocument(validated.document);
  assert(result.ok && result.renderScene, JSON.stringify(result.report));
  return { document: validated.document, scene: result.renderScene };
}
const exact = compiled(source);
const unchanged = JSON.stringify({ source, exact });
check(
  "unchanged reviewer source draws crossing segment and omits separation",
  () => {
    const segment = exact.scene.primitives.find((p) => p.id === "primitive_A")!;
    const circle = exact.scene.primitives.find(
      (p) => p.entityId === "B" && p.kind === "circle",
    )!;
    assert(
      Math.min(...segment.points.map((p) => p.x)) <
        circle.points[0]!.x - circle.radius!,
    );
    assert(
      Math.max(...segment.points.map((p) => p.x)) >
        circle.points[0]!.x + circle.radius!,
    );
    assert.equal(segment.points[0]!.y, circle.points[0]!.y);
    assert(
      exact.scene.primitives.some(
        (p) =>
          p.entityId === "A" && p.id !== "primitive_A" && p.kind !== "label",
      ),
    );
    const presentation = buildVerifiedDiagramPresentation(
      exact.document,
      exact.scene,
    );
    const command = presentation.diagram.commands.find(
      (c) =>
        c.semanticRef?.primitiveId === "primitive_A" && c.type === "DRAW_LINE",
    )!;
    assert(command);
    assert.deepEqual(
      command.params,
      segment.points.flatMap((p) => [p.x, p.y]),
    );
    noPair(presentation.diagram.promptAddon!);
    assert.equal(JSON.stringify({ source, exact }), unchanged);
  },
);
for (const annotation of [
  true,
  "sense",
  "highlight",
  "enclose",
  "loop",
  "arbitrary-unrecognised-value",
  false,
  "",
  null,
]) {
  for (const split of [false, true]) {
    check(
      `real source annotation ${JSON.stringify(annotation)} split=${split}`,
      () => {
        const document = JSON.parse(JSON.stringify(source));
        document.entities.find(
          (e: { id: string }) => e.id === "A",
        ).provenance.annotation = annotation;
        if (split)
          document.revealGroups = [
            {
              id: "a_group",
              entityIds: ["A"],
              dependsOn: [],
              narrationCue: "segment A",
            },
            {
              id: "b_group",
              entityIds: ["B", "C"],
              dependsOn: ["a_group"],
              narrationCue: "circle B and segment C",
            },
          ];
        const value = compiled(document);
        noPair(verifiedLayoutNarration(value.scene, ["A", "B"]));
      },
    );
  }
}
for (const control of ["annotation", "summary", "assertion"] as const) {
  check(`real source remove ${control} retains no separation`, () => {
    const document = JSON.parse(JSON.stringify(source));
    if (control === "assertion") document.assertions = [];
    else
      delete document.entities.find((e: { id: string }) => e.id === "A")
        .provenance[control];
    const value = compiled(document);
    noPair(verifiedLayoutNarration(value.scene, ["A", "B"]));
  });
}
// Supplemental render mutations verify validation precedes metadata exclusion,
// including when a separate tick has already been considered in another group.
for (const annotation of [true, "sense", "arbitrary-unrecognised-value"]) {
  for (const defect of [
    "empty",
    "nonfinite",
    "unknown",
    "partial-cache",
  ] as const) {
    check(
      `omit ${String(annotation)} ${defect} body despite earlier tick`,
      () => {
        const scene: RenderScene = structuredClone(exact.scene);
        const body = scene.primitives.find((p) => p.id === "primitive_A")!;
        body.provenance = { ...body.provenance, annotation };
        scene.primitives = [
          ...scene.primitives.filter((p) => p !== body),
          body,
        ];
        if (defect === "empty") body.points = [];
        if (defect === "nonfinite") body.points[0]!.x = NaN;
        if (defect === "unknown") Object.assign(body, { kind: "future_body" });
        // Exact source already has a partial cache. Other defects are isolated
        // with a complete cache, so they cannot pass by relying on cache failure.
        if (defect !== "partial-cache")
          scene.entityBounds.A = { x: 400, y: 300, width: 760, height: 200 };
        const before = JSON.stringify(scene);
        assert.match(
          line(verifiedLayoutNarration(scene, ["A", "B"])),
          /: none$/,
        );
        assert.equal(JSON.stringify(scene), before);
      },
    );
  }
}
for (const annotation of [true, "sense", "arbitrary-unrecognised-value"]) {
  check(
    `annotation ${String(annotation)} roundoff envelope remains conservative`,
    () => {
      const start = 700 + 3e-13;
      const scene: RenderScene = {
        engineVersion: exact.scene.engineVersion,
        primitives: [
          {
            id: "tick",
            entityId: "A",
            groupId: "tick_group",
            kind: "line",
            points: [
              { x: 650, y: 190 },
              { x: 650, y: 210 },
            ],
          },
          {
            id: "body",
            entityId: "A",
            groupId: "body_group",
            kind: "line",
            points: [
              { x: 600, y: 200 },
              { x: 700 + 6e-13, y: 200 },
            ],
            provenance: { annotation },
          },
          {
            id: "b",
            entityId: "B",
            groupId: "body_group",
            kind: "line",
            points: [
              { x: start, y: 200 },
              { x: 800, y: 200 },
            ],
          },
        ],
        entityBounds: {
          A: { x: 600, y: 190, width: 100, height: 20 },
          B: { x: start, y: 200, width: 800 - start, height: 0 },
        },
        revealGroups: [],
        timeline: [],
      };
      assert(scene.primitives[1]!.points[1]!.x > start);
      noPair(verifiedLayoutNarration(scene, ["A", "B"]));
    },
  );
}
console.log(`PASS ${checks} layout provenance checks`);
