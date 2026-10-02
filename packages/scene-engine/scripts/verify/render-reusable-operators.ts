/** Render representative operator compositions for visual review at board size. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compileSceneDocument, type SceneConstruction, type SceneDocument, type SceneEntity } from "../../src";
import { renderSceneSvg } from "../lib/renderSceneSvg";

const out = resolve(process.argv[2] ?? "/tmp/heytutor-operator-coverage");
mkdirSync(out, { recursive: true });
const examples: Array<{ title: string; entities: SceneEntity[]; constructions: SceneConstruction[] }> = [];
const entity = (id: string, kind: string, label?: string): SceneEntity => ({ id, kind, role: `${kind} in the requested construction`, ...(label ? { label } : {}) });
const construction = (operator: string, inputs: Record<string, unknown>, outputs: string[]): SceneConstruction => ({ id: `make_${outputs.join("_")}`, operator, inputs, outputs });
const origin = construction("point", { x: 0, y: 0 }, ["origin"]);
const originEntity: SceneEntity = { id: "origin", kind: "point", role: "construction helper point" };

const bins = [{ lower: 0, upper: 2, frequency: 6 }, { lower: 2, upper: 5, frequency: 9 }, { lower: 5, upper: 9, frequency: 4 }];
examples.push({ title: "Statistics: unequal-width density histogram", entities: [entity("axes", "axes"), entity("data", "polyline")],
  constructions: [construction("axes", { xMin: 0, xMax: 10, yMin: 0, yMax: 4 }, ["axes"]), construction("histogram", { bins, heightMode: "density" }, ["data"])] });
examples.push({ title: "Statistics: less-than cumulative frequency", entities: [entity("axes", "axes"), entity("data", "polyline")],
  constructions: [construction("axes", { xMin: 0, xMax: 10, yMin: 0, yMax: 20 }, ["axes"]), construction("cumulative_frequency", { bins, direction: "less_than" }, ["data"])] });
examples.push({ title: "Triangles: SSS with derived incenter", entities: [entity("A", "point", "A"), entity("B", "point", "B"), entity("C", "point", "C"), entity("triangle", "polygon"), entity("I", "point", "I")],
  constructions: [construction("triangle_from_sides", { sideAB: 6, sideBC: 5, sideCA: 4, headingDeg: 20 }, ["A", "B", "C", "triangle"]), construction("triangle_center", { a: "A", b: "B", c: "C", kind: "incenter" }, ["I"])] });
for (const kind of ["ellipse", "hyperbola", "parabola"] as const) {
  const parameters = kind === "parabola" ? { vertex: "origin", p: 1.2, tMin: -2, tMax: 2 }
    : { center: "origin", a: 4, b: 2.5, ...(kind === "hyperbola" ? { tMin: -1.5, tMax: 1.5 } : {}) };
  const entities = [originEntity, entity("curve", "polyline"), entity("focus", "point", "F"), entity("directrix", "line", "d"), entity("contact", "point", "T"), entity("tangent", "line")];
  const constructions = [origin, construction("conic", { kind, ...parameters, rotationDeg: 20 }, ["curve"]),
    construction("conic_anchor", { conic: "curve", feature: "focus", ...(kind === "parabola" ? {} : { side: 1 }) }, ["focus"]),
    construction("conic_directrix", { conic: "curve", span: 10, ...(kind === "parabola" ? {} : { side: 1 }) }, ["directrix"]),
    construction("conic_anchor", { conic: "curve", feature: "curve_point", at: 0.7, ...(kind === "hyperbola" ? { branch: 1 } : {}) }, ["contact"]),
    construction("conic_tangent", { conic: "curve", at: 0.7, span: 9, ...(kind === "hyperbola" ? { branch: 1 } : {}) }, ["tangent"])];
  if (kind === "hyperbola") { entities.push(entity("asymptotes", "polyline")); constructions.push(construction("conic_asymptotes", { conic: "curve", span: 15 }, ["asymptotes"])); }
  examples.push({ title: `Conics: rotated ${kind} with exact landmarks`, entities, constructions });
}
const nodes = [
  { id: "root", outcome: "Start" }, { id: "h", outcome: "H", parent: "root", probability: 0.6 }, { id: "t", outcome: "T", parent: "root", probability: 0.4 },
  { id: "hh", outcome: "HH", parent: "h", probability: 0.7 }, { id: "ht", outcome: "HT", parent: "h", probability: 0.3 },
  { id: "th", outcome: "TH", parent: "t", probability: 0.2 }, { id: "tt", outcome: "TT", parent: "t", probability: 0.8 },
];
const treeOutputs = Array.from({ length: 17 }, (_, i) => `tree_${i}`);
examples.push({ title: "Probability: conditional branches and computed joint leaves",
  entities: treeOutputs.map((id, i) => entity(id, i < 7 ? "point" : i < 13 ? "polyline" : "label")),
  constructions: [construction("probability_tree", { nodes, levelGap: 2, leafGap: 1.5 }, treeOutputs)] });
examples.push({ title: "3D geometry: shortest connector between skew lines",
  entities: [originEntity, entity("frame", "polyline"), entity("l1", "line", "l1"), entity("l2", "line", "l2"), entity("P", "point", "P"), entity("Q", "point", "Q"), entity("connector", "segment", "PQ")],
  constructions: [origin, construction("space_frame", { origin: "origin", axisLength: 2 }, ["frame"]),
    construction("space_line", { frame: "frame", point: [0, 0, 0], direction: [1, 0, 0], tMin: -2, tMax: 2 }, ["l1"]),
    construction("space_line", { frame: "frame", point: [0, 0, 2], direction: [0, 1, 0], tMin: -2, tMax: 2 }, ["l2"]),
    construction("space_closest_points", { frame: "frame", first: "l1", second: "l2" }, ["P", "Q"]),
    construction("space_segment", { frame: "frame", a: "P", b: "Q" }, ["connector"])] });
examples.push({ title: "Electrostatics: computed dipole field and components",
  entities: [entity("positive", "point", "+q"), entity("negative", "point", "-q"), entity("probe", "point", "P"), entity("field", "vector"), entity("x", "vector"), entity("y", "vector")],
  constructions: [construction("point", { x: -1, y: 0 }, ["positive"]), construction("point", { x: 1, y: 0 }, ["negative"]), construction("point", { x: 1.5, y: 2 }, ["probe"]),
    construction("electric_field", { charges: [{ position: "positive", charge: 1 }, { position: "negative", charge: -1 }], at: "probe", mode: "schematic", k: 1, displayLength: 1.5 }, ["field"]),
    construction("field_components", { field: "field" }, ["x", "y"])] });

examples.push({ title: "Complex numbers: fourth roots with source authority",
  entities: [entity("axes", "axes"),entity("z", "point", "z"), ...Array.from({length:4},(_,i)=>entity(`w${i}`,"point"))],
  constructions: [construction("axes", {xMin:-3,xMax:3,yMin:-3,yMax:3}, ["axes"]),construction("complex_point", {real:1,imaginary:1,displayScale:2}, ["z"]), construction("complex_roots", {source:"z",degree:4,displayScale:2}, ["w0","w1","w2","w3"])] });
examples.push({ title: "Magnetism: Lorentz force out of the page",
  entities: [entity("force", "vector"),entity("velocity","vector","v"),entity("field","vector","B")], constructions: [construction("vector", {start:[0,0],direction:[1,0],length:2},["velocity"]), construction("vector", {start:[0,0],direction:[0,1],length:2},["field"]),construction("magnetic_force", {charge:2,velocity:[3,0,0],magneticField:[0,4,0],units:{charge:"C",velocity:"m/s",magneticField:"T"},origin:[0,0],displayLength:2}, ["force"])] });
examples.push({ title: "Fluids: exact hydrostatic pressure and state",
  entities: [entity("profile", "polyline"),entity("state","point"),entity("derivative","vector","dp/dd")],
  constructions: [construction("hydrostatic_profile", {surfacePressure:100,density:1000,gravity:10,depthMin:0,depthMax:5,pressureUnit:"kPa",densityUnit:"kg/m^3",gravityUnit:"m/s^2",depthUnit:"m",depthScale:1,pressureScale:0.03}, ["profile"]), construction("hydrostatic_state", {profile:"profile",depth:3}, ["state"]), construction("curve_derivative", {curve:"profile",at:3,parameterScale:0.8}, ["derivative"])] });

for (const quantity of ["position", "velocity", "acceleration"]) {
  examples.push({title:`Simple harmonic motion: ${quantity} time graph`,entities:[entity("motion","polyline"),entity("state","point")],
    constructions:[construction("harmonic_motion", {amplitude:1,equilibrium:0,angularFrequency:1,phase:0,phaseUnit:"rad",tMin:0,tMax:2*Math.PI,lengthUnit:"m",timeUnit:"s",frequencyUnit:"rad/s",quantity,origin:[0,0],timeScale:1,ordinateScale:1,samples:257},["motion"]),construction("harmonic_state",{motion:"motion",time:1},["state"])]});
}
examples.push({title:"Gravitation: verified superposition of two source masses",entities:[entity("m1","point","m1"),entity("m2","point","m2"),entity("P","point","P"),entity("g","vector")],
  constructions:[construction("point",{x:-2,y:0},["m1"]),construction("point",{x:2,y:0},["m2"]),construction("point",{x:0,y:2},["P"]),construction("gravitational_field",{sources:[{position:"m1",mass:1000},{position:"m2",mass:2000}],at:"P",G:6.6743e-11,units:{mass:"kg",length:"m",G:"m^3/(kg*s^2)"},displayLength:2},["g"])]});

const cards: string[] = [];
examples.push({ title: "Circles: derived external tangencies",
  entities: [originEntity, entity("circle", "circle"), entity("external", "point", "P"), entity("upper", "point", "T1"), entity("lower", "point", "T2"), entity("t1", "segment"), entity("t2", "segment")],
  constructions: [origin, construction("circle", { center: "origin", radius: 2 }, ["circle"]), construction("point", { x: 5, y: 1 }, ["external"]),
    construction("circle_tangency_points", { circle: "circle", externalPoint: "external" }, ["upper", "lower"]),
    construction("segment", { start: "external", end: "upper" }, ["t1"]), construction("segment", { start: "external", end: "lower" }, ["t2"])] });
examples.push({ title: "Linear algebra: composed affine shear and translation",
  entities: [entity("source", "polygon", "A"), entity("image", "polygon", "T(A)")],
  constructions: [construction("polygon", { points: [[0, 0], [2, 0], [2, 2], [0, 2]] }, ["source"]),
    construction("affine_path", { path: "source", matrix: [[1, 0.5], [0, 1]], translation: [4, 0] }, ["image"])] });
examples.push({ title: "Vector algebra: resultant and exact orthogonal projection",
  entities: [entity("a", "vector", "a"), entity("b", "vector", "b"), entity("sum", "vector", "a+b"), entity("projection", "vector", "proj")],
  constructions: [construction("vector", { start: [0, 0], end: [3, 1] }, ["a"]), construction("vector", { start: [0, 0], end: [-1, 2] }, ["b"]),
    construction("vector_sum", { vectors: ["a", "b"], origin: [0, 0] }, ["sum"]), construction("vector_projection", { vector: "sum", onto: "a", origin: [0, 0] }, ["projection"])] });
examples.push({ title: "Kinematics: exact projectile state and velocity",
  entities: [entity("trajectory", "polyline"), entity("position", "point", "P(t)"), entity("velocity", "vector", "v(t)")],
  constructions: [construction("constant_acceleration_trajectory", { initialPosition: [0, 0], initialVelocity: [3, 5], acceleration: [0, -2], tMin: 0, tMax: 5, samples: 129 }, ["trajectory"]),
    construction("trajectory_state", { trajectory: "trajectory", time: 3, kind: "position" }, ["position"]),
    construction("trajectory_state", { trajectory: "trajectory", time: 3, kind: "velocity", timeScale: 1 }, ["velocity"])] });
examples.push({ title: "Calculus: exact curve anchors, secant, and derivative",
  entities: [entity("curve", "polyline"), entity("A", "point", "A"), entity("B", "point", "B"), entity("secant", "line", "AB"), entity("derivative", "vector", "dC/dt")],
  constructions: [construction("parametric_curve", { xExpression: "t", yExpression: "t^2", tMin: -2, tMax: 2, samples: 129 }, ["curve"]),
    construction("curve_anchor", { curve: "curve", at: -1 }, ["A"]), construction("curve_anchor", { curve: "curve", at: 1.5 }, ["B"]),
    construction("curve_secant", { curve: "curve", first: -1, second: 1.5 }, ["secant"]),
    construction("curve_derivative", { curve: "curve", at: 1.5, parameterScale: 0.35 }, ["derivative"])] });
examples.push({ title: "AC circuits: computed voltage and lagging current phasors",
  entities: [entity("R", "vector"), entity("L", "vector"), entity("Z", "vector"), entity("V", "vector"), entity("I", "vector")],
  constructions: [construction("impedance", { kind: "resistor", value: 3, unit: "ohm", frequency: 4, frequencyUnit: "rad/s", displayScale: 1 }, ["R"]),
    construction("impedance", { kind: "inductor", value: 1, unit: "H", frequency: 4, frequencyUnit: "rad/s", displayScale: 1 }, ["L"]),
    construction("impedance_combine", { sources: ["R", "L"], mode: "series", displayScale: 1 }, ["Z"]),
    construction("phasor_response", { voltage: { real: 10, imaginary: 0 }, voltageUnit: "V", convention: "rms", impedance: "Z", origin: [6, 0], voltageScale: 0.5, currentScale: 4 }, ["V", "I"])] });
examples.push({ title: "Waves: analytic superposition and a computed sample",
  entities: [entity("w1", "polyline"), entity("w2", "polyline"), entity("sum", "polyline"), entity("sample", "point")],
  constructions: [construction("harmonic_wave", { amplitude: 1, waveNumber: 1, angularFrequency: 2, phase: 0, phaseUnit: "rad", time: 0.5, xMin: 0, xMax: 2 * Math.PI, samples: 257, xScale: 1.3, yScale: 0.8 }, ["w1"]),
    construction("harmonic_wave", { amplitude: 0.4, waveNumber: 2, angularFrequency: 3, phase: 0, phaseUnit: "rad", time: 0.5, xMin: 0, xMax: 2 * Math.PI, samples: 257, xScale: 1.3, yScale: 0.8 }, ["w2"]),
    construction("wave_superposition", { waves: ["w1", "w2"], samples: 257 }, ["sum"]), construction("wave_sample", { wave: "sum", x: 2 }, ["sample"])] });
examples.push({ title: "Geometric optics: Cartesian lens image and derived foci",
  entities: [originEntity, entity("axis", "line"), entity("lens", "polygon"), entity("ob", "point"), entity("ot", "point"), entity("ib", "point"), entity("it", "point"), entity("f1", "point"), entity("f2", "point"), entity("object", "vector"), entity("image", "vector")],
  constructions: [origin, construction("line", { start: [-4, 0], end: [3, 0] }, ["axis"]),
    construction("lens_section", { center: "origin", axis: "axis", radius1: 2, radius2: -2, halfHeight: 1 }, ["lens"]),
    construction("gaussian_image", { kind: "lens", center: "origin", axis: "axis", objectDistance: -30, focalLength: 10, objectHeight: 8, displayScale: 0.1, lengthUnit: "cm" }, ["ob", "ot", "ib", "it"]),
    construction("optical_focus", { kind: "lens", center: "origin", axis: "axis", focalLength: 10, displayScale: 0.1, lengthUnit: "cm" }, ["f1", "f2"]),
    construction("vector", { start: "ob", end: "ot" }, ["object"]), construction("vector", { start: "ib", end: "it" }, ["image"])] });
examples.push({ title: "Thermodynamics: isothermal expansion and exact state",
  entities: [entity("process", "polyline"), entity("state", "point")],
  constructions: [construction("polytropic_process", { pressureStart: 100, volumeStart: 2, volumeEnd: 5, exponent: 1, pressureUnit: "kPa", volumeUnit: "L", pressureScale: 0.03, volumeScale: 1, samples: 129 }, ["process"]),
    construction("process_state", { process: "process", at: 0.5 }, ["state"])] });
const setOutputs = ["A","B","C",...Array.from({length:7},(_,i)=>`region${i+1}`),"outside"];
examples.push({title:"Sets: certified Venn membership and Boolean selection",entities:[...setOutputs.map((id,i)=>entity(id,i<3?"circle":"label")),entity("selected","label")],
  constructions:[construction("set_partition",{sets:[{name:"A",count:9},{name:"B",count:8},{name:"C",count:6}],intersections:[{sets:["A","B"],count:4},{sets:["A","C"],count:3},{sets:["B","C"],count:2},{sets:["A","B","C"],count:1}],universeCount:20,displayScale:2},setOutputs),construction("set_select",{partition:"A",expression:{difference:[{union:[{set:"A"},{set:"B"}]},{set:"C"}]},at:[3,-2]},["selected"])]});
examples.push({title:"Rotation: exact radial position and acceleration components",entities:[entity("orbit","circle"),entity("motion","point"),entity("v","vector"),entity("at","vector"),entity("ac","vector")],
  constructions:[construction("circle",{center:[0,0],radius:2},["orbit"]),construction("rotational_motion",{radius:2,angle:Math.PI/6,angleUnit:"rad",angularVelocity:3,angularAcceleration:4,units:{length:"m",time:"s"},angularVelocityUnit:"rad/s",angularAccelerationUnit:"rad/s^2",origin:[0,0],displayScale:1},["motion"]),construction("rotational_state",{motion:"motion",kind:"velocity",displayLength:1.5},["v"]),construction("rotational_state",{motion:"motion",kind:"components",displayLength:1},["at","ac"])]});
examples.push({title:"Torque: source lever arm force and signed page-normal moment",entities:[entity("lever","vector","r"),entity("force","vector","F"),entity("torque","polyline")],
  constructions:[construction("vector",{start:[0,0],end:[2,1]},["lever"]),construction("vector",{start:[2,1],end:[3,4]},["force"]),construction("planar_torque",{leverArm:[2,1],force:[1,3],lengthUnit:"m",forceUnit:"N",origin:[5,2],displayLength:1},["torque"])]});
examples.push({title:"Induction: exact quadratic flux linkage and signed emf",entities:[entity("flux","polyline"),entity("state","point"),entity("emf","label")],
  constructions:[construction("flux_process",{model:"uniform_affine",B0:[0,0,0.2],fieldRate:[0,0,0.3],areaVector:[0,0,2],areaRate:[0,0,0.4],turns:5,tMin:0,tMax:4,units:{field:"T",area:"m^2",time:"s"},timeScale:5,fluxScale:0.5,samples:129},["flux"]),construction("induction_state",{process:"flux",time:2,emfAt:[12,3]},["state","emf"])]});
const permutationItems=["a","b","c","d","e"];
const permutationOutputs=[...permutationItems.map((_,i)=>`node${i}`),...permutationItems.map((_,i)=>`edge${i}`)];
examples.push({title:"Combinatorics: explicit permutation cycles",entities:permutationOutputs.map((id,i)=>entity(id,i<5?"point":"polyline")),constructions:[construction("permutation_cycles",{items:permutationItems,mapping:[1,2,0,4,3],displayScale:1},permutationOutputs)]});
const latticeOutputs=[...Array.from({length:8},(_,i)=>`subset${i}`),...Array.from({length:12},(_,i)=>`cover${i}`)];
examples.push({title:"Combinatorics: subset ranks and directed cover edges",entities:latticeOutputs.map((id,i)=>entity(id,i<8?"point":"polyline")),constructions:[construction("subset_lattice",{items:["a","b","c"],selectionRank:2,displayScale:1},latticeOutputs)]});
examples.push({title:"Elasticity: explicit linear law and source strain state",entities:[entity("profile","polyline"),entity("state","point"),entity("derivative","vector")],
  constructions:[construction("elastic_profile",{model:"linear_elastic",youngModulus:200,modulusUnit:"GPa",stressUnit:"MPa",strainMin:-0.001,strainMax:0.003,strainScale:2000,stressScale:0.01,samples:33},["profile"]),construction("elastic_state",{profile:"profile",strain:0.002,area:4,areaUnit:"mm^2",length:100,lengthUnit:"mm",uniformBar:true},["state"]),construction("curve_derivative",{curve:"profile",at:0.002,parameterScale:0.0005},["derivative"])]});
for (const [index, example] of examples.entries()) {
  const required = example.entities.filter((item) => !item.role.includes("construction helper")).map((item) => item.id);
  const document: SceneDocument = { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "Visual review of deterministic operator composition" },
    source: { question: example.title }, quantities: [], entities: example.entities, constructions: example.constructions,
    relations: [], assertions: [], annotations: [], requiredEntityIds: required,
    revealGroups: [{ id: "scene", entityIds: required, dependsOn: [], narrationCue: example.title }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "scene", dependsOn: [], narrationIntent: example.title }] };
  const compiled = compileSceneDocument(document);
  if (!compiled.ok || !compiled.renderScene) throw new Error(`${example.title}: ${JSON.stringify(compiled.report.issues)}`);
  for (const primitive of compiled.renderScene.primitives) {
    for (const point of primitive.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 400 || point.x > 1160 || point.y < 55 || point.y > 610) {
        throw new Error(`${example.title}: ${primitive.id} leaves the diagram viewport at ${JSON.stringify(point)}`);
      }
    }
  }
  const name = `${index + 1}-${example.title.split(":", 1)[0]!.toLowerCase().replaceAll(" ", "-")}`;
  writeFileSync(join(out, `${name}.svg`), renderSceneSvg(compiled.renderScene, { title: example.title, guides: true }));
  writeFileSync(join(out, `${name}.json`), JSON.stringify({ document, ...compiled }, null, 2));
  cards.push(`<article><h2>${example.title}</h2><img src="${name}.svg" alt="${example.title}"></article>`);
}
writeFileSync(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Reusable operator visual review</title><style>body{font:16px system-ui;background:#eceff2;color:#18232f;margin:24px}h1{font-size:24px}h2{font-size:17px}article{background:white;padding:16px;margin:20px auto;max-width:1200px;border-radius:10px}img{width:100%;height:auto}</style><h1>Reusable operator visual review</h1>${cards.join("\n")}`);
console.log(`Rendered ${examples.length} verified operator compositions to ${out}`);
