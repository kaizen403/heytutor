import assert from "node:assert/strict";
import { attemptArchetypeScene, rankArchetypes } from "../../src/archetypes";

// A generic adjective supplies no physical wave or boundary condition.
for (const question of ["Explain the fundamental rules of counting.", "Teach the fundamental theorem of arithmetic.", "Describe fundamental principles of logic."]) {
  assert(!rankArchetypes(question).some(a => a.id === "standing_wave"), "fundamental alone must not request a wave figure");
  assert(!attemptArchetypeScene({ question }).scene, "a maths concept cannot acquire stock physical wave ink");
}
for (const question of ["Draw a standing wave on a string fixed at both ends.", "Show the fundamental mode of a string fixed at both ends.", "Show the fundamental frequency of an open pipe."]) {
  assert(rankArchetypes(question).some(a => a.id === "standing_wave"), "explicit physical wave evidence stays supported");
  assert(attemptArchetypeScene({ question }).scene);
}
console.log("recovery weak wave cue: adjective-only refusals and physical controls passed");
