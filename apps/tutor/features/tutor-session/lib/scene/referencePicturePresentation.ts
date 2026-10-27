/**
 * The board presentation of a stored reference picture: two runtime-owned
 * `DRAW_PICTURE` beats (outline, then fill), one anchor covering the picture,
 * and the prompt addon that tells the teaching model what is and is not on it.
 *
 * Pure and shared by the live turn, the server's persisted intro rebuild and
 * restore, so all three produce the same ink and the same spoken cues from the
 * same record. It is never a verified scene: the authority is the server's
 * stored record, which exists only after its judge accepted the picture.
 */
import {
  REFERENCE_PICTURE_ENTITY_ID,
  isReferencePictureId,
  parseReferencePictureLegend,
  isStoredCommandTrustedGeometry,
  parseFocusSpec,
  parsePictureCommandParams,
  parseStoredSegmentCommands,
  referencePictureCommands,
  referencePictureCredit,
  verifiedDiagramCommandToDrawCommand,
  type DrawCommand,
  type PicturePass,
  type PicturePlacement,
  type ReferencePictureLegendEntry,
  type ReferencePictureRecord,
  type TutorSegment,
  type VerifiedDiagram,
  type VerifiedDiagramCommand,
} from "@heytutor/drawing";
import type { NarrationLanguage } from "@heytutor/tutor-core";

/** Entity id of the whole picture: the only focus target it offers. */
export { REFERENCE_PICTURE_ENTITY_ID };

/**
 * What a turn stores in `sceneArtifacts.referencePicture`. The server rebuilds
 * it from its own record before saving, so restore and replay read only what
 * the server accepted.
 */
export interface StoredReferencePicture {
  id: string;
  source: ReferencePictureRecord["source"];
  title: string;
  pageUrl: string | null;
  license: string;
  artist: string;
  shows: string;
  labels: string[];
  /** A numbered picture's key, as the server checked it. Absent otherwise. */
  legend?: ReferencePictureLegendEntry[];
  credit: string;
}

/** The board diagram of a picture: the verified diagram slot with the picture's id. */
export type ReferencePictureDiagram = VerifiedDiagram & { id: typeof REFERENCE_PICTURE_ENTITY_ID };

export interface ReferencePicturePresentation {
  diagram: VerifiedDiagram;
  introSegments: TutorSegment[];
  promptAddon: string;
  stored: StoredReferencePicture;
}

export function asBoardDiagram(diagram: ReferencePictureDiagram): VerifiedDiagram {
  return diagram;
}

export function isReferencePictureDiagram(diagram: { id: string } | null | undefined): boolean {
  return diagram?.id === REFERENCE_PICTURE_ENTITY_ID;
}

export function storedReferencePictureFrom(record: ReferencePictureRecord): StoredReferencePicture {
  const legend = record.legend?.length ? parseReferencePictureLegend(record.legend) : null;
  return {
    id: record.id,
    source: record.source,
    title: record.title,
    pageUrl: record.pageUrl,
    license: record.license,
    artist: record.artist,
    shows: record.shows,
    labels: [...record.labels],
    ...(legend ? { legend } : {}),
    credit: referencePictureCredit(record),
  };
}

const ARTICLE = /^(?:a|an|the|this|these|those|two|three|four|several|some|one)\s/i;
const PICTURE_WORDS = "diagram|picture|illustration|image|drawing|figure|sketch|chart|schematic|photo|photograph|cross[- ]section";
const LEADING_PICTURE = new RegExp(
  `^(?:(?:this|the|a|an)\\s+)?(?:(?:simple|clear|detailed|labell?ed|annotated|colou?red|schematic|scientific|educational|anatomical)\\s+)*(?:${PICTURE_WORDS})\\s+(?:of|showing|that shows|which shows|depicting|illustrating)\\s+`,
  "i",
);

/**
 * What the picture is of, as a noun phrase for the spoken line: the judge's
 * one-line reading without its "A labelled diagram of" lead, its first clause,
 * at most twelve words. Empty when nothing usable is left.
 */
export function shownSubject(shows: string): string {
  let subject = shows.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  subject = subject.replace(LEADING_PICTURE, "").replace(/^(?:shows|showing|depicts|depicting|illustrates)\s+/i, "");
  subject = subject
    .split(/[;:(]|,\s*(?:with|showing|including|labell?ed|where|which)\b|\s+(?:showing|including|depicting|labell?ed|with (?:its )?(?:parts |organelles |structures )?labell?ed|with labels)\b/i)[0]!
    .trim()
    .replace(/,$/, "");
  const words = subject.split(" ").filter(Boolean);
  if (words.length === 0) return "";
  subject = words.slice(0, 12).join(" ");
  // Keep an acronym or a proper name ("DNA", "Golgi"); lower a sentence start.
  if (!/^[A-Z]{2}/.test(subject) && /^[A-Z][a-z]/.test(subject) && !/^[A-Z][a-z]+\s+[A-Z]/.test(subject)) {
    subject = subject.charAt(0).toLowerCase() + subject.slice(1);
  }
  return ARTICLE.test(subject) ? subject : `the ${subject}`;
}

type IntroBeat = { narration: string; token: string };

/**
 * The spoken beats, one per pass. Each names its pass with one word the pen
 * waits for: "diagram" for the outline, "colour" for the fill, "key" for a
 * numbered picture's legend. The words stay in Latin script in Hinglish, as
 * the rest of the mixed narration does for terms.
 */
export function referencePictureIntroLines(
  picture: Pick<StoredReferencePicture, "shows" | "labels" | "legend">,
  language?: NarrationLanguage,
): { outline: IntroBeat; fill: IntroBeat; legend?: IntroBeat } {
  const subject = shownSubject(picture.shows);
  const keyed = (picture.legend?.length ?? 0) > 0;
  const kind = keyed ? "numbered " : picture.labels.length > 0 ? "labelled " : "";
  if (language === "hinglish") {
    return {
      outline: {
        narration: subject ? `यह ${subject} का ${kind}diagram है.` : `यह एक ${kind}diagram है.`,
        token: "diagram",
      },
      fill: { narration: "अब इसमें colour भरते हैं.", token: "colour" },
      ...(keyed ? { legend: { narration: "बगल में लिखी key हर number वाले part का नाम बताती है.", token: "key" } } : {}),
    };
  }
  return {
    outline: {
      narration: subject ? `Here is a ${kind}diagram of ${subject}.` : `Here is a ${kind}diagram.`,
      token: "diagram",
    },
    fill: { narration: "Let me colour it in.", token: "colour" },
    ...(keyed ? { legend: { narration: "The key beside it names each numbered part.", token: "key" } } : {}),
  };
}

/** One short line per label, quoted, in the order the judge read them. */
function labelList(labels: readonly string[]): string {
  const clean = [...new Set(labels.map((label) => label.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 40);
  return clean.length > 0 ? clean.map((label) => `"${label.replace(/"/g, "'")}"`).join(", ") : "none";
}

/** "Right atrium" reads "the right atrium" in a sentence; "Bowman's capsule" and "DNA" keep their capitals. */
function inSentence(label: string): string {
  return /^[A-Z][a-z]+(?:\s|$)/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

/** The key as the prompt lists it: `1 = Right atrium; 2 = Left atrium`. Key names are checked to Latin letters and plain punctuation, so nothing needs quoting. */
function legendList(legend: readonly ReferencePictureLegendEntry[]): string {
  return legend.map((entry) => `${entry.mark} = ${entry.label}`).join("; ");
}

export function referencePicturePromptAddon(picture: Pick<StoredReferencePicture, "source" | "shows" | "labels" | "legend">): string {
  const origin = picture.source === "wikimedia" ? "a real diagram from Wikimedia Commons" : "an illustration generated for this lesson";
  const legend = picture.legend?.length ? picture.legend : null;
  const keyNames = new Set((legend ?? []).map((entry) => entry.label));
  const printed = picture.labels.filter((label) => !keyNames.has(label));
  const digits = legend?.every((entry) => /^[0-9]/.test(entry.mark)) ?? true;
  const naming = legend
    ? [
        `Its parts are marked with ${digits ? "numbers" : "numbers or letters"}, and the runtime has written the key beside the picture, checked against what each mark points at: ${legendList(legend)}.`,
        ...(printed.length > 0 ? [`Names printed on it, as read by a checker: ${labelList(printed)}.`] : []),
        `When you talk about a marked part, say its ${digits ? "number" : "mark"} and its name together, for example "part ${legend[0]!.mark}, the ${inSentence(legend[0]!.label)}", so the student can find it on the picture. Never name, describe or point at a part that is not in the key${printed.length > 0 ? " or printed on it" : ""}, never use a mark the key does not list, and never claim the picture shows a value, arrow or direction it does not label. If the picture does not fit what this question asks, say so in one plain sentence and teach in words.`,
      ]
    : [
        `Labels printed on it, as read by a checker: ${labelList(picture.labels)}.`,
        "Refer to a labelled part by its printed name. Never name, describe or point at a part that is not in that list, and never claim the picture shows a value, arrow or direction it does not label. If the picture does not fit what this question asks, say so in one plain sentence and teach in words.",
      ];
  return [
    "BOARD STATE: A REFERENCE PICTURE, NOT A FIGURE YOU DREW",
    `The right of the board shows ${origin}. The runtime has already drawn it in. It is a reference picture, not a validated figure: it carries no measurements, scale or computed values.`,
    `What it shows: ${picture.shows.replace(/\s+/g, " ").trim() || "not described"}.`,
    ...naming,
    `Never emit DRAW_*, LABEL, DIMENSION, ARROW, CIRCLE_AROUND, HIGHLIGHT, UNDERLINE, SCRIBBLE, ANNOTATE, ERASE or CLEAR tags. [FOCUS:${REFERENCE_PICTURE_ENTITY_ID}] may point at the whole picture, at most once in a step, inside the sentence that talks about it; there is no other focus target and no part of the picture can be focused on its own.`,
    "WRITE the left work column as the student notebook: names, definitions, relations and results (x below 360). Every step writes a short board line.",
  ].join("\n");
}

function placementOf(commands: readonly VerifiedDiagramCommand[]): PicturePlacement | null {
  for (const command of commands) {
    if (command.type !== "DRAW_PICTURE") continue;
    const parsed = parsePictureCommandParams(command.params);
    if (parsed) return parsed.placement;
  }
  return null;
}

/**
 * The diagram for a picture whose board commands are already known: from the
 * record live and on the server, or from the persisted rows on restore.
 */
export function referencePictureDiagram(
  picture: Pick<StoredReferencePicture, "id" | "source" | "shows" | "labels" | "legend">,
  commands: readonly VerifiedDiagramCommand[],
  reveals: VerifiedDiagram["reveals"] = [],
): VerifiedDiagram | null {
  const placement = placementOf(commands);
  if (!placement) return null;
  const diagram: ReferencePictureDiagram = {
    id: REFERENCE_PICTURE_ENTITY_ID,
    name: `reference picture ${picture.id}`,
    commands: commands.map((command) => ({ ...command, params: [...command.params] })),
    // No labels: a spoken name must not infer a FOCUS on the whole picture.
    // An explicit [FOCUS:reference_picture] still resolves by id.
    anchors: [{ id: REFERENCE_PICTURE_ENTITY_ID, labels: [], ...placement }],
    reveals,
    promptAddon: referencePicturePromptAddon(picture),
  };
  return asBoardDiagram(diagram);
}

export function buildReferencePicturePresentation(
  record: ReferencePictureRecord,
  options: { narrationLanguage?: NarrationLanguage } = {},
): ReferencePicturePresentation {
  const stored = storedReferencePictureFrom(record);
  const commands: VerifiedDiagramCommand[] = referencePictureCommands(record).map((command) => ({
    type: command.type,
    params: [...command.params],
    text: command.text,
    semanticRef: { ...command.semanticRef },
  }));
  const lines = referencePictureIntroLines(stored, options.narrationLanguage);
  // One beat per pass, matched by the pass each command carries: outline,
  // fill and, for a numbered picture, the key.
  const beats = commands.map((command) => {
    const pass: PicturePass | undefined = parsePictureCommandParams(command.params)?.pass;
    const beat = pass ? lines[pass] : undefined;
    if (!beat) throw new Error(`reference picture ${pass ?? "unknown"} pass has no spoken beat`);
    return beat;
  });
  const reveals = beats.map((beat, index) => ({
    narration: beat.narration,
    commandIndices: [index],
    kind: "reveal" as const,
    targetId: REFERENCE_PICTURE_ENTITY_ID,
  }));
  const diagram = referencePictureDiagram(stored, commands, reveals);
  if (!diagram) throw new Error("reference picture commands carry no placement");
  const introSegments: TutorSegment[] = beats.map((beat, index) => {
    const command = {
      ...verifiedDiagramCommandToDrawCommand(commands[index]!),
      spokenCue: { token: beat.token, entityId: REFERENCE_PICTURE_ENTITY_ID },
    };
    return { narration: beat.narration, command, commands: [command], verifiedDiagramIntro: true };
  });
  return { diagram, introSegments, promptAddon: diagram.promptAddon, stored };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The picture id a turn's artifacts claim, before anything is checked against it. */
export function referencePictureIdOf(artifacts: unknown): string | null {
  if (!isRecord(artifacts)) return null;
  const value = Object.getOwnPropertyDescriptor(artifacts, "referencePicture")?.value;
  return isRecord(value) && isReferencePictureId(value.id) ? value.id : null;
}

/**
 * A stored row that is a picture pass: a trusted envelope holding only
 * `DRAW_PICTURE` commands, all naming `id` when one is given.
 */
export function isReferencePictureRow(stored: unknown, id?: string | null): boolean {
  if (!isStoredCommandTrustedGeometry(stored)) return false;
  const commands = parseStoredSegmentCommands(stored);
  return commands.length > 0 && commands.every((command) =>
    command?.type === "DRAW_PICTURE" && (id == null || command.text === id));
}

/** A FOCUS on the whole picture, the one gesture a picture turn may keep. */
export function pointsAtReferencePicture(command: Pick<DrawCommand, "type" | "text" | "semanticRef">): boolean {
  if (command.type !== "FOCUS") return false;
  const spec = parseFocusSpec(command.semanticRef?.entityId ?? command.text);
  const targets = spec.targetIds.length > 0 ? spec.targetIds : [(command.semanticRef?.entityId ?? command.text ?? "").trim()];
  return targets.length > 0 && targets.every((target) => target.trim().toLowerCase() === REFERENCE_PICTURE_ENTITY_ID);
}

/**
 * How a turn's picture attempt ended, kept with its artifacts so outcomes can
 * be counted: `shown` drew, `declined` was the judge or pipeline saying no,
 * `unavailable` a transport, deadline or preload failure, `skipped` a request
 * dropped because a verified figure was drawn instead.
 */
export interface ReferencePictureOutcome {
  attempted: boolean;
  status: "shown" | "declined" | "unavailable" | "skipped";
  reason: string | null;
  ms: number;
  /** Started while the scene was still planning (subjects with no engine). */
  speculative: boolean;
  /** The server answered from its topic cache (no search or judge this turn). */
  cached?: boolean;
}

const OUTCOME_STATUSES = new Set<ReferencePictureOutcome["status"]>(["shown", "declined", "unavailable", "skipped"]);

export function readReferencePictureOutcome(artifacts: unknown): ReferencePictureOutcome | null {
  if (!isRecord(artifacts)) return null;
  const value = Object.getOwnPropertyDescriptor(artifacts, "referencePictureOutcome")?.value;
  if (!isRecord(value) || typeof value.attempted !== "boolean" || typeof value.speculative !== "boolean" ||
      !OUTCOME_STATUSES.has(value.status as ReferencePictureOutcome["status"]) ||
      !(value.reason === null || (typeof value.reason === "string" && /^[a-z0-9_:-]{1,64}$/i.test(value.reason))) ||
      !(typeof value.ms === "number" && Number.isInteger(value.ms) && value.ms >= 0 && value.ms <= 600_000)) return null;
  return {
    attempted: value.attempted,
    status: value.status as ReferencePictureOutcome["status"],
    reason: value.reason as string | null,
    ms: value.ms,
    speculative: value.speculative,
    ...(value.cached === true ? { cached: true } : {}),
  };
}

/** Read `sceneArtifacts.referencePicture` back, or null when it is not one. */
export function readStoredReferencePicture(artifacts: unknown): StoredReferencePicture | null {
  if (!isRecord(artifacts)) return null;
  const value = Object.getOwnPropertyDescriptor(artifacts, "referencePicture")?.value;
  if (!isRecord(value) || !isReferencePictureId(value.id)) return null;
  const string = (field: unknown, max: number) => typeof field === "string" && field.length <= max ? field : null;
  const source = value.source === "wikimedia" || value.source === "generated" ? value.source : null;
  const title = string(value.title, 400);
  const license = string(value.license, 200);
  const artist = string(value.artist, 400);
  const shows = string(value.shows, 600);
  const credit = string(value.credit, 400);
  const pageUrl = value.pageUrl === null || value.pageUrl === undefined ? null : string(value.pageUrl, 1000);
  const labels = Array.isArray(value.labels) && value.labels.length <= 80 &&
    value.labels.every((label) => typeof label === "string" && label.length <= 120) ? value.labels as string[] : null;
  // A key that does not parse is not dropped: the picture's numbers would be left unnamed.
  const legend = value.legend === undefined ? undefined : parseReferencePictureLegend(value.legend);
  if (!source || title === null || license === null || artist === null || shows === null || credit === null || !labels ||
      (value.pageUrl != null && pageUrl === null) || legend === null) return null;
  return { id: value.id, source, title, pageUrl, license, artist, shows, labels: [...labels], ...(legend ? { legend } : {}), credit };
}
