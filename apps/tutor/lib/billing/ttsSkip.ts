export function ttsSkippedResponse(reason: "budget" | "unconfigured" = "budget"): Response {
  return new Response(new Uint8Array(), {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "x-heytutor-tts-skipped": reason,
    },
  });
}
