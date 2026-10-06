import assert from "node:assert/strict";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import { resolveVisualRequirement } from "../../features/tutor-session/lib/scene/visualRequirement";
const questions = [
 "A car moving at 20 m/s brakes uniformly at 2 m/s^2 until it comes to rest. Find the time taken and the distance travelled.",
 "A body starts from rest and accelerates uniformly at 2 m/s^2 for 5 s. Find the displacement.",
 "A cart moving at 4 m/s accelerates uniformly at 1/2 m/s^2 for 4 s. Find its final velocity.",
 "Find the point P dividing the join of A(1,2) and B(4,5) externally in the ratio 2:1.",
 "Find the distance of P(0,0) from 3x+4y-25=0.",
 "A 10 ohm resistor is connected to a 5 V cell. Find the current through the resistor.",
 "A 8 ohm resistor and a 7 ohm resistor are connected in series across a 30 V cell. Find the equivalent resistance and total current.",
 "A 6 ohm resistor and a 9 ohm resistor are connected in parallel across a 18 V cell. Find the equivalent resistance and total current.",
 "A ladder of length 13 m leans against a vertical wall. Its foot is 5 m from the wall on a horizontal floor. Find the height reached.",
 "A ladder of length 10 m leans against a vertical wall. Its top is 8 m above the horizontal floor. Find the foot distance.",
];
for (const question of questions) {
 const caps=inferSceneCapabilities(question,{turnPlan:{visualRequirement:"none"}});
 assert.equal(caps.hasSourceProgram,true,question);
 assert.ok(caps.constructionOperators.length);
 assert.equal(resolveVisualRequirement("none",null,false,caps.hasSourceProgram),"optional");
 assert.equal(resolveVisualRequirement("none","none",false,caps.hasSourceProgram),"none");
 assert.equal(resolveVisualRequirement("required",null,false,caps.hasSourceProgram),"required");
}
for (const question of ["What is the capital of France?","Find the distance of P(0,0) from x+y=1. If the point moves, find its speed.",
 "A ladder of length 13 m leans against a vertical wall. Its foot is 5 m from the wall on a horizontal floor. Find the height reached. The wall is tilted.",
 "A 10 ohm resistor is connected to a 5 V cell. The resistor is shorted by a wire. Find the current through the resistor."])
 assert.notEqual(inferSceneCapabilities(question).hasSourceProgram,true,question);
console.log("W2 source availability: 10 source programs, null visual-need fallback and 4 unsupported controls passed (offline)");
