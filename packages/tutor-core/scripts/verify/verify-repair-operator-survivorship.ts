/**
 * A repair that keeps a required vector's id and its constructing operator
 * keeps the vector. Survivorship used to accept a vector only from the
 * vector/trajectory operators, so a surface_contact incident ray whose aim
 * point the repair moved was "lost", every repaired optics candidate was
 * marked invalid and a required light-ray figure ended retry_required.
 *
 *   tsx scripts/verify/verify-repair-operator-survivorship.ts
 *
 *   kept      same id and operator, new inputs: no loss.
 *   lost      vector deleted; vector moved to another output of the same
 *             operator; a trajectory velocity repaired into an acceleration.
 */
import assert from "node:assert/strict";
import { validateRepairSurvivorship } from "@heytutor/scene-engine";

type Doc = Record<string, unknown>;

function optics(aim: { x: number; y: number }, edit: (doc: Doc) => void = () => {}): Doc {
  const doc: Doc = {
    schemaVersion: "scene-document/v2",
    entities: [
      { id: "boundary", kind: "line", role: "boundary between the two media" },
      { id: "source", kind: "point", role: "light source" },
      { id: "aim", kind: "point", role: "aim point" },
      { id: "contact", kind: "point", role: "point where the ray meets the boundary" },
      { id: "incident", kind: "vector", role: "incident ray" },
      { id: "reflected", kind: "ray", role: "reflected ray" },
    ],
    constructions: [
      { id: "c_boundary", operator: "line", inputs: { through: [{ x: 400, y: 400 }, { x: 1100, y: 400 }] }, outputs: ["boundary"] },
      { id: "c_source", operator: "point", inputs: { x: 520, y: 200 }, outputs: ["source"] },
      { id: "c_aim", operator: "point", inputs: aim, outputs: ["aim"] },
      { id: "c_contact", operator: "surface_contact", inputs: { origin: "source", toward: "aim", surface: "boundary" }, outputs: ["contact", "incident"] },
      { id: "c_reflect", operator: "reflect_at", inputs: { ray: "incident", surface: "boundary" }, outputs: ["reflected"] },
    ],
    requiredEntityIds: ["boundary", "contact", "incident", "reflected"],
  };
  edit(doc);
  return doc;
}

function motion(kind: "velocity" | "acceleration"): Doc {
  return {
    schemaVersion: "scene-document/v2",
    entities: [
      { id: "path", kind: "curve", role: "trajectory" },
      { id: "v", kind: "vector", role: "state vector at the top" },
    ],
    constructions: [
      { id: "c_path", operator: "projectile_trajectory", inputs: { speed: "u", angle: "theta" }, outputs: ["path"] },
      { id: "c_v", operator: "trajectory_state", inputs: { path: "path", at: "apex", kind }, outputs: ["v"] },
    ],
    requiredEntityIds: ["path", "v"],
  };
}

const lostIds = (seed: Doc, repaired: Doc) =>
  validateRepairSurvivorship(seed, repaired).flatMap((issue) => issue.entityIds ?? []);

const seed = optics({ x: 700, y: 400 });

assert.deepEqual(lostIds(seed, optics({ x: 760, y: 400 })), [],
  "kept: a surface_contact vector with the same id and operator survives a moved aim point");

assert.deepEqual(lostIds(seed, optics({ x: 760, y: 400 }, (doc) => {
  doc.entities = (doc.entities as Doc[]).filter((entity) => entity.id !== "incident");
  (doc.constructions as Doc[]).find((c) => c.id === "c_contact")!.outputs = ["contact"];
})), ["incident"], "lost: a deleted required vector");

assert.ok(lostIds(seed, optics({ x: 760, y: 400 }, (doc) => {
  (doc.constructions as Doc[]).find((c) => c.id === "c_contact")!.outputs = ["incident", "contact"];
})).includes("incident"), "lost: the vector id now names a different output of the same operator");

assert.deepEqual(lostIds(motion("velocity"), motion("velocity")), [], "kept: an unchanged trajectory state vector");
assert.deepEqual(lostIds(motion("velocity"), motion("acceleration")), ["v"],
  "lost: the same operator cannot turn a velocity into an acceleration");

console.log("repair operator survivorship: ok (kept=2, lost=3)");
