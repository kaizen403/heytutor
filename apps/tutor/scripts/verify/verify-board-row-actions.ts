/**
 * Sidebar row actions: pin and an overflow menu, revealed on hover.
 *
 * Two rules this guards, both of which came from the owner directly:
 *   1. No Share in the menu.
 *   2. No red anywhere in the hover cluster. Arming a confirm is not itself
 *      destructive, so red is spent once, on the button that confirms.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isArchived,
  isPinned,
  sortBoards,
  withArchived,
  withPinned,
  type BoardEntry,
} from "../../lib/boards/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = join(import.meta.dirname, "..", "..");
const source = readFileSync(
  join(root, "features/tutor-session/components/BoardHistory.tsx"),
  "utf8",
);

// --- the menu holds exactly what was asked for ------------------------------
for (const label of ["Rename", "Archive", "Delete"]) {
  assert(source.includes(`>\n                        ${label}\n`) || source.includes(label),
    `the row menu is missing "${label}"`);
}
assert(
  /Pin board|Unpin board/.test(source),
  "the row menu is missing the pin entry",
);
assert(
  !/>\s*Share\s*</.test(source) && !/"Share"/.test(source),
  "Share must not appear in the row menu; the owner excluded it explicitly",
);

// --- hover reveal, not always-on --------------------------------------------
assert(
  /\.bh__row-btn \{[^}]*opacity: 0;/s.test(source),
  "row actions must start hidden and appear on hover",
);
assert(
  /\.bh__item:hover \.bh__row-btn,\s*\.bh__item:focus-within \.bh__row-btn \{\s*opacity: 1;/.test(source),
  "row actions must appear on hover and on keyboard focus within the row",
);
// Without this a keyboard user tabs to a control they cannot see.
assert(
  /\.bh__row-btn:focus-visible \{\s*opacity: 1;/.test(source),
  "a focused row action must become visible",
);
// Nothing in the cluster may be visible without hover, focus, or an explicit
// selection. The owner rejected a build where a touch fallback left both
// controls at 0.55 opacity on every row: "only on hover I must be able to see
// those, not just like that".
assert(
  !/@media \(hover: none\) \{\s*\.bh__row-btn \{/.test(source),
  "a blanket touch rule puts the row actions on screen by default; scope it to the open row",
);
assert(
  /@media \(hover: none\) \{\s*\.bh__item--active \.bh__row-btn \{\s*opacity: 1;/.test(source),
  "row actions must still be reachable on touch, on the open board",
);
// Exactly one control sits outside the menu: the three dots. The owner
// removed the standalone pin from the row ("I don't want the pin outside"),
// so pinning is reachable only from inside the menu.
const outsideButtons = (
  source.slice(
    source.indexOf("data-row-actions"),
    source.indexOf('className="bh__menu"'),
  ).match(/className="bh__row-btn"/g) ?? []
).length;
assert(
  outsideButtons === 1,
  `the row must show exactly one control outside the menu, found ${outsideButtons}`,
);
assert(
  !/bh__row-btn--on|bh__item-pinned/.test(source),
  "no pin may sit outside the menu, as a button or as a title-row glyph",
);
// The title ran underneath the cluster once the second button arrived.
const titleWidth = /\.bh__item-btn \{[\s\S]*?width: calc\(100% - ([\d.]+)rem\);/.exec(source);
assert(titleWidth, "the row title must reserve a fixed width for the actions");
assert(
  Number(titleWidth[1]) >= 2.5,
  `the title reserves only ${titleWidth[1]}rem; a 1.65rem button plus its 0.5rem inset needs ~2.6rem, so the text overlaps`,
);

// --- no red in the hover cluster --------------------------------------------
const clusterStart = source.indexOf(".bh__row-actions {");
const clusterEnd = source.indexOf(".bh__item--confirm {");
assert(clusterStart > 0 && clusterEnd > clusterStart, "row action styles not found");
const clusterCss = source.slice(clusterStart, clusterEnd);
assert(
  !/--danger|248,\s*81,\s*73|224,\s*104,\s*88|#E06858|#e06858/i.test(clusterCss),
  "the hover cluster must carry no red; red belongs on the delete confirm alone",
);

// --- pin ordering ------------------------------------------------------------
const board = (id: string, createdAt: number, pinnedAt?: number): BoardEntry => ({
  id,
  title: id,
  preview: "",
  createdAt,
  pinnedAt: pinnedAt ?? null,
  archivedAt: null,
});

const ordered = sortBoards([
  board("old", 1),
  board("new", 3),
  board("pinned-first", 2, 100),
  board("pinned-later", 1, 200),
]);
assert(
  ordered.map((b) => b.id).join(",") === "pinned-later,pinned-first,new,old",
  `pinned boards must sort first, newest pin on top, got ${ordered.map((b) => b.id).join(",")}`,
);

// --- pin and archive are independent, and both toggle ------------------------
const plain = board("b", 1);
assert(!isPinned(plain) && !isArchived(plain), "a new board is neither pinned nor archived");
const pinned = withPinned(plain, true);
assert(isPinned(pinned) && !isArchived(pinned), "pinning must not archive");
assert(!isPinned(withPinned(pinned, false)), "pinning must toggle back off");
// Re-pinning keeps the original stamp, or the list reshuffles under the click.
assert(
  withPinned(pinned, true).pinnedAt === pinned.pinnedAt,
  "re-pinning an already-pinned board must keep its original position",
);
const archived = withArchived(pinned, true);
assert(isArchived(archived) && isPinned(archived), "archiving must not clear the pin");
assert(!isArchived(withArchived(archived, false)), "archiving must toggle back off");

// --- an archived board leaves the list but stays findable --------------------
assert(
  /b\.archivedAt == null \|\| b\.id === activeBoardId/.test(source),
  "archived boards must drop out of the default list, except the open one",
);
assert(
  /const filtered = query\s*\?\s*boards\.filter\(\(b\) => b\.title\.toLowerCase\(\)\.includes\(query\)\)/.test(source),
  "a search must still reach archived boards",
);

console.log("verify-board-row-actions: ok");
