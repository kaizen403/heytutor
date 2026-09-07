"use client";

import { Highlighter, Settings } from "lucide-react";
import { resolveApiUrl, type SubjectFamiliarity } from "@heytutor/tutor-core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { compressQuestionImage } from "@/features/tutor-session/lib/input/compressQuestionImage";
import { LESSON_DONE_PROMPT } from "@/features/tutor-session/lib/turn/lessonFollowUp";
import { fileFromClipboardData } from "@/features/tutor-session/lib/input/questionImageInput";
import {
  DOUBT_INTERRUPT_HINT,
  DOUBT_PLACEHOLDER,
} from "@/features/tutor-session/lib/input/askDoubt";
import {
  MARK_MODE_PLACEHOLDER,
  MARK_SUBMIT_LABEL,
} from "@/features/tutor-session/lib/board/boardMarking";
import { FamiliarityPicker } from "@/features/tutor-session/components/FamiliarityPicker";
import { useVoiceInput } from "@/features/tutor-session/hooks/useVoiceInput";
import { VoiceLevelBars } from "@/features/tutor-session/components/VoiceLevelBars";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type InputSubmitMode = "ask" | "doubt" | "follow-up";

/** One-line composer height. A pasted problem grows from here, not sideways. */
const QUESTION_LINE_HEIGHT_PX = 28;
/** Tall enough for a typical LeetCode paste; longer problems scroll inside. */
const QUESTION_FIELD_MAX_HEIGHT_PX = 480;

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
  prominent?: boolean;
  onOpenSettings?: () => void;
  /** There is board content worth marking, so offer the marker. */
  canMark?: boolean;
  /** The marker is out and the board is taking strokes. */
  markingArmed?: boolean;
  /** How many marks are held. A marked doubt may be sent with no typed text. */
  markCount?: number;
  onToggleMarking?: () => void;
  /**
   * How well the student says they know this topic, chosen per question.
   * Settings only supplies the default. Omitting both props hides the picker,
   * which is what the doubt and follow-up bars want — a doubt continues the
   * lesson already running at its level.
   */
  familiarity?: SubjectFamiliarity;
  onFamiliarityChange?: (level: SubjectFamiliarity) => void;
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

// Dictation is a Chromium/WebKit API; Firefox has no SpeechRecognition at all.
// Resolved through an external-store read so SSR and hydration agree.
const subscribeToNothing = () => () => {};
const readSpeechSupport = () => getSpeechRecognitionCtor() !== undefined;
const readServerSpeechSupport = () => false;

function submitButtonLabel(mode: InputSubmitMode): string {
  if (mode === "doubt" || mode === "follow-up") return "Ask Doubt";
  return "Ask";
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
  prominent = false,
  onOpenSettings,
  canMark = false,
  markingArmed = false,
  markCount = 0,
  onToggleMarking,
  familiarity,
  onFamiliarityChange,
}: InputBarProps) {
  const [question, setQuestion] = useState("");
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const isMultiline = question.includes("\n");
  const speechSupported = useSyncExternalStore(
    subscribeToNothing,
    readSpeechSupport,
    readServerSpeechSupport,
  );
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
  /** The tutor owns the board (teaching or replaying) and offers its own controls. */
  const isLiveLesson = disabled && Boolean(onPauseToggle);
  /**
   * A live lesson keeps the composer open — the Ask Doubt button is worthless if
   * the student cannot type the doubt while the lesson is on screen.
   */
  const canInterruptWithDoubt = isLiveLesson && Boolean(onAskDoubt);
  const inputLocked = isExtracting || (disabled && !canInterruptWithDoubt);
  /**
   * A mark is a question on its own — "explain this again" is the commonest
   * doubt a student has and the one they are least able to word. So the submit
   * stays live with an empty box as long as something is marked.
   */
  const marksCarryTheQuestion = markingArmed && markCount > 0;
  const buttonDisabled = inputLocked || (trimmed.length === 0 && !marksCarryTheQuestion);
  const nextQuestionDisabled = inputLocked;

  const finishInput = useCallback(() => {
    onUserInteractionChange?.(true);
    setQuestion("");
    setExtractLatencyMs(null);
    setExtractError(null);
  }, [onUserInteractionChange]);

  const runSubmit = useCallback(() => {
    if (isDoubt || canInterruptWithDoubt) {
      onAskDoubt?.(trimmed);
    } else {
      onSubmit(trimmed);
    }
    finishInput();
  }, [canInterruptWithDoubt, finishInput, isDoubt, onAskDoubt, onSubmit, trimmed]);

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

  const handleQuestionKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      // A stacked paste is edited as a box: Enter inserts a line. A one-line
      // question still sends on Enter. ⌘/Ctrl+Enter always sends.
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        submitQuestion();
        return;
      }
      if (event.shiftKey) return;
      if (!question.includes("\n")) {
        event.preventDefault();
        submitQuestion();
      }
    },
    [question, submitQuestion],
  );

  useLayoutEffect(() => {
    const field = questionInputRef.current;
    if (!field) return;
    if (!question.includes("\n")) {
      field.style.height = `${QUESTION_LINE_HEIGHT_PX}px`;
      field.style.overflowY = "hidden";
      return;
    }
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, QUESTION_FIELD_MAX_HEIGHT_PX)}px`;
    field.style.overflowY =
      field.scrollHeight > QUESTION_FIELD_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [question]);

  /** Composing a doubt stops the voice talking over the student. */
  const pauseForDoubt = useCallback(() => {
    if (canInterruptWithDoubt && !isPaused) {
      onPauseToggle?.();
    }
  }, [canInterruptWithDoubt, isPaused, onPauseToggle]);

  const askDoubtFromButton = useCallback(() => {
    if (inputLocked) return;
    if (trimmed.length === 0 && !marksCarryTheQuestion) {
      pauseForDoubt();
      // Nothing typed and nothing marked: hand the student both ways in.
      onToggleMarking?.();
      questionInputRef.current?.focus();
      return;
    }
    runSubmit();
  }, [
    inputLocked,
    marksCarryTheQuestion,
    onToggleMarking,
    pauseForDoubt,
    runSubmit,
    trimmed.length,
  ]);

  const toggleListening = useCallback(() => {
    if (inputLocked) return;

    const SpeechRecognition = getSpeechRecognitionCtor();
    if (!SpeechRecognition) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    // Dictating over a talking tutor feeds the lesson audio straight back into
    // the transcript, so a live lesson pauses before the mic opens.
    pauseForDoubt();

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
  }, [inputLocked, isListening, pauseForDoubt]);

  /**
   * Dictation lands after whatever is already typed rather than replacing it,
   * so a student can type half a question, speak the rest, and keep both.
   */
  const appendTranscript = useCallback(
    (text: string) => {
      setExtractError(null);
      setQuestion((current) => {
        const base = current.trim();
        return base ? `${base} ${text}` : text;
      });
      onUserInteractionChange?.(true);
      questionInputRef.current?.focus();
    },
    [onUserInteractionChange],
  );

  const voice = useVoiceInput({
    onTranscript: appendTranscript,
    // Same reason the browser path pauses: a talking tutor is the loudest thing
    // in the room and would be transcribed instead of the student.
    onStart: pauseForDoubt,
    disabled: inputLocked,
  });
  const {
    toggle: toggleVoice,
    clearError: clearVoiceError,
    unavailable: voiceUnavailable,
  } = voice;

  // No STT key on the server is a deployment fact, not something to put in
  // front of a student. Swallow it; the next press uses browser dictation.
  useEffect(() => {
    if (voiceUnavailable && speechSupported) clearVoiceError();
  }, [clearVoiceError, speechSupported, voiceUnavailable]);

  /** ElevenLabs is the mic; the browser's own dictation is the safety net. */
  const useBrowserDictation = !voice.supported || voiceUnavailable;
  const micAvailable = voice.supported || speechSupported;
  const micListening = useBrowserDictation ? isListening : voice.state === "listening";
  const micTranscribing = voice.state === "transcribing";

  const toggleMic = useCallback(() => {
    if (inputLocked) return;
    if (useBrowserDictation) {
      toggleListening();
      return;
    }
    toggleVoice();
  }, [inputLocked, toggleListening, toggleVoice, useBrowserDictation]);

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
        target.closest(
          '[role="dialog"], input[type="search"], textarea:not([data-question-field])',
        )
      ) {
        return;
      }
      submitPastedImage(event);
    };
    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  }, [inputLocked, submitPastedImage]);

  return (
    <div className="flex w-full flex-col items-stretch gap-1.5">
      {isFollowUp && !disabled && (
        <p className="px-3 text-center text-[0.8125rem]" style={{ color: "var(--text-soft)" }}>
          {LESSON_DONE_PROMPT}
        </p>
      )}
      {canInterruptWithDoubt && trimmed.length > 0 && (
        <p className="px-3 text-center text-[0.8125rem]" style={{ color: "var(--text-soft)" }}>
          {DOUBT_INTERRUPT_HINT}
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
        className={cn(
          // Below sm the composer is a two-row card: photo/input/marker/mic on
          // the first line, the control cluster wrapping full-width beneath.
          // At sm+ a one-line question stays the pill row. A stacked paste
          // opens into a rounded box and grows down, not sideways.
          "wb-input-wrap flex min-w-0 flex-1 flex-wrap gap-1.5",
          isMultiline
            ? "wb-input-wrap--multiline items-end rounded-[1.5rem] px-3 pb-2.5 pt-3"
            : cn(
                "items-center rounded-[1.75rem] py-2 sm:rounded-[9999px]",
                prominent ? "px-3" : "px-2.5",
              ),
        )}
        style={{
          minHeight: prominent ? "64px" : "52px",
          backgroundColor: "var(--ink-850)",
          border: "1px solid var(--stroke)",
          boxShadow:
            "inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 8px 24px -4px rgba(3, 11, 18, 0.45)",
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
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40",
              prominent ? "h-10 w-10" : "h-9 w-9",
            )}
            style={{ color: isExtracting ? "var(--sky-500)" : "var(--text-soft)" }}
            onMouseEnter={(e) => {
              if (!inputLocked) e.currentTarget.style.color = "var(--frost)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = isExtracting ? "var(--sky-500)" : "var(--text-soft)";
            }}
          >
            {isExtracting ? (
              <Spinner size={prominent ? 18 : 16} label="Reading the question" />
            ) : (
              <svg
                width={prominent ? 22 : 20}
                height={prominent ? 22 : 20}
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
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
            )}
          </button>
        )}

        <textarea
          ref={questionInputRef}
          data-question-field
          rows={1}
          value={question}
          onChange={(event) => {
            setExtractError(null);
            setExtractLatencyMs(null);
            setQuestion(event.target.value);
            if (event.target.value.trim().length > 0) {
              pauseForDoubt();
            }
          }}
          onKeyDown={handleQuestionKeyDown}
          disabled={inputLocked}
          autoFocus={autoFocus}
          aria-label="Question"
          placeholder={
            isExtracting
              ? "Reading the question…"
              : micListening
                ? "Listening… press the mic again when you are done"
                : micTranscribing
                  ? "Writing down what you said…"
                  : extractError ??
                    voice.error ??
                    (markingArmed
                      ? MARK_MODE_PLACEHOLDER
                      : canInterruptWithDoubt
                        ? DOUBT_PLACEHOLDER
                        : placeholder)
          }
          className={cn(
            "min-w-0 resize-none bg-transparent px-2 py-1.5 focus:outline-none disabled:opacity-50 placeholder:text-faint",
            // 16px below sm so iOS Safari does not zoom the field on focus.
            prominent ? "text-base" : "text-base sm:text-[15px]",
            isMultiline
              ? "order-first w-full basis-full leading-relaxed"
              : "flex-1 overflow-x-auto whitespace-nowrap",
          )}
          autoComplete="off"
          spellCheck={false}
          style={{
            color: "var(--frost)",
            minHeight: QUESTION_LINE_HEIGHT_PX,
            whiteSpace: isMultiline ? "pre-wrap" : "nowrap",
          }}
        />

        {canMark && onToggleMarking && (
          <button
            type="button"
            onClick={() => {
              if (inputLocked) return;
              pauseForDoubt();
              onToggleMarking();
            }}
            disabled={inputLocked}
            aria-pressed={markingArmed}
            aria-label={markingArmed ? "Put the marker away" : "Mark the board"}
            title={
              markingArmed
                ? "Put the marker away (Esc)"
                : "Mark what you did not follow, then ask (M)"
            }
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40",
              prominent ? "h-10 w-10" : "h-9 w-9",
            )}
            style={{
              color: markingArmed ? "var(--ink-950)" : "var(--text-soft)",
              backgroundColor: markingArmed ? "var(--sky-500)" : "transparent",
            }}
            onMouseEnter={(event) => {
              if (!inputLocked && !markingArmed) {
                event.currentTarget.style.color = "var(--frost)";
              }
            }}
            onMouseLeave={(event) => {
              if (!markingArmed) {
                event.currentTarget.style.color = "var(--text-soft)";
              }
            }}
          >
            <Highlighter
              className={prominent ? "h-[18px] w-[18px]" : "h-4 w-4"}
              strokeWidth={1.9}
              aria-hidden
            />
          </button>
        )}

        {micAvailable && (
          <button
            type="button"
            onClick={toggleMic}
            disabled={inputLocked || micTranscribing}
            aria-pressed={micListening}
            aria-label={
              micListening
                ? "Stop recording and transcribe"
                : micTranscribing
                  ? "Transcribing what you said"
                  : "Ask by voice"
            }
            title={
              micListening
                ? "Press again when you have finished speaking"
                : "Ask by voice"
            }
            className={cn(
              "relative flex shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40",
              prominent ? "h-10 w-10" : "h-9 w-9",
            )}
            style={{
              color:
                micListening || micTranscribing ? "var(--sky-500)" : "var(--text-soft)",
            }}
            onMouseEnter={(e) => {
              if (!inputLocked && !micListening && !micTranscribing) {
                e.currentTarget.style.color = "var(--frost)";
              }
            }}
            onMouseLeave={(e) => {
              if (!micListening && !micTranscribing) {
                e.currentTarget.style.color = "var(--text-soft)";
              }
            }}
          >
            {/* Recording shows the student's own voice moving. A lit box would
                only say "this button is on", which they can already see. */}
            {micListening ? (
              <VoiceLevelBars
                analyserRef={voice.analyserRef}
                bars={5}
                barWidth={2}
                height={prominent ? 18 : 16}
              />
            ) : micTranscribing ? (
              <Spinner size={prominent ? 17 : 15} label="Writing down what you said" />
            ) : (
              <svg
                width={prominent ? 20 : 18}
                height={prominent ? 20 : 18}
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
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
            )}
          </button>
        )}

        {disabled && onPauseToggle ? (
          <div
            className={cn(
              "mr-0 flex w-full shrink-0 items-center justify-between gap-1.5 sm:mr-0.5 sm:w-auto",
              isMultiline && "sm:ml-auto",
            )}
          >
            <button
              type="button"
              onClick={onPauseToggle}
              aria-label={isPaused ? "Resume teaching" : "Pause teaching"}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
              style={{
                backgroundColor: "var(--wb-accent-soft)",
                color: "var(--frost)",
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
                  backgroundColor: "var(--stroke)",
                  color: "var(--text-soft)",
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
            {onOpenSettings ? (
              <InputSettingsButton onOpen={onOpenSettings} prominent={prominent} />
            ) : null}
            <button
              type="button"
              aria-label={marksCarryTheQuestion ? MARK_SUBMIT_LABEL : "Ask Doubt"}
              title={
                marksCarryTheQuestion
                  ? "Teach the part you marked again, from there"
                  : trimmed.length > 0
                    ? DOUBT_INTERRUPT_HINT
                    : "Pause, then mark or type a doubt about this lesson"
              }
              disabled={inputLocked}
              className={cn(
                "btn btn-sky btn-sm shrink-0",
                compact && "w-[38px] px-0",
              )}
              onClick={askDoubtFromButton}
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
              ) : marksCarryTheQuestion ? (
                MARK_SUBMIT_LABEL
              ) : (
                "Ask Doubt"
              )}
            </button>
          </div>
        ) : (
          <div
            className={cn(
              "mr-0 flex w-full shrink-0 items-center justify-between gap-1.5 sm:mr-0.5 sm:w-auto",
              isMultiline && "sm:ml-auto",
            )}
          >
            {familiarity && onFamiliarityChange ? (
              <FamiliarityPicker
                value={familiarity}
                onChange={onFamiliarityChange}
                disabled={inputLocked}
                prominent={prominent}
                compact={compact}
              />
            ) : null}
            {onOpenSettings ? (
              <InputSettingsButton onOpen={onOpenSettings} prominent={prominent} />
            ) : null}
            {/* The landing's pedestal button, not a flat pill: a cap resting on
                a taller base, so pressing drops the cap and the row never
                reflows. Face and geometry both come from `.btn`. */}
            <button
              type="submit"
              disabled={buttonDisabled}
              className={cn("btn btn-sky shrink-0", prominent ? "btn-md" : "btn-sm")}
            >
              {marksCarryTheQuestion ? MARK_SUBMIT_LABEL : submitLabel}
            </button>
            {isFollowUp && (
              <button
                type="button"
                onClick={runNextQuestion}
                disabled={nextQuestionDisabled}
                title={
                  trimmed.length > 0
                    ? "Start this question on a new board"
                    : "Open a new board for your next question"
                }
                className={cn("btn btn-ghost shrink-0", prominent ? "btn-md" : "btn-sm")}
              >
                Next question
              </button>
            )}
          </div>
        )}
      </form>
      {extractLatencyMs != null && !extractError && (
        <p className="px-3 text-center text-[0.6875rem]" style={{ color: "var(--text-soft)" }}>
          Read in {(extractLatencyMs / 1000).toFixed(1)}s. Press Ask to start teaching.
        </p>
      )}
    </div>
  );
}

function InputSettingsButton({
  onOpen,
  prominent,
}: {
  onOpen: () => void;
  prominent: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Board settings"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-stroke bg-ink-700 text-soft transition-colors hover:border-sky-500/35 hover:bg-ink-600 hover:text-sky-200",
        prominent ? "h-10 w-10" : "h-9 w-9",
      )}
    >
      <Settings className={prominent ? "h-[18px] w-[18px]" : "h-4 w-4"} strokeWidth={1.75} />
    </button>
  );
}
