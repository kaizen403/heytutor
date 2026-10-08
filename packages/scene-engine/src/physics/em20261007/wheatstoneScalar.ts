export interface WheatstoneInputs {
  readonly emf: number;
  readonly r: number;
  readonly P: number;
  readonly Q: number;
  readonly Rg: number;
}

/** Balanced equal-ratio bridge. Detector current is zero for any positive Rg. */
export function wheatstoneCurrents(inputs: WheatstoneInputs): Readonly<Record<string, number>> {
  const arm = inputs.P + inputs.Q;
  const parallel = arm / 2;
  const source = inputs.emf / (inputs.r + parallel);
  const branch = (inputs.emf - source * inputs.r) / arm;
  return {
    I_S: source,
    I_LT: -branch,
    I_TR: -branch,
    I_LB: -branch,
    I_BR: -branch,
    I_G: 0,
  };
}
