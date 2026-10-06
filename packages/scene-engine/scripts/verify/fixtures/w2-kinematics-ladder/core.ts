// Independent hand oracles: values are literal, never obtained from the implementation.
export const suvatCases = [
  { id: "braking", question: "A train moving at 20 m/s applies brakes and decelerates uniformly at 2 m/s^2 until it stops. Find the stopping time and distance.", expected: { u: 20, v: 0, a: -2, t: 10, s: 100 } },
  { id: "accelerating", question: "A car moving with initial velocity 2 m/s accelerates uniformly at 4 m/s^2 for 3 s. Find the final velocity and displacement.", expected: { u: 2, v: 14, a: 4, t: 3, s: 24 } },
  { id: "from_rest", question: "A body starts from rest and accelerates uniformly at 2 m/s^2 for 5 s. Find the displacement.", expected: { u: 0, v: 10, a: 2, t: 5, s: 25 } },
  { id: "metric_conversion", question: "A car accelerates uniformly from 36 km/h to 72 km/h in 5 s on a straight road. Find acceleration and distance.", expected: { u: 10, v: 20, a: 2, t: 5, s: 75 } },
  { id: "fraction", question: "A cart moving at 4 m/s accelerates uniformly at 1/2 m/s^2 for 4 s. Find its final velocity.", expected: { u: 4, v: 6, a: 0.5, t: 4, s: 20 } },
];
export const ladderCases = [
  { id: "foot_distance", question: "A ladder of length 13 m leans against a vertical wall. Its foot is 5 m from the wall on a horizontal floor. Find the height reached.", length: 13, distance: 5, height: 12, side: 1 },
  { id: "top_height", question: "A ladder of length 10 m leans against a vertical wall. Its top is 8 m above the horizontal floor. Find the foot distance.", length: 10, distance: 6, height: 8, side: 1 },
  { id: "two_legs_mirror", question: "A ladder leans against a vertical wall with its foot 5 m to the left of the wall on a horizontal floor. Its top is 12 m above the floor. Find its length.", length: 13, distance: 5, height: 12, side: -1 },
  { id: "centimetres", question: "A 500 cm long ladder leans against a vertical wall. Its foot is 300 cm from the wall on a horizontal floor. Find the height.", length: 5, distance: 3, height: 4, side: 1 },
];
