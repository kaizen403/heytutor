"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, Check, Copy } from "lucide-react";
import { PenSpinner } from "@heytutor/whiteboard/pen-spinner";

import type { NotesChatMessage } from "@/lib/boards/notesChatClient";
import { MathText } from "@/features/tutor-session/components/MathText";

const STREAMING_ID = "notes-chat-streaming";
const NEAR_BOTTOM_PX = 48;

interface NotesChatThreadProps {
  messages: NotesChatMessage[];
  sending: boolean;
  starters: string[];
  onStarter: (prompt: string) => void;
}

function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => undefined);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy answer"
      title="Copy answer"
      className="ncs__icon-btn"
    >
      {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.8} />}
    </button>
  );
}

export function NotesChatThread({
  messages,
  sending,
  starters,
  onStarter,
}: NotesChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);

  const scrollToEnd = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const atBottom = distance <= NEAR_BOTTOM_PX;
    pinnedRef.current = atBottom;
    setPinned(atBottom);
  }, []);

  // Follow the stream only while the reader is already at the bottom, so
  // scrolling back to re-read an earlier answer is never yanked away.
  useEffect(() => {
    if (!pinnedRef.current) return;
    scrollToEnd(messages.length > 2 ? "smooth" : "auto");
  }, [messages, scrollToEnd]);

  if (messages.length === 0) {
    return (
      <div className="ncs__scroll">
        <div className="ncs__empty">
          <p className="ncs__empty-title">Ask me anything</p>
          <p className="ncs__empty-body">
            About a line on the board, the idea behind it, or the next question you
            are stuck on.
          </p>
          <div className="ncs__chips ncs__empty-chips">
            {starters.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="ncs__chip"
                onClick={() => onStarter(prompt)}
              >
                <MathText handwritten={false}>{prompt}</MathText>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ncs__thread-wrap">
      <div className="ncs__scroll" ref={scrollRef} onScroll={handleScroll}>
        <div className="ncs__thread">
          {messages.map((message) => {
            const isUser = message.role === "user";
            const streaming = message.id === STREAMING_ID;

            if (isUser) {
              return (
                <div key={message.id} className="ncs__msg ncs__msg--user">
                  {message.tag ? (
                    <span className="ncs__tag">
                      <span className="ncs__tag-kind">
                        {message.tag.kind === "work" ? "line" : message.tag.kind}
                      </span>
                      <span className="ncs__tag-text">
                        <MathText>{message.tag.text}</MathText>
                      </span>
                    </span>
                  ) : null}
                  <div className="ncs__bubble ncs__bubble--user">
                    <MathText>{message.content}</MathText>
                  </div>
                </div>
              );
            }

            return (
              <div key={message.id} className="ncs__msg">
                <span className="ncs__msg-label">Tutor</span>
                <div className="ncs__bubble ncs__bubble--assistant">
                  <MathText>{message.content}</MathText>
                  {streaming && sending ? (
                    message.content ? (
                      <span className="ncs__caret" />
                    ) : (
                      <span className="ncs__pending">
                        <PenSpinner size={22} ink="#C9C9D2" label="Thinking" />
                        thinking
                      </span>
                    )
                  ) : null}
                </div>
                {!streaming && message.content ? (
                  <div className="ncs__msg-foot">
                    <CopyMessage text={message.content} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {!pinned ? (
        <button type="button" className="ncs__jump" onClick={() => scrollToEnd()}>
          <ArrowDown size={13} strokeWidth={2} />
          Latest
        </button>
      ) : null}
    </div>
  );
}
