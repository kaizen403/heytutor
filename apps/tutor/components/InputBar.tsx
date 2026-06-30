"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type InputSubmitMode = "ask" | "doubt";

export interface InputBarProps {
  onSubmit: (question: string) => void;
  onAskDoubt?: (question: string) => void;
  onImageSelect?: (file: File) => void;
  disabled?: boolean;
  submitMode?: InputSubmitMode;
  isPaused?: boolean;
  onPauseToggle?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  onUserInteractionChange?: (hasInteracted: boolean) => void;
  compact?: boolean;
}

type SpeechRecognitionResultList = {
  length: number;
  [index: number]: { 0: { transcript: string } };
};

type SpeechRecognitionResultEvent = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getSpeechRecognitionCtor():
  | (new () => SpeechRecognitionInstance)
  | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function submitButtonLabel(mode: InputSubmitMode): string {
  return mode === "doubt" ? "Ask Doubt" : "Ask";
}

function submitButtonColors(mode: InputSubmitMode, inactive: boolean) {
  if (inactive) {
    return {
      backgroundColor: mode === "doubt" ? "rgba(158, 64, 64, 0.08)" : "rgba(0, 119, 204, 0.08)",
      color: "rgba(51, 51, 51, 0.35)",
    };
  }

  return mode === "doubt"
    ? { backgroundColor: "#9E4040", color: "#FFFFFF" }
    : { backgroundColor: "#0077CC", color: "#FFFFFF" };
}

export function InputBar({
  onSubmit,
  onAskDoubt,
  onImageSelect,
  disabled = false,
  submitMode = "ask",
  isPaused = false,
  onPauseToggle,
  onCancel,
  placeholder = "",
  onUserInteractionChange,
  compact = false,
}: InputBarProps) {
  const [question, setQuestion] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const trimmed = question.trim();
  const isDoubt = submitMode === "doubt";
  const submitLabel = submitButtonLabel(submitMode);
  const buttonDisabled = disabled || trimmed.length === 0;

  const runSubmit = useCallback(() => {
    if (isDoubt) {
      onAskDoubt?.(trimmed);
    } else {
      onSubmit(trimmed);
    }
    onUserInteractionChange?.(true);
    setQuestion("");
  }, [isDoubt, onAskDoubt, onSubmit, onUserInteractionChange, trimmed]);

  const submitQuestion = useCallback(() => {
    if (buttonDisabled) return;
    runSubmit();
  }, [buttonDisabled, runSubmit]);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      submitQuestion();
    },
    [submitQuestion],
  );

  const toggleListening = useCallback(() => {
    if (disabled) return;

    const SpeechRecognition = getSpeechRecognitionCtor();
    if (!SpeechRecognition) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionResultEvent) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setQuestion(transcript);
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [disabled, isListening]);

  const handleImageClick = useCallback(() => {
    if (disabled) return;
    fileInputRef.current?.click();
  }, [disabled]);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        onImageSelect?.(file);
      }
      event.target.value = "";
    },
    [onImageSelect],
  );

  const submitColors = submitButtonColors(submitMode, buttonDisabled);

  return (
    <div className="flex w-full items-stretch gap-2">
      <form
        onSubmit={handleSubmit}
        className="wb-input-wrap flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-2"
        style={{
          minHeight: "52px",
          backgroundColor: "rgba(255, 255, 255, 0.95)",
          border: "1px solid rgba(0, 119, 204, 0.2)",
          borderRadius: "9999px",
          boxShadow: "0 2px 16px -2px rgba(0, 0, 0, 0.1)",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          disabled={disabled}
          aria-hidden
          tabIndex={-1}
        />

        {!(compact && disabled) && (
          <button
            type="button"
            onClick={handleImageClick}
            disabled={disabled}
            aria-label="Add image"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
            style={{ color: "rgba(51, 51, 51, 0.55)" }}
            onMouseEnter={(e) => {
              if (!disabled) e.currentTarget.style.color = "rgba(51, 51, 51, 0.85)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "rgba(51, 51, 51, 0.55)";
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}

        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[15px] focus:outline-none disabled:opacity-50"
          autoComplete="off"
          spellCheck={false}
          style={{ color: "rgba(51, 51, 51, 0.9)" }}
        />

        <button
          type="button"
          onClick={toggleListening}
          disabled={disabled}
          aria-label={isListening ? "Stop dictation" : "Dictate question"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
          style={{
            color: isListening ? "#0077CC" : "rgba(51, 51, 51, 0.55)",
          }}
          onMouseEnter={(e) => {
            if (!disabled && !isListening) {
              e.currentTarget.style.color = "rgba(51, 51, 51, 0.85)";
            }
          }}
          onMouseLeave={(e) => {
            if (!isListening) {
              e.currentTarget.style.color = "rgba(51, 51, 51, 0.55)";
            }
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect
              x="9"
              y="2"
              width="6"
              height="11"
              rx="3"
              stroke="currentColor"
              strokeWidth="1.75"
            />
            <path
              d="M5 10a7 7 0 0 0 14 0M12 17v3"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {disabled && onPauseToggle ? (
          <div className="mr-0.5 flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onPauseToggle}
              aria-label={isPaused ? "Resume teaching" : "Pause teaching"}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
              style={{
                backgroundColor: "rgba(0, 119, 204, 0.12)",
                color: "rgba(51, 51, 51, 0.9)",
              }}
            >
              {isPaused ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              )}
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                aria-label="Cancel teaching"
                className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
                style={{
                  backgroundColor: "rgba(217, 112, 112, 0.15)",
                  color: "#9E4040",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            <button
              type="button"
              aria-label="Ask Doubt"
              className={cn(
                "shrink-0 rounded-full font-medium transition-all",
                compact
                  ? "flex h-9 w-9 items-center justify-center"
                  : "px-4 py-2 text-sm",
              )}
              style={submitButtonColors("doubt", false)}
              onClick={() => {
                // wired up later during live lecture
              }}
            >
              {compact ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 20h.01M12 6a4 4 0 0 1 4 4c0 2-2 2.5-2 3.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                "Ask Doubt"
              )}
            </button>
          </div>
        ) : (
          <button
            type="submit"
            disabled={buttonDisabled}
            className="mr-0.5 shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all"
            style={{
              ...submitColors,
              cursor: buttonDisabled ? "not-allowed" : "pointer",
            }}
          >
            {submitLabel}
          </button>
        )}
      </form>
    </div>
  );
}
