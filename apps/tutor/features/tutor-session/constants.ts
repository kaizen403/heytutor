import { DS } from "@heytutor/design-tokens";
import type { CanvasLandingSuggestion } from "@/components/CanvasLanding";

export const BOARD_WIDTH = DS.Canvas.width;
export const BOARD_HEIGHT = DS.Canvas.height;
export const WHITEBOARD_COLOR = "#FFFFFF";
export const PAGE_GUTTER_X = 10;
export const PAGE_GUTTER_Y = 6;
export const MAX_LLM_CONTINUATIONS = 1;
export const STREAM_SEGMENTS_LIVE = true;

export const LANDING_SUGGESTIONS: CanvasLandingSuggestion[] = [
  {
    topic: "Resistors",
    question:
      "Three 12 ohm resistors in series and in parallel. Find both equivalent resistances and draw each circuit.",
  },
  {
    topic: "Resistors",
    question:
      "A 9 V supply and two 4.7 kΩ resistors in series. Find the voltage at the midpoint.",
  },
  {
    topic: "Ray optics",
    question:
      "Concave mirror, f = 15 cm, object at 20 cm. Locate the image and draw the ray diagram.",
  },
  {
    topic: "Ray optics",
    question:
      "Light enters glass at 45° with n = 1.5. Find the angle of refraction and draw both rays.",
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
