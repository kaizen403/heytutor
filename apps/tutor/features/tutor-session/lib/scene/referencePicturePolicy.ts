/** Admission to the existing judged-picture fallback; never geometry authority. */
export function referencePictureAllowedForTurn(input: {
  granted: boolean;
  doubt: boolean;
  resume: boolean;
  dsa: boolean;
  codeBoard: boolean;
  emptyZone: boolean;
  zoneOccupied: boolean;
}): boolean {
  return (
    input.granted &&
    !input.resume &&
    !input.dsa &&
    !input.codeBoard &&
    (!input.doubt || (input.emptyZone && !input.zoneOccupied))
  );
}
