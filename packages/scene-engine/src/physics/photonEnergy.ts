/** SI photon energy conversions shared by source checks and their renderers.
 * Readers own input validation; these functions do not round a source value. */
const PLANCK_J_S = 6.62607015e-34;
const LIGHT_M_PER_S = 299792458;
const JOULE_PER_EV = 1.602176634e-19;

export function photonEnergyEvFromFrequencyHz(frequencyHz: number): number {
  return (PLANCK_J_S * frequencyHz) / JOULE_PER_EV;
}

export function photonEnergyEvFromWavelengthMetres(wavelengthMetres: number): number {
  return (PLANCK_J_S * LIGHT_M_PER_S) / wavelengthMetres / JOULE_PER_EV;
}
