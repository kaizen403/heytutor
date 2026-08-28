import {
  NOTES_CHAT_SYSTEM_PROMPT,
  getMockNotesChatResponse,
  stripNotesChatProtocol,
  visibleNotesChatText,
} from "../../src/llm/notesChatPrompt";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(/board protocol tags/i.test(NOTES_CHAT_SYSTEM_PROMPT), "notes chat must forbid board tags");
assert(/text only/i.test(NOTES_CHAT_SYSTEM_PROMPT), "notes chat must answer in text");
assert(
  stripNotesChatProtocol("[STEP]hello [WRITE:v = 60,90,145][/STEP] there [FOCUS:image]") ===
    "hello there",
  "protocol tags must be stripped from notes-chat replies",
);
assert(
  stripNotesChatProtocol("keep [EMPHASIZE:last] this [SUPERSEDE:1] and [ANNOTATE:u_dim]") ===
    "keep this and",
  "new semantic tags must be stripped from notes-chat replies",
);
assert(
  visibleNotesChatText("the formula is [WRI") === "the formula is",
  "an incomplete trailing tag must stay hidden while streaming",
);
assert(
  !getMockNotesChatResponse("why this formula").includes("[STEP]"),
  "mock notes-chat replies must be plain text",
);

console.log("notes chat prompt verification passed");
