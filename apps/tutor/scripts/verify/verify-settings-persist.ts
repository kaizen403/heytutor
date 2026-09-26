import { STUNT_KINDS } from "@heytutor/whiteboard";
import { readFileSync } from "node:fs";
import {
  accountSettingsPatch,
  DEFAULT_ACCOUNT_SETTINGS,
  lessonSettingsFromAccount,
  markerStuntsColumn,
  parseAccountSettings,
  parseMarkerStunts,
  teachingPromptAddon,
  TEACHING_NOTE_MAX,
} from "../../lib/account/userSettings";
import { DEFAULT_PLAYBACK_SPEED, toggleMarkerStunt } from "../../lib/account/lessonSettings";
import { DEFAULT_REPLAY_SPEED } from "../../lib/replay/replayAudio";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(DEFAULT_PLAYBACK_SPEED === 1.25, "new tutor and admin sessions start at 1.25×");
assert(DEFAULT_ACCOUNT_SETTINGS.speedMultiplier === DEFAULT_PLAYBACK_SPEED, "new accounts use the session default");
assert(DEFAULT_REPLAY_SPEED === DEFAULT_PLAYBACK_SPEED, "admin Watch uses the session default");
assert(parseAccountSettings({}).speedMultiplier === DEFAULT_PLAYBACK_SPEED, "missing speed uses the new default");

const parsed = parseAccountSettings({
  speedMultiplier: 2,
  fastMode: false,
  audioLanguage: "hindi",
  narrationEnabled: false,
  lowLatencyVoice: true,
  teachingNote: "  I mix up unit vectors  ",
  alwaysShowUnits: true,
});
assert(parsed.speedMultiplier === 2, "speed is kept");
assert(parsed.fastMode === true, "fast mode stays on even when the row says off");
assert(parsed.audioLanguage === "english", "audio stays English even when the row says Hindi");
assert(parsed.narrationEnabled === true, "narration stays on even when the row says off");
assert(parsed.lowLatencyVoice === false, "voice stays Natural even when the row says low latency");
assert(parsed.teachingNote === "I mix up unit vectors", "teaching note is trimmed");
assert(parsed.alwaysShowUnits === true, "units toggle is kept");

assert(
  !("fastMode" in accountSettingsPatch({ fastMode: false })),
  "a PATCH cannot turn fast mode off",
);
assert(
  !("audioLanguage" in accountSettingsPatch({ audioLanguage: "hindi" })),
  "a PATCH cannot switch audio language",
);
assert(
  !("narrationEnabled" in accountSettingsPatch({ narrationEnabled: false })),
  "a PATCH cannot turn narration off",
);
assert(
  !("lowLatencyVoice" in accountSettingsPatch({ lowLatencyVoice: true })),
  "a PATCH cannot switch to low latency voice",
);

const lesson = lessonSettingsFromAccount(parsed);
assert(lesson.speedMultiplier === 2, "lesson sheet gets speed");
assert(!("teachingNote" in lesson), "lesson sheet does not carry the teaching note field");
assert(parsed.markerColor === "navy" && parsed.pencilColor === "navy", "new accounts start with matching ink");
assert(parsed.markerThickness === 1 && parsed.pencilThickness === 1, "new accounts start at regular thickness");

const legacyInk = parseAccountSettings({ markerColor: "red" });
assert(legacyInk.pencilColor === "red", "an old account keeps its pencil tint");
const customInk = parseAccountSettings({
  markerColor: "blue",
  pencilColor: "green",
  markerThickness: 1.4,
  pencilThickness: 0.8,
});
assert(customInk.pencilColor === "green", "pencil color is independent of marker color");
assert(customInk.markerThickness === 1.4 && customInk.pencilThickness === 0.8, "both widths survive the row");
assert(lessonSettingsFromAccount(customInk).pencilThickness === 0.8, "the board receives pencil width");
assert(parseAccountSettings({ markerThickness: 99 }).markerThickness === 1.6, "stored widths are bounded");
assert(accountSettingsPatch({ pencilColor: "purple", markerThickness: 0.6 }).pencilColor === "purple", "the API accepts pencil color");
assert(accountSettingsPatch({ pencilThickness: 1.2 }).pencilThickness === 1.2, "the API accepts pencil width");
assert(!("markerThickness" in accountSettingsPatch({ markerThickness: "huge" })), "invalid widths are ignored");

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

assert(
  parseAccountSettings({}).lectureFileType === "mp4",
  "lecture downloads stay MP4 until the student picks another type",
);
assert(
  parseAccountSettings({ lectureFileType: "webm" }).lectureFileType === "webm",
  "WebM survives the row",
);
assert(
  parseAccountSettings({ lectureFileType: "mov" }).lectureFileType === "mp4",
  "an unknown type falls back to MP4 rather than being stored",
);
assert(
  lessonSettingsFromAccount(parseAccountSettings({ lectureFileType: "webm" })).lectureFileType ===
    "webm",
  "the lesson sheet carries the lecture file type",
);
assert(
  accountSettingsPatch({ lectureFileType: "webm" }).lectureFileType === "webm",
  "switching to WebM is a patch the API will write",
);
assert(
  !("lectureFileType" in accountSettingsPatch({ speedMultiplier: 2 })),
  "a patch that says nothing about the lecture file type must not reset it",
);

const settingsScreen = readFileSync(
  new URL("../../features/account/SettingsScreen.tsx", import.meta.url),
  "utf8",
);
const settingsDrawer = readFileSync(
  new URL("../../features/tutor-session/components/SettingsDrawer.tsx", import.meta.url),
  "utf8",
);
assert(
  settingsScreen.includes("Lecture file type") && settingsDrawer.includes("Lecture file type"),
  "both settings surfaces must offer the lecture file type",
);
assert(
  settingsScreen.includes('patch({ lectureFileType: value })') &&
    settingsDrawer.includes("update({ lectureFileType: value })"),
  "picking MP4 or WebM must write lectureFileType",
);

console.log(
  "✓ settings persist, the marker stunt selection survives the row to board hop in one canonical order, legacy booleans land somewhere a student would recognise, teaching-note cap, teaching-prompt injection, and lecture file type",
);
