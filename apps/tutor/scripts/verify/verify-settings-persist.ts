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

console.log("✓ settings persist, teaching-note cap, and teaching-prompt injection");
