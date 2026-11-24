import { unwrapMathMarkup } from "@heytutor/drawing";
import { sourceFigureForegroundContext } from "../chemistry/figureSourceOwnership";
import { chemStem } from "../chemistry/sceneKit";
import { chemicalKineticsContext } from "../chemistry/semanticCues";
import { readSourceDrawingRequests, sourceUnquotedText } from "../document/sourceRequestScope";
import { buildSourceCertifiedScientificScene } from "../synthesize/sourceCertifiedScientificScene";
import type { SceneDocument, SceneIssue } from "../types";
import { sourceDocumentMatchesRebuiltSource } from "./independentSourceScene";
import { buildNeutralDecayScene } from "./neutralDecaySource";

const ACTIVITY_UNIT = String.raw`(?:becquerels?|[kMmµμunp]?bq|[mµμunp]?ci|(?:(?:milli|micro|nano|pico)[- ]?)?curies?)`;
const NUCLEAR_CONTEXT = new RegExp(String.raw`\b(?:radioactiv\w*|radioisotop\w*|radionuclid\w*|parent\s+(?:population|nuclei|nuclide)|${ACTIVITY_UNIT}|(?:decays?|disintegrations?)\s*(?:\/|per\b))\b`, "i");
const DECAY_LAW = /\b(?:decays?|halves?|half[- ]li(?:fe|ves)|transmut\w*|disintegrat\w*)\b|\bhalf\s+(?:of\s+)?(?:the\s+)?(?:remaining\s+)?(?:nuclei|nuclides?|atoms?)\b|\bt\s*[_^{ ]*(?:½|half|1\s*\/\s*2)/i;
const DECAY_OBSERVABLE = /\b(?:nuclei|nucleus|nuclides?|population|activity|count\s+rates?|mass|[NA]\s*[_^{ ]*0)\b|\b[NA]\s*\(\s*t\s*\)/i;
const TIME_UNIT = String.raw`(?:s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?|d|days?|weeks?|years?|yrs?)`;
const MASS_UNIT = String.raw`(?:ng|[µμu]g|mg|g|kg|(?:nano|micro|milli|kilo)?grams?)`;
const COUNT_UNIT = String.raw`(?:(?:(?:undecayed|remaining|parent|daughter)\s+)*(?:nuclei|atoms?|particles?)|counts?|decays?|disintegrations?|[cd]p[sm]|${ACTIVITY_UNIT})`;
const MEASURED_UNIT = new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:\d+(?:[.,_]\d+)*|\.\d+)(?:e[+-]?\d+)?\s*(?:${TIME_UNIT}|${MASS_UNIT}|${COUNT_UNIT})\b`, "iu");
const WRITTEN_MEASUREMENT = new RegExp(String.raw`\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:thir|four|fif|six|seven|eigh|nine)teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)[- ]+(?:${TIME_UNIT}|${MASS_UNIT}|${COUNT_UNIT})\b`, "i");
const NUMBERED_TIME = /\b(?:second|minute|hour|day|week|year)\s+\d/i;
const MEASURED_RATE = new RegExp(String.raw`[\d.]\s*(?:/|per\b)\s*${TIME_UNIT}\b`, "i");
const SCALAR_ASSIGNMENT = /(?:\b(?:[NA]\s*[_^{ ]*0|N|A|[NA]\s*\([^)]*\)|lambda|half[- ]life|T\s*[_^{ ]*(?:½|half|1\s*\/\s*2)|mass|population|activity|(?:count|decay)\s+rate)|λ)\s*\}?\s*(?:=|≈|:|is)\s*[+-]?(?:\d|\.\d)/i;
const MASS_VALUE = new RegExp(String.raw`\d\s*${MASS_UNIT}\b`, "i");
const AXIS_UNIT = new RegExp(String.raw`(?:[\[(/]|\bper\s+)\s*(?:${TIME_UNIT}|${MASS_UNIT}|${COUNT_UNIT})\b`, "i");
const PLOT = /\b(?:graphs?|plots?|plotted|curves?|axes|axis|charts?|versus|vs|against)\b|\b(?:over|with|against)\s+(?:(?:the|elapsed)\s+)*time\b|\bas\s+a\s+function\s+of\s+time\b/i;
const NUMERIC_PLOT = /\b(?:numeric(?:al)?|quantitative|calibrated|metric|to\s+scale|scaled|unit\s+conversion|computed\s+values?)\b/i;
const NO_NUMBERS = /\b(?:without|no)\s+(?:numeric(?:al)?\s+)?(?:values|labels|scale|numbers)\b/gi;
const SHAPE_ONLY = /^(?:draw|sketch|plot|graph|show)\s+(?:(?:a|an|the|only)\s+)*(?:qualitative(?:ly)?|schematic|symbolic(?:ally)?|unscaled)\b/i;
const NORMALIZED_TIME = /\bt\s*\/\s*t\s*[_^{ ]*(?:½|half|1\s*\/\s*2)|(?:\blambda|λ)\s*\*?\s*t\b/i;
const NORMALIZED_ORDINATE = /\b(?:normalized|fraction|[NA]\s*\/\s*[NA]\s*_?0)\b/i;
const INK_MEASUREMENT = /\b(?:mark|label|indicate|show)\b|\b(?:marks?|marker|tick|anchored?|labelled|labeled|marked)\b/i;
const MEASURED_ANCHOR = /\b(?:time|value|count|rate|mass|amount|half[- ]life|halfway|halves?)\b/i;
const VERBAL_TAIL = /\b(?:and|then|also)\s+(?:then\s+|also\s+)?(?:calculate|compute|find|determine|evaluate|solve|derive|estimate|compare|explain|describe|state|write)\b/i;
const HISTORY = /\b(?:previously|formerly|historically|used\s+to|last\s+(?:time|exercise)|(?:previous|earlier|old)\s+(?:task|exercise|diagram|convention))\b/i;
const CURRENT = /\b(?:now|currently|current\s+(?:task|question|exercise)|for\s+this\s+(?:task|question|exercise))\b/i;
const DRAWING = new Set(["draw", "sketch", "plot", "graph", "show", "label", "mark"]);

const normalized = (text: string) => unwrapMathMarkup(text).normalize("NFKC")
  .replace(/[‐‑‒–—−]/g, "-").replace(/1⁄2/g, "½");
const hasMeasurement = (text: string) => MEASURED_UNIT.test(text) || WRITTEN_MEASUREMENT.test(text) ||
  NUMBERED_TIME.test(text) || MEASURED_RATE.test(text) || SCALAR_ASSIGNMENT.test(text);

function foreground(question: string): string {
  return normalized(sourceFigureForegroundContext(question)).split("; ").flatMap(clause => {
    const history = HISTORY.exec(clause);
    if (!history) return [clause];
    const current = CURRENT.exec(clause.slice(history.index + history[0].length));
    return current ? [clause.slice(history.index + history[0].length + current.index)] : [];
  }).join("; ");
}

/** A symbolic request is a bounded exception to measured-plot admission.
 * Keep separate verbal calculations out of the visual claim. */
function symbolicDrawingOnly(question: string): boolean {
  const requests = readSourceDrawingRequests(question).filter(request => request.scope === "current" && DRAWING.has(request.action));
  if (!requests.length) return false;
  let found = false;
  const outside = sourceUnquotedText(question).split("");
  for (const request of requests) {
    const text = outside.slice(request.start, request.end).join("");
    const tail = text.search(VERBAL_TAIL);
    const body = normalized(tail < 0 ? text : text.slice(0, tail));
    const symbolic = SHAPE_ONLY.test(body);
    if (!symbolic && !PLOT.test(body) && !["plot", "graph"].includes(request.action)) {
      if (INK_MEASUREMENT.test(body) && (hasMeasurement(body) || MEASURED_ANCHOR.test(body))) return false;
      continue;
    }
    const scaledByHalfLife = NORMALIZED_TIME.test(body) && NORMALIZED_ORDINATE.test(body);
    if ((!symbolic && !scaledByHalfLife) || hasMeasurement(body) || NUMERIC_PLOT.test(body.replace(NO_NUMBERS, "")) ||
        INK_MEASUREMENT.test(body) && MEASURED_ANCHOR.test(body) && !scaledByHalfLife) return false;
    found = true;
    outside.fill(" ", request.start, tail < 0 ? request.end : request.start + tail);
  }
  const remaining = foreground(outside.join(""));
  return found && !PLOT.test(remaining) &&
    !/\b(?:include|annotate|place|put|show|label|mark)\b[^;.!?]*\b(?:exact|numeric(?:al)?|measured|computed|result|values?)\b/i.test(remaining);
}

function hasMeasuredInk(document: SceneDocument): boolean {
  const texts = [
    ...document.entities.map(entity => entity.label),
    ...document.annotations.map(annotation => annotation.text),
    ...document.constructions.flatMap(construction => construction.operator === "label" ? [construction.inputs.text] : []),
  ];
  return texts.some(label => typeof label === "string" && hasMeasurement(normalized(label))) ||
    document.constructions.some(construction => construction.operator === "axes" &&
      [construction.inputs.xLabel, construction.inputs.yLabel].some(
        text => typeof text === "string" && AXIS_UNIT.test(normalized(text)),
      ));
}

function rebuiltInstantaneousDisplay(document: SceneDocument, question: string): boolean {
  const rebuilt = buildSourceCertifiedScientificScene(question)?.document;
  if (!rebuilt?.quantities.some(quantity => quantity.id === "lambda" && quantity.nativeOwnerId === "activity")) return false;
  // The app independently rebuilds answer timing and binds the palette.
  // Neither supplies geometry or labels for the source comparison.
  const source = { ...document.source };
  for (const field of ["answerLabelPrimitiveIds", "answerLabelEntityIds", "answerLabelAnnotationIds", "scientificStyle"]) delete source[field];
  return sourceDocumentMatchesRebuiltSource({ ...document, source }, question, rebuilt);
}

/** A quantified decay question needs whole source proof for every scene.
 * Changing the form of an unproved figure does not grant numerical authority. */
export function validateNumericDecayPlotAdmission(document: SceneDocument, question: string): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const context = foreground(question);
  const namedDecay = NUCLEAR_CONTEXT.test(context);
  if (!namedDecay && !(DECAY_LAW.test(context) &&
      (DECAY_OBSERVABLE.test(context) || MASS_VALUE.test(context)) && !chemicalKineticsContext(chemStem(context), context))) return [];
  const measured = hasMeasuredInk(document);
  if (!measured && !hasMeasurement(context) && !NUMERIC_PLOT.test(context.replace(NO_NUMBERS, ""))) return [];
  if (!measured && symbolicDrawingOnly(question)) return [];
  if (rebuiltInstantaneousDisplay(document, question)) return [];
  if (sourceDocumentMatchesRebuiltSource(document, question, buildNeutralDecayScene(question))) return [];
  return [{ code: "numeric_decay_plot_source_unproved", severity: "fatal", failureKind: "truth",
    message: "A numerical decay figure needs an independently source-proved whole figure, including its plotted observable, scales, and physical labels." }];
}
