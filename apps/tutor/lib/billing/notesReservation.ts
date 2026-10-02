/** Failed/empty responses release their reserved message; a delivered answer
 * counts even if the student closes the tab before the stream finishes. */
export function holdNotesReservation(response: Response, release?: () => Promise<void>): Response {
  if (!release || !response.body) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let delivered = false;
  const observe = (chunk: Uint8Array) => {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        const data = JSON.parse(line.slice(5)) as { delta?: unknown };
        if (typeof data.delta === "string" && data.delta.trim()) delivered = true;
      } catch { /* comment/heartbeat/done frames are not an answer */ }
    }
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          if (!delivered) await release();
          controller.close();
        } else { observe(chunk.value); controller.enqueue(chunk.value); }
      } catch (error) {
        if (!delivered) await release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      if (!delivered) await release();
      await reader.cancel(reason);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
