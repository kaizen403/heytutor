import type { TutorPhase, StatusDisplay } from "../types";

export const STATUS_CONFIG: Record<TutorPhase, StatusDisplay> = {
  idle: {
    color: "rgba(107, 114, 128, 0.5)",
    label: "ready",
    dotClass: "",
    labelColor: "rgba(107, 114, 128, 0.5)",
  },
  planning: {
    color: "#5FA4F9",
    label: "planning\u2026",
    dotClass: "animate-wb-pulse-amber",
    labelColor: "#5FA4F9",
  },
  thinking: {
    color: "#5FA4F9",
    label: "thinking\u2026",
    dotClass: "animate-wb-pulse-amber",
    labelColor: "#5FA4F9",
  },
  drawing: {
    color: "#2563EB",
    label: "teaching\u2026",
    dotClass: "animate-wb-glow-blue",
    labelColor: "#2563EB",
  },
  speaking: {
    color: "#2563EB",
    label: "teaching\u2026",
    dotClass: "animate-wb-glow-blue",
    labelColor: "#2563EB",
  },
};

export const PAUSED_STATUS: StatusDisplay = {
  color: "#6B7280",
  label: "paused",
  dotClass: "",
  labelColor: "#6B7280",
};

export const REPLAYING_STATUS: StatusDisplay = {
  color: "#2563EB",
  label: "replaying\u2026",
  dotClass: "animate-wb-glow-blue",
  labelColor: "#2563EB",
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
