import { electrostaticFieldAdmissions, electrostaticFieldModels } from "./agent3-electrostatic-fields";
import { potentialCapacitorAdmissions, potentialCapacitorModels } from "./agent4-potential-capacitors";
import { registerModelAdmission, type InputRole, type ModelAdmission } from "./admission";

const categoricalPhrases: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  ideal: { "0": ["finite separated point charges"], "1": ["ideal point dipole approximation"] },
  side: { "-1": ["observation just inside the boundary"], "1": ["observation just outside the boundary"] },
  orientation: { "-1": ["inward surface normal"], "1": ["outward surface normal"] },
  shown: { "1": ["source explicitly requests the schematic"] },
  axial: { "0": ["equatorial observation"], "1": ["axial observation"] },
  grounded: { "0": ["isolated from ground"], "1": ["grounded to earth"] },
  separated: { "0": ["conductors remain connected"], "1": ["connection removed after equilibrium"] },
  direction: { "-1": ["electric field along the negative reference direction"], "1": ["electric field along the positive reference direction"] },
  battery: { "0": ["capacitor isolated from the source"], "1": ["capacitor connected to the voltage source"] },
  assemblyOrder: { "0": ["assemble charges in order one two three"], "1": ["assemble charges in order three two one"] },
  connection: { "0": ["capacitors connected in series"], "1": ["capacitors connected in parallel"] },
};

function withCategoricalSource(role: InputRole, key: string): InputRole {
  const sourcePhrases = categoricalPhrases[key];
  return sourcePhrases ? { ...role, sourcePhrases } : role;
}

function register(admission: ModelAdmission, scope: "solved" | "qualitative" | "setup_only" | "text_only"): void {
  registerModelAdmission({
    ...admission,
    roles: Object.fromEntries(Object.entries(admission.roles).map(([key, value]) => [key, withCategoricalSource(value, key)])),
    resultKind: scope === "solved" ? "scalar" : "representation",
  });
}

const scopes = new Map([
  ...electrostaticFieldModels.map((model) => [model.name, model.scope] as const),
  ...potentialCapacitorModels.map((model) => [model.name, model.scope] as const),
]);
for (const admission of [...electrostaticFieldAdmissions(), ...potentialCapacitorAdmissions()]) {
  const scope = scopes.get(admission.name);
  if (!scope) throw new Error(`missing electrostatics scope for ${admission.name}`);
  register(admission, scope);
}
