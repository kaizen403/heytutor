import { registerModelAdmission } from "./admission";
import { wheatstoneCurrents } from "./wheatstoneScalar";
import "./registerMagnetismAdmission";
import "./registerElectrostaticsAdmission";
import "./registerEmWaveAdmission";
import "./registerInductionAcAdmission";

registerModelAdmission({
  name: "dc.wheatstone",
  roles: {
    emf: { role: "source emf", unit: "V" },
    r: { role: "source internal resistance", unit: "ohm" },
    P: { role: "left arm resistance", unit: "ohm" },
    Q: { role: "right arm resistance", unit: "ohm" },
    Rg: { role: "galvanometer resistance", unit: "ohm" },
  },
  assumptions: ["balanced"],
  scalar(inputs) {
    const emf = inputs.emf;
    const r = inputs.r;
    const P = inputs.P;
    const Q = inputs.Q;
    const Rg = inputs.Rg;
    if (emf === undefined || r === undefined || P === undefined || Q === undefined || Rg === undefined) {
      throw new Error("wheatstone scalar is missing a grounded input");
    }
    return wheatstoneCurrents({ emf, r, P, Q, Rg });
  },
});
