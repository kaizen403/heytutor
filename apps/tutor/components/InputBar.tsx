"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface InputBarProps {
  onSubmit: (question: string) => void;
  onAskDoubt?: (question: string) => void;
  onImageSelect?: (file: File) => void;
  disabled?: boolean;
  isPaused?: boolean;
  onPauseToggle?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  onUserInteractionChange?: (hasInteracted: boolean) => void;
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

export function InputBar({
  onSubmit,
  onAskDoubt,
  onImageSelect,
  disabled = false,
  isPaused = false,
  onPauseToggle,
  onCancel,
  placeholder = "Ask anything",
  onUserInteractionChange,
}: InputBarProps) {
  const [question, setQuestion] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isDoubtMode, setIsDoubtMode] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const trimmed = question.trim();
  const buttonDisabled = disabled || trimmed.length === 0;

  const submitQuestion = useCallback(() => {
    if (buttonDisabled) return;
    if (isDoubtMode && onAskDoubt) {
      onAskDoubt(trimmed);
    } else {
      onSubmit(trimmed);
    }
    onUserInteractionChange?.(true);
    setQuestion("");
    setIsDoubtMode(false);
  }, [buttonDisabled, isDoubtMode, onAskDoubt, onSubmit, trimmed, onUserInteractionChange]);

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

  return (
    <div className="flex w-full items-stretch gap-2">
      <form
        onSubmit={handleSubmit}
        className="wb-input-wrap flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-2"
        style={{
          minHeight: "52px",
          backgroundColor: "rgba(19, 93, 102, 0.85)",
          border: "1px solid rgba(119, 176, 170, 0.2)",
          borderRadius: "9999px",
          boxShadow: "0 2px 16px -2px rgba(0, 0, 0, 0.45)",
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

        <button
          type="button"
          onClick={handleImageClick}
          disabled={disabled}
          aria-label="Add image"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
          style={{ color: "rgba(227, 254, 247, 0.55)" }}
          onMouseEnter={(e) => {
            if (!disabled) e.currentTarget.style.color = "rgba(227, 254, 247, 0.85)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "rgba(227, 254, 247, 0.55)";
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

        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={disabled}
          placeholder={isDoubtMode ? "Ask a doubt" : placeholder}
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[15px] focus:outline-none disabled:opacity-50"
          autoComplete="off"
          spellCheck={false}
          style={{ color: "rgba(227, 254, 247, 0.9)" }}
        />

        <button
          type="button"
          onClick={toggleListening}
          disabled={disabled}
          aria-label={isListening ? "Stop dictation" : "Dictate question"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
          style={{
            color: isListening ? "#77B0AA" : "rgba(227, 254, 247, 0.55)",
          }}
          onMouseEnter={(e) => {
            if (!disabled && !isListening) {
              e.currentTarget.style.color = "rgba(227, 254, 247, 0.85)";
            }
          }}
          onMouseLeave={(e) => {
            if (!isListening) {
              e.currentTarget.style.color = "rgba(227, 254, 247, 0.55)";
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
                backgroundColor: "rgba(119, 176, 170, 0.12)",
                color: "rgba(227, 254, 247, 0.9)",
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
                  color: "#D97070",
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
          </div>
        ) : (
          <>
            {onAskDoubt && (
              <button
                type="button"
                onClick={() => setIsDoubtMode(!isDoubtMode)}
                aria-pressed={isDoubtMode}
                aria-label="Toggle doubt mode"
                disabled={disabled}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all disabled:opacity-40"
                style={{
                  color: isDoubtMode ? "#D97070" : "rgba(227, 254, 247, 0.55)",
                  backgroundColor: isDoubtMode
                    ? "rgba(217, 112, 112, 0.12)"
                    : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!disabled && !isDoubtMode) {
                    e.currentTarget.style.color = "rgba(227, 254, 247, 0.85)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isDoubtMode) {
                    e.currentTarget.style.color = "rgba(227, 254, 247, 0.55)";
                  }
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                  <circle cx="12" cy="17" r="1" fill="currentColor" />
                </svg>
              </button>
            )}
            <button
              type="submit"
              disabled={buttonDisabled}
              className="mr-0.5 shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all"
              style={{
                backgroundColor: buttonDisabled
                  ? "rgba(119, 176, 170, 0.08)"
                  : isDoubtMode
                    ? "#D97070"
                    : "#77B0AA",
                color: buttonDisabled
                  ? "rgba(227, 254, 247, 0.35)"
                  : isDoubtMode
                    ? "#E3FEF7"
                    : "#003C43",
                cursor: buttonDisabled ? "not-allowed" : "pointer",
              }}
            >
              {isDoubtMode ? "Ask Doubt" : "Ask"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
