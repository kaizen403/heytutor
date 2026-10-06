import assert from "node:assert/strict";
import {
  isSupportedSceneOperator,
  SUPPORTED_SCENE_CONSTRUCTION_OPERATORS,
} from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { buildSceneDocumentPlannerPrompt, selectConstructionInputContracts } from "../../src/planners/scenePlannerV2Prompt";
import { planSceneDocument, repairSceneDocument } from "../../src/planners/scenePlannerV2";

const cases = [
  {question:"Draw the explicit permutation cycles and subset lattice of supplied finite items.",operators:["permutation_cycles","subset_lattice"]},
  {question:"Plot the explicit linear elastic stress strain law and mark the source strain state.",operators:["elastic_profile","elastic_state"]},
  {question:"Plot explicit changing magnetic flux and mark its flux and induced emf at a source time.",operators:["flux_process","induction_state"]},
  {question:"Draw rotational motion velocity, tangential and centripetal acceleration, and a source-derived torque.",operators:["rotational_motion","rotational_state","planar_torque"]},
  {question:"Draw a Venn diagram from explicit inclusive set counts and show a Boolean selection.",operators:["set_partition","set_select"]},
  {question: "Plot the simple harmonic motion position, velocity, acceleration, and an exact state from explicit source quantities.",operators:["harmonic_motion","harmonic_state"]},
  {question: "Draw the gravitational field of the supplied point masses and the force on an explicit test mass.",operators:["gravitational_field","gravitational_force"]},
  {question: "Draw the supplied complex value, its affine complex image, and every fourth root.", operators: ["complex_point", "complex_transform", "complex_roots"]},
  {question: "Draw the magnetic force from the supplied charge, velocity and magnetic field and its signed components.", operators: ["magnetic_force", "magnetic_components"]},
  {question: "Plot the hydrostatic pressure profile and a state and draw the buoyancy force from explicit source quantities.", operators: ["hydrostatic_profile", "hydrostatic_state", "buoyancy"]},
  {
    question: "Plot the supplied class intervals and counts, preserving their different widths.",
    operators: ["histogram", "frequency_polygon", "cumulative_frequency"],
  },
  {
    question: "Construct a figure with side lengths AB=3, BC=5, CA=4 and mark its incenter.",
    operators: ["triangle_from_sides", "triangle_from_sas", "triangle_from_asa", "triangle_center"],
  },
  {
    question: "Draw an ellipse with semi axes 5 and 3 and mark its foci, directrices, and tangent.",
    operators: ["conic", "conic_anchor", "conic_directrix", "conic_asymptotes", "conic_tangent"],
  },
  {
    question: "Draw the supplied conditional outcomes and mark every joint leaf probability.",
    operators: ["probability_tree"],
  },
  {
    question: "Draw two skew lines in 3D and their shortest connecting segment, and project a point onto a plane.",
    operators: ["space_project", "space_intersection", "space_closest_points", "space_segment"],
  },
  {
    question: "Draw the net electric field of two explicit point charges and its components at P.",
    operators: ["electric_field", "field_components"],
  },
  {
    question: "Construct a circle through three points and its external tangents and intersections with another circle.",
    operators: ["circle_from_three_points", "circle_tangent_at", "circle_tangency_points", "circle_intersections"],
  },
  {
    question: "Draw the supplied affine shear of a polygon and transform one of its vertices.",
    operators: ["affine_point", "affine_path"],
  },
  {
    question: "Draw the resultant of vectors a and b, then scale and project it onto b.",
    operators: ["vector_sum", "vector_scale", "vector_projection"],
  },
  {
    question: "Plot the trajectory and velocity of a projectile with its supplied constant acceleration.",
    operators: ["constant_acceleration_trajectory", "trajectory_state"],
  },
  {
    question: "Plot the parametric curve, evaluate two exact anchors, and draw its secant and derivative.",
    operators: ["curve_anchor", "curve_secant", "curve_derivative"],
  },
  {
    question: "Draw a phasor diagram for a series RLC circuit at its supplied frequency.",
    operators: ["impedance", "impedance_combine", "phasor_response"],
  },
  {
    question: "Plot the sum of two supplied harmonic waves and mark its value at a specified coordinate.",
    operators: ["harmonic_wave", "wave_superposition", "wave_sample"],
  },
  {
    question: "Draw the Cartesian image and foci of a converging lens with explicit object and focal distances.",
    operators: ["gaussian_image", "optical_focus"],
  },
  {
    question: "Plot an isothermal process and a constant-volume thermodynamic process and mark a state.",
    operators: ["polytropic_process", "isochoric_process", "process_state"],
  },
  {
    question: "Draw the river banks and the two velocity triangles for a boat crossing a current.",
    operators: ["crossing_strategies", "parallel_guides"],
  },
  {
    question: "Draw the Kirchhoff two-loop network and solve the branch currents.",
    operators: ["kirchhoff_network"],
  },
  {
    question: "Draw the free-body diagram of a block on a rough incline.",
    operators: ["free_body"],
  },
  {
    question: "Draw the magnetic field of a long straight wire using the Biot-Savart law.",
    operators: ["current_element_field"],
  },
  {
    question: "Draw the velocity triangles and the velocity of A relative to B.",
    operators: ["relative_velocity"],
  },
  {
    question: "Plot the position-time graph of the motion.",
    operators: ["motion_graph"],
  },
  {
    question: "Draw the metre bridge and mark the balance length.",
    operators: ["metre_bridge"],
  },
  {
    question: "Draw the cyclotron orbit for the given charge and field.",
    operators: ["cyclotron"],
  },
];

let contractChecks = 0;
for (const testCase of cases) {
  const capabilities = inferSceneCapabilities(testCase.question);
  assert(capabilities.visualRequired, `the requested figure must reach scene planning: ${testCase.question}`);
  const prompt = buildSceneDocumentPlannerPrompt(testCase.question, capabilities);
  assert(prompt.length + 800 <= 24_500, `combined semantic families must fit the initial transport budget: ${prompt.length}`);
  for (const operator of testCase.operators) {
    assert(isSupportedSceneOperator(operator), `${operator} must be executable in the package the tutor imports`);
    assert(capabilities.constructionOperators.includes(operator), `${operator} must reach the live planner`);
    assert(prompt.includes(`- ${operator}: {`), `${operator} must have a full input contract, not only a capability name`);
    const selected = selectConstructionInputContracts([operator]);
    assert.equal(selectConstructionInputContracts([operator], [operator]), selected, "repair must retain full contracts for the candidate's operators");
    assert(selected.includes(`- ${operator}: {`), `${operator} contract must survive prompt compaction`);
    for (const other of testCase.operators.filter((name) => name !== operator)) {
      assert(!selected.includes(`- ${other}: {`), `selecting ${operator} must not inject the ${other} contract`);
    }
    contractChecks++;
  }
}
assert.equal(new Set(SUPPORTED_SCENE_CONSTRUCTION_OPERATORS).size, SUPPORTED_SCENE_CONSTRUCTION_OPERATORS.length);
const compactCatalog = selectConstructionInputContracts(SUPPORTED_SCENE_CONSTRUCTION_OPERATORS, []);
for (const testCase of cases) for (const operator of testCase.operators) {
  assert(compactCatalog.includes(`- ${operator}: {`), `compact repair catalog must retain ${operator}'s input shape`);
}
const unknownQuestion = "Draw the supplied conditional outcomes and mark every joint leaf probability.";
const unknownCapabilities = inferSceneCapabilities(unknownQuestion);
assert.deepEqual(unknownCapabilities.families, [], "exercise the universal catalog without a family classifier");
for (const operators of [SUPPORTED_SCENE_CONSTRUCTION_OPERATORS, [...SUPPORTED_SCENE_CONSTRUCTION_OPERATORS].reverse()]) {
  const prompt = buildSceneDocumentPlannerPrompt(unknownQuestion, { ...unknownCapabilities, constructionOperators: operators });
  assert(prompt.length + 800 <= 24_500, `full catalog must leave initial transport/strategy room: ${prompt.length}`);
  for (const testCase of cases) for (const operator of testCase.operators) assert(prompt.includes(`- ${operator}: {`), `catalog must retain ${operator}`);
}
for (const [operator,conditions] of [
  ["elastic_state",["uniformBar:true","strain>-1"]],
  ["buoyancy",["exactly one of displayLength/displayScale","zero:point"]],
  ["magnetic_force",["zero:point","page-normal:dot/cross"]],
  ["planar_torque",["polyline page-normal glyph","zero:point"]],
  ...["curve_derivative","impedance","impedance_combine","gravitational_field","gravitational_force"].map(operator=>[operator,["zero:point"]]),
] as Array<[string,string[]]>) for (const condition of conditions) assert(selectConstructionInputContracts([operator],[]).includes(condition), `${operator} compact contract must retain ${condition}`);
const conditionalContracts = [
  ["circle_intersections", 'mode="two": 2 points', 'mode="tangent": 1 point'],
  ["trajectory_state", 'kind="position": 1 point', '"velocity"/"acceleration": 1 vector', '"state": [position point,velocity vector,acceleration vector]'],
  ["optical_focus", "lens: [focus(-f),focus(+f)] points", "mirror: [focus(f)] point"],
  ["space_intersection", "line/plane: 1 point", "plane/plane: 1 line"],
  ["probability_tree", "N node points in input order", "N-1 branch polylines in nonroot input order", "L leaf labels in DFS order"],
  ["vector_components", "[x_component,y_component] without basis", "[parallel_component,perpendicular_component] with basis"],
  ["optical_train", "[incoming_upper,incoming_lower,internal_upper,internal_lower,outgoing_upper,outgoing_lower] rays"],
  ["space_closest_points", "[point on first line,point on second line]"],
] as const;
for (const [operator, ...outputContracts] of conditionalContracts) {
  const compact = selectConstructionInputContracts([operator], []);
  for (const outputContract of outputContracts) assert(compact.includes(outputContract), `${operator} compact contract must preserve ${outputContract}`);
  assert.equal(selectConstructionInputContracts([operator], [operator]), selectConstructionInputContracts([operator]), "used repair operators keep full contracts");
}
const scopedPrompt = buildSceneDocumentPlannerPrompt("Construct two circle intersections.", { constructionOperators: ["circle_intersections"] });
assert(scopedPrompt.includes("The requested multiplicity must be mathematically correct."), "scoped requests keep the full explanatory contract");
const catalogRepairPrompt = buildSceneDocumentPlannerPrompt(unknownQuestion, unknownCapabilities, ["probability_tree"]);
assert(catalogRepairPrompt.includes("No inferred complements or independence."), "used repair operator keeps its mathematical authority rules");
const originalFetch = globalThis.fetch;
const requests: Array<{ messages: Array<{ content: string }> }> = [];
globalThis.fetch = async (_input, init) => {
  requests.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "scene-document/v2", visualDecision: { mode: "text_only" } }) } }] }), { status: 200 });
};
try {
  const options = { ...unknownCapabilities, proxyUrl: "http://planner.test", timeoutMs: 2000 };
  assert(await planSceneDocument(unknownQuestion, options, "Build the smallest sufficient scene and preserve every exact conditional outcome."));
  assert(await repairSceneDocument(unknownQuestion, {
    schemaVersion: "scene-document/v2", constructions: [{ id: "tree", operator: "probability_tree", outputs: ["root", "a", "b", "branch_a", "branch_b", "joint_a", "joint_b"] }],
  }, [{ code: "invalid_probability_output", message: "Rebuild the ordered node/branch/leaf outputs from explicit conditionals.", severity: "fatal" }], options));
  const promptSize = (request: typeof requests[number]): number => request.messages.reduce((total, message) => total + message.content.length, 0);
  assert.equal(requests.length, 2);
  assert(promptSize(requests[0]!) <= 24_500, `universal initial request exceeds its existing budget: ${promptSize(requests[0]!)}`);
  assert(promptSize(requests[1]!) <= 27_000, `universal repair request exceeds its existing budget: ${promptSize(requests[1]!)}`);
} finally { globalThis.fetch = originalFetch; }
console.log(`verify-reusable-scene-capabilities: ok (${cases.length} requests, ${contractChecks} operator contracts)`);
