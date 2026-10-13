/**
 * Independent scope gate for the narrowed ampere/area correction.
 *
 * Inputs retain all 55 named-chain and 37 safety fixtures authored during
 * review, plus mechanics/capacitor/grouped/trig/percent/series/area controls.
 * This asserts parity, not general mathematical correctness: baseline errors
 * are intentionally preserved outside the narrow supported Ohm product.
 *
 * Complete validate -> reconcile -> validate outcomes were captured from
 * 1e6e01814cac55e8b8d10b2dfd270add6541693d by compiling its contract module
 * in memory. The expression module is identical at that ref and current main.
 * Literal snapshots below need no runtime Git, private files, or builds.
 */
import {
  reconcileTurnPlanV3ExplicitArithmetic,
  validateTurnPlanV3,
  type TurnPlanQuantityV3,
  type TurnPlanV3,
  type TurnPlanValidationIssue,
  type TurnPlanArithmeticReconciliation,
  type TurnPlanArithmeticDecline,
} from "../../src/contracts/contractsV3";

type Given = readonly [symbol: string, value: number, unit: string];
interface ScopeFixture {
  readonly name: string;
  readonly givens: number;
  readonly target: string;
  readonly value: number;
  readonly unit?: string;
  readonly source: string;
  readonly question?: string;
  readonly id: string;
  readonly extras?: readonly TurnPlanQuantityV3[];
  readonly baseline: readonly [anonymous: number, named: number];
}
interface PlanChange {
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
  readonly remove?: boolean;
}
interface BaselineSnapshot {
  readonly raw: { readonly valid: boolean; readonly issues: readonly TurnPlanValidationIssue[] };
  readonly patch: readonly PlanChange[];
  readonly reconciliations: readonly TurnPlanArithmeticReconciliation[];
  readonly declined: readonly TurnPlanArithmeticDecline[];
  readonly after: { readonly valid: boolean; readonly issues: readonly TurnPlanValidationIssue[] };
}
function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

const givenGroups: readonly (readonly Given[])[] = freezeDeep([
  [["C",0.00001,"F"],["V",12,"V"],["Q",0.00012,"C"]],
  [["m",4,"kg"],["v",5,"m/s"],["d",2,"m"]],
  [["m",200,"g"],["g",9.8,"m/s^2"],["h",5,"m"]],
  [["m",500,"g"],["g",9.8,"m/s^2"],["h",3,"m"]],
  [["k",200,"N/m"],["x",5,"cm"]],
  [["m",250,"g"],["a",4,"m/s^2"],["d",2,"m"]],
  [["m",1200,"kg"],["v",54,"km/h"]],
  [["I",250,"mA"],["R",20,"Ω"]],
  [["ρ",1.7e-8,"Ω m"],["L",2,"m"],["A",1,"mm²"]],
  [["C",4,"μF"],["V",6,"V"]],
  [["Q",60,"μC"],["C",3,"μF"]],
  [["u",72,"km/h"],["θ",30,"°"],["g",9.8,"m/s^2"]],
  [["u",20,"m/s"],["θ",60,"°"],["g",9.8,"m/s^2"],["m",200,"g"]],
  [["m",250,"g"],["a",4,"m/s^2"]],
  [["m",2,"kg"],["g",9.8,"m/s^2"],["h",80,"cm"]],
  [["m",2,"kg"],["a",3,"m/s^2"]],
  [["m",2,"kg"],["v",3,"m/s"]],
  [["C",2,"μF"],["V",100,"V"]],
  [["m",200,"g"],["u",72,"km/h"],["θ",30,"°"],["g",9.8,"m/s^2"]],
  [["M",2,"kg"],["a",3,"m/s^2"]],
  [["P",60,"W"],["V",230,"V"]],
  [["m",125,"g"],["a",8,"m/s^2"]],
  [["m",750,"g"],["g",10,"m/s^2"],["h",40,"cm"]],
  [["C",8,"μF"],["V",15,"V"]],
  [["I",75,"mA"],["R",80,"Ω"],["A",3,"mm²"]],
  [["m",300,"g"],["v",36,"km/h"]],
  [["C",7,"μF"],["V",20,"V"],["Q",140,"μC"]],
  [["M",0.6,"kg"],["a",5,"m/s^2"],["m",2,"m"]],
  [["C",0.5,"mF"],["V",12,"V"]],
  [["m",125,"g"],["g",10,"m/s^2"],["h",3.2,"m"]],
  [["k",80,"N/m"],["x",15,"cm"],["m",2,"kg"]],
  [["m",250,"g"],["a",-4,"m/s^2"]],
  [["m",2,"mg"],["v",3,"m/s"]],
  [["F",2,"μN"],["t",3,"s"]],
  [["m",2,"kg"],["v",3,"m/s"],["h",5,"m"]],
  [["m",3,"kg"],["a",2,"m/s^2"],["d",4,"m"]],
  [["N",40,"N"],["m",2,"m"]],
  [["F",10,"N"],["d",5,"m"],["theta",90,"°"]],
  [],
  [["a",2,"J"],["b",5,"J"]],
  [["eta",80,"%"],["P",100,"W"]],
  [["V",12,"V"],["R1",2,"Ω"],["R2",4,"Ω"]],
  [["A",0.8,"m²"],["p",12,"Pa"],["I",3,"A"],["R",12,"Ω"]],
  [["rho",1.7e-8,"Ω m"],["L",2,"m"],["A",1,"mm²"]],
  [["A",0.8,"mm²"],["I",3,"A"],["Ω",2,"Ω"],["m",2,"kg"]],
  [["A",0.8,"mm²"],["I",3,"A"],["ohm",2,"Ω"],["s",3,"s"]],
  [["A",0.8,"mm²"],["I",3,"A"],["R",12,"Ω"]],
  [["A",0.8,"mm²"],["I",3,"A"],["R",999,"Ω"]],
]);
const fixtures: readonly ScopeFixture[] = freezeDeep([
  {"name":"named-E1","target":"U","value":0.00072,"unit":"J","source":"U = 1/2 C V^2 = 0.5 C × 144 = 7.2e-4 J","id":"x","givens":0,"baseline":[0,0]},
  {"name":"named-E2","target":"KE","value":50,"unit":"J","source":"KE = 1/2 m v^2 = 0.5 m × 25 = 50 J","id":"x","givens":1,"baseline":[0,0]},
  {"name":"named-E3","target":"v","value":9.899,"unit":"m/s","source":"v = sqrt(2 g h) = sqrt(2 g × 5) = 9.899 m/s","id":"x","givens":2,"baseline":[1,1]},
  {"name":"named-P1R","target":"PE","value":14.7,"unit":"J","source":"PE = m g h = 500 g × 9.8 m/s^2 × 3 m = 14.7 J","id":"x","givens":3,"baseline":[0,0]},
  {"name":"named-P1W","target":"PE","value":14700,"unit":"J","source":"PE = m g h = 500 kg × 9.8 m/s^2 × 3 m = 14700 J","id":"x","givens":3,"baseline":[2,2]},
  {"name":"named-P2R","target":"U","value":0.25,"unit":"J","source":"U = 1/2 k x^2 = 0.5 × 200 N/m × (0.05 m)^2 = 0.25 J","id":"x","givens":4,"baseline":[0,0]},
  {"name":"named-P2W","target":"U","value":2500,"unit":"J","source":"U = 1/2 k x^2 = 0.5 × 200 × 5^2 = 2500 J","id":"x","givens":4,"baseline":[0,3]},
  {"name":"named-P3R","target":"F","value":1,"unit":"N","source":"F = m a = 0.25 kg × 4 m/s^2 = 1 N","id":"x","givens":5,"baseline":[0,0]},
  {"name":"named-P3W","target":"F","value":1000,"unit":"N","source":"F = m a = 250 × 4 = 1000 N","id":"x","givens":5,"baseline":[2,2]},
  {"name":"named-P4R","target":"p","value":18000,"unit":"kg m/s","source":"p = m v = 1200 kg × 15 m/s = 18000 kg m/s","id":"x","givens":6,"baseline":[0,0]},
  {"name":"named-P4W","target":"p","value":64800,"unit":"kg m/s","source":"p = m v = 1200 × 54 = 64800 kg m/s","id":"x","givens":6,"baseline":[2,2]},
  {"name":"named-P5R","target":"V","value":5,"unit":"V","source":"V = I R = 0.25 A × 20 Ω = 5 V","id":"x","givens":7,"baseline":[0,0]},
  {"name":"named-P5W","target":"V","value":5000,"unit":"V","source":"V = I R = 250 mA × 20 Ω = 5000 V","id":"x","givens":7,"baseline":[2,2]},
  {"name":"named-P6R","target":"R","value":0.034,"unit":"Ω","source":"R = ρ L / A = 1.7e-8 Ω m × 2 m / (1e-6 m^2) = 0.034 Ω","id":"x","givens":8,"baseline":[0,0]},
  {"name":"named-P6W","target":"R","value":3.4e-8,"unit":"Ω","source":"R = ρ L / A = 1.7e-8 × 2 / 1 = 3.4e-8 Ω","id":"x","givens":8,"baseline":[2,2]},
  {"name":"named-P7R","target":"Q","value":24,"unit":"μC","source":"Q = C V = 4 μF × 6 V = 24 μC","id":"x","givens":9,"baseline":[0,4]},
  {"name":"named-P7W","target":"Q","value":24,"unit":"C","source":"Q = C V = 4 μF × 6 V = 24 C","id":"x","givens":9,"baseline":[2,5]},
  {"name":"named-P8R","target":"U","value":0.0006,"unit":"J","source":"U = Q^2/(2 C) = (60e-6 C)^2/(2 × 3e-6 F) = 6e-4 J","id":"x","givens":10,"baseline":[0,0]},
  {"name":"named-P8W","target":"U","value":600,"unit":"J","source":"U = Q^2/(2 C) = 60^2/(2 × 3) = 600 J","id":"x","givens":10,"baseline":[3,3]},
  {"name":"named-P9R","target":"R","value":35.35,"unit":"m","source":"R = u^2 sin(2θ)/g = (20 m/s)^2 × sin(60°)/(9.8 m/s^2) = 35.35 m","id":"x","givens":11,"baseline":[6,6]},
  {"name":"named-P9W","target":"R","value":458.1,"unit":"m","source":"R = u^2 sin(2θ)/g = 72^2 × sin(60°)/9.8 = 458.1 m","id":"x","givens":11,"baseline":[3,7]},
  {"name":"named-P10R","target":"H","value":15.31,"unit":"m","source":"H = u^2 sin^2 θ / (2 g) = 400 × 0.75 / 19.6 = 15.31 m","id":"x","givens":12,"baseline":[8,8]},
  {"name":"named-P10W","target":"H","value":17.67,"unit":"m","source":"H = u^2 sin^2 θ/(2 g) = 400 × 0.866 / 19.6 = 17.67 m","id":"x","givens":12,"baseline":[9,9]},
  {"name":"named-H1","target":"F","value":1000,"unit":"N","source":"F = m a = 250 kg × 4 m/s^2 = 1000 N","id":"x","givens":13,"baseline":[2,2]},
  {"name":"named-H2","target":"Q","value":24,"unit":"C","source":"Q = C V = 4 F × 6 V = 24 C","id":"x","givens":9,"baseline":[2,2]},
  {"name":"named-H3","target":"PE","value":1568,"unit":"J","source":"PE = m g h = 2 kg × 9.8 m/s^2 × 80 m = 1568 J","id":"x","givens":14,"baseline":[2,2]},
  {"name":"named-H4","target":"F","value":15,"unit":"N","source":"F = m a = 5 kg × 3 m/s^2 = 15 N","id":"x","givens":15,"baseline":[10,10]},
  {"name":"named-H5","target":"KE","value":22.5,"unit":"J","source":"KE = 1/2 m v^2 = 0.5 × 5 kg × (3 m/s)^2 = 22.5 J","id":"x","givens":16,"baseline":[11,11]},
  {"name":"named-H6","target":"F","value":6,"unit":"N","source":"F = m a = 5 kg × 3 m/s^2 = 6 N","id":"x","givens":15,"baseline":[0,0]},
  {"name":"named-H7","target":"p","value":15,"unit":"kg m/s","source":"p = m v = 5 kg × 3 m/s = 15 kg m/s","id":"x","givens":16,"baseline":[12,13]},
  {"name":"named-H8","target":"U","value":0.01,"unit":"J","source":"U = 1/2 C V^2 = 0.5 × 2 μF × (100 V)^2 = 0.01 J","id":"x","givens":17,"baseline":[0,14]},
  {"name":"named-H9","target":"R","value":35.35,"unit":"m","source":"R = u^2 sin(2θ)/g = (20 m/s)^2 × sin(60°)/(9.8 m/s^2) = 35.35 m","id":"x","givens":18,"baseline":[6,6]},
  {"name":"named-C1","target":"F","value":15,"unit":"N","source":"F = M a = 5 kg × 3 m/s^2 = 15 N","id":"x","givens":19,"baseline":[15,15]},
  {"name":"named-C2","target":"PE","value":14700,"unit":"J","source":"PE = m g h = 500 kg × 9.8 m/s^2 × 3 m = 14700 J","id":"x","givens":3,"baseline":[2,2]},
  {"name":"named-C3","target":"I","value":0.2609,"unit":"A","source":"I = P/V = 60 W / 230 V = 0.2609 A","id":"x","givens":20,"baseline":[16,17]},
  {"name":"named-D1R","target":"F","value":1,"unit":"N","source":"F = m a = 125 g × 8 m/s^2 = 1 N","id":"x","givens":21,"baseline":[0,0]},
  {"name":"named-D1W","target":"F","value":1000,"unit":"N","source":"F = m a = 125 kg × 8 m/s^2 = 1000 N","id":"x","givens":21,"baseline":[2,2]},
  {"name":"named-D2R","target":"PE","value":3,"unit":"J","source":"PE = m g h = 750 g × 10 m/s^2 × 40 cm = 3 J","id":"x","givens":22,"baseline":[0,0]},
  {"name":"named-D2W","target":"PE","value":300000,"unit":"J","source":"PE = m g h = 750 kg × 10 m/s^2 × 40 m = 300000 J","id":"x","givens":22,"baseline":[2,2]},
  {"name":"named-D3R","target":"Q","value":120,"unit":"μC","source":"Q = C V = 8 μF × 15 V = 120 μC","id":"x","givens":23,"baseline":[0,18]},
  {"name":"named-D3W","target":"Q","value":120,"unit":"C","source":"Q = C V = 8 μF × 15 V = 120 C","id":"x","givens":23,"baseline":[2,19]},
  {"name":"named-D4R","target":"V","value":6,"unit":"V","source":"V = I R = 75 mA × 80 Ω = 6 V","id":"x","givens":24,"baseline":[0,0]},
  {"name":"named-D4W","target":"V","value":6000,"unit":"V","source":"V = I R = 75 A × 80 Ω = 6000 V","id":"x","givens":24,"baseline":[2,2]},
  {"name":"named-D5R","target":"p","value":3,"unit":"kg m/s","source":"p = m v = 0.3 kg × 10 m/s = 3 kg m/s","id":"x","givens":25,"baseline":[0,0]},
  {"name":"named-D5W","target":"p","value":10800,"unit":"kg m/s","source":"p = m v = 300 kg × 36 m/s = 10800 kg m/s","id":"x","givens":25,"baseline":[2,2]},
  {"name":"named-D6R","target":"U","value":0.0014,"unit":"J","source":"U = 1/2 C V^2 = 0.5 × 7 μF × (20 V)^2 = 0.0014 J","id":"x","givens":26,"baseline":[0,20]},
  {"name":"named-D6W","target":"U","value":1400,"unit":"J","source":"U = 1/2 C V^2 = 0.5 × 7 F × (20 V)^2 = 1400 J","id":"x","givens":26,"baseline":[3,3]},
  {"name":"named-D7R","target":"F","value":3,"unit":"N","source":"F = M a = 0.6 kg × 5 m/s^2 = 3 N","id":"x","givens":27,"baseline":[0,0]},
  {"name":"named-D7W","target":"F","value":4.5,"unit":"N","source":"F = M a = 0.9 kg × 5 m/s^2 = 4.5 N","id":"x","givens":27,"baseline":[21,21]},
  {"name":"named-D8R","target":"Q","value":6,"unit":"mC","source":"Q = C V = 0.5 mF × 12 V = 6 mC","id":"x","givens":28,"baseline":[0,22]},
  {"name":"named-D8W","target":"Q","value":6,"unit":"C","source":"Q = C V = 0.5 F × 12 V = 6 C","id":"x","givens":28,"baseline":[2,2]},
  {"name":"named-D9R","target":"v","value":8,"unit":"m/s","source":"v = sqrt(2 g h) = sqrt(2 g × 3.2) = 8 m/s","id":"x","givens":29,"baseline":[0,0]},
  {"name":"named-D9W","target":"v","value":25.2982212813,"unit":"m/s","source":"v = sqrt(2 g h) = sqrt(2 g × 32) = 25.2982212813 m/s","id":"x","givens":29,"baseline":[23,0]},
  {"name":"named-D10R","target":"U","value":0.9,"unit":"J","source":"U = 1/2 k x^2 = 0.5 × 80 N/m × (15 cm)^2 = 0.9 J","id":"x","givens":30,"baseline":[0,0]},
  {"name":"named-D10W","target":"U","value":9000,"unit":"J","source":"U = 1/2 k x^2 = 0.5 × 80 N/m × (15 m)^2 = 9000 J","id":"x","givens":30,"baseline":[0,3]},
  {"name":"safety-conversion-ascii-after","target":"F","value":1,"unit":"N","source":"F = m*0.001*a = 1 N","id":"result","givens":13,"baseline":[24,24]},
  {"name":"safety-conversion-negative-ascii-after","target":"F","value":-1,"unit":"N","source":"F = m*0.001*a = −1 N","id":"result","givens":31,"baseline":[24,24]},
  {"name":"safety-conversion-times-after","target":"F","value":1,"unit":"N","source":"F = m × 0.001 × a = 1 N","id":"result","givens":13,"baseline":[24,24]},
  {"name":"safety-conversion-negative-times-after","target":"F","value":-1,"unit":"N","source":"F = m × 0.001 × a = −1 N","id":"result","givens":31,"baseline":[24,24]},
  {"name":"safety-conversion-dot-after","target":"F","value":1,"unit":"N","source":"F = m · 0.001 · a = 1 N","id":"result","givens":13,"baseline":[24,24]},
  {"name":"safety-conversion-negative-dot-after","target":"F","value":-1,"unit":"N","source":"F = m · 0.001 · a = −1 N","id":"result","givens":31,"baseline":[24,24]},
  {"name":"safety-conversion-operator-dot-after","target":"F","value":1,"unit":"N","source":"F = m ⋅ 0.001 ⋅ a = 1 N","id":"result","givens":13,"baseline":[24,24]},
  {"name":"safety-conversion-negative-operator-dot-after","target":"F","value":-1,"unit":"N","source":"F = m ⋅ 0.001 ⋅ a = −1 N","id":"result","givens":31,"baseline":[24,24]},
  {"name":"safety-conversion-ascii-before","target":"F","value":1,"unit":"N","source":"F = 0.001*m*a = 1 N","id":"result","givens":13,"baseline":[24,24]},
  {"name":"safety-conversion-negative-ascii-before","target":"F","value":-1,"unit":"N","source":"F = 0.001*m*a = −1 N","id":"result","givens":31,"baseline":[24,24]},
  {"name":"safety-conversion-times-before","target":"F","value":1,"unit":"N","source":"F = 0.001 × m × a = 1 N","id":"result","givens":13,"baseline":[24,24]},
  {"name":"safety-conversion-negative-times-before","target":"F","value":-1,"unit":"N","source":"F = 0.001 × m × a = −1 N","id":"result","givens":31,"baseline":[24,24]},
  {"name":"safety-conversion-dot-before","target":"F","value":1,"unit":"N","source":"F = 0.001 · m · a = 1 N","id":"result","givens":13,"baseline":[24,24]},
  {"name":"safety-conversion-negative-dot-before","target":"F","value":-1,"unit":"N","source":"F = 0.001 · m · a = −1 N","id":"result","givens":31,"baseline":[24,24]},
  {"name":"safety-conversion-operator-dot-before","target":"F","value":1,"unit":"N","source":"F = 0.001 ⋅ m ⋅ a = 1 N","id":"result","givens":13,"baseline":[24,24]},
  {"name":"safety-conversion-negative-operator-dot-before","target":"F","value":-1,"unit":"N","source":"F = 0.001 ⋅ m ⋅ a = −1 N","id":"result","givens":31,"baseline":[24,24]},
  {"name":"safety-conversion-adjacent-divisor","target":"F","value":1,"unit":"N","source":"F = m/1000*a = 1 N","id":"result","givens":13,"baseline":[24,24]},
  {"name":"safety-conversion-negative-adjacent-divisor","target":"F","value":-1,"unit":"N","source":"F = m/1000*a = −1 N","id":"result","givens":31,"baseline":[24,24]},
  {"name":"safety-conversion-group-divisor","target":"F","value":1,"unit":"N","source":"F = (m*a)/1000 = 1 N","id":"result","givens":13,"baseline":[24,24]},
  {"name":"safety-conversion-negative-group-divisor","target":"F","value":-1,"unit":"N","source":"F = (m*a)/1000 = −1 N","id":"result","givens":31,"baseline":[24,24]},
  {"name":"safety-conversion-final-divisor","target":"F","value":1,"unit":"N","source":"F = m*a/1000 = 1 N","id":"result","givens":13,"baseline":[24,24]},
  {"name":"safety-conversion-negative-final-divisor","target":"F","value":-1,"unit":"N","source":"F = m*a/1000 = −1 N","id":"result","givens":31,"baseline":[24,24]},
  {"name":"safety-untrusted-only-survivor","target":"v","value":10,"unit":"m/s","source":"v = sqrt(2 g × 5) = z*1 = 10 m/s","id":"result","extras":[{"id":"z_value","symbol":"z","value":10,"unit":"m/s","provenance":"derived","sourceText":"z = unknown"}],"givens":2,"baseline":[25,0]},
  {"name":"safety-untrusted-only-survivor-reversed","target":"v","value":10,"unit":"m/s","source":"v = z*1 = sqrt(2 g × 5) = 10 m/s","id":"result","extras":[{"id":"z_value","symbol":"z","value":10,"unit":"m/s","provenance":"derived","sourceText":"z = unknown"}],"givens":2,"baseline":[0,26]},
  {"name":"safety-uncomputed-measured-restatement-survivor","target":"v","value":10,"unit":"m/s","source":"v = sqrt(2 g × 5) = z*1 = 10 m/s","id":"result","extras":[{"id":"z_value","symbol":"z","value":10,"unit":"m/s","provenance":"derived","sourceText":"z = 10 m/s"}],"givens":2,"baseline":[25,0]},
  {"name":"safety-uncomputed-bare-restatement-survivor","target":"v","value":10,"unit":"m/s","source":"v = sqrt(2 g × 5) = z*1 = 10 m/s","id":"result","extras":[{"id":"z_value","symbol":"z","value":10,"unit":"m/s","provenance":"derived","sourceText":"z = 10"}],"givens":2,"baseline":[25,0]},
  {"name":"safety-trusted-wrong-dimensions-survivor","target":"v","value":10,"unit":"m/s","source":"v = sqrt(2 g × 5) = h*2 = 10 m/s","id":"result","givens":2,"baseline":[27,0]},
  {"name":"safety-unsupported-only","target":"v","value":10,"unit":"m/s","source":"v = sqrt(2 g × 5) = 10 m/s","id":"result","givens":2,"baseline":[28,28]},
  {"name":"safety-E3-complete-trusted-member","target":"v","value":9.899,"unit":"m/s","source":"v = sqrt(2 g h) = sqrt(2 g × 5) = 9.899 m/s","id":"result","givens":2,"baseline":[29,29]},
  {"name":"safety-compound-mg-to-Mg-right","target":"p","value":6e-9,"unit":"Mg m/s","source":"p = m v = 6 mg m/s","id":"result","givens":32,"baseline":[0,0]},
  {"name":"safety-compound-mg-to-Mg-wrong-declaration","target":"p","value":6,"unit":"Mg m/s","source":"p = m v = 6 mg m/s","id":"result","givens":32,"baseline":[0,30]},
  {"name":"safety-compound-Mg-wrong-source","target":"p","value":6,"unit":"Mg m/s","source":"p = m v = 6 Mg m/s","id":"result","givens":32,"baseline":[2,2]},
  {"name":"safety-compound-micro-to-mega-right","target":"P","value":6e-12,"unit":"MN s","source":"P = F t = 6 μN s","id":"result","givens":33,"baseline":[0,0]},
  {"name":"safety-compound-micro-to-mega-wrong","target":"P","value":6,"unit":"MN s","source":"P = F t = 6 μN s","id":"result","givens":33,"baseline":[0,31]},
  {"name":"safety-compound-micro-glyph-right","target":"P","value":6,"unit":"µN s","source":"P = F t = 6 μN s","id":"result","givens":33,"baseline":[0,0]},
  {"name":"safety-mixed-unit-slip-no-conversion","target":"F","value":1000,"unit":"N","source":"F = m*a = 1000 N","id":"result","givens":13,"baseline":[2,2]},
  {"name":"safety-mixed-unit-slip-wrong-factor","target":"F","value":10,"unit":"N","source":"F = m/100*a = 10 N","id":"result","givens":13,"baseline":[24,24]},
  {"name":"legacy-KE-right","target":"KE","value":9,"unit":"J","source":"KE = 0.5 m v^2 = 0.5 * 2 * 9 = 9 J","id":"result","givens":34,"baseline":[0,0]},
  {"name":"legacy-KE-wrong","target":"KE","value":4.5,"unit":"J","source":"KE = 0.5 m v^2 = 0.5 * 9 = 4.5 J","id":"result","givens":34,"baseline":[32,32]},
  {"name":"legacy-force-right","target":"F","value":18,"unit":"N","source":"F = 3 m a = 3 × 3 × 2 = 18 N","id":"result","givens":35,"baseline":[0,0]},
  {"name":"legacy-cap-right","target":"U","value":0.00072,"unit":"J","source":"U = 1/2 C V^2 = 0.5*1e-5*144 = 7.2e-4 J","id":"result","givens":0,"baseline":[0,0]},
  {"name":"legacy-cap-wrong","target":"U","value":72,"unit":"J","source":"U = 1/2 C V^2 = 72 J","id":"result","givens":0,"baseline":[33,33]},
  {"name":"legacy-grouped-right","target":"D","value":240,"unit":"N*m","source":"D = (2+1)N*m = 240 N*m","id":"result","givens":36,"baseline":[0,0]},
  {"name":"legacy-grouped-wrong","target":"D","value":3,"unit":"N*m","source":"D = (2+1)N*m = 3 N*m","id":"result","givens":36,"baseline":[34,34]},
  {"name":"legacy-trig-right","target":"W","value":0,"unit":"J","source":"W = F*d*cos(theta) = 10*5*cos(90°) = 0 J","id":"result","givens":37,"baseline":[0,0]},
  {"name":"legacy-trig-wrong","target":"W","value":1,"unit":"J","source":"W = F*d*cos(theta) = 10*5*cos(90°) = 1 J","id":"result","givens":37,"baseline":[35,35]},
  {"name":"legacy-trig-cancel","target":"X","value":0,"source":"X = 10*cos(60°) - 5 = 0","id":"result","givens":38,"baseline":[0,0]},
  {"name":"legacy-percent-right","target":"eta","value":40,"unit":"%","source":"eta = a/b*100 = 40 %","id":"result","givens":39,"baseline":[0,0]},
  {"name":"legacy-percent-wrong","target":"eta","value":20,"unit":"%","source":"eta = a/b*100 = 20 %","id":"result","givens":39,"baseline":[36,37]},
  {"name":"legacy-percent-chain","target":"useful","value":80,"unit":"W","source":"useful = eta/100*P = 80 W","id":"result","givens":40,"baseline":[24,24]},
  {"name":"legacy-series-bare","target":"I","value":2,"unit":"A","source":"I = 12 V / 6 Ω = 2 A","id":"result","givens":41,"baseline":[38,38]},
  {"name":"legacy-series-bound","target":"I","value":2,"unit":"A","source":"I = V/(R1+R2) = 12 V / 6 Ω = 2 A","id":"result","givens":41,"baseline":[0,39]},
  {"name":"legacy-series-parenthesized","target":"I","value":2,"unit":"A","source":"I = (12 V)/(6 Ω) = 2 A","id":"result","givens":41,"baseline":[40,40]},
  {"name":"legacy-series-wrong","target":"I","value":24,"unit":"A","source":"I = 12 V / 6 Ω = 24 A","id":"result","givens":41,"baseline":[0,0]},
  {"name":"legacy-area-pressure","target":"F","value":28.8,"unit":"N","source":"F = 3*A*p = 28.8 N","id":"result","givens":42,"baseline":[0,0]},
  {"name":"legacy-area-glued","target":"F","value":28.8,"unit":"N","source":"F = 3A*p = 28.8 N","id":"result","givens":42,"baseline":[0,0]},
  {"name":"legacy-area-grouped","target":"F","value":28.8,"unit":"N","source":"F = (2+1)A*p = 28.8 N","id":"result","givens":42,"baseline":[0,0]},
  {"name":"legacy-resistivity-area","target":"R","value":0.034,"unit":"Ω","source":"R = rho*L/A = 0.034 Ω","id":"result","givens":43,"baseline":[0,0]},
  {"name":"legacy-prefixed-resistor-binding-collision","target":"V","value":24000,"unit":"V","source":"V = 3 A * 2000 mΩ = 24000 V","id":"result","givens":44,"baseline":[2,2]},
  {"name":"legacy-coherent-omega-binding-right","target":"V","value":6,"unit":"V","source":"V = 3 A * 2 Ω = 6 V","id":"result","givens":44,"baseline":[2,2]},
  {"name":"legacy-coherent-omega-binding-wrong","target":"V","value":12,"unit":"V","source":"V = 3 A * 2 Ω = 12 V","id":"result","givens":44,"baseline":[2,2]},
  {"name":"legacy-coherent-ohms-segmented-binding","target":"V","value":36,"unit":"V","source":"V = 3 A * 2 ohms = 36 V","id":"result","givens":45,"baseline":[2,2]},
  {"name":"legacy-derived-resistance-symbol-shadow","target":"V","value":36,"unit":"V","source":"V = 3 A * R = 36 V","id":"result","givens":46,"extras":[{"id":"other","symbol":"R","value":12,"unit":"m","sourceText":"R = 12 m","provenance":"derived"}],"baseline":[41,41]},
  {"name":"legacy-resistance-question-contradiction","target":"V","value":36,"unit":"V","source":"V = 3 A * R = 36 V","question":"Given A = 0.8 mm², I = 3 A, R = 16 Ω, and unrelated S = 12 Ω, determine V across R.","id":"result","givens":46,"baseline":[2,2]},
  {"name":"legacy-current-question-contradiction","target":"V","value":36,"unit":"V","source":"V = 3 A * R = 36 V","question":"Given A = 0.8 mm², I = 4 A, unrelated J = 3 A, and R = 12 Ω, determine V for I through R.","id":"result","givens":46,"baseline":[2,2]},
  {"name":"legacy-stale-resistance-unmatched-question","target":"V","value":2997,"unit":"V","source":"V = 3 A * R = 2997 V","question":"Given A = 0.8 mm², I = 3 A, and R = 12 Ω, determine V.","id":"result","givens":47,"baseline":[2,2]},
  {"name":"legacy-prefixed-current-question-contradiction","target":"V","value":36,"unit":"V","source":"V = 3 A * R = 36 V","question":"Given A = 0.8 mm², I = 3 mA, unrelated J = 3 A, and R = 12 Ω, determine V for I through R.","id":"result","givens":46,"baseline":[2,2]},
  {"name":"legacy-prefixed-resistance-question-contradiction","target":"V","value":36,"unit":"V","source":"V = 3 A * R = 36 V","question":"Given A = 0.8 mm², I = 3 A, R = 12 mΩ, and unrelated S = 12 Ω, determine V across R.","id":"result","givens":46,"baseline":[2,2]},
  {"name":"legacy-wrong-prose-assignment","target":"V","value":36,"unit":"V","source":"V = 3 A * R = 36 V","question":"Given A = 0.8 mm², R = 12 Ω. A wrong example says I = 3 A; actual I is 4 A. Determine V for the actual current.","id":"result","givens":46,"baseline":[2,2]},
]);
// Deduplicated literal outcomes. Patches contain baseline values/sourceText,
// never values recomputed by the evaluator under test.
const baselineSnapshots: readonly BaselineSnapshot[] = freezeDeep([
  {"raw":{"valid":true,"issues":[]},"patch":[],"reconciliations":[],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",0,"value"],"value":9.899494936611665},{"path":["derived",0,"sourceText"],"value":"v = sqrt(2 g h) = sqrt(2 g × 5) = 9.89949493661 m/s"}],"reconciliations":[{"quantityId":"x","previousValue":9.899,"reconciledValue":9.899494936611665}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[],"reconciliations":[],"declined":[],"after":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]}},
  {"raw":{"valid":true,"issues":[]},"patch":[],"reconciliations":[],"declined":[{"quantityId":"x","reason":"mixed_units"}],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":144},{"path":["derived",0,"sourceText"],"value":"Q = C V = 4 μF × 6 V = 144 μC"}],"reconciliations":[{"quantityId":"x","previousValue":24,"reconciledValue":144}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":144},{"path":["derived",0,"sourceText"],"value":"Q = C V = 4 μF × 6 V = 144 C"}],"reconciliations":[{"quantityId":"x","previousValue":24,"reconciledValue":144}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",0,"value"],"value":35.34797566467096},{"path":["derived",0,"sourceText"],"value":"R = u^2 sin(2θ)/g = (20 m/s)^2 × sin(60°)/(9.8 m/s^2) = 35.3479756647 m"}],"reconciliations":[{"quantityId":"x","previousValue":35.35,"reconciledValue":35.34797566467096}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",0,"value"],"value":458.1097646141357},{"path":["derived",0,"sourceText"],"value":"R = u^2 sin(2θ)/g = 72^2 × sin(60°)/9.8 = 458.109764614 m"}],"reconciliations":[{"quantityId":"x","previousValue":458.1,"reconciledValue":458.1097646141357}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",0,"value"],"value":15.306122448979592},{"path":["derived",0,"sourceText"],"value":"H = u^2 sin^2 θ / (2 g) = 400 × 0.75 / 19.6 = 15.306122449 m"}],"reconciliations":[{"quantityId":"x","previousValue":15.31,"reconciledValue":15.306122448979592}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",0,"value"],"value":17.673469387755098},{"path":["derived",0,"sourceText"],"value":"H = u^2 sin^2 θ/(2 g) = 400 × 0.866 / 19.6 = 17.6734693878 m"}],"reconciliations":[{"quantityId":"x","previousValue":17.67,"reconciledValue":17.673469387755098}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":6},{"path":["derived",0,"sourceText"],"value":"F = m a = 5 kg × 3 m/s^2 = 6 N"}],"reconciliations":[{"quantityId":"x","previousValue":15,"reconciledValue":6}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":9},{"path":["derived",0,"sourceText"],"value":"KE = 1/2 m v^2 = 0.5 × 5 kg × (3 m/s)^2 = 9 J"}],"reconciliations":[{"quantityId":"x","previousValue":22.5,"reconciledValue":9}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":6},{"path":["derived",0,"sourceText"],"value":"p = m v = 5 kg × 3 m/s = 6 kg m/s"}],"reconciliations":[{"quantityId":"x","previousValue":15,"reconciledValue":6}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",0,"value"],"value":6},{"path":["derived",0,"sourceText"],"value":"p = m v = 5 kg × 3 m/s = 6 kg m/s"}],"reconciliations":[{"quantityId":"x","previousValue":15,"reconciledValue":6}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":100000000},{"path":["derived",0,"sourceText"],"value":"U = 1/2 C V^2 = 0.5 × 2 μF × (100 V)^2 = 100000000 J"}],"reconciliations":[{"quantityId":"x","previousValue":0.01,"reconciledValue":100000000}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":6},{"path":["derived",0,"sourceText"],"value":"F = M a = 5 kg × 3 m/s^2 = 6 N"}],"reconciliations":[{"quantityId":"x","previousValue":15,"reconciledValue":6}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",0,"value"],"value":0.2608695652173913},{"path":["derived",0,"sourceText"],"value":"I = P/V = 60 W / 230 V = 0.260869565217 A"}],"reconciliations":[{"quantityId":"x","previousValue":0.2609,"reconciledValue":0.2608695652173913}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":60},{"path":["derived",0,"sourceText"],"value":"I = P/V = 60 W / 230 V = 60 A"}],"reconciliations":[{"quantityId":"x","previousValue":0.2609,"reconciledValue":60}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":1800},{"path":["derived",0,"sourceText"],"value":"Q = C V = 8 μF × 15 V = 1800 μC"}],"reconciliations":[{"quantityId":"x","previousValue":120,"reconciledValue":1800}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":1800},{"path":["derived",0,"sourceText"],"value":"Q = C V = 8 μF × 15 V = 1800 C"}],"reconciliations":[{"quantityId":"x","previousValue":120,"reconciledValue":1800}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":560000},{"path":["derived",0,"sourceText"],"value":"U = 1/2 C V^2 = 0.5 × 7 μF × (20 V)^2 = 560000 J"}],"reconciliations":[{"quantityId":"x","previousValue":0.0014,"reconciledValue":560000}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":3},{"path":["derived",0,"sourceText"],"value":"F = M a = 0.9 kg × 5 m/s^2 = 3 N"}],"reconciliations":[{"quantityId":"x","previousValue":4.5,"reconciledValue":3}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":72},{"path":["derived",0,"sourceText"],"value":"Q = C V = 0.5 mF × 12 V = 72 mC"}],"reconciliations":[{"quantityId":"x","previousValue":6,"reconciledValue":72}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":8},{"path":["derived",0,"sourceText"],"value":"v = sqrt(2 g h) = sqrt(2 g × 32) = 8 m/s"}],"reconciliations":[{"quantityId":"x","previousValue":25.2982212813,"reconciledValue":8}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[],"reconciliations":[],"declined":[{"quantityId":"result","reason":"mixed_units"}],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",1,"value"],"value":9.899494936611665},{"path":["derived",1,"sourceText"],"value":"v = sqrt(2 g × 5) = z*1 = 9.89949493661 m/s"}],"reconciliations":[{"quantityId":"result","previousValue":10,"reconciledValue":9.899494936611665}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",1,"value"],"value":9.899494936611665},{"path":["derived",1,"sourceText"],"value":"v = z*1 = sqrt(2 g × 5) = 9.89949493661 m/s"}],"reconciliations":[{"quantityId":"result","previousValue":10,"reconciledValue":9.899494936611665}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",0,"value"],"value":9.899494936611665},{"path":["derived",0,"sourceText"],"value":"v = sqrt(2 g × 5) = h*2 = 9.89949493661 m/s"}],"reconciliations":[{"quantityId":"result","previousValue":10,"reconciledValue":9.899494936611665}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",0,"value"],"value":9.899494936611665},{"path":["derived",0,"sourceText"],"value":"v = sqrt(2 g × 5) = 9.89949493661 m/s"}],"reconciliations":[{"quantityId":"result","previousValue":10,"reconciledValue":9.899494936611665}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",0,"value"],"value":9.899494936611665},{"path":["derived",0,"sourceText"],"value":"v = sqrt(2 g h) = sqrt(2 g × 5) = 9.89949493661 m/s"}],"reconciliations":[{"quantityId":"result","previousValue":9.899,"reconciledValue":9.899494936611665}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":true,"issues":[]},"patch":[{"path":["derived",0,"value"],"value":6e-9}],"reconciliations":[{"quantityId":"result","previousValue":6,"reconciledValue":6e-9}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_value_mismatch","path":"derived[0].value","message":"declared value 6 disagrees with explicit arithmetic result 6e-12"}]},"patch":[{"path":["derived",0,"value"],"value":6e-12}],"reconciliations":[{"quantityId":"result","previousValue":6,"reconciledValue":6e-12}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":9},{"path":["derived",0,"sourceText"],"value":"KE = 0.5 m v^2 = 0.5 * 9 = 9 J"}],"reconciliations":[{"quantityId":"result","previousValue":4.5,"reconciledValue":9}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":0.00072},{"path":["derived",0,"sourceText"],"value":"U = 1/2 C V^2 = 0.00072 J"}],"reconciliations":[{"quantityId":"result","previousValue":72,"reconciledValue":0.00072}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":240},{"path":["derived",0,"sourceText"],"value":"D = (2+1)N*m = 240 N*m"}],"reconciliations":[{"quantityId":"result","previousValue":3,"reconciledValue":240}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":3.061616997868383e-15},{"path":["derived",0,"sourceText"],"value":"W = F*d*cos(theta) = 10*5*cos(90°) = 3.06161699787e-15 J"}],"reconciliations":[{"quantityId":"result","previousValue":1,"reconciledValue":3.061616997868383e-15}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":40},{"path":["derived",0,"sourceText"],"value":"eta = a/b*100 = 40 %"}],"reconciliations":[{"quantityId":"result","previousValue":20,"reconciledValue":40}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_value_mismatch","path":"derived[0].value","message":"declared value 20 disagrees with explicit arithmetic result 40"}]},"patch":[{"path":["derived",0,"value"],"value":40},{"path":["derived",0,"sourceText"],"value":"eta = a/b*100 = 40 %"}],"reconciliations":[{"quantityId":"result","previousValue":20,"reconciledValue":40}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":24},{"path":["derived",0,"sourceText"],"value":"I = 12 V / 6 Ω = 24 A"}],"reconciliations":[{"quantityId":"result","previousValue":2,"reconciledValue":24}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":24},{"path":["derived",0,"sourceText"],"value":"I = V/(R1+R2) = 12 V / 6 Ω = 24 A"}],"reconciliations":[{"quantityId":"result","previousValue":2,"reconciledValue":24}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[0].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[{"path":["derived",0,"value"],"value":24},{"path":["derived",0,"sourceText"],"value":"I = (12 V)/(6 Ω) = 24 A"}],"reconciliations":[{"quantityId":"result","previousValue":2,"reconciledValue":24}],"declined":[],"after":{"valid":true,"issues":[]}},
  {"raw":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[1].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]},"patch":[],"reconciliations":[],"declined":[],"after":{"valid":false,"issues":[{"code":"source_text_arithmetic_invalid","path":"derived[1].sourceText","message":"an independently checkable calculation in sourceText is arithmetically incorrect"}]}},
]);

function makePlan(test: ScopeFixture, named: boolean): TurnPlanV3 {
  const givens = givenGroups[test.givens]!;
  const symbol = named ? test.target : "X";
  const question = test.question ?? `Given ${givens.map(([s, v, u]) => `${s} = ${v} ${u}`).join(", ")}, determine ${test.target}.`;
  return freezeDeep({
    schemaVersion: "turn-plan/v3", question,
    givens: givens.map(([symbol, value, unit], i) => ({
      id: `given_${i}`, symbol, value, unit,
      sourceText: `${symbol} = ${value} ${unit}`, provenance: "given",
    })),
    unknowns: [{ id: test.id, symbol, ...(test.unit === undefined ? {} : { unit: test.unit }) }],
    derived: [...(test.extras ?? []), {
      id: test.id, symbol, value: test.value,
      ...(test.unit === undefined ? {} : { unit: test.unit }),
      provenance: "derived", sourceText: test.source,
      dependsOn: givens.map((_, i) => `given_${i}`),
    }],
    qualitativeClaims: [], lawIds: ["x"], assumptions: [], visualRequirement: "optional",
  } satisfies TurnPlanV3);
}

/** Rebuild the full baseline plan from frozen literal leaf changes. */
function baselinePlan(plan: TurnPlanV3, changes: readonly PlanChange[]): TurnPlanV3 {
  const result = structuredClone(plan);
  for (const change of changes) {
    let parent: unknown = result;
    for (const key of change.path.slice(0, -1)) {
      parent = (parent as Record<string | number, unknown>)[key];
    }
    const key = change.path.at(-1);
    if (key === undefined || parent === null || typeof parent !== "object") {
      throw new Error("invalid frozen baseline patch");
    }
    if (change.remove) delete (parent as Record<string | number, unknown>)[key];
    else (parent as Record<string | number, unknown>)[key] = structuredClone(change.value);
  }
  return result;
}
function expectedOutcome(plan: TurnPlanV3, snapshot: BaselineSnapshot) {
  const reconciled = baselinePlan(plan, snapshot.patch);
  return {
    raw: { ...snapshot.raw, plan: snapshot.raw.valid ? plan : null },
    reconciliation: {
      plan: reconciled, reconciliations: snapshot.reconciliations, declined: snapshot.declined,
    },
    after: { ...snapshot.after, plan: snapshot.after.valid ? reconciled : null },
  };
}
function actualOutcome(plan: TurnPlanV3) {
  const raw = validateTurnPlanV3(plan, plan.question);
  const reconciliation = reconcileTurnPlanV3ExplicitArithmetic(plan);
  const after = validateTurnPlanV3(reconciliation.plan, plan.question);
  return { raw, reconciliation, after };
}
/** Object-key order is irrelevant; array order and every field/value are retained. */
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

const failures: string[] = [];
let plans = 0;
let checks = 0;
for (const test of fixtures) {
  for (const named of [false, true]) {
    plans += 1;
    const id = `${test.name}/${named ? "named" : "X"}`;
    const plan = makePlan(test, named);
    const before = canonical(plan);
    const expected = expectedOutcome(plan, baselineSnapshots[test.baseline[named ? 1 : 0]]!);
    try {
      const actual = actualOutcome(plan);
      for (const stage of ["raw", "reconciliation", "after"] as const) {
        checks += 1;
        if (canonical(actual[stage]) !== canonical(expected[stage])) {
          failures.push(`${id}/${stage}: baseline ${canonical(expected[stage])}; actual ${canonical(actual[stage])}`);
        }
      }
      checks += 1;
      if (canonical(plan) !== before) failures.push(`${id}/immutable: API mutated its input`);
    } catch (error) {
      failures.push(`${id}/exception: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(`Ampere-area scope gate ${failures.length === 0 ? "GREEN" : "RED"}: ${failures.length} failures, ${checks} checks, ${plans} plans, ${fixtures.length} immutable fixtures; baseline 1e6e0181.`);
if (failures.length > 0) process.exitCode = 1;
