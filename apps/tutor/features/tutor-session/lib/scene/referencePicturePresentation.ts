/**
 * The board presentation of a stored reference picture: two runtime-owned
 * `DRAW_PICTURE` beats (outline, then fill), one anchor covering the picture,
 * and the prompt addon that tells the teaching model what is and is not on it.
 *
 * Pure and shared by the live turn, the server's persisted intro rebuild and
 * restore, so all three produce the same ink and the same spoken cues from the
 * same record. It is never a verified scene: the authority is the server's
 * stored record, which exists only after its judge accepted the picture.
 *
 * With part focus on (`REFERENCE_PICTURE_PART_FOCUS`, off by default) the
 * picture also offers one anchor per located part and one target per key
 * entry, so the pen can point at "R1" or at part 3 and its key row. Off, the
 * diagram, the prompt and the stored artifact are exactly what they were.
 */
import {
  REFERENCE_PICTURE_ENTITY_ID,
  isReferencePictureId,
  legendMarkKey,
  parseReferencePictureLegend,
  parseReferencePictureParts,
  referencePictureKeyId,
  referencePictureLayout,
  referencePictureLegendEntryRect,
  referencePicturePartBoardRect,
  referencePicturePartKey,
  resolveVerifiedDiagramFocusTargets,
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
  type ReferencePicturePart,
  type ReferencePictureRecord,
  type TutorSegment,
  type VerifiedDiagram,
  type VerifiedDiagramAnchor,
  type VerifiedDiagramCommand,
  type VerifiedDiagramGroup,
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
  /**
   * Present only when part focus was on as the turn was saved and the picture
   * has something to point at: the plan size its part boxes and its key
   * layout are expressed in, and its located parts (checked with
   * `parseReferencePictureParts`, possibly none for a numbered picture, whose
   * key rows are pointable on their own). Restore rebuilds the same targets.
   */
  partFocus?: ReferencePicturePartFocus;
  credit: string;
}

export interface ReferencePicturePartFocus {
  plan: { width: number; height: number };
  parts: ReferencePicturePart[];
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

/**
 * The part focus a record offers: its checked parts and its plan size, or
 * null when part focus is off or there is nothing to point at.
 */
function partFocusFrom(record: ReferencePictureRecord, legend: readonly ReferencePictureLegendEntry[] | null): ReferencePicturePartFocus | null {
  const plan = { width: record.plan.width, height: record.plan.height };
  const parts = parseReferencePictureParts(record.parts, { plan, labels: record.labels, legend });
  return parts.length > 0 || (legend?.length ?? 0) > 0 ? { plan, parts } : null;
}

export function storedReferencePictureFrom(
  record: ReferencePictureRecord,
  options: { partFocus?: boolean } = {},
): StoredReferencePicture {
  const legend = record.legend?.length ? parseReferencePictureLegend(record.legend) : null;
  const partFocus = options.partFocus ? partFocusFrom(record, legend) : null;
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
    ...(partFocus ? { partFocus } : {}),
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

/**
 * Focus target ids of a numbered picture's key entry, named by its printed
 * mark (never its place in the key, which skips and reorders): the target,
 * its row and its mark on the drawing.
 */
export function referencePictureKeyIds(mark: string): { target: string; row: string; mark: string } {
  const target = referencePictureKeyId(mark);
  return { target, row: `${target}.row`, mark: `${target}.mark` };
}

/**
 * Words a sentence uses for their ordinary meaning. A printed label that is
 * one of them ("Top", "Image", "Water") may still be pointed at by its tag,
 * but saying it must not move the pen: "the image is upright" is not about a
 * label printed "Image". The optics role names are here so the role cues of
 * the spoken inference never fire on a picture.
 */
const COMMON_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "by", "for", "from", "with", "into", "onto", "over", "under",
  "is", "are", "was", "be", "it", "its", "this", "that", "these", "those", "here", "there", "as", "if", "so", "no", "not",
  "up", "down", "out", "off", "all", "one", "two", "three", "four", "five", "six", "ten", "first", "second", "third", "last", "next",
  "top", "bottom", "left", "right", "front", "back", "side", "end", "start", "middle", "centre", "center", "inside", "outside",
  "upper", "lower", "inner", "outer", "above", "below", "near", "far", "high", "low", "north", "south", "east", "west",
  "input", "output", "area", "part", "point", "line", "edge", "face", "base", "head", "body", "tail", "arm", "leg",
  "image", "object", "focus", "pole", "vertex", "axis", "view", "key", "label", "figure", "diagram", "picture", "scale",
  "light", "heat", "water", "air", "time", "mass", "force", "work", "power", "energy", "current", "charge", "field", "wave",
  "flow", "direction", "length", "width", "height", "size", "space", "level", "stage", "step", "phase", "state", "type",
  "new", "old", "big", "small", "large", "long", "short", "open", "closed", "hot", "cold", "warm", "dry", "wet",
]);

/**
 * A label a spoken name may point at on its own: two characters or more, not
 * a bare number and not every word a common one. Others are pointed at only
 * by their tag; the spoken inference never guesses at them.
 */
export function isDistinctivePictureLabel(label: string): boolean {
  const clean = label.replace(/\s+/g, " ").trim();
  if (clean.length < 2) return false;
  if (/^[0-9.,\s%°+\-−]+$/.test(clean)) return false;
  const words = clean.toLowerCase().split(/[\s/-]+/).filter(Boolean);
  return words.some((word) => !COMMON_WORDS.has(word.replace(/[^\p{L}\p{N}']/gu, "")));
}

/** One pointable part as the prompt lists it: what is said, then the tag. */
interface ListedTarget {
  spoken: string;
  id: string;
}

export interface ReferencePictureFocusTargets {
  anchors: VerifiedDiagramAnchor[];
  groups: VerifiedDiagramGroup[];
  listed: ListedTarget[];
}

const NO_TARGETS: ReferencePictureFocusTargets = { anchors: [], groups: [], listed: [] };

function samePlacement(a: PicturePlacement, b: PicturePlacement): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 &&
    Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
}

/**
 * The picture's part and key targets at `placement`, beyond the whole
 * picture. Nothing without `partFocus`, and nothing when the placement is not
 * where the record's own layout puts the picture: the rows and the record
 * would disagree about where a part is, and a pointer on the wrong part is a
 * false mark.
 *
 * - A located printed label: one anchor, `reference_picture.part.<n>`, on
 *   its printed text. It carries the label for the spoken inference only
 *   when the label is distinctive.
 * - A numbered picture's key entry: the group `reference_picture.key.<mark>`
 *   (the printed mark, so "part 4" is `key.4` even on a key that skips 3) of
 *   the mark on the drawing (when it was located) then the key row the pen
 *   wrote, so the pen goes to "3" and then to "3 Loop of Henle". Key rows are
 *   computed from the record, so every entry is pointable.
 */
export function referencePictureFocusTargets(
  picture: Pick<StoredReferencePicture, "legend" | "partFocus">,
  placement: PicturePlacement,
): ReferencePictureFocusTargets {
  const focus = picture.partFocus;
  if (!focus) return NO_TARGETS;
  const legend = picture.legend?.length ? picture.legend : null;
  const layout = referencePictureLayout({ plan: focus.plan, legend });
  if (!layout || !samePlacement(layout.picture, placement)) return NO_TARGETS;
  const anchors: VerifiedDiagramAnchor[] = [];
  const groups: VerifiedDiagramGroup[] = [];
  const listed: ListedTarget[] = [];
  const keyNames = new Set((legend ?? []).map((entry) => referencePicturePartKey(entry.label)));
  for (const part of focus.parts) {
    // A mark belongs to its key entry; a key name printed on a numbered
    // picture is pointed at through that entry, never twice.
    if (part.mark !== undefined || keyNames.has(referencePicturePartKey(part.label))) continue;
    anchors.push({
      id: part.id,
      labels: isDistinctivePictureLabel(part.label) ? [part.label] : [],
      ...referencePicturePartBoardRect(part, placement, focus.plan),
    });
    listed.push({ spoken: `"${part.label.replace(/"/g, "'")}"`, id: part.id });
  }
  if (legend && layout.legend) {
    legend.forEach((entry, index) => {
      const row = referencePictureLegendEntryRect(layout.legend!, index);
      if (!row) return;
      const ids = referencePictureKeyIds(entry.mark);
      const mark = focus.parts.find((part) => part.mark !== undefined && legendMarkKey(part.mark) === legendMarkKey(entry.mark));
      const members: string[] = [];
      if (mark) {
        anchors.push({ id: ids.mark, labels: [], ...referencePicturePartBoardRect(mark, placement, focus.plan) });
        members.push(ids.mark);
      }
      anchors.push({ id: ids.row, labels: [], ...row });
      members.push(ids.row);
      groups.push({ id: ids.target, entityIds: members });
      listed.push({ spoken: `part ${entry.mark}, the ${inSentence(entry.label)}`, id: ids.target });
    });
  }
  return { anchors, groups, listed };
}

/**
 * Everything a FOCUS on this picture may name, at the place the record's
 * layout puts it: for the save filters, which see the artifact but not always
 * the rows. Only the whole picture when part focus is off.
 */
export function referencePicturePointables(
  picture: Pick<StoredReferencePicture, "legend" | "partFocus">,
): Pick<VerifiedDiagram, "anchors" | "groups"> {
  const whole: VerifiedDiagramAnchor = { id: REFERENCE_PICTURE_ENTITY_ID, labels: [], x: 0, y: 0, width: 0, height: 0 };
  const layout = picture.partFocus
    ? referencePictureLayout({ plan: picture.partFocus.plan, legend: picture.legend?.length ? picture.legend : null })
    : null;
  const targets = layout ? referencePictureFocusTargets(picture, layout.picture) : NO_TARGETS;
  return { anchors: [whole, ...targets.anchors], groups: targets.groups };
}

/**
 * The focus sentence. With no part targets it is the sentence every picture
 * turn had before part focus, word for word.
 */
function focusRule(listed: readonly ListedTarget[]): string[] {
  const drawing = "Never emit DRAW_*, LABEL, DIMENSION, ARROW, CIRCLE_AROUND, HIGHLIGHT, UNDERLINE, SCRIBBLE, ANNOTATE, ERASE or CLEAR tags.";
  const whole = `[FOCUS:${REFERENCE_PICTURE_ENTITY_ID}] may point at the whole picture, at most once in a step, inside the sentence that talks about it`;
  if (listed.length === 0) return [`${drawing} ${whole}; there is no other focus target and no part of the picture can be focused on its own.`];
  const first = listed[0]!;
  const example = first.spoken.startsWith('"') ? `notice ${first.spoken.slice(1, -1)} [FOCUS:${first.id}]` : `${first.spoken} [FOCUS:${first.id}]`;
  return [
    `${drawing} ${whole}.`,
    `These parts of the picture can be pointed at, each written as what you say then its tag: ${listed.map((target) => `${target.spoken} = [FOCUS:${target.id}]`).join("; ")}.`,
    `When you say one of them, put its tag inside that sentence directly after the name, for example "${example}". Say the name, never the id. One id per tag, and each part at most once in a step. No other part has a focus target: say any other name without a tag, and never write an id that is not listed here.`,
  ];
}

export function referencePicturePromptAddon(
  picture: Pick<StoredReferencePicture, "source" | "shows" | "labels" | "legend">,
  targets: Pick<ReferencePictureFocusTargets, "listed"> = NO_TARGETS,
): string {
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
    ...focusRule(targets.listed),
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
  picture: Pick<StoredReferencePicture, "id" | "source" | "shows" | "labels" | "legend" | "partFocus">,
  commands: readonly VerifiedDiagramCommand[],
  reveals: VerifiedDiagram["reveals"] = [],
): VerifiedDiagram | null {
  const placement = placementOf(commands);
  if (!placement) return null;
  const targets = referencePictureFocusTargets(picture, placement);
  const diagram: ReferencePictureDiagram = {
    id: REFERENCE_PICTURE_ENTITY_ID,
    name: `reference picture ${picture.id}`,
    commands: commands.map((command) => ({ ...command, params: [...command.params] })),
    // No labels: a spoken name must not infer a FOCUS on the whole picture.
    // An explicit [FOCUS:reference_picture] still resolves by id. It stays
    // first: the board reads the picture's own box from anchors[0].
    anchors: [{ id: REFERENCE_PICTURE_ENTITY_ID, labels: [], ...placement }, ...targets.anchors],
    reveals,
    ...(targets.groups.length > 0 ? { groups: targets.groups } : {}),
    promptAddon: referencePicturePromptAddon(picture, targets),
  };
  return asBoardDiagram(diagram);
}

export function buildReferencePicturePresentation(
  record: ReferencePictureRecord,
  options: { narrationLanguage?: NarrationLanguage; partFocus?: boolean } = {},
): ReferencePicturePresentation {
  const stored = storedReferencePictureFrom(record, { partFocus: options.partFocus === true });
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

/**
 * A FOCUS a picture turn may keep: on the whole picture, or, given the
 * picture's `pointables` (its diagram, or `referencePicturePointables`), on
 * one of its part or key targets, resolved exactly as the board resolves
 * them. Every target must resolve; anything else is dropped, words kept.
 */
export function pointsAtReferencePicture(
  command: Pick<DrawCommand, "type" | "text" | "semanticRef">,
  pointables?: Pick<VerifiedDiagram, "anchors" | "groups"> | null,
): boolean {
  if (command.type !== "FOCUS") return false;
  const spec = parseFocusSpec(command.semanticRef?.entityId ?? command.text);
  const targets = spec.targetIds.length > 0 ? spec.targetIds : [(command.semanticRef?.entityId ?? command.text ?? "").trim()];
  return targets.length > 0 && targets.every((target) => {
    const id = target.trim().toLowerCase();
    if (id === REFERENCE_PICTURE_ENTITY_ID) return true;
    if (!pointables || !id) return false;
    const probe = { id: REFERENCE_PICTURE_ENTITY_ID, name: "", commands: [], reveals: [], promptAddon: "", ...pointables } as VerifiedDiagram;
    const resolved = resolveVerifiedDiagramFocusTargets({ type: "FOCUS", params: [], text: id, charPosition: 0, narrationBefore: "" }, probe);
    return resolved.length > 0 && resolved.every((anchor) =>
      anchor.id === REFERENCE_PICTURE_ENTITY_ID || anchor.id.startsWith(`${REFERENCE_PICTURE_ENTITY_ID}.`));
  });
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
  // Unlike the key, part focus that does not parse only loses its pointing.
  const partFocus = readPartFocus(value.partFocus, labels, legend);
  return {
    id: value.id, source, title, pageUrl, license, artist, shows, labels: [...labels],
    ...(legend ? { legend } : {}),
    ...(partFocus ? { partFocus } : {}),
    credit,
  };
}

function readPartFocus(
  raw: unknown,
  labels: readonly string[],
  legend: readonly ReferencePictureLegendEntry[] | undefined,
): ReferencePicturePartFocus | null {
  if (!isRecord(raw) || !isRecord(raw.plan)) return null;
  const size = (field: unknown) => typeof field === "number" && Number.isFinite(field) && field > 0 && field <= 4096 ? field : null;
  const width = size(raw.plan.width);
  const height = size(raw.plan.height);
  if (width === null || height === null) return null;
  const plan = { width, height };
  const parts = parseReferencePictureParts(raw.parts, { plan, labels, legend });
  return parts.length > 0 || (legend?.length ?? 0) > 0 ? { plan, parts } : null;
}
