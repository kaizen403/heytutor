/**
 * Seconds of audio in a complete WAV sentence, read from its header, or null
 * for anything else. Sarvam (the Hinglish voice) sends no timings, so this is
 * the only measure of how long its sentence lasts.
 */
export function wavDurationSec(bytes: Uint8Array | undefined): number | null {
  if (!bytes || speechAudioMimeType(bytes) !== "audio/wav") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let byteRate = 0;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt " && at + 20 <= bytes.length) byteRate = view.getUint32(at + 16, true);
    if (id === "data") {
      const dataBytes = Math.min(size, bytes.length - at - 8);
      return byteRate > 0 && dataBytes > 0 ? dataBytes / byteRate : null;
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/** The relay returns complete WAV (Cartesia, Sarvam) or MP3 (ElevenLabs) sentences. */
export function speechAudioMimeType(bytes: Uint8Array | undefined): "audio/wav" | "audio/mpeg" {
  return bytes && bytes.length >= 12
    && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70
    && bytes[8] === 87 && bytes[9] === 65 && bytes[10] === 86 && bytes[11] === 69
    ? "audio/wav" : "audio/mpeg";
}
