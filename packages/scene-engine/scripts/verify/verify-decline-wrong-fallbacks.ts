import { strict as assert } from "node:assert";
import { contradictedMagnetCoil, detectArchetype } from "../../src/archetypes/detect";
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
  const question = "A bar magnet is pushed into a coil connected to a galvanometer. Use Lenz's law to explain the deflection.";
  assert.equal(detectArchetype(question, faraday)?.id, "faraday_induction", "a magnet pushed into a coil keeps its figure");
  assert.equal(detectArchetype(lenz, faraday)?.id, "faraday_induction", "a bare Lenz's law stem gets the magnet and coil, not the rod");
});
// The figure draws no winding, so it cannot show which way the induced
// current flows: a stem that asks for that direction gets no figure.
for (const question of [
  "A bar magnet is pushed into a coil connected to a galvanometer. Use Lenz's law to find the direction of the induced current.",
  "Show a north pole approaching a conducting circular loop along its axis. Label the approaching motion and the induced current direction as viewed from the magnet side.",
  "A north pole is moved towards a coil. Is the induced current clockwise or anticlockwise as seen from the magnet?",
]) {
  check(`direction asked: ${question}`, () => {
    for (const hints of [faraday, { ...faraday, plannerArchetype: "faraday_induction" }]) {
      assert.notEqual(detectArchetype(question, hints)?.id, "faraday_induction", `${question}: the figure does not derive the current's direction`);
    }
  });
}
// The figure draws a north pole moving towards a coil that stays put. A stem
// that contradicts any of that, or names another induction setup, gets no
// magnet and coil; a magnet dropped through a coil is no free fall either.
for (const question of [
  "The south pole of a bar magnet is pushed into a coil connected to a galvanometer. Explain what happens using Lenz's law.",
  "Explain electromagnetic induction when the S pole of a magnet approaches a coil.",
  "A bar magnet is pulled out of a coil connected to a galvanometer. Explain the deflection using Faraday's law.",
  "Explain what happens when a magnet is withdrawn from a coil. Use Lenz's law.",
  "A magnet is moved away from a coil. Explain Lenz's law.",
  "A magnet is held stationary inside a coil. Explain why no current is induced (Faraday's law).",
  "A coil is moved towards a stationary bar magnet. Explain the induced emf using Faraday's law.",
  "A magnet is kept stationary inside a coil. Explain electromagnetic induction using Faraday's law.",
  "A magnet placed inside a coil is stationary. Explain why no emf is induced using Faraday's law.",
  "Two coils are placed side by side; switching on the current in one induces a current in the other. Explain Faraday's law.",
  "Explain the working of an electric generator using Faraday's law.",
  "Explain eddy currents and Lenz's law.",
  "A conducting rod slides on rails in a magnetic field. Explain the induced emf and Lenz's law.",
]) {
  check(`contradicts the magnet and coil: ${question}`, () => {
    for (const hints of [faraday, { ...faraday, plannerArchetype: "faraday_induction" }]) {
      assert.notEqual(detectArchetype(question, hints)?.id, "faraday_induction", `${question}: the figure would contradict the stem`);
    }
  });
}
// Turning in words as well as rotating, and a bar as well as a rod: neither
// planner claim may draw a translating figure for it, while a coil "of 50
// turns" is a count, not a motion.
check("a turning coil or bar", () => {
  for (const [question, claim] of [
    ["A coil turns in a magnetic field. Find the induced emf.", "faraday_induction"],
    ["A metal bar rotates in a uniform magnetic field. Find the induced emf.", "motional_emf_rod"],
    ["A coil of area 0.2 m^2 rotates at 10 rad/s in a uniform magnetic field. Find the peak induced emf.", "faraday_induction"],
  ] as const) {
    assert.notEqual(detectArchetype(question, { ...faraday, plannerArchetype: claim })?.id, claim, `${question}: a turning conductor is not ${claim}`);
  }
  const counted = "A bar magnet is pushed into a coil of 50 turns connected to a galvanometer. Use Lenz's law to explain the deflection.";
  assert.equal(detectArchetype(counted, faraday)?.id, "faraday_induction", "a coil of 50 turns does not turn");
});
// A current direction the stem gives is not one it asks: the solenoid keeps
// its figure. A magnet and coil with a resistor gets no resistor network.
check("given current direction keeps the solenoid", () => {
  const question = "A solenoid of 600 turns and cross-sectional area 3.0 cm^2 carries 0.50 A, flowing clockwise as seen from one end. Draw its field.";
  assert.equal(detectArchetype(question, {})?.id, "solenoid_field", "a given clockwise current is not an asked direction");
});
check("no resistor network for an induction setup", () => {
  const question = "A magnet moves toward a closed coil connected to a resistor, then moves away along the same axis. Draw both stages.";
  for (const hints of [faraday, { ...faraday, plannerArchetype: "resistor_network" }]) {
    assert.notEqual(detectArchetype(question, hints)?.id, "resistor_network", "a resistor circuit without its magnet stands in for the setup");
  }
});
// A magnet and coil stem that contradicts the figure declines whole: a veto
// alone handed it to the next figure, a block on a surface or a bare magnet.
for (const question of [
  "A magnet is pushed towards a coil. Which way does the induced current flow?",
  "The south pole of a magnet is pushed into a coil. Explain using Lenz's law.",
  "A magnet is pulled out of a coil quickly. Explain the galvanometer deflection.",
  "Lenz's law tells us the direction of induced current. Explain with a magnet pushed into a coil.",
  "A bar magnet is pushed into a coil. Use Lenz's law to find the direction of the induced current.",
  "A magnet is pulled out of a ring. Explain why the ring moves.",
  "A magnet is pushed towards a ring. Which way does the current flow in the ring?",
  "The south pole of a magnet is pushed towards a ring of wire. Explain.",
  "A magnet is pushed through a ring of wire. Which way does the current flow?",
]) {
  check(`contradicted magnet and coil declines whole: ${question}`, () => {
    for (const hints of [{}, faraday, { ...faraday, plannerArchetype: "faraday_induction" }, { ...faraday, plannerArchetype: "blocks_contact" }, { ...faraday, plannerArchetype: "bar_magnet" }]) {
      assert.equal(detectArchetype(question, hints)?.id, undefined, `${question}: no archetype stands in`);
    }
    assert.equal(synthesizeFamilyScene({ question })?.family, undefined, `${question}: no family stands in`);
    assert.equal(synthesizeLastResortScene({ question })?.family, undefined, `${question}: no last resort stands in`);
  });
}
// The figure's own setup keeps it, however the stem words the motion or the
// induced pole; a magnet dropped from a height is still free fall.
for (const question of [
  "A bar magnet moving towards a coil induces an emf. Explain using Faraday's law.",
  "A bar magnet is moved slowly into a coil; then it is moved quickly. Compare the induced emf using Faraday's law.",
  "When the N pole of a magnet approaches a coil, does the near face of the coil become a north or a south pole? Explain with Lenz's law.",
  "A magnet is pushed into a stationary coil connected to a galvanometer. Draw the setup using Faraday's law.",
  "A magnet is pushed into a coil and the needle moves. Explain using Faraday's law.",
]) {
  check(`magnet and coil kept: ${question}`, () => {
    assert.equal(detectArchetype(question, faraday)?.id, "faraday_induction", `${question}: the stem is the figure's own setup`);
  });
}
// A plain bar magnet question names no induction setup: a stationary magnet
// or a south pole there is no contradiction, and its own figure stays.
for (const question of [
  "Draw the magnetic field lines around a stationary bar magnet.",
  "A bar magnet of moment 2 A m^2 is held at rest in a uniform field of 0.5 T at 30 degrees. Find the torque on it.",
  "A bar magnet is placed in a uniform field. The south pole faces north. Find the torque.",
  "A bar magnet is held stationary at the centre of a ring of plotting compasses. Draw the compass directions.",
  "A stationary bar magnet induces magnetism in a nearby iron nail. Explain.",
]) {
  check(`plain bar magnet keeps its figure: ${question}`, () => {
    assert.equal(contradictedMagnetCoil(question), false, `${question}: names no coil or induction`);
  });
}
for (const question of [
  "A coil is pushed to the right while a magnet is pushed left towards it. Explain the induced emf.",
  "A coil connected to a galvanometer is moved towards a magnet. Explain the deflection.",
]) {
  check(`moving coil: ${question}`, () => {
    assert.equal(detectArchetype(question, faraday)?.id, undefined, `${question}: the figure keeps the coil still`);
  });
}
check("no stand-in circuit for a turning bar", () => {
  const question = "A metal bar of length 1 m rotates about one end in a field of 0.4 T at 10 rad/s. Find the emf.";
  assert.notEqual(synthesizeLastResortScene({ question, families: ["circuit_network"] })?.family, "circuit_network", "a conductor's emf in a field is not circuit apparatus");
  for (const stem of [question, "A copper rod 0.5 m long rotates about one end at 20 rad/s in a 0.3 T field. Find the emf."]) {
    assert.equal(synthesizeLastResortScene({ question: stem })?.family, undefined, `${stem}: no contact sketch with its pivot at the centre`);
    assert.equal(synthesizeFamilyScene({ question: stem, families: ["contact_body"] })?.family, undefined, `${stem}: no contact sketch for an emf`);
  }
});
check("a rod swinging about a pivot", () => {
  const question = "A metal rod pivoted at one end swings like a pendulum in a magnetic field. Find the emf between its ends.";
  assert.notEqual(detectArchetype(question, { ...faraday, plannerArchetype: "motional_emf_rod" })?.id, "motional_emf_rod", "a swinging rod is no sliding rod");
  assert.notEqual(synthesizeLastResortScene({ question })?.family, "circuit_network", "its emf is no circuit");
});
check("no block for a magnet and ring", () => {
  const question = "A magnet is pushed into a ring and an emf appears. Explain.";
  for (const hints of [{}, { ...faraday, plannerArchetype: "blocks_contact" }]) {
    assert.notEqual(detectArchetype(question, hints)?.id, "blocks_contact", "a magnet and ring is no block on a surface");
  }
});
check("a magnet dropped from a height", () => {
  assert.notEqual(detectArchetype("A bar magnet is dropped from a height of 5 m. How long does it take to reach the ground?", {})?.id, "bar_magnet",
    "a falling magnet with no coil is a free fall question, not a field picture");
});
check("coils offered beside a rod keep the magnet and coil", () => {
  const question = "Draw Electromagnetic induction and Faraday's law. Show the coils or the rod-and-rails setup named in the topic.";
  assert.equal(detectArchetype(question, {})?.id, "faraday_induction", "a stem that offers the coils may draw them");
});
check("a falling magnet is no free fall", () => {
  const question = "A magnet is dropped through a coil. Explain the induced emf.";
  assert.notEqual(detectArchetype(question, {})?.id, "free_fall", "a magnet dropped through a coil gets no falling ball");
});
check("no guessed winding current", () => {
  const question = "Use Lenz's law to find the direction of current induced in a solenoid when a magnet approaches.";
  for (const hints of [faraday, { ...faraday, plannerArchetype: "solenoid_field" }]) {
    assert.notEqual(detectArchetype(question, hints)?.id, "solenoid_field", "the solenoid figure would guess the induced current's direction");
  }
});
check("magnet and coil marks", () => {
  const scene = synthesizeArchetypeScene({ question: lenz, turnPlan: { schemaVersion: "turn-plan/v3", question: lenz } as never });
  assert.equal(scene?.archetype, "faraday_induction", "the Lenz stem draws the magnet and coil");
  const texts = scene!.renderScene.primitives.filter((primitive) => primitive.text);
  const at = (text: string) => texts.filter((primitive) => primitive.text === text);
  assert.deepEqual(at("I"), [], "no induced current arrow the figure cannot derive");
  assert.equal(scene!.document.annotations?.some((annotation: { kind: string }) => annotation.kind === "sense") ?? false, false, "no current sense on the coil");
  assert.equal(at("N").length, 1, "N labels its own end");
  assert.equal(at("S").length, 1, "S labels its own end");
  assert.ok(at("S")[0]!.points![0]!.x < at("N")[0]!.points![0]!.x, "S on the far end, N on the face towards the coil");
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
