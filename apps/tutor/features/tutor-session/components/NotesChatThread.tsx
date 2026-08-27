import { useEffect, useRef } from "react";
import type { NotesChatMessage } from "@/lib/boards/notesChatClient";

interface NotesChatThreadProps {
  messages: NotesChatMessage[];
  sending: boolean;
  emptyHint: string;
}

export function NotesChatThread({ messages, sending, emptyHint }: NotesChatThreadProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-end px-4 py-3">
        <p className="text-sm leading-relaxed text-[#A6A6AE]">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
      {messages.map((message) => {
        const isUser = message.role === "user";
        const streaming = message.id === "notes-chat-streaming";
        return (
          <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div
              className={
                isUser
                  ? "max-w-[90%] rounded-2xl rounded-br-md bg-[#2E2E33] px-3 py-2 text-sm leading-relaxed text-[#F2F2F4]"
                  : "max-w-[90%] rounded-2xl rounded-bl-md bg-[#1E1E21] px-3 py-2 text-sm leading-relaxed text-[#DEDEE4]"
              }
            >
              {message.content || (streaming ? "…" : "")}
              {streaming && sending ? (
                <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-[#C9C9D2] align-middle" />
              ) : null}
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
