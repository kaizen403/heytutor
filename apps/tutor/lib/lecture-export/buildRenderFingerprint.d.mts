export const RENDER_SOURCE_ROOTS: readonly string[];
export function renderSourceFiles(root: string, roots?: readonly string[]): string[];
/** Hashes rendering source bytes plus resolved installed runtime package versions.
 * Fails closed when required runtime packages/metadata cannot be resolved.
 * Does not detect same-version patches to installed package contents.
 */
export function renderFingerprint(root: string, roots?: readonly string[]): string;
