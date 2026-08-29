/**
 * Konva-free entry point: `@heytutor/whiteboard/pen-spinner`.
 *
 * The main entry pulls in Konva with the board. App chrome that only needs the
 * pending-state pencil imports from here so a header pill or a chat bubble
 * never drags the canvas runtime into its bundle.
 */
export { PenSpinner, type PenSpinnerProps } from "./PenSpinner";
export { SPIN_PERIOD_MS, spinningPose, type SpinningPose } from "./penChoreography";
