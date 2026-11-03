/**
 * The reference picture tier declines a stock picture for a question that
 * carries its own figure. The guard used to read only the cheap model's topic,
 * so "projectile motion" or "concave mirror image" with the student's own
 * speeds or distances got a stock picture with other numbers. It now also
 * reads the question: its figure words, and a motion, circular motion,
 * projectile, incline, lens or mirror setup that states a measured value.
 * Concept asks with no measured value keep their picture. Synthetic stems.
 */
import { questionSpecificFigure } from "../../lib/reference-picture/pictureQuery";

let failed = 0;
let passed = 0;
const expect = (want: boolean, question: string, mustShow: string, why: string) => {
  if (questionSpecificFigure(question, mustShow) === want) passed += 1;
  else { failed += 1; console.error(`FAIL (${want ? "should decline" : "should keep"}) ${why}: ${question} | ${mustShow}`); }
};

// A stated value in one of these setups: the topic lacks the figure word.
for (const [question, mustShow] of [
  ["A ball is projected at 20 m/s at 30° to the horizontal. Find the maximum height.", "ball thrown at an angle"],
  ["A stone is thrown horizontally at 15 m/s from a 45 m high cliff. Find where it lands.", "projectile from a cliff"],
  ["A car of mass 1000 kg goes round a curve of radius 50 m at 20 m/s. Find the centripetal force.", "car on a curved road"],
  ["A stone tied to a 1 m string is whirled in a horizontal circle at 4 m/s.", "uniform circular motion"],
  ["A cyclist rides round a circular track of radius 20 m at 5 m/s.", "cyclist on a track"],
  ["A banked road of radius 100 m is designed for 15 m/s.", "banked curve"],
  ["A block of 5 kg slides down a 30° incline. Find its acceleration.", "block sliding down"],
  ["A 2 kg box rests on a ramp at 25 degrees.", "box at rest"],
  ["An object is placed 20 cm from a convex lens of focal length 10 cm. Find the image.", "image formation by convex lens"],
  ["A concave mirror has focal length 15 cm. An object sits 30 cm in front of it.", "concave mirror image"],
  ["A lens of power +2.5 D forms an image. Find the focal length.", "converging lens"],
  ["A lens of power 4 D is used as a magnifier.", "magnifying glass"],
  ["An object 5 cm tall is placed 12 cm from a concave lens.", "diverging lens"],
  ["A plane mirror is 2 m from a person. How far away is the image?", "reflection in a plane mirror"],
  ["A car accelerates from 10 m/s to 30 m/s in 5 s.", "car on a road"],
  ["A train moving at a speed of 72 km/h stops in 200 m.", "train braking"],
  ["A bus decelerates uniformly at 2 m/s^2 for 6 s.", "bus slowing down"],
  ["A body falls from 80 m. Find its velocity on reaching the ground.", "falling body"],
  ["A ball is dropped from 20 m. Ignore air resistance.", "free fall of a ball"],
  ["A projectile is launched with a speed of 50 m s^-1.", "launch of a ball"],
  ["A particle moves with velocity 2.5m/s for 4 s.", "particle on a line"],
  // Motion described by its verb, with a topic that names no setup word.
  ["A ball is dropped from 20 m. Find the time to reach the ground.", "falling ball"],
  ["A boat crosses a 100 m wide river at 4 m/s while the water flows at 3 m/s.", "boat crossing a river"],
  ["A stone is thrown up with 15 m/s. Find the maximum height.", "stone thrown upward"],
  ["A sphere rolls down a 2 m long track without slipping.", "rolling sphere"],
  // Pasted LaTeX keeps its values.
  ["An object is placed $20\\,\\text{cm}$ from a convex lens of focal length $10\\,\\text{cm}$.", "image formation by convex lens"],
  ["A ball is projected at $30^\\circ$ with $20\\,\\mathrm{m\\,s^{-1}}$.", "ball thrown at an angle"],
]) expect(true, question, mustShow, "a measured setup is the question's own figure");

// The question names its own figure, whatever topic the model wrote.
for (const [question, mustShow] of [
  ["Plot the distance against time for 2 s, 4 s and 6 s.", "motion of a car"],
  ["Draw the circuit with a 6 V battery and two 3 ohm resistors.", "resistors in series"],
  ["Draw the free body diagram of a 4 kg block pulled by 10 N.", "block on a table"],
  // Pinned: a digit beside a figure word declines, even a class number.
  ["Draw the circuit of a class 10 practical.", "electric circuit"],
]) expect(true, question, mustShow, "a figure word in the question with a number");

// Today's arm, unchanged.
expect(true, "A car goes from 10 m/s to 30 m/s in 5 s. Draw its v-t graph", "velocity-time graph", "a graph of the question's own numbers");

// Concept asks keep their picture: no measured value, or a number that is a count.
for (const [question, mustShow] of [
  ["Explain Newton's 3 laws of motion.", "Newton's laws of motion"],
  ["Explain the 5 kingdoms of classification.", "five kingdom classification"],
  ["Describe the 3 germ layers.", "germ layers of an embryo"],
  ["How does a convex lens form an image?", "image formation by convex lens"],
  ["Show a 3D view of a convex lens.", "convex lens"],
  ["Draw a 2D diagram of a concave mirror.", "concave mirror"],
  ["What is the difference between speed and velocity?", "speed and velocity"],
  ["Explain the structure of the 4 chambers of the heart.", "chambers of the human heart"],
  ["Write a 10 marks answer on photosynthesis.", "process of photosynthesis"],
  ["Explain the 2 gametes in fertilisation.", "fertilisation"],
  ["Describe the human eye and the role of its lens.", "structure of the human eye"],
  ["How does a periscope use 2 mirrors?", "periscope"],
  ["Explain the uses of concave mirrors in 3 everyday devices.", "uses of concave mirrors"],
  ["Explain how a speed camera works.", "speed camera"],
  ["Describe 3 types of inclined planes used as simple machines.", "inclined plane simple machine"],
  ["Explain the 4 stroke petrol engine.", "four stroke engine"],
  ["Explain projectile motion.", "projectile motion"],
  ["Explain centripetal force with 2 examples.", "centripetal force"],
  ["Label the 3 sides of a triangular glass prism.", "triangular prism"],
  ["Explain the apparatus for simple distillation.", "apparatus for simple distillation"],
  ["Why do leaves fall from trees in autumn?", "leaf fall in autumn"],
  ["Draw the cross section of a dicot stem 2 mm across.", "cross section of a dicot stem"],
  ["How do fish swim?", "fish swimming"],
  ["Draw the V-I characteristic of a p-n junction diode", "V-I characteristic graph of a diode"],
]) expect(false, question, mustShow, "a concept ask keeps its picture");

console.log(`verify-picture-value-guard: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
