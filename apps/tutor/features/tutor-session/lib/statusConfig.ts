import type { TutorPhase, StatusDisplay } from "../types";

export const STATUS_CONFIG: Record<TutorPhase, StatusDisplay> = {
  idle: {
    color: "rgba(101,146,135,0.5)",
    label: "ready",
    dotClass: "",
    labelColor: "rgba(101,146,135,0.5)",
  },
  thinking: {
    color: "#88BDA4",
    label: "thinking\u2026",
    dotClass: "animate-wb-pulse-amber",
    labelColor: "#88BDA4",
  },
  drawing: {
    color: "#659287",
    label: "teaching\u2026",
    dotClass: "animate-wb-glow-blue",
    labelColor: "#659287",
  },
  speaking: {
    color: "#659287",
    label: "teaching\u2026",
    dotClass: "animate-wb-glow-blue",
    labelColor: "#659287",
  },
};

export const PAUSED_STATUS: StatusDisplay = {
  color: "#333333",
  label: "paused",
  dotClass: "",
  labelColor: "#333333",
};

export const REPLAYING_STATUS: StatusDisplay = {
  color: "#659287",
  label: "replaying\u2026",
  dotClass: "animate-wb-glow-blue",
  labelColor: "#659287",
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
