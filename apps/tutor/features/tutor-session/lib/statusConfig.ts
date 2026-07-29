import type { TutorPhase, StatusDisplay } from "../types";

export const STATUS_CONFIG: Record<TutorPhase, StatusDisplay> = {
  idle: {
    color: "rgba(139, 148, 158, 0.7)",
    label: "ready",
    dotClass: "",
    labelColor: "rgba(139, 148, 158, 0.7)",
  },
  planning: {
    color: "#58A6FF",
    label: "planning\u2026",
    dotClass: "animate-wb-pulse-amber",
    labelColor: "#58A6FF",
  },
  thinking: {
    color: "#58A6FF",
    label: "thinking\u2026",
    dotClass: "animate-wb-pulse-amber",
    labelColor: "#58A6FF",
  },
  drawing: {
    color: "#3FB950",
    label: "teaching\u2026",
    dotClass: "animate-wb-glow-blue",
    labelColor: "#3FB950",
  },
  speaking: {
    color: "#3FB950",
    label: "teaching\u2026",
    dotClass: "animate-wb-glow-blue",
    labelColor: "#3FB950",
  },
};

export const PAUSED_STATUS: StatusDisplay = {
  color: "#8B949E",
  label: "paused",
  dotClass: "",
  labelColor: "#8B949E",
};

export const REPLAYING_STATUS: StatusDisplay = {
  color: "#58A6FF",
  label: "replaying\u2026",
  dotClass: "animate-wb-glow-blue",
  labelColor: "#58A6FF",
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
