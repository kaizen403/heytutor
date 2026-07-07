import type { RefObject } from "react";
import { ResponseBubble } from "@/components/ResponseBubble";
import { ReplayControls } from "@/components/ReplayControls";
import { getMarkerColorHex, type SettingsState } from "@/components/SettingsDrawer";
import type { WhiteboardHandle, CursorState } from "@heytutor/whiteboard";
import { BOARD_WIDTH, BOARD_HEIGHT } from "../constants";
import type { BoardViewport, TutorPhase } from "../types";
import { Whiteboard } from "./WhiteboardLoader";
import { BoardErrorBanner } from "./BoardErrorBanner";

export interface SessionBoardCanvasProps {
  boardContainerRef: RefObject<HTMLDivElement | null>;
  boardViewport: BoardViewport;
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  cursorState: CursorState;
  settings: SettingsState;
  phase: TutorPhase;
  currentSegmentText: string;
  lastError: { message: string; question: string } | null;
  isReplaying: boolean;
  isPaused: boolean;
  replayProgressMs: number;
  replayTotalMs: number;
  onRetryError: (question: string) => void;
  onDismissError: () => void;
  onReplayPlayPause: () => void;
  onReplaySeek: (ms: number) => void;
  onReplaySpeedChange: (rate: number) => void;
  onStop: () => void;
}

export function SessionBoardCanvas({
  boardContainerRef,
  boardViewport,
  whiteboardRef,
  cursorState,
  settings,
  phase,
  currentSegmentText,
  lastError,
  isReplaying,
  isPaused,
  replayProgressMs,
  replayTotalMs,
  onRetryError,
  onDismissError,
  onReplayPlayPause,
  onReplaySeek,
  onReplaySpeedChange,
  onStop,
}: SessionBoardCanvasProps) {
  return (
    <div
      ref={boardContainerRef}
      className="absolute inset-0 z-[1] overflow-hidden"
    >
      <div
        style={{
          position: "absolute",
          top: boardViewport.offsetY,
          left: boardViewport.offsetX,
          width: BOARD_WIDTH * boardViewport.scale,
          height: BOARD_HEIGHT * boardViewport.scale,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: BOARD_WIDTH,
            height: BOARD_HEIGHT,
            transform: `scale(${boardViewport.scale})`,
            transformOrigin: "top left",
          }}
        >
          <Whiteboard
            ref={whiteboardRef}
            width={BOARD_WIDTH}
            height={BOARD_HEIGHT}
            cursorState={cursorState}
            inkColor={getMarkerColorHex(settings.markerColor)}
          />
        </div>

        <ResponseBubble
          text={currentSegmentText}
          visible={
            settings.subtitlesEnabled &&
            (phase === "speaking" || phase === "drawing")
          }
        />

        {phase === "idle" && lastError && (
          <BoardErrorBanner
            message={lastError.message}
            onRetry={() => onRetryError(lastError.question)}
            onDismiss={onDismissError}
          />
        )}

        <ReplayControls
          visible={isReplaying}
          playing={isReplaying && !isPaused}
          progressMs={replayProgressMs}
          totalMs={replayTotalMs}
          playbackRate={settings.speedMultiplier}
          onPlayPause={onReplayPlayPause}
          onSeek={onReplaySeek}
          onPlaybackRateChange={onReplaySpeedChange}
          onStop={onStop}
        />
      </div>
    </div>
  );
}
