/**
 * What a mounted tutor session can do.
 *
 * The shell is mounted on four surfaces, and until now each of them was
 * expressed as a scattering of `!isEmbed` conditions next to the feature it
 * suppressed. That is how admin Watch ended up a strictly poorer lesson than
 * the main page — no way to ask a follow-up, no Ask panel, no marking, no
 * settings — without anyone deciding it should be: the conditions were written
 * one at a time, for a demo iframe, and Watch inherited every one of them by
 * sharing its variant.
 *
 * So the decision lives here instead, as one table. A surface says which
 * variant it is; this says what that variant may do; the shell asks.
 *
 * The distinction that matters is between *chrome* and *capability*. Admin
 * Watch is not a cut-down lesson — it is the whole lesson with the app frame
 * taken off, because it is already inside a drawer that has its own header and
 * its own back button. The public demo is the opposite: the same frameless
 * board, but read-only, because `?embed=1` is reachable without signing in
 * (see `isEmbedDemoRequest`) and an anonymous visitor must not be able to run
 * a lecture, open the Ask chat, or write to anyone's settings.
 */

export type TutorSessionVariant = "full" | "panel" | "embed" | "headless";

export interface SessionCapabilities {
  /** The app frame: sidebar, board list, session header. */
  appChrome: boolean;
  /** The composer: ask a question, ask a doubt, pause, stop. */
  askQuestions: boolean;
  /** The Ask panel — lesson notes plus the chat about them. */
  notes: boolean;
  /** Ringing part of the board to ask about it. */
  marking: boolean;
  /** The lesson settings drawer, and the familiarity control beside the input. */
  settings: boolean;
  /** Whether changes made here are written back to the student's own defaults. */
  persistSettings: boolean;
  /** Board, ink, voice: what is left when everything else is off. */
  board: boolean;
}

const FULL: SessionCapabilities = {
  appChrome: true,
  askQuestions: true,
  notes: true,
  marking: true,
  settings: true,
  persistSettings: true,
  board: true,
};

/** Everything the main page can do, with the app frame taken off. */
const PANEL: SessionCapabilities = { ...FULL, appChrome: false };

/** The unauthenticated demo: it may be watched and nothing else. */
const EMBED: SessionCapabilities = {
  appChrome: false,
  askQuestions: false,
  notes: false,
  marking: false,
  settings: false,
  persistSettings: false,
  board: true,
};

/** A recording runtime with no interface at all. */
const HEADLESS: SessionCapabilities = {
  appChrome: false,
  askQuestions: false,
  notes: false,
  marking: false,
  settings: false,
  persistSettings: false,
  board: true,
};

const CAPABILITIES: Record<TutorSessionVariant, SessionCapabilities> = {
  full: FULL,
  panel: PANEL,
  embed: EMBED,
  headless: HEADLESS,
};

export function sessionCapabilities(variant: TutorSessionVariant): SessionCapabilities {
  return CAPABILITIES[variant] ?? FULL;
}

/**
 * The two surfaces a person teaches from. Both get the whole lesson; they
 * differ only in whether the app frame is around it.
 */
export const LESSON_VARIANTS: readonly TutorSessionVariant[] = ["full", "panel"];
