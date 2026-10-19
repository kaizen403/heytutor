/** Node/tsx only. Next aliases this module out of the browser graph. */
import { existsSync } from "node:fs";
import path from "node:path";
import { renderFingerprint } from "./buildRenderFingerprint.mjs";

export function sourceFingerprint(): string | null {
  let root = process.cwd();
  while (true) {
    if (existsSync(path.join(root, "apps/tutor/lib/lecture-export/buildRenderFingerprint.mjs"))) return renderFingerprint(root);
    const parent = path.dirname(root);
    if (parent === root) return null;
    root = parent;
  }
}
