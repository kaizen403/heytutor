import {
  accountSettingsPatch,
  lessonSettingsFromAccount,
  parseAccountSettings,
  sanitizeTeachingNote,
  teachingPromptAddon,
  TEACHING_NOTE_MAX,
} from "../../lib/account/userSettings";

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

// Marker stunts: on unless the student turned them off, and the switch has to
// survive every hop between the row, the account sheet and the lesson sheet.
// The board reads it off the lesson sheet, so a field dropped in the middle is
// a setting that silently stops working.
assert(parsed.markerStunts === true, "marker stunts are on for a row that never set them");
assert(lesson.markerStunts === true, "and the lesson sheet carries them to the board");
assert(
  parseAccountSettings({ markerStunts: false }).markerStunts === false,
  "and a student who turned them off keeps them off",
);
assert(
  lessonSettingsFromAccount(parseAccountSettings({ markerStunts: false })).markerStunts === false,
  "including on the sheet the board is handed",
);
assert(
  accountSettingsPatch({ markerStunts: false }).markerStunts === false,
  "turning them off is a patch the API will write",
);
assert(
  accountSettingsPatch({ markerStunts: true }).markerStunts === true,
  "and so is turning them back on",
);
assert(
  !("markerStunts" in accountSettingsPatch({ speedMultiplier: 2 })),
  "a patch that says nothing about stunts must not reset them",
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
  "✓ settings persist, marker stunts survive the row to board hop, teaching-note cap, and teaching-prompt injection",
);
