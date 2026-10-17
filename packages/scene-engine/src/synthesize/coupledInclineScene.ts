import { SceneBuilder } from "../archetypes/document";
import { readCoupledInclineSource } from "../physics/coupledInclineSource";
import type { SceneDocument, SceneEntity } from "../types";

/** Two free bodies from the same source force balance used for narration. */
export function synthesizeCoupledInclineScene(
  question: string,
): SceneDocument | null {
  const state = readCoupledInclineSource(question);
  if (!state) return null;
  const radians = (state.angleDeg * Math.PI) / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const slope = (force: number) => [force * c, force * s];
  const blockIds = [
    "incline_body",
    "incline_weight",
    "incline_normal",
    "incline_tension",
    ...(state.friction > 0 ? ["incline_friction"] : []),
  ];
  const hangingIds = ["hanging_body", "hanging_weight", "hanging_tension"];
  const labels = [
    "body",
    "mg",
    "N",
    "T",
    ...(state.friction > 0 ? ["f_k"] : []),
    "body",
    "mg",
    "T",
  ];
  const ids = [...blockIds, ...hangingIds];
  const entities: SceneEntity[] = ids.map((id, index) => ({
    id,
    kind: id.endsWith("body") ? "point" : "vector",
    role: id.replaceAll("_", " "),
    label: labels[index]!,
    ...(id === "incline_friction"
      ? { provenance: { requireLabelLeader: true } }
      : {}),
  }));
  // Apparatus context and the isolated forces are separate panels. Rope
  // endpoints are the actual source bodies, so connectivity is constructed.
  const setup = new SceneBuilder(
    question,
    "Source-bound incline and hanging mass apparatus",
    "coupled_incline",
  );
  const base = 5;
  const run = 4;
  const rise = run * Math.tan(radians);
  setup.helper("slope_left", { x: 0, y: base });
  setup.helper("slope_right", { x: run, y: base });
  setup.helper("slope_top", { x: run, y: base + rise });
  setup.polygon(
    "incline",
    ["slope_left", "slope_right", "slope_top"],
    "incline region",
    "incline",
  );
  setup.point(
    "block",
    { x: run / 2, y: base + rise / 2 },
    "block on incline",
    "block",
  );
  const radius = 0.18;
  const center = { x: run - radius * s, y: base + rise + radius * c };
  setup.point(
    "mass",
    { x: center.x + radius, y: base + rise / 2 },
    "hanging mass",
    "mass",
  );
  setup.helper("pulley_center", center);
  setup.circle("pulley", "pulley_center", radius, "pulley", "pulley");
  const wrapPoints: string[] = [];
  for (let index = 0; index <= 12; index++) {
    const angle = (radians - Math.PI / 2) * (1 - index / 12);
    const id = `rope_wrap_${index}`;
    setup.helper(id, {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
    wrapPoints.push(id);
  }
  setup.polyline("rope", ["block", ...wrapPoints, "mass"], "taut rope", "rope");
  setup.labelAt(
    "block_fbd_title",
    { x: 0, y: 2.8 },
    "free-body panel title",
    "incline block",
  );
  setup.labelAt(
    "mass_fbd_title",
    { x: 5, y: 2.8 },
    "free-body panel title",
    "hanging mass",
  );
  setup.assert("block_on_surface", "inside", ["block", "incline"]);
  setup.group(
    "apparatus",
    ["incline", "block", "mass", "rope", "pulley"],
    "The rope joins the block on the incline to the hanging mass over the pulley.",
  );
  const apparatus = setup.build();
  return {
    schemaVersion: "scene-document/v2",
    source: {
      question,
      sourceModel: "coupled_incline",
      synthesizedFamily: true,
      representationTier: "question_representation",
      nonMetric: true,
    },
    visualDecision: {
      mode: "scene",
      reason:
        "Two free-body diagrams computed from stated masses, incline angle and current sliding direction; arrow scales are illustrative.",
    },
    quantities: [
      { id: "m1", symbol: "m1", value: state.inclineMass, unit: "kg" },
      { id: "m2", symbol: "m2", value: state.hangingMass, unit: "kg" },
      { id: "theta", symbol: "theta", value: state.angleDeg, unit: "degree" },
    ],
    entities: [...apparatus.entities, ...entities],
    constructions: [
      ...apparatus.constructions,
      {
        id: "block_fbd",
        operator: "free_body",
        inputs: {
          origin: [0, 0],
          forces: [
            {
              role: "weight",
              components: [0, -state.inclineMass * state.gravity],
            },
            {
              role: "normal",
              components: [-state.normal * s, state.normal * c],
            },
            { role: "tension", components: slope(state.tension) },
            ...(state.friction > 0
              ? [
                  {
                    role: "kinetic_friction",
                    components: slope(-state.velocitySign * state.friction),
                  },
                ]
              : []),
          ],
          units: { force: "N" },
          displayScale: 2.4,
        },
        outputs: blockIds,
      },
      {
        id: "hanging_fbd",
        operator: "free_body",
        inputs: {
          origin: [5, 0],
          forces: [
            {
              role: "weight",
              components: [0, -state.hangingMass * state.gravity],
            },
            { role: "tension", components: [0, state.tension] },
          ],
          units: { force: "N" },
          displayScale: 2.4,
        },
        outputs: hangingIds,
      },
    ],
    relations: [],
    assertions: apparatus.assertions,
    annotations: [],
    requiredEntityIds: [...apparatus.requiredEntityIds, ...ids],
    revealGroups: [
      ...apparatus.revealGroups,
      {
        id: "block_forces",
        entityIds: [...blockIds, "block_fbd_title"],
        dependsOn: [],
        narrationCue:
          "Incline block: weight vertical, normal perpendicular to the surface; tension upslope and kinetic friction opposite current sliding.",
      },
      {
        id: "hanging_forces",
        entityIds: [...hangingIds, "mass_fbd_title"],
        dependsOn: ["block_forces"],
        narrationCue: "Hanging mass: weight down and rope tension up.",
      },
    ],
    teachingTimeline: [],
  };
}
