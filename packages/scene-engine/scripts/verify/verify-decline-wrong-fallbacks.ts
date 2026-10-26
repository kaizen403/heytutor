import { strict as assert } from "node:assert";
import { detectArchetype } from "../../src/archetypes/detect";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";

// Two fallbacks drew a wrong figure whenever the planner's own figure was
// refused. A rotating loop got the sliding rod on rails, because "induced
// emf" and a Faraday law hint cleared the rod's bar with no rod in the stem.
// A stem that asks for a v-t graph got a particle on a line from the contact
// family. Both now decline; stems that state their rod, or ask for no graph,
// keep their figure.

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
}
for (const question of [
  "A conducting rod of length 0.5 m moves at 4 m/s on rails perpendicular to a 0.2 T magnetic field. Find the motional emf.",
  "A metal bar slides at 3 m/s along two rails 0.4 m apart in a 0.5 T magnetic field. Find the induced emf.",
]) {
  check(`rod: ${question}`, () => {
    assert.equal(detectArchetype(question, faraday)?.id, "motional_emf_rod", `${question}: a stated rod keeps its figure`);
  });
}

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
