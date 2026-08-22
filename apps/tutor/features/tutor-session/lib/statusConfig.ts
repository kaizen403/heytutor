import type { TutorPhase, StatusDisplay } from "../types";

export const STATUS_CONFIG: Record<TutorPhase, StatusDisplay> = {
  idle: {
    color: "rgba(113, 113, 119, 0.7)",
    label: "ready",
    dotClass: "",
    labelColor: "rgba(113, 113, 119, 0.7)",
  },
  planning: {
    color: "#C9C9D2",
    label: "planning\u2026",
    dotClass: "animate-wb-pulse-amber",
    labelColor: "#C9C9D2",
  },
  thinking: {
    color: "#C9C9D2",
    label: "thinking\u2026",
    dotClass: "animate-wb-pulse-amber",
    labelColor: "#C9C9D2",
  },
  drawing: {
    color: "#C9C9D2",
    label: "teaching\u2026",
    dotClass: "animate-wb-glow-blue",
    labelColor: "#C9C9D2",
  },
  speaking: {
    color: "#C9C9D2",
    label: "teaching\u2026",
    dotClass: "animate-wb-glow-blue",
    labelColor: "#C9C9D2",
  },
};

export const PAUSED_STATUS: StatusDisplay = {
  color: "#717177",
  label: "paused",
  dotClass: "",
  labelColor: "#717177",
};

export const REPLAYING_STATUS: StatusDisplay = {
  color: "#C9C9D2",
  label: "replaying\u2026",
  dotClass: "animate-wb-glow-blue",
  labelColor: "#C9C9D2",
};

export function resolveActiveStatus(
  phase: TutorPhase,
  isReplaying: boolean,
  isPaused: boolean,
): StatusDisplay {
  if (isReplaying) {
    return REPLAYING_STATUS;
  }
  if (isPaused) {
    return PAUSED_STATUS;
  }
  return STATUS_CONFIG[phase];
}
