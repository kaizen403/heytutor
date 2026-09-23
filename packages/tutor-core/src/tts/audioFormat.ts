/** The relay returns complete WAV (Cartesia) or MP3 (ElevenLabs) sentences. */
export function speechAudioMimeType(bytes: Uint8Array | undefined): "audio/wav" | "audio/mpeg" {
  return bytes && bytes.length >= 12
    && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70
    && bytes[8] === 87 && bytes[9] === 65 && bytes[10] === 86 && bytes[11] === 69
    ? "audio/wav" : "audio/mpeg";
}
