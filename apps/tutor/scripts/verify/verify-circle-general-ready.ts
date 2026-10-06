/**
 * Circle in general form x²+y²+2gx+2fy+c=0 (any common scale A), through the
 * live selection path. Centre (-g,-f) and r² = g²+f²-c were worked by hand from
 * each stem after dividing by A; nothing below is read back from the engine.
 * Checks themselves live in verify-circle-standard-ready.ts.
 */
import { checkCircleCase, checkDeclineCase, checkPointCase, type CircleCase, type DeclineCase, type PointCase } from "./verify-circle-standard-ready";

const CASES: CircleCase[] = [
  // g=-3, f=2, c=-12: r² = 9+4+12 = 25
  { id: "GF-A", question: "Find the centre and radius of x^2+y^2-6x+4y-12=0.", center: [3, -2], radius: 5, label: "(x-3)²+(y+2)²=25" },
  // ÷2: x²+y²+4x-6y-3=0, r² = 4+9+3 = 16
  { id: "GF-B-scaled", question: "Find the centre and radius of 2x^2+2y^2+8x-12y-6=0.", center: [-2, 3], radius: 4, label: "(x+2)²+(y-3)²=16" },
  // ÷(-2): x²+y²-6x+4y-12=0
  { id: "GF-negative-scale", question: "Find the centre and radius of -2x^2-2y^2+12x-8y+24=0.", center: [3, -2], radius: 5, label: "(x-3)²+(y+2)²=25" },
  // ×2: x²+y²-3x+4y-0.75=0, r² = 2.25+4+0.75 = 7; the equation is 17 characters
  { id: "GF-fractional", question: "Find the centre and radius of 0.5x^2+0.5y^2-1.5x+2y-0.375=0.", center: [1.5, -2], radius: Math.sqrt(7), label: "r²=7", centreLabel: "C(1.5,-2)" },
  // ÷2: x²+y²+x+y-1=0, r² = 0.25+0.25+1 = 1.5; equal numbers in distinct roles
  { id: "GF-equal-number-roles", question: "Find the centre and radius of 2x^2+2y^2+2x+2y-2=0.", center: [-0.5, -0.5], radius: Math.sqrt(1.5), label: "r²=1.5", centreLabel: "C(-0.5,-0.5)" },
  // both equations are one locus
  { id: "GF-equivalence", question: "Show that x^2+y^2-6x+4y-12=0 and (x-3)^2+(y+2)^2=25 have the same locus. Find its centre and radius.", center: [3, -2], radius: 5, label: "(x-3)²+(y+2)²=25" },
  // the claimed radius 4 is false; the figure draws the source's r = 5, never the claim
  { id: "GF-E-false-claim", question: "For x^2+y^2-6x+4y-12=0, check the claimed centre (3,-2) and radius 4.", center: [3, -2], radius: 5, label: "(x-3)²+(y+2)²=25" },
  // (6-3)² + (-6+2)² = 9+16 = 25
  { id: "GF-member-on", question: "Does the point (6,-6) lie on the circle x^2+y^2-6x+4y-12=0?", center: [3, -2], radius: 5, label: "(x-3)²+(y+2)²=25", member: { at: [6, -6], verdict: "on" } },
];

const POINTS: PointCase[] = [
  // r² = 1+4-5 = 0
  { id: "GF-C-bare-zero", question: "Classify the locus x^2+y^2+2x+4y+5=0.", point: [-1, -2] },
  { id: "GF-C-explicit", question: "The locus x^2+y^2+2x+4y+5=0 is a single point. Determine that point.", point: [-1, -2] },
];

const DECLINES: DeclineCase[] = [
  { id: "GF-D-no-real-locus", question: "Does x^2+y^2+2x+4y+6=0 represent a real circle?", why: "r² = 1+4-6 = -1" },
  { id: "GF-xy-term", question: "Find the centre and radius of x^2+y^2+xy-4=0.", why: "an xy term is not a circle" },
  { id: "GF-unequal-squares", question: "Find the centre and radius of x^2+2y^2-4x=0.", why: "unequal square coefficients are not a circle" },
];

let checks = 0;
for (const c of CASES) checks += checkCircleCase(c);
for (const c of POINTS) checks += checkPointCase(c);
for (const c of DECLINES) checks += checkDeclineCase(c);
console.log(`circle general form ready: ${CASES.length} circles, ${POINTS.length} singletons, ${DECLINES.length} declines, ${checks} checks`);
