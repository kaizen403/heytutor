import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../../src/synthesize/familyScene";
const stems = process.argv.slice(2).length ? process.argv.slice(2) : [
  "A 12 V battery is connected across a 6 Ω resistor. Find the current through the resistor.",
  "A current of 2 A flows through a 5 Ω resistor. Find the potential difference across it.",
  "Two resistors of 4 Ω and 6 Ω are connected in series to a 10 V battery. Find the current in the circuit.",
  "Three resistors of 2 Ω, 3 Ω and 6 Ω are connected in parallel across a 6 V battery. Find the total current drawn.",
  "A 3 Ω resistor is connected in series with a parallel combination of 6 Ω and 3 Ω resistors across a 10 V battery. Find the current from the battery.",
  "A resistor of 10 Ω is connected to a 5 V cell. An ammeter is connected in series and a voltmeter across the resistor. Find the ammeter and voltmeter readings.",
  "State Ohm's law.",
];
for (const question of stems) {
  let r = synthesizeFamilyScene({ question }); let via = "family";
  if (!r) { r = synthesizeLastResortScene({ question }); via = "last"; }
  console.log("\nQ:", question);
  if (!r) { console.log("  -> declined"); continue; }
  console.log(`  -> family=${r.family} via=${via} tier=${r.tier} reason=${r.reason}`);
  const comps = r.document.entities.filter((e) => e.kind !== "point");
  console.log("  entities:", comps.map((e) => `${e.id}:${e.kind}/${e.role}${e.label ? `[${e.label}]` : ""}`).join(" "));
  console.log("  symbols:", r.document.constructions.filter((c) => c.operator === "symbol").map((c) => `${c.outputs[0]}=${(c.inputs as any).symbol}(${(c.inputs as any).start}->${(c.inputs as any).end})`).join(" "));
  console.log("  quantities:", r.document.quantities.map((q: any) => `${q.id}=${q.value}${q.unit ?? ""}`).join(" "));
}
