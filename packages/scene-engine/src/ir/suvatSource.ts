/** One source interval: role evidence, stated condition and complete queries. */
import { normalized, tokens, stemKnowns, suvatSlots, resolveConstantAcceleration, STARTS_AT_REST, ENDS_AT_REST,
  type SuvatRole, type SuvatState } from "../archetypes/generators/constantAcceleration";
import type { ExpressionNodeIR, QuestionSourceEvidence } from "./problemIR";

export type SuvatSemantic = "velocity" | "speed" | "displacement" | "distance" | "acceleration" | "time";
export const suvatSemantic = (name: string): SuvatSemantic => name.includes("speed") ? "speed" : name.includes("velocity") ? "velocity" : name === "distance" ? "distance" : name === "displacement" ? "displacement" : name === "time" || name === "duration" || name === "braking time" ? "time" : "acceleration";

export interface SuvatSource {
  question: string;
  actor: string;
  state: SuvatState;
  roles: Partial<Record<SuvatRole, QuestionSourceEvidence>>;
  condition: QuestionSourceEvidence;
  asks: Array<{role: SuvatRole; semantic: SuvatSemantic; evidence: QuestionSourceEvidence}>;
  formulas: Record<SuvatRole, ExpressionNodeIR[]>;
}
export type SuvatReading = {status: "none"} | {status: "declined"; reason: string} | {status: "ok"; source: SuvatSource};
const roles: SuvatRole[] = ["u", "v", "a", "t", "s"];
const evidence = (question: string, start: number, end: number): QuestionSourceEvidence => ({source: "question", start, end, quote: question.slice(start,end)});
const number = (value: number): ExpressionNodeIR => ({kind: "number", value});
const binary = (operator: "+"|"-"|"*"|"/", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({kind: "binary", operator, left, right});
const wordRoles: Record<string, SuvatRole> = {acceleration: "a", deceleration: "a", retardation: "a", distance: "s", displacement: "s", time: "t", duration: "t", velocity: "v", speed: "v"};

export function readSuvatSource(question: string): SuvatReading {
  const actor = /\b(?:a|an|the)\s+(car|train|cart|body|cyclist|trolley|particle|object|truck|bike)\b/i.exec(question);
  const premise=question.split(/\b(?:find|calculate|determine|compute|how far|how long)\b/i)[0]!;
  // Applicability is a source motion predicate, never a requested quantity
  // name. Asking for centripetal/relative acceleration does not claim SUVAT.
  if (!actor || !/\b(?:accelerates?|accelerating|decelerates?|decelerating|brakes?|braking|retardation|constant acceleration)\b/i.test(premise) || tokens(normalized(premise)).length < 2) return {status:"none"};
  const decline = (reason: string): SuvatReading => ({status:"declined",reason});
  // This grammar consumes the source, rather than treating extra clauses as cues.
  const split = /\b(?:find|calculate|determine|compute|how far|how long)\b/i.exec(question);
  if (!split) return decline("no complete interval query");
  const statement = question.slice(0,split.index).trim().replace(/[.;]\s*$/, "");
  const conditionMatch = /\b(?:(?:brakes?|braking|accelerates?|decelerates?|retardation)\s+uniformly|uniform(?:ly)?\s+(?:acceleration|deceleration|braking)|constant\s+acceleration)\b/i.exec(statement);
  if (!conditionMatch) return decline("constant acceleration is not explicitly stated");
  const slots = suvatSlots(question, []);
  if ("conflict" in slots) return decline(slots.conflict);
  const solve = resolveConstantAcceleration(slots.knowns);
  if (!solve.ok) return decline(solve.reason);
  const found = tokens(normalized(statement));
  // Original evidence offsets are recovered from the exact source token, not
  // from lowercased/whitespace-folded offsets.
  const sourceTokens = found.map(token => {
    const tokenText = normalized(statement).slice(token.start, token.end);
    const matches = [...statement.matchAll(/[-+−]?\d+(?:[./]\d+)?(?:\s+\d+\/\d+)?\s*(?:km\/h|m\/s(?:\^2|²)?|cm\/s(?:\^2|²)?|min|s|m|km|cm)\b/g)]
      .filter(match => normalized(match[0]) === tokenText);
    const match = matches.find(match => normalized(statement.slice(0,match.index)).length === normalized(statement).slice(0,token.start).trimEnd().length);
    return match ? {token, span: evidence(question,match.index!,match.index!+match[0].length)} : null;
  });
  if(sourceTokens.some(token => !token)) return decline("source token grammar is ambiguous or unsupported");
  const sourceRoles: SuvatSource["roles"] = {};
  for(const row of sourceTokens) {
    if(!row) continue;
    const candidates = roles.filter(role => slots.knowns[role] !== undefined &&
      (role === "u" || role === "v" ? row.token.dimension === "speed" : role === "a" ? row.token.dimension === "accel" : role === "t" ? row.token.dimension === "time" : row.token.dimension === "length") &&
      (role === "a" || Math.abs(slots.knowns[role]! - row.token.value) < 1e-9));
    let role = candidates[0];
    if(row.token.dimension === "accel") role="a";
    if(row.token.dimension === "speed") {
      const before = normalized(statement).slice(0,row.token.start);
      role = /(?:\bto|\breaching|\breaches|\bfinal (?:velocity|speed)(?: of| is)?)\s*$/.test(before) ? "v" : "u";
      if(STARTS_AT_REST.test(statement))role="v";
    }
    if(!role || sourceRoles[role] || slots.knowns[role] === undefined) return decline("unbound source quantity");
    if (role !== "a" && Math.abs(slots.knowns[role]! - row.token.value) > 1e-9) return decline("source speed role conflicts with its rest condition");
    // Existing source lexemes specify magnitudes; they never license a
    // negative speed/distance by borrowing velocity/displacement coordinates.
    const priorEnd = sourceTokens.filter(prior => prior && prior.span.end <= row.span.start).at(-1)?.span.end ?? 0;
    const names = normalized(statement.slice(priorEnd,row.span.start)).match(/\b(?:speed|velocity|distance|displacement)\b/g);
    const semantic = names?.at(-1);
    if(row.token.value < 0 && (semantic === "speed" || semantic === "distance")) return decline("negative source magnitude is physically invalid");
    sourceRoles[role]=row.span;
  }
  for (const [role, pattern] of [["u",STARTS_AT_REST],["v",ENDS_AT_REST]] as const) {
    const match = pattern.exec(statement);
    if(match && !sourceRoles[role]) sourceRoles[role]=evidence(question,match.index,match.index+match[0].length);
  }
  if (Object.keys(slots.knowns).some(role => !sourceRoles[role as SuvatRole])) return decline("a solved source role has no complete source evidence");
  // All words belong to a bounded motion premise. Foreign apparatus, data,
  // actors and clauses must not disappear behind a resolvable numeric triple.
  let residual = statement;
  for(const row of sourceTokens) if(row) residual=residual.replace(row.span.quote," ");
  residual = residual.replace(conditionMatch[0]," ").replace(actor[0]," ");
  const allowed = new Set("moving with an initial final velocity speed of at from to rest starts start and in for on a straight road line track along uniformly accelerates accelerate decelerates brakes applies braking deceleration until it stops travelling traveled travelled covers covered reaches reaching is has the".split(" "));
  if((residual.toLowerCase().match(/[a-z]+/g) ?? []).some(word=>!allowed.has(word)) || /[\d=]/.test(residual)) return decline("unconsumed source premise");
  const query = question.slice(split.index);
  const asks: SuvatSource["asks"] = [];
  for(const match of query.matchAll(/\b(?:acceleration|deceleration|retardation|distance|displacement|time|duration|velocity|speed)\b/gi)) {
    const role = wordRoles[match[0].toLowerCase()]!;
    if(asks.some(ask=>ask.role===role) || sourceRoles[role]) return decline("duplicate query or query of a stated role");
    asks.push({role,semantic:suvatSemantic(match[0].toLowerCase()),evidence:evidence(question,split.index+match.index!,split.index+match.index!+match[0].length)});
  }
  let queryResidual=query.toLowerCase().replace(/\b(?:acceleration|deceleration|retardation|distance|displacement|time|duration|velocity|speed)\b/g," ");
  queryResidual=queryResidual.replace(/\b(?:find|calculate|determine|compute|its|the|and|travelled|traveled|covered|covers|while|during|braking|this|time|interval|final|taken|to|stop|it|in|total)\b/g," ");
  if(!asks.length || /[a-z0-9=]/.test(queryResidual))return decline("unconsumed source query");
  if (asks.some(ask => (ask.semantic === "distance" || ask.semantic === "speed") && solve.state[ask.role] < 0)) return decline("signed source result is not a nonnegative magnitude");
  const known=stemKnowns(question);
  const formulas = Object.fromEntries(roles.map(role=>[role,known[role] === undefined ? [] : [number(known[role]!)] ])) as Record<SuvatRole,ExpressionNodeIR[]>;
  const n=(role:SuvatRole) => formulas[role][0]!;
  const two=number(2);
  if(known.u!==undefined && known.v!==undefined && known.t!==undefined){
    formulas.a=[binary("/",binary("-",n("v"),n("u")),n("t"))];
    const sum=binary("+",n("u"),n("v"));
    formulas.s=[binary("/",binary("*",sum,n("t")),two),binary("*",binary("/",sum,two),n("t"))];
  } else if(known.u!==undefined && known.a!==undefined && known.t!==undefined){
    formulas.v=[binary("+",n("u"),binary("*",n("a"),n("t")))];
    formulas.s=[binary("+",binary("*",n("u"),n("t")),binary("/",binary("*",binary("*",n("a"),n("t")),n("t")),two))];
  } else return decline("whole caller formula proof currently supports u/v/t or u/a/t source roles");
  return {status:"ok",source:{question,actor:actor[1]!,state:solve.state,roles:sourceRoles,
    condition:evidence(question,conditionMatch.index,conditionMatch.index+conditionMatch[0].length), asks,formulas}};
}

/** Compare expression structure; equality of evaluated answers is insufficient. */
export function suvatAstKey(node: ExpressionNodeIR): string {
  if(node.kind==="number") return `n:${node.value}`;
  if(node.kind==="variable"||node.kind==="constant")return `${node.kind}:${node.name}`;
  if(node.kind==="unary")return node.operand.kind === "number" ? `n:${node.operator === "-" ? -node.operand.value : node.operand.value}` : `${node.operator}(${suvatAstKey(node.operand)})`;
  if(node.kind==="call")return `${node.function}(${suvatAstKey(node.argument)})`;
  let children=[suvatAstKey(node.left),suvatAstKey(node.right)];
  if(node.operator==="+"||node.operator==="*")children=children.sort();
  return `${node.operator}(${children.join(",")})`;
}
