import type { SpeechStartupStatus } from "../../hooks/turn/types";
import type { TutorPhase } from "../../types";

/** A permission wait can start on any live beat, including after a committed
 * figure. Its action belongs to the current generation, never to replay. */
export function speechRecoveryStatus(
  status: SpeechStartupStatus | null,
  input: {
    phase: TutorPhase;
    turnGeneration: number;
    muted: boolean;
    rewindActive: boolean;
    isReplaying: boolean;
  },
): SpeechStartupStatus | null {
  // Muting retries the retained clip; only actual accepted playback clears
  // status. If that retry is also denied, its gesture action must stay visible.
  if (!status || input.phase === "idle" || input.rewindActive || input.isReplaying ||
    status.turnGeneration !== input.turnGeneration) return null;
  return status;
}
