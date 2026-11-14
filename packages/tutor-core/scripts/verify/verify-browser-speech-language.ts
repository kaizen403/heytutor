import assert from "node:assert/strict";
import { SpeechSynthesisTTSClient } from "../../src/tts/speechClient";
import { INDIAN_LANGUAGE_OPTIONS, switchesNarrationLanguage } from "../../src/tts/voiceLanguage";

class Utterance {
  lang = "";
  voice?: { lang: string; name: string };
  onstart?: () => void;
  onend?: () => void;
  constructor(readonly text: string) {}
}
let active: Utterance | undefined;
const voices = [
  { lang: "en-IN", name: "Google English" },
  ...INDIAN_LANGUAGE_OPTIONS.map(({ voiceKey, label }) => ({ lang: voiceKey, name: label })),
];
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  speechSynthesis: {
    getVoices: () => voices, cancel() {}, resume() {},
    speak(utterance: Utterance) { active = utterance; utterance.onstart?.(); utterance.onend?.(); },
  },
} });
Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: Utterance });
try {
  const client = new SpeechSynthesisTTSClient();
  for (const { voiceKey } of INDIAN_LANGUAGE_OPTIONS) {
    client.setVoicePreferences({ voiceKey, lowLatency: false });
    await client.speakSegment("x equals nine.");
    assert.equal(active?.lang, voiceKey);
    assert.equal(active?.voice?.lang, voiceKey, "browser fallback must retain the lesson language");
    assert.ok(switchesNarrationLanguage("en-IN", voiceKey));
    assert.ok(!switchesNarrationLanguage(voiceKey, voiceKey));
  }
  assert.ok(switchesNarrationLanguage("ta-IN", "te-IN"));
  assert.ok(!switchesNarrationLanguage("en-GB", "en-IN"));
} finally {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance");
}
console.log("verify-browser-speech-language: regional fallback voices and turn language boundaries pass");
