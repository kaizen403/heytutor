import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";

const question = "For an exothermic reaction the activation energy of the forward reaction is 60 kJ/mol and ΔH = −20 kJ/mol. Draw the energy profile diagram.";
const candidate = buildThermoGraphScene(question, [], false)!;
const document = validateSceneDocument(pruneDeadSceneEntities(candidate as unknown as Record<string, unknown>)).document!;
const compiled = compileSceneDocument(document);
if (!compiled.ok || !compiled.renderScene) throw new Error(`energy marks failed: ${JSON.stringify(compiled.report.issues)}`);
const primitives = compiled.renderScene.primitives;
const bar = primitives.find((p) => p.entityId === "dh_dim" && p.kind === "dimension")!;
const product = primitives.find((p) => p.entityId === "product_level" && p.kind === "line")!;
const measured = bar.provenance?.measuredEnd as { x: number; y: number };
if (!product.points.some((p) => Math.hypot(p.x - measured.x, p.y - measured.y) < 0.02)) throw new Error("enthalpy dimension must meet the actual product level endpoint");
const activation = primitives.find((p) => p.entityId === "ea_dim" && p.kind === "dimension")!;
const peak = primitives.find((p) => p.entityId === "ts_point_1" && p.kind === "point")!.points[0]!;
const activationTop = activation.provenance?.measuredEnd as { x: number; y: number };
if (Math.hypot(peak.x - activationTop.x, peak.y - activationTop.y) > 0.02) throw new Error("activation energy must terminate exactly at its transition state peak");
console.log("verify-energy-measurement-anchors: enthalpy marks the actual level endpoint and clears the energy profile");
