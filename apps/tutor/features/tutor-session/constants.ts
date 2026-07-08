import { DS } from "@heytutor/design-tokens";
import type { CanvasLandingSuggestion } from "@/components/CanvasLanding";

export const BOARD_WIDTH = DS.Canvas.width;
export const BOARD_HEIGHT = DS.Canvas.height;
export const WHITEBOARD_COLOR = "#F8F6F0";
export const PAGE_GUTTER_X = 28;
export const PAGE_GUTTER_Y = 10;
export const MAX_LLM_CONTINUATIONS = 1;
export const STREAM_SEGMENTS_LIVE = true;

export const LANDING_SUGGESTIONS: CanvasLandingSuggestion[] = [
  {
    label: "Projectile motion",
    question: "Explain projectile motion with a diagram",
    hint: "physics · trajectories",
  },
  {
    label: "Free body diagram",
    question: "Draw a free body diagram for a block on a ramp",
    hint: "forces · vectors",
  },
  {
    label: "Pythagorean theorem",
    question: "Prove the Pythagorean theorem step by step",
    hint: "geometry · proof",
  },
  {
    label: "Circle theorems",
    question: "Explain the inscribed angle theorem with a circle",
    hint: "geometry · arcs",
  },
  {
    label: "Solve a quadratic",
    question: "Solve x squared minus 5 x plus 6 by factoring",
    hint: "algebra · roots",
  },
  {
    label: "RC circuit",
    question: "Walk me through a simple RC circuit charging up",
    hint: "circuits · transients",
  },
];

export const TEXT_LAYOUT = {
  marginX: 90,
  topY: 64,
  headingBottomY: 118,
  workTopY: 142,
  bottomY: 645,
  lineHeight: 54,
  textHeight: 42,
  eraseX: 70,
  eraseY: 126,
  eraseWidth: 1060,
  eraseHeight: 520,
};

export const DIAGRAM_ZONE = {
  x: 400,
  y: 140,
  width: 760,
  height: 380,
};

export const ANNOTATION_SNAP_DISTANCE = 40;
