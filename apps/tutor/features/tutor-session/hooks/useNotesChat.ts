import { useCallback, useEffect, useRef, useState } from "react";
import { visibleNotesChatText } from "@heytutor/tutor-core";
import {
  fetchNotesChatMessages,
  streamNotesChatMessage,
  type NotesChatLivePayload,
  type NotesChatMessage,
} from "@/lib/boards/notesChatClient";
import type { NotesChatTag } from "@/features/tutor-session/lib/notes/notesChatTag";

export function useNotesChat(boardId: string, enabled = true) {
  const [messages, setMessages] = useState<NotesChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
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
    let cancelled = false;
    void fetchNotesChatMessages(boardId, controller.signal)
      .then((loaded) => {
        if (cancelled || boardIdRef.current !== boardId) return;
        // Optimistic and persisted messages share identities. Merge an older
        // history read with new messages, including replies still streaming.
        setMessages((current) => {
          const byId = new Map(current.map((message) => [message.id, message]));
          const loadedIds = new Set(loaded.map((message) => message.id));
          return [
            ...loaded.map((message) => byId.get(message.id) ?? message),
            ...current.filter((message) => !loadedIds.has(message.id)),
          ];
        });
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
      let rawBuffer = "";
      const messageIds = { user: crypto.randomUUID(), assistant: crypto.randomUUID() };
      const isCurrent = () => abortRef.current === controller && boardIdRef.current === boardId;

      const userMessage: NotesChatMessage = {
        id: messageIds.user,
        role: "user",
        content: message,
        createdAt: Date.now(),
        tag,
      };
      const assistantMessage: NotesChatMessage = {
        id: messageIds.assistant,
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
          messageIds,
          tag,
          liveNotes,
          lectureInProgress,
          signal: controller.signal,
          onDelta: (chunk) => {
            if (!isCurrent() || controller.signal.aborted) return;
            rawBuffer += chunk;
            const visible = visibleNotesChatText(rawBuffer);
            setMessages((prev) =>
              prev.map((item) =>
                item.id === messageIds.assistant ? { ...item, content: visible } : item,
              ),
            );
          },
        });
        if (!isCurrent()) return;
        controller.signal.throwIfAborted();
        const content = visibleNotesChatText(rawReply);
        setMessages((prev) =>
          prev.map((item) =>
            item.id === messageIds.assistant
              ? { ...item, content }
              : item,
          ),
        );
      } catch (caught: unknown) {
        if (!isCurrent()) return;
        if (controller.signal.aborted) {
          setMessages((prev) => prev.filter((item) => item.id !== messageIds.assistant));
          return;
        }
        const messageText = caught instanceof Error ? caught.message : "could not answer";
        setError(messageText);
        setMessages((prev) => prev.filter((item) => item.id !== messageIds.assistant));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setSending(false);
        }
      }
    },
    [boardId, enabled, sending],
  );

  /** Abort a streaming reply and drop the partial bubble. */
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, sending, error, historyError, reloadHistory, send, stop };
}
