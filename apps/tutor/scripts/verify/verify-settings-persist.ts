import { STUNT_KINDS } from "@heytutor/whiteboard";
import {
  accountSettingsPatch,
  lessonSettingsFromAccount,
  markerStuntsColumn,
  parseAccountSettings,
  parseMarkerStunts,
  teachingPromptAddon,
  TEACHING_NOTE_MAX,
} from "../../lib/account/userSettings";
import { toggleMarkerStunt } from "../../lib/account/lessonSettings";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const parsed = parseAccountSettings({
  speedMultiplier: 2,
  fastMode: false,
  teachingNote: "  I mix up unit vectors  ",
  alwaysShowUnits: true,
});
assert(parsed.speedMultiplier === 2, "speed is kept");
assert(parsed.fastMode === false, "fast mode can turn off");
assert(parsed.teachingNote === "I mix up unit vectors", "teaching note is trimmed");
assert(parsed.alwaysShowUnits === true, "units toggle is kept");

const lesson = lessonSettingsFromAccount(parsed);
assert(lesson.speedMultiplier === 2, "lesson sheet gets speed");
assert(!("teachingNote" in lesson), "lesson sheet does not carry the teaching note field");

/*
  Marker stunts are a selection, not a switch, and the selection has to survive
  every hop between the row, the account sheet and the lesson sheet. The board
  reads it off the lesson sheet, so a field dropped in the middle is a setting
  that silently stops working — and here that means the trick the student
  picked never plays.
*/
const list = (kinds: readonly string[]) => kinds.join(",");

assert(
  list(parsed.markerStunts) === list(STUNT_KINDS),
  "a row that never set them gets every trick",
);
assert(list(lesson.markerStunts) === list(STUNT_KINDS), "and the lesson sheet carries them");

const twoPicked = parseAccountSettings({ markerStunts: ["tossCatch", "knuckleRoll"] });
assert(
  list(twoPicked.markerStunts) === "knuckleRoll,tossCatch",
  `a selection survives the row, got ${list(twoPicked.markerStunts)}`,
);
assert(
  list(lessonSettingsFromAccount(twoPicked).markerStunts) === "knuckleRoll,tossCatch",
  "including on the sheet the board is handed",
);

// Stored order must not change which selection it is: two students who picked
// the same pair have the same setting however they clicked.
assert(
  list(parseAccountSettings({ markerStunts: "tossCatch,knuckleRoll" }).markerStunts) ===
    list(parseAccountSettings({ markerStunts: "knuckleRoll,tossCatch" }).markerStunts),
  "the stored order must not change the selection",
);
assert(
  list(parseAccountSettings({ markerStunts: ["helicopter", "helicopter"] }).markerStunts) ===
    "helicopter",
  "a duplicate is one trick, not two",
);
assert(
  list(parseAccountSettings({ markerStunts: ["helicopter", "backflip"] }).markerStunts) ===
    "helicopter",
  "a trick the engine does not have is dropped rather than carried",
);
assert(
  parseAccountSettings({ markerStunts: [] }).markerStunts.length === 0,
  "and deselecting everything is a real answer, not a missing one",
);

// The column and the cache both began as a boolean. A row written then still
// has to land on something a student would recognise as what they chose.
assert(list(parseMarkerStunts(true)) === list(STUNT_KINDS), "a legacy true is every trick");
assert(parseMarkerStunts(false).length === 0, "a legacy false is none of them");
assert(list(parseMarkerStunts(undefined)) === list(STUNT_KINDS), "and an unwritten row is all");
assert(list(parseMarkerStunts("1")) === list(STUNT_KINDS), "including the cached boolean form");
assert(parseMarkerStunts("0").length === 0, "in both directions");
assert(parseMarkerStunts("").length === 0, "while an empty list stays empty");

assert(
  list(accountSettingsPatch({ markerStunts: ["thumbAround"] }).markerStunts ?? []) ===
    "thumbAround",
  "narrowing the selection is a patch the API will write",
);
assert(
  accountSettingsPatch({ markerStunts: [] }).markerStunts?.length === 0,
  "and so is clearing it",
);
assert(
  !("markerStunts" in accountSettingsPatch({ speedMultiplier: 2 })),
  "a patch that says nothing about stunts must not reset them",
);

// The stored form round-trips, so a write followed by a read is a no-op.
for (const selection of [[], ["helicopter"], ["knuckleRoll", "tossCatch"], [...STUNT_KINDS]]) {
  const stored = markerStuntsColumn(selection as never);
  assert(
    list(parseMarkerStunts(stored)) === list(selection),
    `${JSON.stringify(selection)} did not round-trip through the column, got "${stored}"`,
  );
}

// Toggling is what the settings UI does, and it must stay a stable shape.
assert(
  list(toggleMarkerStunt([], "helicopter")) === "helicopter",
  "toggling an unselected trick turns it on",
);
assert(
  toggleMarkerStunt(["helicopter"], "helicopter").length === 0,
  "and toggling it again turns it off",
);
assert(
  list(toggleMarkerStunt(["tossCatch"], "knuckleRoll")) === "knuckleRoll,tossCatch",
  "the result is ordered by the repertoire, not by click order",
);

const patch = accountSettingsPatch({ teachingNote: "x".repeat(TEACHING_NOTE_MAX + 20), familiarity: "new" });
assert(patch.teachingNote?.length === TEACHING_NOTE_MAX, "teaching note is capped");
assert(patch.familiarity === "new", "familiarity patch is kept");

const addon = teachingPromptAddon({
  teachingNote: "I mix up unit vectors",
  alwaysShowUnits: true,
  alwaysStateLawFirst: true,
});
assert(addon.includes("STUDENT TEACHING NOTE"), "teaching note reaches the teaching prompt");
assert(addon.includes("never invent diagram geometry"), "note is barred from scene-engine");
assert(addon.includes("Always name the unit"), "units toggle reaches teaching");
assert(addon.includes("State the governing law"), "law-first toggle reaches teaching");
assert(teachingPromptAddon({}) === "", "empty prefs add nothing");

console.log(
  "✓ settings persist, the marker stunt selection survives the row to board hop in one canonical order, legacy booleans land somewhere a student would recognise, teaching-note cap, and teaching-prompt injection",
);
