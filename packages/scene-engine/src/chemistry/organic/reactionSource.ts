/** Positive reaction roles and requested results over exact original source spans. */
import type { Molecule } from "./smiles";
import { addRadicalHBr, asymmetricTreeStereo, degradePrimaryAmide, primaryAmineName, radicalBromoalkaneName, sameMolecularGraph, type GraphProduct, type StereoTreeProof } from "./reactionGraph";

export interface ReactionMention { molecule: Molecule; text: string; start: number; end: number }
export interface ReactionSpan { start: number; end: number; text: string; role: string }
export interface OrganicReactionSource extends GraphProduct {
  question: string;
  kind: "radical_hbr" | "hofmann";
  reactant: Molecule;
  bindings: ReactionSpan[];
  productRole: string;
  stereo?: StereoTreeProof;
  requestedStereoCount: boolean;
  requestedCarbonCount: boolean;
  carbonCounts: number[];
  gabrielExcluded: boolean;
}
export type OrganicReactionRead = { status: "not_applicable" } | { status: "declined"; reason: string } | { status: "source"; model: OrganicReactionSource };
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const productNoun = String.raw`(?:the |its |an? )?(?:(?:major |addition |amine )?product)`;

/** "Draw and name the product" asks for the chemical name, not only the graph. */
export function radicalProductNamingRequested(question: string): boolean {
  return new RegExp(String.raw`\b(?:draw|show|name)(?: and name)? ${productNoun}\b`, "i").test(question) && /\bname\b/i.test(question);
}

/** The mention reader is shared with the ordinary organic family; only actual
 * positively governed reactant occurrences enter a transformation. */
export function readOrganicReactionSource(question: string, mentions: readonly ReactionMention[]): OrganicReactionRead {
  const radicalClaim = /\b(?:hbr|hcl)\b/i.test(question) && /\b(?:peroxide|roor)\b/i.test(question);
  const amideClaim = /\b(?:hofmann|amide\w*|\S*amide)\b/i.test(question) && /\b(?:br2|bromine|hofmann)\b/i.test(question);
  if (!radicalClaim && !amideClaim) return { status: "not_applicable" };
  const decline = (reason: string): OrganicReactionRead => ({ status: "declined", reason });
  if (radicalClaim && amideClaim) return decline("multiple reaction models");
  const bindings: ReactionSpan[] = [];
  const consumed = Array(question.length).fill(false) as boolean[];
  const own = (start: number, end: number, role: string): void => {
    bindings.push({ start, end, text: question.slice(start, end), role });
    consumed.fill(true, start, end);
  };
  const candidates: Array<{ mention: ReactionMention; start: number; end: number }> = [];
  for (const mention of mentions) {
    // Tokens include source punctuation; that punctuation is not part of a chemical name.
    const name = question.slice(mention.start, mention.end).replace(/[.,;:?!]+$/, "");
    const end = mention.start + name.length;
    const after = question.slice(end);
    const prefix = question.slice(0, mention.start);
    const predicate = /^\s+(?:(?:is|are)\s+)?(?:treated|reacts?)\s+with\s+/i.exec(after)
      ?? (/\bTreat\s*$/i.test(prefix) ? /^\s+with\s+/i.exec(after) : null)
      ?? (/\btransformation of\s*$/i.test(prefix) ? /^\s+into its product with\s+/i.exec(after) : null);
    if (!predicate) continue;
    let start = mention.start;
    const leading = /\b(?:Treat|(?:Draw|Show) the transformation of)\s*$/i.exec(prefix);
    if (leading) start = leading.index;
    candidates.push({ mention, start, end: end + predicate[0].length });
  }
  if (candidates.length !== 1) return decline("one positively bound reactant required");
  const candidate = candidates[0]!, reactant = candidate.mention.molecule;
  const sameClause = question.slice(Math.max(question.lastIndexOf(".", candidate.mention.start - 1), question.lastIndexOf("?", candidate.mention.start - 1)) + 1, candidate.mention.start);
  // A coordinated subject is not silently reduced to its last named molecule.
  if (mentions.some(mention => mention !== candidate.mention && mention.end <= candidate.mention.start && mention.start >= candidate.mention.start - sameClause.length)) return decline("multiple source reactants");
  const reagent = radicalClaim
    ? /^HBr\s+(?:in\s+(?:the\s+)?presence\s+of\s+|and\s+|with\s+)(?:peroxide|ROOR)\b/i.exec(question.slice(candidate.end))
    : /^(?:Br2|bromine)\s+(?:and|with|\/)\s*(?:aqueous\s+(?:NaOH|sodium hydroxide)|aq\.?\s*NaOH)\b/i.exec(question.slice(candidate.end));
  if (!reagent) return decline("supported positive reagent condition required");
  own(candidate.start, candidate.end + reagent[0].length, "reactant and reaction conditions");
  const transformed = radicalClaim ? addRadicalHBr(reactant) : degradePrimaryAmide(reactant);
  if (!transformed) return decline("unsupported graph transformation");
  const stereo = radicalClaim ? asymmetricTreeStereo(transformed.product) : undefined;
  if (radicalClaim && !stereo) return decline("unsupported exact stereochemical count");
  if (!radicalClaim) {
    const name = primaryAmineName(transformed.product);
    if (!name) return decline("unsupported complete product name");
    transformed.product.name = name;
  }
  let productRole = "product";
  const productDeclaration = /\bto\s+(?:form|give|produce)\s+(?:(?:an?|the)\s+)?((?:addition\s+)?product(?:\s+[A-Z])?)\b/g;
  for (const match of question.matchAll(productDeclaration)) {
    const role = match[1]!;
    if (productRole !== "product" && productRole !== role) return decline("conflicting product variables");
    productRole = role;
    own(match.index!, match.index! + match[0].length, "formed product role");
  }
  // A named product is an independently checkable declaration, not a reason
  // to bypass the computed transformation or fall through to a name-only row.
  for (const match of question.matchAll(/\bto\s+(?:form|give|produce)\s+(?:(?:an?|the)\s+)?/gi)) {
    const start = match.index! + match[0].length;
    const mention = mentions.find(item => item.start === start);
    if (!mention) continue; // Unread names remain unconsumed and decline below.
    const name = question.slice(start, mention.end).replace(/[.,;:?!]+$/, "");
    if (!sameMolecularGraph(mention.molecule, transformed.product)) return decline("named product contradicts computed graph");
    if (productRole !== "product" && productRole !== name) return decline("conflicting product declarations");
    productRole = name;
    own(match.index!, start + name.length, "formed product name");
  }
  let gabrielExcluded = false;
  const gabriel = /\bWhy can (?:the )?Gabriel phthalimide synthesis not be used to prepare\s+/i.exec(question);
  if (gabriel) {
    const target = mentions.find(mention => mention.start === gabriel.index + gabriel[0].length);
    if (radicalClaim || !target || !sameMolecularGraph(target.molecule, transformed.product)
      || !transformed.product.atoms.some(atom => atom.element === "C" && atom.aromatic)) return decline("unsupported Gabriel target relation");
    own(gabriel.index, target.end, "excluded aryl Gabriel preparation");
    gabrielExcluded = true;
  }
  // Independent reusable request clauses. Every nonpunctuation source span
  // must belong to the reaction, a source variable or an implemented request.
  const reference = productRole.match(/\b([A-Z])$/)?.[1];
  const noun = `(?:the |its |an? )?(?:(?:major |addition |amine )?product${reference ? `(?: ${escape(reference)})?` : ""})`;
  const requests = [
    new RegExp(`\\b(?:Draw|Show|Name)(?: and name)? ${noun}\\b`, "gi"),
    /\b(?:identify|mark|label) (?:its |every |all |both |the )?stereocent(?:re|er)s?\b/gi,
    /\b(?:and )?(?:the |its )?(?:number of |count (?:its )?)?(?:possible |configurational )?stereoisomers(?: are possible)?\b/gi,
    /\b(?:What is the number of (?:possible )?|How many (?:configurational )?)stereoisomers(?: of ([A-Z]))?(?: are possible)?\b/g,
    /\b(?:count|state) (?:the |its )?(?:number of )?stereoisomers\b/gi,
    /\b(?:compare its carbon count with the amide|show how the carbon count changes|state how its number of carbon atoms compares with the amide)\b/gi,
    /\b(?:show|identify|identifying|mark) the carbon atom (?:lost|removed)\b/gi,
  ];
  let requestCount = 0;
  let requestedStereoCount = false;
  let requestedCarbonCount = false;
  for (const pattern of requests) for (const match of question.matchAll(pattern)) {
    if (consumed.slice(match.index!, match.index! + match[0].length).every(Boolean)) continue;
    if (match[1] && match[1] !== reference) return decline("unbound requested product variable");
    if (/\bstereo(?:isomers|cent(?:re|er)s?)\b/i.test(match[0]) && !stereo) return decline("requested stereochemical result has no computed graph proof");
    if (/\b(?:count|number of|how many)\b/i.test(match[0]) && /\bstereoisomers\b/i.test(match[0])) requestedStereoCount = true;
    if (/\bcarbon count\b|\bnumber of carbon atoms\b/i.test(match[0])) requestedCarbonCount = true;
    own(match.index!, match.index! + match[0].length, "requested reaction result"); requestCount++;
  }
  for (const match of question.matchAll(/\b(?:and|when)\b/gi)) own(match.index!, match.index! + match[0].length, "request coordination");
  const leftovers = [...question.matchAll(/[\p{L}\p{N}]/gu)].filter(match => consumed.slice(match.index!, match.index! + match[0].length).some(owned => !owned));
  if (!requestCount || leftovers.length) return decline("unconsumed reaction source or request");
  if (radicalClaim && radicalProductNamingRequested(question)) {
    const proved = radicalBromoalkaneName(transformed.product);
    if (!proved) return decline("unsupported complete product name");
    if (productRole === "product") transformed.product.name = proved;
    else if (productRole !== proved) return decline("requested product name is not the computed graph name");
  }
  return { status: "source", model: { question, kind: radicalClaim ? "radical_hbr" : "hofmann", reactant, ...transformed, bindings, productRole,
    ...(stereo ? { stereo } : {}), requestedStereoCount, requestedCarbonCount, carbonCounts: [reactant, transformed.product].map(molecule => molecule.atoms.filter(atom => atom.element === "C").length), gabrielExcluded } };
}
