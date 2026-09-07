import type { TutorPhase, StatusDisplay } from "../types";

export const STATUS_CONFIG: Record<TutorPhase, StatusDisplay> = {
  idle: {
    color: "rgba(93, 108, 123, 0.7)",
    label: "ready",
    dotClass: "",
    labelColor: "rgba(93, 108, 123, 0.7)",
  },
  planning: {
    color: "#59AFD4",
    label: "planning\u2026",
    dotClass: "animate-wb-pulse",
    labelColor: "#59AFD4",
  },
  thinking: {
    color: "#59AFD4",
    label: "thinking\u2026",
    dotClass: "animate-wb-pulse",
    labelColor: "#59AFD4",
  },
  drawing: {
    color: "#59AFD4",
    label: "teaching\u2026",
    dotClass: "animate-wb-glow",
    labelColor: "#59AFD4",
  },
  speaking: {
    color: "#59AFD4",
    label: "teaching\u2026",
    dotClass: "animate-wb-glow",
    labelColor: "#59AFD4",
  },
};

export const PAUSED_STATUS: StatusDisplay = {
  color: "#5D6C7B",
  label: "paused",
  dotClass: "",
  labelColor: "#5D6C7B",
};

export const REPLAYING_STATUS: StatusDisplay = {
  color: "#59AFD4",
  label: "replaying\u2026",
  dotClass: "animate-wb-glow",
  labelColor: "#59AFD4",
};

export const REWINDING_STATUS: StatusDisplay = {
  color: "#59AFD4",
  label: "reviewing\u2026",
  dotClass: "animate-wb-glow",
  labelColor: "#59AFD4",
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
