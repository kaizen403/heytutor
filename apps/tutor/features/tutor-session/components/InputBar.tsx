"use client";

import { resolveApiUrl } from "@heytutor/tutor-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { compressQuestionImage } from "@/features/tutor-session/lib/compressQuestionImage";
import { LESSON_DONE_PROMPT } from "@/features/tutor-session/lib/lessonFollowUp";
import { fileFromClipboardData } from "@/features/tutor-session/lib/questionImageInput";
import { cn } from "@/lib/utils";

export type InputSubmitMode = "ask" | "doubt" | "follow-up";

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
  autoFocus?: boolean;
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
  if (mode === "doubt" || mode === "follow-up") return "Ask Doubt";
  return "Ask";
}

function submitButtonColors(_mode: InputSubmitMode, inactive: boolean) {
  if (inactive) {
    return {
      backgroundColor: "rgba(240, 246, 252, 0.06)",
      color: "rgba(139, 148, 158, 0.7)",
    };
  }

  return { backgroundColor: "#6E6E76", color: "#FFFFFF" };
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
  placeholder = "Ask a question or paste a photo",
  autoFocus = false,
  onUserInteractionChange,
  compact = false,
}: InputBarProps) {
  const [question, setQuestion] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractLatencyMs, setExtractLatencyMs] = useState<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractGenerationRef = useRef(0);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const trimmed = question.trim();
  const isFollowUp = submitMode === "follow-up";
  const isDoubt = submitMode === "doubt" || isFollowUp;
  const submitLabel = submitButtonLabel(submitMode);
  const inputLocked = disabled || isExtracting;
  const buttonDisabled = inputLocked || trimmed.length === 0;
  const nextQuestionDisabled = inputLocked;

  const finishInput = useCallback(() => {
    onUserInteractionChange?.(true);
    setQuestion("");
    setExtractLatencyMs(null);
    setExtractError(null);
  }, [onUserInteractionChange]);

  const runSubmit = useCallback(() => {
    if (isDoubt) {
      onAskDoubt?.(trimmed);
    } else {
      onSubmit(trimmed);
    }
    finishInput();
  }, [finishInput, isDoubt, onAskDoubt, onSubmit, trimmed]);

  const runNextQuestion = useCallback(() => {
    if (nextQuestionDisabled) return;
    onSubmit(trimmed);
    finishInput();
  }, [finishInput, nextQuestionDisabled, onSubmit, trimmed]);

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
    if (inputLocked) return;

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
  }, [inputLocked, isListening]);

  const handleImageClick = useCallback(() => {
    if (inputLocked) return;
    fileInputRef.current?.click();
  }, [inputLocked]);

  const extractQuestionFromImage = useCallback(
    async (file: File) => {
      const generation = extractGenerationRef.current + 1;
      extractGenerationRef.current = generation;
      setExtractError(null);
      setExtractLatencyMs(null);
      setIsExtracting(true);
      const startedAt = performance.now();
      try {
        const image = await compressQuestionImage(file);
        const response = await fetch(resolveApiUrl("/api/extract-question"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          question?: unknown;
          error?: unknown;
          latencyMs?: unknown;
        };
        if (extractGenerationRef.current !== generation) {
          return;
        }
        if (!response.ok || typeof data.question !== "string") {
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Could not read that image. Try a clearer photo.",
          );
        }
        onImageSelect?.(file);
        setQuestion(data.question);
        setExtractLatencyMs(
          typeof data.latencyMs === "number"
            ? data.latencyMs
            : Math.round(performance.now() - startedAt),
        );
      } catch (error) {
        if (extractGenerationRef.current !== generation) {
          return;
        }
        setExtractError(
          error instanceof Error
            ? error.message
            : "Could not read that image. Try a clearer photo.",
        );
      } finally {
        if (extractGenerationRef.current === generation) {
          setIsExtracting(false);
        }
      }
    },
    [onImageSelect],
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) {
        void extractQuestionFromImage(file);
      }
    },
    [extractQuestionFromImage],
  );

  const submitPastedImage = useCallback(
    (event: { clipboardData: DataTransfer | null; preventDefault(): void }) => {
      if (inputLocked) return;
      const file = fileFromClipboardData(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      void extractQuestionFromImage(file);
    },
    [extractQuestionFromImage, inputLocked],
  );

  useEffect(() => {
    if (inputLocked) return;
    const onWindowPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('[role="dialog"], textarea, input[type="search"]')
      ) {
        return;
      }
      submitPastedImage(event);
    };
    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  }, [inputLocked, submitPastedImage]);

  const submitColors = submitButtonColors(submitMode, buttonDisabled);

  return (
    <div className="flex w-full flex-col items-stretch gap-1.5">
      {isFollowUp && !disabled && (
        <p className="px-3 text-center text-[0.8125rem]" style={{ color: "#A6A6AE" }}>
          {LESSON_DONE_PROMPT}
        </p>
      )}
      <form
        onSubmit={handleSubmit}
        onDragOver={(event) => {
          if (inputLocked) return;
          if ([...event.dataTransfer.types].includes("Files")) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => {
          if (inputLocked) return;
          const file = fileFromClipboardData(event.dataTransfer);
          if (!file) return;
          event.preventDefault();
          void extractQuestionFromImage(file);
        }}
        className="wb-input-wrap flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-2"
        style={{
          minHeight: "52px",
          backgroundColor: "#151517",
          border: "1px solid #2E2E33",
          borderRadius: "9999px",
          boxShadow: "0 8px 24px -4px rgba(0, 0, 0, 0.45)",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          disabled={inputLocked}
          aria-hidden
          tabIndex={-1}
        />

        {!(compact && disabled) && (
          <button
            type="button"
            onClick={handleImageClick}
            disabled={inputLocked}
            aria-label="Add question photo"
            title="Upload or paste a question photo"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
            style={{ color: isExtracting ? "#C9C9D2" : "#A6A6AE" }}
            onMouseEnter={(e) => {
              if (!inputLocked) e.currentTarget.style.color = "#F2F2F4";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = isExtracting ? "#C9C9D2" : "#A6A6AE";
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect
                x="3.5"
                y="6"
                width="17"
                height="13"
                rx="2.25"
                stroke="currentColor"
                strokeWidth="1.75"
              />
              <circle cx="8.5" cy="10.25" r="1.35" fill="currentColor" />
              <path
                d="M7 17.5l4.2-4.4a1.2 1.2 0 0 1 1.7 0L17.5 17.5"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}

        <input
          type="text"
          value={question}
          onChange={(event) => {
            setExtractError(null);
            setExtractLatencyMs(null);
            setQuestion(event.target.value);
          }}
          disabled={inputLocked}
          autoFocus={autoFocus}
          placeholder={
            isExtracting
              ? "Reading the question…"
              : extractError ?? placeholder
          }
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[15px] focus:outline-none disabled:opacity-50 placeholder:text-[#717177]"
          autoComplete="off"
          spellCheck={false}
          style={{ color: "#F2F2F4" }}
        />

        <button
          type="button"
          onClick={toggleListening}
          disabled={inputLocked}
          aria-label={isListening ? "Stop dictation" : "Dictate question"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40"
          style={{
            color: isListening ? "#C9C9D2" : "#A6A6AE",
          }}
          onMouseEnter={(e) => {
            if (!inputLocked && !isListening) {
              e.currentTarget.style.color = "#F2F2F4";
            }
          }}
          onMouseLeave={(e) => {
            if (!isListening) {
              e.currentTarget.style.color = "#A6A6AE";
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
                backgroundColor: "rgba(201, 201, 210, 0.15)",
                color: "#F2F2F4",
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
                  backgroundColor: "rgba(240, 246, 252, 0.06)",
                  color: "#A6A6AE",
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
          <div className="mr-0.5 flex shrink-0 items-center gap-1.5">
            <button
              type="submit"
              disabled={buttonDisabled}
              className="shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all"
              style={{
                ...submitColors,
                cursor: buttonDisabled ? "not-allowed" : "pointer",
              }}
            >
              {submitLabel}
            </button>
            {isFollowUp && (
              <button
                type="button"
                onClick={runNextQuestion}
                disabled={nextQuestionDisabled}
                className="shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all disabled:opacity-40"
                style={{
                  backgroundColor: "rgba(201, 201, 210, 0.15)",
                  color: "#F2F2F4",
                  cursor: nextQuestionDisabled ? "not-allowed" : "pointer",
                }}
              >
                Next Question
              </button>
            )}
          </div>
        )}
      </form>
      {extractLatencyMs != null && !extractError && (
        <p className="px-3 text-center text-[0.6875rem]" style={{ color: "#A6A6AE" }}>
          Read in {(extractLatencyMs / 1000).toFixed(1)}s. Press Ask to start teaching.
        </p>
      )}
    </div>
  );
}
