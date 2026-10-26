import { strict as assert } from "node:assert";
import { detectArchetype } from "../../src/archetypes/detect";
import { synthesizeArchetypeScene } from "../../src/archetypes";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";

// Two fallbacks drew a wrong figure whenever the planner's own figure was
// refused. A rotating loop got the sliding rod on rails, because "induced
// emf" and a Faraday law hint cleared the rod's bar with no rod in the stem.
// A stem that asks for a v-t graph got a particle on a line from the contact
// family. Both now decline; stems that state their rod, or ask for no graph,
// keep their figure. With the rod gone, the loop fell to the magnet and coil
// figure, which is no generator either, so that declines a turning loop too.
// Past both, the last resort drew three resistors in parallel, because its
// circuit test read "induced emf" as circuit apparatus.

let checks = 0;
const check = (name: string, run: () => void) => {
  run();
  checks += 1;
  void name;
};

const faraday = { turnPlan: { lawIds: ["faraday_law"] } };
for (const question of [
  "A conducting loop rotates steadily in a uniform magnetic field. Sketch the flux and the induced emf against time.",
  "A coil of 50 turns rotates at 10 rev/s in a 0.2 T magnetic field. Find the peak induced emf.",
]) {
  check(`no rod: ${question}`, () => {
    assert.notEqual(detectArchetype(question, faraday)?.id, "motional_emf_rod", `${question}: a loop is not a rod on rails`);
    assert.notEqual(detectArchetype(question, { ...faraday, plannerArchetype: "motional_emf_rod" })?.id, "motional_emf_rod",
      `${question}: the planner's rod claim needs a rod in the stem too`);
  });
  check(`turning loop: ${question}`, () => {
    for (const hints of [faraday, { ...faraday, plannerArchetype: "faraday_induction" }]) {
      assert.notEqual(detectArchetype(question, hints)?.id, "faraday_induction", `${question}: a turning loop is not a magnet pushed into a coil`);
    }
  });
}
// A straight conductor moving through the field keeps the rod, however the
// stem names it, and an induced emf alone never draws the magnet and coil.
for (const question of [
  "A conducting rod of length 0.5 m moves at 4 m/s on rails perpendicular to a 0.2 T magnetic field. Find the motional emf.",
  "A metal bar slides at 3 m/s along two rails 0.4 m apart in a 0.5 T magnetic field. Find the induced emf.",
  "A wire of length 20 cm moves at 5 m/s perpendicular to a 0.5 T magnetic field. Find the induced emf.",
  "A wire PQ of length 0.3 m slides at 2 m/s on a U-shaped frame in a 0.4 T magnetic field. Find the induced emf.",
  "A conductor of length l moves with velocity v perpendicular to a uniform magnetic field B. Derive the motional emf.",
  "The axle of a train 1.5 m long moves at 20 m/s through the vertical component of the earth's magnetic field. Find the induced emf.",
  "The movable arm of a rectangular frame is 0.25 m long and moves at 3 m/s in a 0.5 T magnetic field. Find the induced emf.",
]) {
  check(`rod: ${question}`, () => {
    assert.equal(detectArchetype(question, faraday)?.id, "motional_emf_rod", `${question}: a stated conductor keeps its figure`);
    assert.notEqual(detectArchetype(question, { ...faraday, plannerArchetype: "faraday_induction" })?.id, "faraday_induction",
      `${question}: a moving conductor is not a magnet pushed into a coil`);
  });
}
// What is not a sliding conductor: a magnet pushed into a coil, and a rod
// turning about one end.
for (const [question, claim] of [
  ["A bar magnet moving towards a coil induces an emf. Find the induced emf.", undefined],
  ["A coil of 200 turns is held fixed and a bar magnet is pushed into it. Find the induced emf.", "motional_emf_rod"],
  ["A magnet is pushed into a coil joined by copper wires to a galvanometer. Find the induced emf.", "motional_emf_rod"],
  ["A coil of wire of 100 turns and area 0.02 m^2 moves at 2 m/s into a 0.5 T magnetic field. Find the induced emf.", "motional_emf_rod"],
  ["A rod of length 1 m rotates about one end at 10 rad/s in a 0.2 T magnetic field perpendicular to its plane. Find the induced emf.", undefined],
] as const) {
  check(`not a sliding rod: ${question}`, () => {
    assert.notEqual(detectArchetype(question, { ...faraday, plannerArchetype: claim })?.id, "motional_emf_rod", `${question}: no sliding rod`);
  });
}

check("no stand-in circuit for a turning loop", () => {
  for (const question of [
    "A conducting loop rotates steadily in a uniform magnetic field. Sketch the flux and the induced emf against time.",
    "A loop rotates in a uniform magnetic field. Plot the flux and the induced emf against time, and relate a flux extremum to the emf.",
  ]) {
    assert.equal(synthesizeLastResortScene({ question, families: ["circuit_network"] })?.family, undefined,
      `${question}: an induced emf is not circuit apparatus, so no stock resistor network`);
  }
  const source = "A source of emf E is connected to a load. Sketch the arrangement.";
  assert.equal(synthesizeLastResortScene({ question: source, families: ["circuit_network"] })?.family, "circuit_network",
    "a source of emf in a circuit keeps its schematic");
});

const lenz = "Explain induced emf and current and Lenz's law.";
check("magnet and coil", () => {
  const question = "A bar magnet is pushed into a coil connected to a galvanometer. Use Lenz's law to find the direction of the induced current.";
  assert.equal(detectArchetype(question, faraday)?.id, "faraday_induction", "a magnet pushed into a coil keeps its figure");
  assert.equal(detectArchetype(lenz, faraday)?.id, "faraday_induction", "a bare Lenz's law stem gets the magnet and coil, not the rod");
});
check("no stray pole letter", () => {
  const scene = synthesizeArchetypeScene({ question: lenz, turnPlan: { schemaVersion: "turn-plan/v3", question: lenz } as never });
  assert.equal(scene?.archetype, "faraday_induction", "the Lenz stem draws the magnet and coil");
  const texts = scene!.renderScene.primitives.map((primitive) => primitive.text).filter(Boolean);
  assert.deepEqual(texts.filter((text) => text === "V"), [], `the magnet's front is not a mirror pole: ${texts.join(" | ")}`);
});

const contactFamily = (question: string) => synthesizeFamilyScene({ question, families: ["contact_body"] });
for (const question of [
  "A v-t graph goes linearly from (0, 0) to (2.0 s, 8 m/s), then linearly back to (6.0 s, 0). Find the displacement and the average velocity.",
  "Draw the velocity-time graph of a car that starts from rest with constant acceleration 2 m/s^2 for 5 s.",
  "Sketch the position-time graph for a cyclist whose average speed is 5 m/s.",
]) {
  check(`motion graph: ${question}`, () => {
    assert.notEqual(contactFamily(question)?.family, "contact_body", `${question}: a motion graph stem gets no contact sketch`);
  });
}
check("no graph asked", () => {
  const question = "A cyclist makes a round trip of 4 km in 20 minutes. Find the average speed and the average velocity.";
  assert.equal(contactFamily(question)?.family, "contact_body", "a kinematics stem that asks for no graph keeps its sketch");
});

console.log(`verify-decline-wrong-fallbacks: ${checks} checks passed`);
