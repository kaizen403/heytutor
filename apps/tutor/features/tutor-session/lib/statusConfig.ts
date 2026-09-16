import type { TutorPhase, StatusDisplay } from "../types";

export const STATUS_CONFIG: Record<TutorPhase, StatusDisplay> = {
  idle: {
    color: "rgba(118, 118, 118, 0.7)",
    label: "ready",
    dotClass: "",
    labelColor: "rgba(118, 118, 118, 0.7)",
  },
  planning: {
    color: "#4A9EFF",
    label: "planning\u2026",
    dotClass: "animate-wb-pulse",
    labelColor: "#4A9EFF",
  },
  thinking: {
    color: "#4A9EFF",
    label: "thinking\u2026",
    dotClass: "animate-wb-pulse",
    labelColor: "#4A9EFF",
  },
  drawing: {
    color: "#4A9EFF",
    label: "teaching\u2026",
    dotClass: "animate-wb-glow",
    labelColor: "#4A9EFF",
  },
  speaking: {
    color: "#4A9EFF",
    label: "teaching\u2026",
    dotClass: "animate-wb-glow",
    labelColor: "#4A9EFF",
  },
};

export const PAUSED_STATUS: StatusDisplay = {
  color: "#767676",
  label: "paused",
  dotClass: "",
  labelColor: "#767676",
};

export const REPLAYING_STATUS: StatusDisplay = {
  color: "#4A9EFF",
  label: "replaying\u2026",
  dotClass: "animate-wb-glow",
  labelColor: "#4A9EFF",
};

export const REWINDING_STATUS: StatusDisplay = {
  color: "#4A9EFF",
  label: "reviewing\u2026",
  dotClass: "animate-wb-glow",
  labelColor: "#4A9EFF",
};

export function resolveActiveStatus(
  phase: TutorPhase,
  isReplaying: boolean,
  isPaused: boolean,
  isRewound = false,
): StatusDisplay {
  // A rewound lecture is paused under the hood, but "reviewing" is what the
  // student is actually doing.
  if (isRewound) {
    return REWINDING_STATUS;
  }
  if (isReplaying) {
    return REPLAYING_STATUS;
  }
  if (isPaused) {
    return PAUSED_STATUS;
  }
  return STATUS_CONFIG[phase];
}
