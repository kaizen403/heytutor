import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileSceneDocument,
  type RenderPrimitive,
  type RenderScene,
  type SceneDocument,
} from "@heytutor/scene-engine";
import { verifiedLayoutNarration } from "../../features/tutor-session/lib/scene/verifiedLayoutNarration";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

const fixture = (name: string) =>
  JSON.parse(readFileSync(resolve("scripts/verify/fixtures", name), "utf8"));
const line = (text: string) =>
  text
    .split("\n")
    .find((value) => value.startsWith("Verified screen layout facts"))!;
const facts = (scene: RenderScene, ids = ["A", "B"]) =>
  line(verifiedLayoutNarration(scene, ids));
let checks = 0;
function check(name: string, run: () => void) {
  run();
  checks++;
  console.log(`PASS ${name}`);
}
function compiled(document: SceneDocument): RenderScene {
  const result = compileSceneDocument(document);
  assert(result.ok && result.renderScene, "real scene must compile");
  return result.renderScene;
}
const concentric: SceneDocument = fixture(
  "verified-layout-whole-body-concentric-20261006.json",
);
const circles = compiled(concentric);
const before = JSON.stringify({ concentric, circles });
check("real summary-marked concentric bodies have no strict separation", () => {
  const a = circles.primitives.find(
    (p) => p.entityId === "A" && p.kind === "circle",
  )!;
  const b = circles.primitives.find(
    (p) => p.entityId === "B" && p.kind === "circle",
  )!;
  assert.deepEqual(a.points, b.points);
  assert(a.radius! > b.radius!);
  assert.equal(a.provenance?.summary, true);
  assert.match(facts(circles), /: none$/);
  assert.match(
    line(
      buildVerifiedDiagramPresentation(concentric, circles).diagram
        .promptAddon!,
    ),
    /: none$/,
  );
  assert.equal(JSON.stringify({ concentric, circles }), before);
});

function generic(): RenderScene {
  return {
    engineVersion: circles.engineVersion,
    primitives: [
      {
        id: "a",
        entityId: "A",
        groupId: "g",
        kind: "circle",
        points: [{ x: 600, y: 200 }],
        radius: 40,
      },
      {
        id: "b",
        entityId: "B",
        groupId: "g",
        kind: "circle",
        points: [{ x: 800, y: 400 }],
        radius: 40,
      },
    ],
    entityBounds: {
      A: { x: 560, y: 160, width: 80, height: 80 },
      B: { x: 760, y: 360, width: 80, height: 80 },
    },
    revealGroups: [],
    timeline: [],
  };
}
check(
  "generic complete bounds retain both directions without coordinates",
  () => {
    const text = verifiedLayoutNarration(generic(), [
      "A",
      "B",
      "A",
      "absent",
      "g",
    ]);
    assert.match(line(text), /\[FOCUS:A\] is left of \[FOCUS:B\]/);
    assert.match(line(text), /\[FOCUS:A\] is above \[FOCUS:B\]/);
    assert.doesNotMatch(text, /600|800|200|400/);
    assert.match(
      text,
      /establishes no physical direction, polarity, connection, scale, distance, or solved value/,
    );
  },
);
for (const [name, mutate] of [
  [
    "forged reversed cache",
    (s: RenderScene) => {
      s.entityBounds.B = { x: 400, y: 0, width: 1, height: 1 };
    },
  ],
  [
    "partial finite cache",
    (s: RenderScene) => {
      s.entityBounds.B = { x: 800, y: 400, width: 0, height: 0 };
    },
  ],
  [
    "missing cache",
    (s: RenderScene) => {
      delete s.entityBounds.B;
    },
  ],
  [
    "negative cache",
    (s: RenderScene) => {
      s.entityBounds.B!.width = -1;
    },
  ],
  [
    "nonfinite cache",
    (s: RenderScene) => {
      s.entityBounds.B!.x = NaN;
    },
  ],
  [
    "overflowed cache",
    (s: RenderScene) => {
      s.entityBounds.B = {
        x: Number.MAX_VALUE,
        y: 0,
        width: Number.MAX_VALUE,
        height: 0,
      };
    },
  ],
  [
    "nonfinite body with finite cache",
    (s: RenderScene) => {
      s.primitives[1]!.points[0]!.x = NaN;
    },
  ],
  [
    "infinite body",
    (s: RenderScene) => {
      s.primitives[1]!.points[0]!.y = Infinity;
    },
  ],
  [
    "missing body",
    (s: RenderScene) => {
      s.primitives.pop();
    },
  ],
  [
    "empty body",
    (s: RenderScene) => {
      s.primitives[1]!.points = [];
    },
  ],
  [
    "missing radius",
    (s: RenderScene) => {
      delete s.primitives[1]!.radius;
    },
  ],
  [
    "negative radius",
    (s: RenderScene) => {
      s.primitives[1]!.radius = -40;
    },
  ],
  [
    "nonfinite radius",
    (s: RenderScene) => {
      s.primitives[1]!.radius = Infinity;
    },
  ],
  [
    "overflowed radius envelope",
    (s: RenderScene) => {
      s.primitives[1]!.radius = Number.MAX_VALUE;
      s.primitives[1]!.points[0]!.x = Number.MAX_VALUE;
    },
  ],
  [
    "unknown body kind",
    (s: RenderScene) => {
      Object.assign(s.primitives[1]!, { kind: "future_shape" });
    },
  ],
  [
    "label-only target",
    (s: RenderScene) => {
      s.primitives[1]!.kind = "label";
    },
  ],
  [
    "dimension-only target",
    (s: RenderScene) => {
      s.primitives[1]!.kind = "dimension";
    },
  ],
  [
    "annotation-only target",
    (s: RenderScene) => {
      s.primitives[1]!.provenance = { annotation: "highlight" };
    },
  ],
  [
    "invisible-only target",
    (s: RenderScene) => {
      s.primitives[1]!.provenance = { dsaExtent: true };
    },
  ],
  [
    "inconsistent ordinary label anchor",
    (s: RenderScene) => {
      s.primitives.push({
        id: "label",
        entityId: "B",
        groupId: "g",
        kind: "label",
        points: [{ x: 500, y: 100 }],
        text: "B",
      });
    },
  ],
  [
    "nonfinite ordinary label",
    (s: RenderScene) => {
      s.primitives.push({
        id: "label",
        entityId: "B",
        groupId: "g",
        kind: "label",
        points: [{ x: NaN, y: 400 }],
        text: "B",
      });
    },
  ],
  [
    "incomplete second body primitive",
    (s: RenderScene) => {
      s.primitives.push({ ...s.primitives[1]!, id: "second", points: [] });
    },
  ],
  [
    "summary geometry cannot hide from completeness",
    (s: RenderScene) => {
      s.primitives.push({
        id: "second",
        entityId: "B",
        groupId: "g",
        kind: "line",
        points: [
          { x: 400, y: 100 },
          { x: 800, y: 400 },
        ],
        provenance: { summary: true },
      });
    },
  ],
] satisfies Array<[string, (scene: RenderScene) => void]>) {
  check(`omit ${name}`, () => {
    const scene = generic();
    mutate(scene);
    assert.match(facts(scene), /: none$/);
  });
}
for (const [name, x, y] of [
  ["overlapping", 620, 220],
  ["touching", 680, 280],
] as const) {
  check(`${name} bodies omit both relations`, () => {
    const scene = generic();
    scene.primitives[1]!.points = [{ x, y }];
    scene.entityBounds.B = { x: x - 40, y: y - 40, width: 80, height: 80 };
    assert.match(facts(scene), /: none$/);
  });
}
check("wide multi-primitive body defeats label-only partial cache", () => {
  const scene = generic();
  scene.primitives.push({
    id: "wide",
    entityId: "A",
    groupId: "g",
    kind: "polyline",
    points: [
      { x: 600, y: 200 },
      { x: 950, y: 200 },
    ],
  });
  assert.match(facts(scene), /: none$/);
  scene.entityBounds.A = { x: 560, y: 160, width: 390, height: 80 };
  assert.doesNotMatch(facts(scene), /left of/);
  assert.match(facts(scene), /\[FOCUS:A\] is above \[FOCUS:B\]/);
});
check("labels can only restrict facts, never substitute for body", () => {
  const scene = generic();
  scene.primitives.push({
    id: "label",
    entityId: "A",
    groupId: "g",
    kind: "label",
    points: [{ x: 900, y: 400 }],
    text: "A",
  });
  scene.entityBounds.A = { x: 560, y: 160, width: 340, height: 240 };
  assert.match(facts(scene), /: none$/);
});
check(
  "diagnostic summary labels and direction metadata do not become placement proof",
  () => {
    const scene = generic();
    scene.primitives[0]!.provenance = {
      direction: "clockwise",
      polarity: "positive",
      diagnostic: "B left of A",
      labelBounds: { x: 1, y: 1 },
    };
    scene.primitives.push({
      id: "summary",
      entityId: "A",
      groupId: "g",
      kind: "label",
      points: [{ x: 1000, y: 500 }],
      text: "given",
      provenance: { summary: true },
    });
    assert.equal(facts(scene), facts(generic()));
  },
);
check(
  "arc whole-circle envelope is conservative and incomplete sweeps omit",
  () => {
    const scene = generic();
    Object.assign(scene.primitives[0]!, {
      kind: "arc",
      startAngle: 0,
      endAngle: 1,
    });
    assert.equal(facts(scene), facts(generic()));
    delete scene.primitives[0]!.endAngle;
    assert.match(facts(scene), /: none$/);
  },
);

// Independent coordinate extrema check for every emitted actual-Ohm fact.
// No helper/cache is used by this oracle; only the real compiled body geometry.
function assertBodyRelations(scene: RenderScene, text: string) {
  const extent = (id: string) => {
    const points = scene.primitives
      .filter(
        (p) =>
          p.entityId === id && p.kind !== "label" && p.kind !== "dimension",
      )
      .flatMap((p: RenderPrimitive) =>
        p.kind === "circle" || p.kind === "arc"
          ? [
              { x: p.points[0]!.x - p.radius!, y: p.points[0]!.y - p.radius! },
              { x: p.points[0]!.x + p.radius!, y: p.points[0]!.y + p.radius! },
            ]
          : p.points,
      );
    assert(points.length);
    return { x: points.map((p) => p.x), y: points.map((p) => p.y) };
  };
  for (const match of line(text).matchAll(
    /\[FOCUS:([^\]]+)\] is (left of|above) \[FOCUS:([^\]]+)\]/g,
  )) {
    const a = extent(match[1]!);
    const b = extent(match[3]!);
    assert(
      match[2] === "left of"
        ? Math.max(...a.x) < Math.min(...b.x)
        : Math.max(...a.y) < Math.min(...b.y),
      match[0],
    );
  }
}
const ohm = fixture("verified-layout-ohm-live.json");
async function verifyActualOhm() {
  const baselinePath =
    process.argv[process.argv.indexOf("--baseline-module") + 1];
  const baseline = process.argv.includes("--baseline-module")
    ? await import(baselinePath!)
    : null;
  check("exact saved actual Ohm retains layout and transport", () => {
    const original = JSON.stringify(ohm);
    const scene = compiled(ohm.sceneDocument);
    const presentation = buildVerifiedDiagramPresentation(
      ohm.sceneDocument,
      scene,
    );
    assert.match(
      line(presentation.diagram.promptAddon!),
      /\[FOCUS:R1\] is above \[FOCUS:battery\]/,
    );
    assert.doesNotMatch(line(presentation.diagram.promptAddon!), /left of/);
    assertBodyRelations(scene, presentation.diagram.promptAddon!);
    if (baseline) {
      const old = baseline.buildVerifiedDiagramPresentation(
        ohm.sceneDocument,
        scene,
      );
      assert.deepEqual(
        {
          ...presentation,
          diagram: { ...presentation.diagram, promptAddon: undefined },
        },
        { ...old, diagram: { ...old.diagram, promptAddon: undefined } },
      );
    }
    assert.equal(JSON.stringify(ohm), original);
  });
  for (const degrees of [0, 30, 45, 60, 90, 120, 180, 225, 270, 315]) {
    check(`saved actual Ohm ${degrees} degrees, scaled/translated`, () => {
      const document: SceneDocument = structuredClone(ohm.sceneDocument);
      const theta = (degrees * Math.PI) / 180;
      for (const construction of document.constructions) {
        const { x, y } = construction.inputs;
        if (
          construction.operator !== "point" ||
          typeof x !== "number" ||
          typeof y !== "number"
        )
          continue;
        construction.inputs.x =
          7 * (x * Math.cos(theta) - y * Math.sin(theta)) + 10;
        construction.inputs.y =
          7 * (x * Math.sin(theta) + y * Math.cos(theta)) - 27;
      }
      const scene = compiled(document);
      const original = JSON.stringify({ document, scene, ohm });
      const presentation = buildVerifiedDiagramPresentation(document, scene);
      const text = presentation.diagram.promptAddon!;
      assert.doesNotMatch(line(text), /: none$/);
      assertBodyRelations(scene, text);
      if (degrees === 0) {
        assert.match(line(text), /\[FOCUS:R1\] is above \[FOCUS:battery\]/);
        assert.doesNotMatch(line(text), /left of/);
      }
      if (degrees === 90) {
        assert.match(line(text), /\[FOCUS:R1\] is left of \[FOCUS:battery\]/);
        assert.doesNotMatch(line(text), /above/);
      }
      if (baseline) {
        const strip = (
          value: ReturnType<typeof buildVerifiedDiagramPresentation>,
        ) => ({
          ...value,
          diagram: { ...value.diagram, promptAddon: undefined },
        });
        assert.deepEqual(
          strip(presentation),
          strip(baseline.buildVerifiedDiagramPresentation(document, scene)),
          "geometry commands, intro, focus, timing and reveal unchanged",
        );
      }
      assert.equal(JSON.stringify({ document, scene, ohm }), original);
    });
  }
  console.log(`PASS ${checks} whole-body layout checks`);
}
void verifyActualOhm().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
