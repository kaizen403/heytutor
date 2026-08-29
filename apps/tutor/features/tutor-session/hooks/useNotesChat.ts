import { useCallback, useEffect, useRef, useState } from "react";
import { visibleNotesChatText } from "@heytutor/tutor-core";
import {
  fetchNotesChatMessages,
  streamNotesChatMessage,
  type NotesChatLivePayload,
  type NotesChatMessage,
} from "@/lib/boards/notesChatClient";

const STREAMING_ID = "notes-chat-streaming";

export function useNotesChat(boardId: string, enabled = true) {
  const [messages, setMessages] = useState<NotesChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const boardIdRef = useRef(boardId);

  useEffect(() => {
    boardIdRef.current = boardId;
  }, [boardId]);

  // Changing board — or switching notes off — resets the thread. Doing that
  // while rendering the new input is the supported pattern: an effect would
  // paint the previous board's messages for a frame before clearing them.
  const [threadKey, setThreadKey] = useState(`${boardId}:${enabled}`);
  if (threadKey !== `${boardId}:${enabled}`) {
    setThreadKey(`${boardId}:${enabled}`);
    setSending(false);
    setError(null);
    setMessages([]);
  }

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (!enabled) {
      return;
    }

    let cancelled = false;
    void fetchNotesChatMessages(boardId).then((loaded) => {
      if (cancelled || boardIdRef.current !== boardId) return;
      setMessages(loaded);
    });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [boardId, enabled]);

  const send = useCallback(
    async (raw: string, liveNotes: NotesChatLivePayload | null, lectureInProgress: boolean) => {
      const message = raw.trim();
      if (!enabled || !message || sending) return;

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      setSending(true);
      setError(null);
      let rawBuffer = "";

      const userMessage: NotesChatMessage = {
        id: `local-user-${Date.now()}`,
        role: "user",
        content: message,
        createdAt: Date.now(),
      };
      const assistantMessage: NotesChatMessage = {
        id: STREAMING_ID,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);

      try {
        const rawReply = await streamNotesChatMessage({
          boardId,
          message,
          liveNotes,
          lectureInProgress,
          signal: controller.signal,
          onDelta: (chunk) => {
            rawBuffer += chunk;
            const visible = visibleNotesChatText(rawBuffer);
            setMessages((prev) =>
              prev.map((item) =>
                item.id === STREAMING_ID ? { ...item, content: visible } : item,
              ),
            );
          },
        });
        const content = visibleNotesChatText(rawReply);
        setMessages((prev) =>
          prev.map((item) =>
            item.id === STREAMING_ID
              ? { ...item, id: `local-assistant-${Date.now()}`, content }
              : item,
          ),
        );
      } catch (caught: unknown) {
        if (controller.signal.aborted) {
          setMessages((prev) => prev.filter((item) => item.id !== STREAMING_ID));
          return;
        }
        const messageText = caught instanceof Error ? caught.message : "could not answer";
        setError(messageText);
        setMessages((prev) => prev.filter((item) => item.id !== STREAMING_ID));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setSending(false);
      }
    },
    [boardId, enabled, sending],
  );

  /** Abort a streaming reply and drop the partial bubble. */
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return { messages, sending, error, send, stop };
}
