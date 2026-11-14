import { useCallback, useEffect, useRef, useState } from "react";
import { visibleNotesChatText } from "@heytutor/tutor-core";
import {
  fetchNotesChatMessages,
  streamNotesChatMessage,
  type NotesChatLivePayload,
  type NotesChatMessage,
} from "@/lib/boards/notesChatClient";
import type { NotesChatTag } from "@/features/tutor-session/lib/notes/notesChatTag";

const STREAMING_ID = "notes-chat-streaming";

export function useNotesChat(boardId: string, enabled = true) {
  const [messages, setMessages] = useState<NotesChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const messagesVersion = useRef(0);
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
    setHistoryError(null);
    setMessages([]);
  }

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    return () => {
      abortRef.current?.abort();
    };
  }, [boardId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const version = messagesVersion.current;
    let cancelled = false;
    void fetchNotesChatMessages(boardId, controller.signal)
      .then((loaded) => {
        if (cancelled || boardIdRef.current !== boardId) return;
        // A history read started before a new message must not replace that
        // message or its streamed reply when the older request finishes.
        if (messagesVersion.current === version) setMessages(loaded);
      })
      .catch(() => {
        if (cancelled || controller.signal.aborted || boardIdRef.current !== boardId) return;
        setHistoryError("Saved messages didn't load. Try again.");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [boardId, enabled, historyAttempt]);

  const reloadHistory = useCallback(() => {
    if (!enabled || sending) return;
    setHistoryError(null);
    setHistoryAttempt((attempt) => attempt + 1);
  }, [enabled, sending]);

  const send = useCallback(
    async (
      raw: string,
      liveNotes: NotesChatLivePayload | null,
      lectureInProgress: boolean,
      tag: NotesChatTag | null = null,
    ) => {
      const message = raw.trim();
      if (!enabled || !message || sending) return;

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      setSending(true);
      setError(null);
      messagesVersion.current += 1;
      let rawBuffer = "";

      const userMessage: NotesChatMessage = {
        id: `local-user-${Date.now()}`,
        role: "user",
        content: message,
        createdAt: Date.now(),
        tag,
      };
      const assistantMessage: NotesChatMessage = {
        id: STREAMING_ID,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        tag: null,
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);

      try {
        const rawReply = await streamNotesChatMessage({
          boardId,
          message,
          tag,
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

  return { messages, sending, error, historyError, reloadHistory, send, stop };
}
