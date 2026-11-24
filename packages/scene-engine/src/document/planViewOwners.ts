import { unwrapMathMarkup } from "@heytutor/drawing";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import type { SceneDocument, SceneIssue } from "../types";
import { readSourceDrawingRequests, sourceUnquotedText, type SourceDrawingRequest } from "./sourceRequestScope";

type Claim = TurnPlanV3["qualitativeClaims"][number];
interface View { claim: Claim; title: string; names: string[] }
interface Label { id: string; text: string }
interface OwnerSet { key: string; ids: string[] }
const words = (value: string): string[] => unwrapMathMarkup(value).normalize("NFKC").toLowerCase()
  .replace(/[_−–—-]/g, " ").match(/[\p{L}\p{N}]+/gu) ?? [];
const singular = (value: string): string => value.length > 3 && value.endsWith("s") && !/(?:us|ss|is)$/.test(value) ? value.slice(0, -1) : value;
const nameKey = (value: string): string => words(value).map(singular).join(" ");
const contains = (value: string, name: string): boolean => {
  const available = words(value).map(singular), wanted = words(name).map(singular);
  return wanted.length > 0 && available.some((_, index) => wanted.every((word, offset) => word === available[index + offset]));
};
const sourceKey = (value: string): string => unwrapMathMarkup(value).normalize("NFKC").replace(/\s+/g, " ").trim();
const viewWords = new Set(["view", "inset", "panel", "diagram", "sketch", "plot", "model"]);
const physicalKinds = new Set(["point", "circle", "ellipse"]);
const particleNames: Readonly<Record<string, string>> = { electron: "e", proton: "p", neutron: "n" };
const issue = (code: string, message: string, entityIds: string[] = []): SceneIssue =>
  ({ code, message, entityIds, severity: "fatal", failureKind: "truth", path: "entities" });

function usablePlan(plan: TurnPlanV3 | null | undefined): plan is TurnPlanV3 {
  return Boolean(plan && plan.schemaVersion === "turn-plan/v3" && typeof plan.question === "string" &&
    ["givens", "unknowns", "derived", "qualitativeClaims", "lawIds", "assumptions"].every(field => Array.isArray(plan[field as keyof TurnPlanV3])) &&
    plan.qualitativeClaims.every(claim => claim && typeof claim.id === "string" && typeof claim.claim === "string" &&
      (claim.relatedEntityHints === undefined || Array.isArray(claim.relatedEntityHints) && claim.relatedEntityHints.every(hint => typeof hint === "string"))));
}
function viewTitle(claim: Claim): string {
  const title = sourceUnquotedText(claim.claim).trim().replace(/^(?:draw|show|sketch|separate|keep)\s+/i, "");
  return /\bview\s*$/i.test(title) ? title.replace(/\s+view\s*$/i, "") : /\b(?:inset|panel)\s*$/i.test(title) ? title : "";
}
/** FROM names the reference view, not the object of a current drawing action. */
function requestObject(request: SourceDrawingRequest): string {
  const text = sourceUnquotedText(request.text);
  return request.action === "separate" || request.action === "keep" ? text.split(/\bfrom\b/i)[0]! : text;
}
function separationRequest(request: SourceDrawingRequest): boolean {
  const object = requestObject(request);
  return /\b(?:separate|distinct)\b/i.test(object) && /\b(?:views?|inset|panel|diagram|sketch|plot|model)\b/i.test(object);
}
function sourceNamedView(title: string, requests: SourceDrawingRequest[]): boolean {
  return requests.some(request => request.scope === "current" && ["draw", "show", "sketch", "plot", "graph", "separate", "keep"].includes(request.action) &&
    contains(requestObject(request), title));
}
function sourceViewTargets(requests: SourceDrawingRequest[]): string[] {
  return requests.filter(request => request.scope === "current").flatMap(request => requestObject(request).split(/\band\b/i).flatMap(part => {
    const object = part.trim().replace(/^(?:(?:draw|show|sketch|plot|graph|separate|keep|a|an|the)\s+)+/i, "");
    const target = /^((?:[\p{L}\p{N}_-]+\s+)*(?:view|inset|panel))\b/iu.exec(object)?.[1];
    return target ? [target.replace(/\s+view$/i, "")] : [];
  }));
}
function stripLocator(name: string): string {
  return name.trim().replace(/\s+(?:in|on|at)\s+(?:this|the)\s+(?:inset|view|panel)\s*$/i, "")
    .replace(/^(?:a|an|the)\s+/i, "");
}
export function requestedViewOwnerNames(claim: Claim): string[] {
  const declaration = claim.claim + ". " + (typeof claim.expected === "string" ? claim.expected : "");
  const requests = readSourceDrawingRequests(declaration).filter(request => request.scope === "current");
  const named = requests.filter(request => ["label", "name", "identify"].includes(request.action)).flatMap(request => {
    const list = /^(?:label|name|identify)\s+(?:the\s+)?([^.;]+)/i.exec(sourceUnquotedText(request.text))?.[1];
    return list && /,|\band\b/i.test(list) ? list.split(/,|\band\b/i).map(stripLocator).filter(Boolean) : [];
  });
  if (named.length) return [...new Set(named)];
  const display = requests.filter(request => ["show", "draw", "sketch", "keep"].includes(request.action)).map(request => requestObject(request)).join(" ");
  return (claim.relatedEntityHints ?? []).filter(hint => !viewWords.has(words(hint).at(-1) ?? "") && contains(display, hint));
}
function particleText(value: string): string {
  const subscripts = "₀₁₂₃₄₅₆₇₈₉", superscripts = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻";
  return unwrapMathMarkup(value).replace(/[₀-₉]+/g, part => "_" + [...part].map(char => subscripts.indexOf(char)).join(""))
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, part => "^{" + [...part].map(char => {
      const index = superscripts.indexOf(char); return index < 10 ? String(index) : index === 10 ? "+" : "-";
    }).join("") + "}").normalize("NFKC").replace(/−/g, "-");
}
function particleNotation(value: string, particle: string): boolean {
  const notation = particleText(value).replace(/[{}\s$]/g, "");
  const match = /^([pne])(?:(?:_[\p{L}\p{N}]+)?(\^?[+\-0]|\([+\-0]\))?|(\^?[+\-0]|\([+\-0]\))_[\p{L}\p{N}]+)$/u.exec(notation);
  if (!match || match[1] !== particleNames[particle]) return false;
  const charge = (match[2] ?? match[3])?.replace(/[\^()]/g, "");
  return !charge || charge === (particle === "electron" ? "-" : particle === "proton" ? "+" : "0");
}
/** Consume the entire charge suffix. A valid e- prefix cannot authorize e--,
 * e^{2-}, or another species. Subscripts are indices, never charge magnitudes. */
function validParticleCaption(label: string, particle: string): boolean {
  const display = particleText(label);
  const notations = [...display.matchAll(/(?<![\p{L}\p{M}\p{N}_])([pnePNE])((?:_\{[^}]*\}|_[\p{L}\p{N}]+|\^\{[^}]*\}|\^[+\-0-9]+|[+-]|[0-9]+[+-]|\s*\(\s*[+\-0-9]+\s*\))+)(?![\p{L}\p{M}\p{N}_])/gu)]
    .filter(match => !/^\s*=/.test(display.slice(match.index! + match[0].length)));
  const parenthesizedNames = [...display.matchAll(/\(\s*([pne])\s*\)/g)].map(match => match[1]!);
  return notations.every(match => particleNotation(match[0], particle)) &&
    parenthesizedNames.every(name => particleNotation(name, particle));
}
function positiveDeclaration(display: string, name: string): boolean {
  const owner = words(name).map(singular);
  return sourceUnquotedText(display).split(/[.;]/).some(clause => {
    const available = words(clause).map(singular);
    return available.some((word, index) => (word === "positive" || word === "positively") && available[index + 1] === "charged" &&
      owner.every((part, offset) => part === available[index + 2 + offset]) &&
      !/\b(?:not|no|never|without|whether|if|says?|said|reported|wrote|quoted)\b/i.test(available.slice(0, index).join(" ")));
  });
}
function positiveOwner(claim: Claim, name: string): boolean {
  const display = readSourceDrawingRequests(claim.claim + ". " + (typeof claim.expected === "string" ? claim.expected : ""))
    .filter(request => request.scope === "current").map(request => sourceUnquotedText(request.text)).join(" ");
  return positiveDeclaration(display, name);
}
function opposingPositiveLabel(label: string): boolean {
  const display = particleText(label);
  return /\b(?:negative|negatively|neutral|uncharged)\b|\b(?:no|zero)\s+charge\b/i.test(display) ||
    /-(?:\}|\s|$)|\^(?:\{\s*0\s*\}|0)(?:\s|$)/.test(display);
}
export function requestedViewLabelNamesOwner(document: SceneDocument, id: string, label: string, name: string, claim?: Claim): boolean {
  const entity = document.entities.find(owner => owner.id === id);
  if (!entity) return false;
  const particle = singular(words(name).at(-1) ?? "");
  if (particle === "nucleus") return physicalKinds.has(entity.kind) && contains(label, name) &&
    (!claim || !positiveOwner(claim, name) || !opposingPositiveLabel(label));
  if (nameKey(name) === "circle") return contains(label, name) && document.constructions.some(construction =>
    construction.outputs.includes(id) && construction.operator === "circle" && entity.kind === "circle");
  if (!particleNames[particle]) return contains(label, name);
  return requestedParticleLabelNamesOwner(entity.kind, label, name);
}
/** Formal label compatibility for a literal source particle noun. This binds
 * an identity only; source/numeric/native/geometry admission remains separate. */
export function requestedParticleLabelNamesOwner(kind: string, label: string, name: string): boolean {
  const particle = singular(words(name).at(-1) ?? "");
  if (!particleNames[particle] || !physicalKinds.has(kind) || !validParticleCaption(label, particle) ||
    Object.keys(particleNames).some(other => other !== particle && contains(label, other))) return false;
  return particleNotation(label, particle) || contains(label, name);
}
function ownerLabels(document: SceneDocument): Label[] {
  const required = new Set(document.requiredEntityIds);
  return document.entities.filter(entity => required.has(entity.id) && !["group", "label"].includes(entity.kind) &&
    document.constructions.some(construction => construction.outputs.includes(entity.id))).flatMap(entity => {
    const annotations = document.annotations.filter(annotation => annotation.kind === "label" && !annotation.quantityId &&
      annotation.targetIds.length === 1 && annotation.targetIds[0] === entity.id);
    const replaced = annotations.some(annotation => annotation.labelMode !== "append" && annotation.text);
    return [...(!replaced ? [entity.label] : []), ...annotations.map(annotation => annotation.text)]
      .filter((label): label is string => typeof label === "string" && Boolean(label.trim())).map(text => ({ id: entity.id, text }));
  });
}

/** Construction dependencies and checked literal layout containment define
 * candidate local representations. Reveal-group names/metadata add no edges. */
function geometryComponents(document: SceneDocument): Map<string, string> {
  const parent = new Map(document.entities.map(entity => [entity.id, entity.id]));
  const root = (id: string): string => { let current = id; while (parent.get(current) !== current) current = parent.get(current)!; return current; };
  const join = (left: string, right: string) => { if (parent.has(left) && parent.has(right)) parent.set(root(left), root(right)); };
  const references = (value: unknown): string[] => typeof value === "string" ? parent.has(value) ? [value] : [] : Array.isArray(value)
    ? value.flatMap(references) : value && typeof value === "object" ? Object.values(value).flatMap(references) : [];
  for (const construction of document.constructions) {
    const inputs = Object.entries(construction.inputs).filter(([key]) =>
      ["center", "start", "end", "from", "to", "a", "b", "point", "points", "vertices", "through", "line", "curve", "path", "origin", "plane", "normal", "direction"].includes(key));
    for (const output of construction.outputs) for (const reference of inputs.flatMap(([, value]) => references(value))) join(output, reference);
  }
  const points = document.constructions.filter(construction => construction.operator === "point" && construction.inputs.coordinateSpace === "layout" &&
    typeof construction.inputs.x === "number" && Number.isFinite(construction.inputs.x) && typeof construction.inputs.y === "number" && Number.isFinite(construction.inputs.y))
    .flatMap(construction => construction.outputs.map(id => ({ id, x: construction.inputs.x as number, y: construction.inputs.y as number })));
  for (const construction of document.constructions) {
    if (construction.operator !== "circle" || typeof construction.inputs.radius !== "number" || construction.inputs.radius <= 0) continue;
    const center = points.find(point => point.id === construction.inputs.center);
    if (!center) continue;
    for (const point of points) if (Math.hypot(point.x - center.x, point.y - center.y) < construction.inputs.radius)
      for (const output of construction.outputs) join(output, point.id);
  }
  return new Map([...parent.keys()].map(id => [id, root(id)]));
}
function distinctCenterCorrespondence(document: SceneDocument, names: string[], owners: string[][]): boolean {
  const index = names.findIndex(name => nameKey(name) === "center");
  if (index < 0) return true;
  return owners[index]!.every(id => document.entities.find(entity => entity.id === id)?.kind === "point" &&
    document.constructions.some(construction => construction.outputs.some(output => owners.some((group, groupIndex) =>
      groupIndex !== index && group.includes(output))) && construction.inputs.center === id));
}
function enoughOwners(name: string, labels: Label[]): boolean {
  const ids = new Set(labels.map(label => label.id)), word = words(name).at(-1) ?? "", plural = singular(word) !== word;
  return plural ? ids.size >= 2 || labels.some(label => words(label.text).includes(word)) : ids.size === 1;
}
function localOwnerSets(document: SceneDocument, view: View, labels: Label[], components: Map<string, string>, repeated: boolean,
  positiveNames: Set<string>): OwnerSet[] {
  const matches = view.names.map(name => labels.filter(label => requestedViewLabelNamesOwner(document, label.id, label.text, name, view.claim) &&
    (!positiveNames.has(nameKey(name)) || !opposingPositiveLabel(label.text))));
  const groups = repeated ? [...new Set(matches.flat().map(label => components.get(label.id)!))] : ["whole"];
  return groups.flatMap(group => {
    const local = matches.map(available => repeated ? available.filter(label => components.get(label.id) === group) : available);
    const owners = local.map(available => [...new Set(available.map(label => label.id))]);
    if (!local.every((available, index) => enoughOwners(view.names[index]!, available)) ||
      new Set(owners.flat()).size !== owners.flat().length || !distinctCenterCorrespondence(document, view.names, owners)) return [];
    const ids = owners.flat();
    if (!repeated) return [{ key: "whole:" + view.claim.id, ids }];
    const positions = document.constructions.filter(construction => construction.operator === "point" &&
      construction.inputs.coordinateSpace === "layout" && construction.outputs.some(id => components.get(id) === group) &&
      typeof construction.inputs.x === "number" && typeof construction.inputs.y === "number")
      .map(construction => [construction.inputs.x, construction.inputs.y].join(",")).sort();
    return positions.length ? [{ key: positions.join(";"), ids }] : [];
  });
}

/** Separate source-requested, numeric-free views require current source actions,
 * a complete retained plan, and their own visible constructed owners at every
 * admission policy and replay. Numeric/native programmes keep their old guards. */
export function validatePlanViewOwnerTruth(document: SceneDocument, plan?: TurnPlanV3 | null): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const accepted = usablePlan(plan);
  const question = typeof document.source.question === "string" ? document.source.question : "";
  const requests = readSourceDrawingRequests(question);
  const declared = accepted ? plan.qualitativeClaims.map(claim => ({ claim, title: viewTitle(claim), names: requestedViewOwnerNames(claim) })).filter(view => view.title) : [];
  const literalSourceNames = requestedViewOwnerNames({ id: "source_names", claim: "Original source", expected: question });
  const particleSource = literalSourceNames.some(name => nameKey(name) === "nucleus" || particleNames[nameKey(name)]);
  const separateViews = requests.some(separationRequest) || declared.length >= 2;
  if (!separateViews && !particleSource) return [];
  if (separateViews && !requests.some(request => request.scope === "current" && separationRequest(request)))
    return [issue("required_view_source_missing", "Separate scene views require a current original-source drawing/separation instruction.")];
  if (!accepted || sourceKey(plan.question) !== sourceKey(question))
    return [issue("required_view_authority_missing", "Source-requested views and particle names need their complete retained accepted turn plan.")];
  if (particleSource && literalSourceNames.some(name => !plan.qualitativeClaims.some(claim =>
    requestedViewOwnerNames(claim).some(owned => nameKey(owned) === nameKey(name)))))
    return [issue("required_view_plan_incomplete", "The retained plan must preserve the literal particle names requested by the original source.")];
  const names = [...new Set([...declared.flatMap(view => view.names), ...literalSourceNames])];
  const positive = names.filter(name => requests.some(request => request.scope === "current" && positiveDeclaration(request.text, name)) ||
    plan.qualitativeClaims.some(claim => claim.expected !== false && positiveDeclaration(claim.claim + ". " +
      (typeof claim.expected === "string" ? claim.expected : ""), name)));
  const positiveIssues = positive.flatMap(name => ownerLabels(document).filter(label => contains(label.text, name) && opposingPositiveLabel(label.text))
    .map(label => issue("required_view_owner_charge_mismatch", "The source asserts a positive charge on " + name + "; its own label states an opposing charge.", [label.id])));
  if (!separateViews) return positiveIssues;
  const views = declared.filter(view => view.claim.expected !== false);
  if (views.length < 2 || views.some(view => view.names.length < 2) ||
    sourceViewTargets(requests).some(target => !views.some(view => contains(target, view.title))))
    return [issue("required_view_plan_incomplete", "The retained plan must preserve every source-labelled separate view and its requested owners.")];
  const unsupported = views.filter(view => !sourceNamedView(view.title, requests));
  if (unsupported.length) return unsupported.map(view => issue("required_view_source_missing",
    "The named view " + view.claim.claim + " has no current original-source drawing action."));
  const labels = ownerLabels(document), components = geometryComponents(document);
  const uses = new Map<string, number>();
  for (const view of views) for (const name of new Set(view.names.map(nameKey))) uses.set(name, (uses.get(name) ?? 0) + 1);
  // Display wording cannot drop another retained, unquoted positive assertion
  // about the same named owner. Only that owner's visible labels are checked.
  const positiveNames = new Set(views.flatMap(view => view.names).filter(name => plan.qualitativeClaims.some(claim => claim.expected !== false &&
    positiveDeclaration(claim.claim + ". " + (typeof claim.expected === "string" ? claim.expected : ""), name))).map(nameKey));
  const choices = views.map(view => localOwnerSets(document, view, labels, components, view.names.some(name => uses.get(nameKey(name))! > 1), positiveNames));
  const failures: SceneIssue[] = [...positiveIssues];
  const occupied = new Set<string>(), assigned = new Map<string, number>();
  const repeatIndices: number[] = [];
  for (const [index, view] of views.entries()) {
    if (view.names.some(name => uses.get(nameKey(name))! > 1)) { repeatIndices.push(index); continue; }
    const owners = choices[index]![0];
    if (!owners || owners.ids.some(id => occupied.has(id))) failures.push(issue("required_view_owner_missing",
      "The accepted source view " + view.claim.claim + " requires its own visible constructed owners.", owners?.ids));
    else owners.ids.forEach(id => occupied.add(id));
  }
  const augment = (index: number, visited: Set<string>): boolean => choices[index]!.some(choice => {
    if (visited.has(choice.key) || choice.ids.some(id => occupied.has(id))) return false;
    visited.add(choice.key);
    const previous = assigned.get(choice.key);
    if (previous === undefined || augment(previous, visited)) { assigned.set(choice.key, index); return true; }
    return false;
  });
  for (const index of repeatIndices) if (!augment(index, new Set())) failures.push(issue("required_view_owner_missing",
    "The accepted source view " + views[index]!.claim.claim + " needs a distinct constructed representation of its requested owners."));
  return failures;
}
