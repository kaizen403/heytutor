import { readSourceDrawingRequests, sourceUnquotedText } from "../document/sourceRequestScope";
import { deriveRadioactiveActivity } from "./nuclearAuthority";
import { readObservableScalar, sourceTimeUnit } from "../document/sourceObservableUnits";

interface Span { start: number; end: number }
export interface SourceInstantaneousActivityCertificate {
  version: "source-instantaneous-activity/v1";
  originalQuestion: string;
  requestedOwner: "activity";
  request: Span;
  law: "activity=lambda_per_second*population_at_same_instant";
  inputs: { lambda: Span & { value: number; timeUnit: string }; population: Span & { value: number; unit: "nuclei" } };
  value: number;
  unit: "Bq";
}
const NUMBER = String.raw`[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?`;
/** Original-source law/input certificate, not arithmetic-only planner evidence.
 * Only the complete same-instant source declaration below supplies operands.
 * No N0, half-life, interval, production, efficiency or candidate IR is inferred. */
export function readSourceInstantaneousActivity(question: string, request: Span, owner: string):
  { status: "certified"; certificate: SourceInstantaneousActivityCertificate } | { status: "unproved"; reason: string } {
  const refuse = (reason: string) => ({ status: "unproved" as const, reason });
  if (question.length > 8192 || owner !== "activity" || request.start < 0 || request.end > question.length || request.end <= request.start)
    return refuse("unsupported source owner or request span");
  const unquoted = sourceUnquotedText(question);
  const declarations = [...unquoted.matchAll(new RegExp(
    String.raw`(?:^|[.!?;\n]\s*)(\s*At\s+(?:an|the\s+same)\s+instant(?:\s+(?:a\s+)?radioactive\s+sample\s+has)?\s*,?\s*(?:lambda|λ)\s*=\s*(${NUMBER})\s*([A-Za-z]+)\s*(?:\^\s*\{?\s*-\s*1\s*\}?|⁻¹)\s+and\s+N\s*=\s*(${NUMBER})\s+nuclei\s*)(?=[.!?;\n]|$)`, "g"))];
  if (declarations.length !== 1) return refuse("one complete explicit same-instant lambda and population declaration is required");
  const match = declarations[0]!;
  const declarationStart = match.index! + match[0].indexOf(match[1]!);
  const declarationEnd = declarationStart + match[1]!.length;
  if (declarationEnd > request.start) return refuse("physical inputs must precede the current request");
  const lambda = readObservableScalar(match[2]!), population = readObservableScalar(match[4]!), timeUnit = sourceTimeUnit(match[3]!);
  if (!timeUnit || lambda === null || population === null || !Number.isSafeInteger(population) || population < 0) return refuse("population must be a nonnegative explicit integer count and lambda needs seconds/minutes/hours");
  const sourceRequest = readSourceDrawingRequests(question).find(item => item.scope === "current" &&
    item.start === request.start && item.end === request.end && ["show", "label", "mark"].includes(item.action));
  if (!sourceRequest || unquoted !== question || unquoted.slice(0, declarationStart).trim())
    return refuse("the original current display request and complete unquoted source are required");
  const gap = unquoted.slice(declarationEnd, request.start).replace(/^[.;\s]+|[;\s]+$/g, "");
  const indirect = /^(?:show|label|mark)\s+(?:the\s+)?(?:two|both)\s+unit\s+labels(?:\s+without\s+swapping\s+(?:their|the)\s+values)?\s*$/i.test(sourceRequest.text);
  const calculation = /^Calculate\s+activity\s+in\s+Bq\s+and\s+compare\s+(?:it\s+with\s+)?(?:the\s+)?decay\s+rate\s+per\s+(?:second|minute|hour)\s*$/i.test(gap);
  const direct = /^(?:show|label|mark)\s+(?:the\s+)?activity\s+in\s+/i.test(sourceRequest.text);
  if (!(indirect && calculation || direct && !gap))
    return refuse("unsupported complete source declaration/calculation/display linkage");
  const tail = unquoted.slice(request.end).replace(/^[,;.\s]+|[.;\s]+$/g, "").replace(/^and\s+/i, "");
  // A temporal request is a separate observable, retained without inventing
  // a population at t=0, time domain or half-life for this instant certificate.
  if (tail && !/^(?:also\s+)?(?:plot|sketch|draw|graph|show)\s+(?:normalized\s+)?(?:activity|population|A\/A0|N\/N0)\s+(?:against|versus|over)\s+time(?:\s+with\s+half-life\s+marks)?\s*$/i.test(tail))
    return refuse("additional source models/calculations are outside this certificate");
  try {
    const value = deriveRadioactiveActivity(population, lambda, timeUnit).activity;
    const lambdaStart = unquoted.indexOf(match[2]!, declarationStart + match[1]!.search(/(?:lambda|λ)\s*=/));
    const populationStart = unquoted.indexOf(match[4]!, unquoted.indexOf("N", lambdaStart));
    return { status: "certified", certificate: { version: "source-instantaneous-activity/v1", originalQuestion: question,
      requestedOwner: "activity", request: { start: request.start, end: request.end }, law: "activity=lambda_per_second*population_at_same_instant",
      inputs: { lambda: { start: lambdaStart, end: lambdaStart + match[2]!.length, value: lambda, timeUnit },
        population: { start: populationStart, end: populationStart + match[4]!.length, value: population, unit: "nuclei" } }, value, unit: "Bq" } };
  } catch (error) { return refuse(error instanceof Error ? error.message : "unrepresentable instantaneous rate"); }
}
