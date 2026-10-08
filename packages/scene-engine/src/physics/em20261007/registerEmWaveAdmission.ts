import { emWaveScalar, emWaveSourceAdmissions, type EmWaveSourceRole } from "./agent8-em-waves";
import { registerModelAdmission, type InputRole, type ModelAdmissionRule } from "./admission";

function role(source: EmWaveSourceRole): InputRole {
  return {
    role: source.role,
    unit: source.unit,
    ...(source.sourceValues ? {
      sourcePhrases: Object.fromEntries(Object.entries(source.sourceValues).map(([value, phrase]) => [value, [phrase]])),
    } : {}),
    ...(source.unitByInput ? { unitByInput: source.unitByInput } : {}),
  };
}

for (const source of emWaveSourceAdmissions) {
  registerModelAdmission({
    name: source.name,
    roles: Object.fromEntries(Object.entries(source.roles).map(([key, value]) => [key, role(value)])),
    optionalRoles: Object.fromEntries(Object.entries(source.optionalRoles).map(([key, value]) => [key, role(value)])),
    optionalGroups: source.optionalGroups,
    assumptions: source.assumptions,
    conditionalRules: source.conditionalRules.map((rule): ModelAdmissionRule => ({
      ...rule,
      ...(rule.roleOverrides ? {
        roleOverrides: Object.fromEntries(Object.entries(rule.roleOverrides).map(([key, value]) => [key, {
          ...value,
          ...(value.sourceValues ? {
            sourcePhrases: Object.fromEntries(Object.entries(value.sourceValues).map(([code, phrase]) => [code, [phrase]])),
          } : {}),
        }])),
      } : {}),
    })),
    resultKind: source.resultKind,
    scalar(inputs) {
      return emWaveScalar(source.name, inputs);
    },
  });
}
