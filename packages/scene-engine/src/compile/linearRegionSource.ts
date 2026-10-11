import type { SceneDocument, SceneIssue } from "../types";
import {
  solveLinearFigure,
  parseLinearConstraint,
  linearConstraintSignature,
  parseLinearAffine,
  type IntervalExpression,
} from "../math/linearRegion";
import { readLinearSourceReferencePoints } from "./linearSourcePoints";
export { readLinearSourceReferencePoints } from "./linearSourcePoints";
import {
  evaluateLinearRegionConstruction,
  LINEAR_REGION_OPERATORS,
  type LinearRegionGeometry,
} from "./linearRegionGeometry";
import { snapshotMathSourceData } from "./mathSourceData";

interface SourceClause {
  text: string;
  start: number;
  end: number;
  equality: boolean;
}
function normalize(text: string): string {
  return text
    .replace(/\\(?:left|right)/g, "")
    .replace(/\\(?:leq|le)\b/g, "<=")
    .replace(/\\(?:geq|ge)\b/g, ">=")
    .replace(/\\(?:cdot|times)\b/g, "*")
    .replace(/\\frac\s*\{\s*([+-]?\d+)\s*\}\s*\{\s*([+-]?\d+)\s*\}/g, "($1/$2)")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/[−–]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/\$/g, "")
    .replace(/∨|∪|\\(?:lor|vee|cup)\b/g, " or ")
    .replace(/∧|∩|\\(?:land|wedge|cap)\b/g, " and ")
    .replace(/¬|\\(?:neg|lnot)\b/g, " not ");
}
/** Explicit variable-domain grammar; these givens are never assumed by convention. */
function explicitDomains(text: string, names: readonly string[]): string {
  const name = `(?:${names.join("|")})`;
  const list = `${name}(?:\\s*(?:,\\s*(?:and\\s*)?|and\\s+)${name})*`;
  const domain = "non[- ]?negative|non[- ]?positive|positive|negative";
  const expand = (variables: string, word: string): string => {
    const relation = /^non[- ]?negative$/i.test(word)
      ? ">="
      : /^non[- ]?positive$/i.test(word)
        ? "<="
        : /^positive$/i.test(word)
          ? ">"
          : "<";
    const selected =
      variables
        .match(/[A-Za-z][A-Za-z0-9_]*/g)
        ?.filter((variable) => variable.toLowerCase() !== "and") ?? [];
    if (
      !selected.length ||
      selected.some((variable) => !names.includes(variable))
    )
      throw new Error(
        "Source domains must use the exact declared variable names",
      );
    return selected.map((variable) => `${variable}${relation}0`).join(" and ");
  };
  let result = text.replace(
    new RegExp(
      `\\b(?:real\\s+)?(${domain})\\s+(?:real\\s+)?(?:(?:[A-Za-z]{2,}\\s+){0,2}?(?:variables?|amounts?|quantities|values)\\s+)?(${list})\\b(?!\\s+(?:intercepts?|coefficients?|axes?|directions?))`,
      "gi",
    ),
    (_, word: string, variables: string) => expand(variables, word),
  );
  result = result.replace(
    new RegExp(
      `\\b(${list})\\s+(?:are\\s+|is\\s+|both\\s+)?(${domain})\\b`,
      "gi",
    ),
    (_, variables: string, word: string) => expand(variables, word),
  );
  const realDomain = (variables: string): string => {
    const selected =
      variables
        .match(/[A-Za-z][A-Za-z0-9_]*/g)
        ?.filter((variable) => variable.toLowerCase() !== "and") ?? [];
    if (
      !selected.length ||
      selected.some((variable) => !names.includes(variable))
    )
      throw new Error(
        "Real domains must use the exact declared variable names",
      );
    return " ";
  };
  result = result.replace(
    new RegExp(`\\breal\\s+(?:variables?\\s+)?(${list})\\b(?!\\s*(?:<=|>=|[<>=]))`, "gi"),
    (_, variables: string) => realDomain(variables),
  );
  result = result.replace(
    new RegExp(`\\b(${list})\\s+(?:are|is)\\s+real\\b`, "gi"),
    (_, variables: string) => realDomain(variables),
  );
  // A tuple comparison such as x,y>=0 distributes the scalar relation to both
  // declared variables, retaining every domain constraint in the source.
  result = result.replace(
    new RegExp(
      `\\b(${name}(?:\\s*,\\s*${name})+)\\s*(<=|>=|<|>|=)\\s*([^,;?\\n]*)`,
      "g",
    ),
    (match: string, variables: string, relation: string, tail: string) => {
      const tokens = [
        ...tail.matchAll(
          /(?:\d+(?:\.\d+|\.(?=[eE][+-]?\d))?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|[^\s]/g,
        ),
      ];
      let end = 0;
      for (const token of tokens) {
        const value = token[0];
        if (
          names.includes(value) ||
          /^(?:\d|\.\d)/.test(value) ||
          /^[()+*/-]$/.test(value)
        ) {
          end = token.index! + value.length;
          continue;
        }
        const prior = tail.slice(0, end).trim().at(-1);
        if (
          token.index === end ||
          /[+*/-]/.test(prior ?? "") ||
          /^[\^%!|[\]{}]$/.test(value)
        )
          throw new Error("Unsupported complete tuple-domain expression");
        break;
      }
      const affine = parseLinearAffine(tail.slice(0, end), names);
      if (affine.a.numerator !== "0" || affine.b.numerator !== "0")
        throw new Error("Tuple domains require a scalar expression");
      const value = `(${affine.constant.numerator}/${affine.constant.denominator})`;
      return (
        (variables.match(new RegExp(`\\b${name}\\b`, "g")) ?? [])
          .map((variable) => `${variable}${relation}${value}`)
          .join(" and ") + ` ${tail.slice(end)}`
      );
    },
  );
  return result;
}
/** A lexical math-span reader, independent of chapters, cue words and planner claims. */
function clauses(text: string, variables: readonly string[]): SourceClause[] {
  const tokens = [
    ...text.matchAll(
      /(?:\d+(?:\.\d+|\.(?=[eE][+-]?\d))?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|<=|>=|[<>=()+*/-]|[^\s]/g,
    ),
  ];
  const output: SourceClause[] = [];
  let chunk: RegExpMatchArray[] = [];
  const flush = (): void => {
    if (!chunk.length) return;
    const relations = chunk.flatMap((token, i) =>
      /^(?:<=|>=|<|>|=)$/.test(token[0]) ? [i] : [],
    );
    if (relations.length) {
      const pieces: Array<{ start: number; end: number; text: string }> = [];
      let first = 0;
      for (const end of [...relations, chunk.length]) {
        let part = chunk.slice(first, end);
        first = end + 1;
        // Boolean grouping parentheses remain outside an affine clause. Balanced
        // arithmetic parentheses remain inside it and are parsed by the solver.
        let balance = part.reduce(
          (sum, token) =>
            sum + (token[0] === "(" ? 1 : token[0] === ")" ? -1 : 0),
          0,
        );
        while (balance > 0 && part[0]?.[0] === "(") {
          part = part.slice(1);
          balance--;
        }
        while (balance < 0 && part.at(-1)?.[0] === ")") {
          part = part.slice(0, -1);
          balance++;
        }
        const start = part[0]?.index ?? 0,
          finish =
            (part.at(-1)?.index ?? start) + (part.at(-1)?.[0].length ?? 0);
        pieces.push({ start, end: finish, text: text.slice(start, finish) });
      }
      relations.forEach((index, i) => {
        const left = pieces[i]!,
          right = pieces[i + 1]!,
          relation = chunk[index]![0];
        if (!left.text || !right.text)
          throw new Error(`Incomplete source comparison: '${left.text}${relation}${right.text}' at character ${chunk[index]!.index}`);
        output.push({
          text: `${left.text}${relation}${right.text}`,
          start: left.start,
          end: right.end,
          equality: relation === "=",
        });
      });
    }
    chunk = [];
  };
  const prose = new Set(
    "graph graphically solve shade show plot represent draw illustrate choose chooses choosing consider considering of for where when satisfy satisfies satisfying and or not with to solution set points in on at as subject such under given over using by then find determine state give report real if possible the a an all values xaxis yaxis coordinate plane line lines region common simultaneously respectively including whether has is are belongs".split(
      " ",
    ),
  );
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const value = token[0];
    // A hyphen inside a prose compound is a word separator, not a new unary
    // affine term. Require an empty math chunk, adjacent multi-letter unknown
    // words and no math continuation; x-y, x<=foo-bar and foo-bar+x still fail.
    const previous = tokens[i - 1], next = tokens[i + 1];
    if (value === "-" && chunk.length === 0 && previous && next
      && /^[A-Za-z]{2,}$/.test(previous[0]) && /^[A-Za-z]{2,}$/.test(next[0])
      && !variables.includes(previous[0]) && !variables.includes(next[0])
      && previous.index! + previous[0].length === token.index
      && token.index! + 1 === next.index
      && !/^(?:<=|>=|[<>=()+*/-])$/.test(tokens[i + 2]?.[0] ?? "")) continue;
    if (
      variables.includes(value) ||
      /^(?:\d|\.\d)/.test(value) ||
      /^(?:<=|>=|[<>=()+*/-])$/.test(value)
    )
      chunk.push(token);
    else {
      const last = chunk.at(-1);
      const prosePunctuation = /^[,;:.?!'"`“”‘’]$/.test(value);
      const nextValue = tokens[i + 1]?.[0] ?? "";
      if (value === "." && last && /^(?:\d|\.\d)/.test(last[0]) && /^e$/i.test(nextValue)
        && token.index! + 1 === tokens[i + 1]!.index)
        throw new Error("Incomplete scientific exponent in original source comparison");
      if (/^[,:?]$/.test(value) && last && /^(?:\d|\.\d)/.test(last[0])
        && /^(?:\d|\.\d)/.test(nextValue)
        && chunk.some((part) => /^(?:<=|>=|[<>=])$/.test(part[0]))) {
        // A comma can separate complete affine comparisons; it cannot silently
        // turn an unsupported decimal comma or scalar ratio into a shorter RHS.
        let completeNextComparison = false;
        if (value === ",") for (const following of tokens.slice(i + 1)) {
          if (/^(?:<=|>=|[<>=])$/.test(following[0])) { completeNextComparison = true; break; }
          if (!variables.includes(following[0]) && !/^(?:\d|\.\d)/.test(following[0]) && !/^[()+*/-]$/.test(following[0])) break;
        }
        if (!completeNextComparison)
          throw new Error(`Ambiguous scalar punctuation in complete source comparison: '${last[0]}${value}${nextValue}' at character ${token.index}`);
      }
      if (/[\p{Sm}\p{No}\p{Lm}]/u.test(value)
        || (!/^[\p{L}_]/u.test(value) && !prosePunctuation
          && (chunk.length > 0 || variables.includes(nextValue) || /^(?:\d|\.\d)/.test(nextValue))))
        throw new Error(`Unsupported mathematical source symbol: '${value}' at character ${token.index}`);
      const mathematicalJoin =
        last &&
        (/^[+*/-]$/.test(last[0]) ||
          last.index! + last[0].length === token.index ||
          (/^[+*/]$/.test(tokens[i + 1]?.[0] ?? "") &&
            !["and", "or", "not"].includes(value.toLowerCase())));
      if (
        /^[\p{L}_]/u.test(value) &&
        (mathematicalJoin ||
          (!prose.has(value.toLowerCase()) &&
            ((last && (/^(?:\d|\.\d)/.test(last[0]) || value.length === 1)) ||
              /^[+*/(]$/.test(tokens[i + 1]?.[0] ?? "") ||
              variables.includes(tokens[i + 1]?.[0] ?? ""))))
      )
        throw new Error(
          `Unknown variable or function in original source expression: '${value}' at character ${token.index}`,
        );
      if (/^[\^%!|[\]{}]$/.test(value) && chunk.length)
        throw new Error("Unsupported mathematical source operator");
      flush();
    }
  }
  flush();
  // Every comparison must be consumed; an unknown variable or nonlinear source
  // clause cannot disappear behind a valid smaller substring.
  for (const match of text.matchAll(/<=|>=|<|>|=/g))
    if (
      !output.some(
        (clause) => match.index! >= clause.start && match.index! < clause.end,
      )
    )
      throw new Error("Unresolved mathematical source comparison");
  return output;
}
function booleanProgram(
  text: string,
  source: SourceClause[],
  sourcePointLabels: readonly string[] = [],
): IntervalExpression {
  if (!source.length)
    throw new Error("No explicit inequality program in source");
  // Chained comparisons share their middle affine term and mean intersection.
  const groups: SourceClause[][] = [];
  for (const clause of source) {
    const previous = groups.at(-1);
    if (previous && clause.start < previous.at(-1)!.end) previous.push(clause);
    else groups.push([clause]);
  }
  const atoms = groups.map((group) =>
    group.length === 1
      ? { inequality: group[0]!.text }
      : { intersection: group.map((clause) => ({ inequality: clause.text })) },
  ) as IntervalExpression[];
  // No Boolean operand may disappear merely because it lacks a comparison.
  // Ordinary instructions such as "and label the axes" remain outside the
  // mathematical program, while "or x" and "or (x+y)" are incomplete math.
  const gaps = [text.slice(0, groups[0]![0]!.start), ...groups.map((group, index) => text.slice(group.at(-1)!.end, groups[index + 1]?.[0].start ?? text.length))];
  for (let gap of gaps) {
    if (sourcePointLabels.length) {
      const labels = `(?:${sourcePointLabels.join("|")})`;
      // Proven original point labels in a membership question are references,
      // not Boolean operands. Bare "or P" remains an incomplete math operand.
      const membership = new RegExp(`\\b(?:[Ww]hich(?:\\s+of)?|[Ww]hether|[Dd]oes|[Dd]o)\\s+(?:points?\\s+)?${labels}(?:\\s*(?:,|and|or)\\s*${labels})*\\s+(?:belongs?|lies?|satisf(?:y|ies)|is|are)\\b`, "g");
      gap = gap.replace(membership, " ");
    }
    if (/\b(?:and|or|not)\b\s*\(*\s*(?:[+-]?\d|[A-Za-z](?:\b|\s*[+*/-]))/i.test(gap)
      || /(?:\b[A-Za-z]|\d|\))\s*\)*\s+\b(?:and|or)\b\s*$/i.test(gap))
      throw new Error(`Incomplete Boolean mathematical operand in source gap: ${JSON.stringify(gap)}`);
  }
  const lexemes: string[] = [];
  const context = text.slice(0, groups[0]![0]!.start);
  const complementWhole =
    /\bcomplement\s+of\b|\b(?:do|does)\s+not\s+satisfy\b/i.test(context);
  const complementAt = context.search(
    /\bcomplement\s+of\b|\b(?:do|does)\s+not\s+satisfy\b/i,
  );
  if (
    complementWhole &&
    (context.slice(0, complementAt).match(/\(/g) ?? []).length >
      (context.slice(0, complementAt).match(/\)/g) ?? []).length
  )
    throw new Error("Unsupported local complement scope in prose source");
  const unionWhole = /\bunion\s+of\b/i.test(context);
  if (/\bcomplement\b|\bnot\b/i.test(text.slice(source.at(-1)!.end)))
    throw new Error("Unsupported postfix complement source program");
  if (/\bnot\s*\(*\s*$/i.test(context)) lexemes.push("not");
  // Unbalanced outer Boolean parentheses are counted, not arithmetic ones.
  const opens =
    (context.match(/\(/g) ?? []).length - (context.match(/\)/g) ?? []).length;
  let level = Math.max(0, opens);
  for (let i = 0; i < Math.max(0, opens); i++) lexemes.push("(");
  groups.forEach((group, i) => {
    lexemes.push(String(i));
    const end = group.at(-1)!.end,
      next = groups[i + 1]?.[0].start;
    const gap = text.slice(end, next ?? text.length);
    if (next === undefined) {
      for (const ch of gap.match(/^\s*\)+/)?.[0] ?? "")
        if (ch === ")") lexemes.push(")");
      return;
    }
    const words = gap.toLowerCase();
    if (/\b(?:unless|except|xor|neither|nor)\b|!=|≠/.test(words))
      throw new Error("Unsupported source Boolean connective");
    for (const ch of gap.match(/^\s*\)+/)?.[0] ?? "")
      if (ch === ")") {
        lexemes.push(")");
        level--;
      }
    lexemes.push(
      (unionWhole && level === 0) || /\bor\b|\bunion\b|∪/.test(words)
        ? "or"
        : "and",
    );
    if (/\bnot\b|\bcomplement\s+of\b/.test(words)) lexemes.push("not");
    for (const ch of gap.match(/\(+\s*$/)?.[0] ?? "")
      if (ch === "(") {
        lexemes.push("(");
        level++;
      }
  });
  let cursor = 0;
  const atom = (): IntervalExpression => {
    const token = lexemes[cursor++];
    if (token === "not") return { complement: atom() };
    if (token === "(") {
      const result = union();
      if (lexemes[cursor++] !== ")")
        throw new Error("Unbalanced source Boolean parentheses");
      return result;
    }
    if (token === undefined || !/^\d+$/.test(token))
      throw new Error("Incomplete source Boolean expression");
    return atoms[Number(token)]!;
  };
  const intersection = (): IntervalExpression => {
    const values = [atom()];
    while (lexemes[cursor] === "and") {
      cursor++;
      values.push(atom());
    }
    return values.length === 1 ? values[0]! : { intersection: values };
  };
  const union = (): IntervalExpression => {
    const values = [intersection()];
    while (lexemes[cursor] === "or") {
      cursor++;
      values.push(intersection());
    }
    return values.length === 1 ? values[0]! : { union: values };
  };
  const result = union();
  if (cursor !== lexemes.length)
    throw new Error("Unresolved source Boolean suffix");
  return complementWhole ? { complement: result } : result;
}
function signatures(
  expressions: readonly string[],
  names: readonly string[],
  equalityOnly = false,
): string[] {
  return expressions
    .flatMap((expression) =>
      parseLinearConstraint(expression, names, equalityOnly).map(
        linearConstraintSignature,
      ),
    )
    .sort();
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function isIntersectionProgram(program: IntervalExpression): boolean {
  return (
    "inequality" in program ||
    ("intersection" in program &&
      program.intersection.every(isIntersectionProgram))
  );
}
function inequalityLeaves(program: IntervalExpression): string[] {
  if ("inequality" in program) return [program.inequality];
  if ("complement" in program) return inequalityLeaves(program.complement);
  return ("union" in program ? program.union : program.intersection).flatMap(inequalityLeaves);
}
/** Bounded named interval literals are another spelling of the same real sets. */
function intervalSourceProgram(body: string, variable: string): IntervalExpression | null {
  const bindings = new Map<string, IntervalExpression>();
  const spans: Array<{ start: number; end: number }> = [];
  for (const definition of body.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*([[(])/g)) {
    const label = definition[1]!;
    if (label === variable || label.length > 32) throw new Error("Invalid named interval source identifier");
    const opening = definition[2]!, start = definition.index! + definition[0].length;
    let depth = 0, end = start, comma = -1;
    for (; end < body.length; end++) {
      const ch = body[end]!;
      if (ch === "(" ) depth++;
      else if (ch === ")" && depth > 0) depth--;
      else if ((ch === ")" || ch === "]") && depth === 0) break;
      else if (ch === "," && depth === 0) {
        if (comma !== -1) throw new Error(`Interval ${label} requires exactly two endpoints`);
        comma = end;
      }
      if (depth > 24) throw new Error("Source interval endpoint nesting exceeds 24");
    }
    if (end >= body.length || comma === -1 || depth !== 0)
      throw new Error(`Interval ${label} requires a complete two-endpoint literal`);
    const endpoint = (text: string): string | "-infinity" | "infinity" => {
      const raw = text.trim();
      if (/^-\s*(?:infinity|infty|∞)$/i.test(raw)) return "-infinity";
      if (/^\+?\s*(?:infinity|infty|∞)$/i.test(raw)) return "infinity";
      const affine = parseLinearAffine(raw, [variable]);
      if (affine.a.numerator !== "0" || affine.b.numerator !== "0")
        throw new Error(`Interval ${label} endpoints must be exact scalar givens`);
      return `(${affine.constant.numerator}/${affine.constant.denominator})`;
    };
    const lower = endpoint(body.slice(start, comma)), upper = endpoint(body.slice(comma + 1, end));
    const closing = body[end]!;
    if (lower === "infinity" || upper === "-infinity" || (lower === "-infinity" && opening !== "(") || (upper === "infinity" && closing !== ")"))
      throw new Error(`Interval ${label} has invalid infinity orientation or inclusion`);
    const leaves: IntervalExpression[] = [];
    if (lower !== "-infinity") leaves.push({ inequality: `${variable}${opening === "[" ? ">=" : ">"}${lower}` });
    if (upper !== "infinity") leaves.push({ inequality: `${variable}${closing === "]" ? "<=" : "<"}${upper}` });
    const program: IntervalExpression = leaves.length === 0 ? { inequality: "0<=1" } : leaves.length === 1 ? leaves[0]! : { intersection: leaves };
    if (bindings.has(label)) throw new Error(`Interval ${label} has repeated source definitions`);
    bindings.set(label, program);
    if (bindings.size > 16) throw new Error("Source named intervals exceed 16 definitions");
    if (/^(?:<=|>=|[<>=+*/^%!|[\]{}-])/.test(body.slice(end + 1).trimStart()))
      throw new Error(`Interval ${label} has an unsupported literal operation`);
    spans.push({ start: definition.index!, end: end + 1 });
  }
  if (bindings.size === 0) return null;
  let residual = body;
  for (const span of spans.reverse()) residual = residual.slice(0, span.start) + " ".repeat(span.end - span.start) + residual.slice(span.end);
  if (["[", "]", "{", "}"].some((character) => residual.includes(character)))
    throw new Error("Unconsumed interval or unsupported source set literal");
  const namedOperands = [
    ...residual.matchAll(/\b(?:union|intersection|complement\s+of)\s+(?!of\b)([A-Za-z][A-Za-z0-9_]*)/gi),
    ...residual.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s+(?:union|intersection)\b/gi),
    ...residual.matchAll(/[∪∩]\s*([A-Za-z][A-Za-z0-9_]*)/g),
    ...residual.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*[∪∩]/g),
  ];
  for (const named of namedOperands) {
    const label = named[1]!;
    if (!bindings.has(label)) throw new Error(`Unknown named set in source program: ${label}`);
  }
  const boundNames = [...bindings.keys()].join("|");
  const connectiveNeighbors = [
    ...residual.matchAll(new RegExp(`\\b(?:${boundNames})\\b\\s*\\)*\\s+(?:and|or)\\s*\\(*\\s*([A-Za-z][A-Za-z0-9_]*)`, "gi")),
    ...residual.matchAll(new RegExp(`\\b([A-Za-z][A-Za-z0-9_]*)\\s*\\)*\\s+(?:and|or)\\s*\\(*\\s*(?:${boundNames})\\b`, "gi")),
  ];
  const proseActions = new Set("show state represent graph plot draw find give explain report determine".split(" "));
  for (const operand of connectiveNeighbors)
    if (!bindings.has(operand[1]!) && !proseActions.has(operand[1]!.toLowerCase()))
      throw new Error(`Unknown named set in source program: ${operand[1]}`);
  if (/\b(?:unless|except|xor|neither|nor|setminus)\b|[∖\\]/i.test(residual))
    throw new Error("Unsupported named-interval source connective");
  const references: SourceClause[] = [...residual.matchAll(/\b[A-Za-z][A-Za-z0-9_]*\b/g)]
    .filter((match) => bindings.has(match[0]))
    .map((match) => ({ text: match[0], start: match.index!, end: match.index! + match[0].length, equality: false }));
  if (!references.length) throw new Error("Source must request a complete named-interval program");
  const replace = (program: IntervalExpression): IntervalExpression => {
    if ("inequality" in program) return bindings.get(program.inequality)!;
    if ("complement" in program) return { complement: replace(program.complement) };
    return "union" in program ? { union: program.union.map(replace) } : { intersection: program.intersection.map(replace) };
  };
  const selected = replace(booleanProgram(residual, references));
  for (const reference of references.slice().reverse())
    residual = residual.slice(0, reference.start) + " ".repeat(reference.end - reference.start) + residual.slice(reference.end);
  const domains = clauses(residual, [variable]);
  if (domains.length) throw new Error("Mixed named-interval and explicit inequality source programs require an explicit shared Boolean grammar");
  return selected;
}
interface SourceObjective {
  expression: string;
  sense: "max" | "min";
  start: number;
  end: number;
}
/** Read an affine objective completely, separately from its prose direction. */
function sourceObjective(body: string, names: readonly string[]): SourceObjective {
  const directionPattern = /\b(?:maximi[sz](?:e[ds]?|ing|ation)|minimi[sz](?:e[ds]?|ing|ation)|maximum|minimum|max|min)\b/gi;
  const directions = [...body.matchAll(directionPattern)];
  if (!directions.length) throw new Error("Objective direction is not explicit in source");
  const sense = (word: string): "max" | "min" => /^max/i.test(word) ? "max" : "min";
  const targetOf = (direction: RegExpMatchArray): string | undefined => /^\s*(?:(?:the|objective|function|constant|value|of)\s+)*([A-Za-z][A-Za-z0-9_]*)\b/i.exec(body.slice(direction.index! + direction[0].length))?.[1];
  const aliasesFor = (label: string | undefined): string[] => label ? [...body.matchAll(new RegExp(`\\b([A-Za-z][A-Za-z0-9_]*)\\s+(?:is|=)\\s+${label}\\s*=`, "g"))].map((alias) => alias[1]!.toLowerCase()) : [];
  const postfixDirection = (direction: RegExpMatchArray, expressionEnd: number): boolean => direction.index! >= expressionEnd && /^\s*(?:is|are)?\s*$/i.test(body.slice(expressionEnd, direction.index!));
  const readExpression = (start: number): { expression: string; end: number } | null => {
    const tail = body.slice(start);
    const tokens = [...tail.matchAll(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|[^\s]/g)];
    const delimiters = new Set("subject such under where given over with for and constraints using by on then find show determine state give report if is are has maximum minimum maximized minimised minimized maximised".split(" "));
    let end = 0;
    for (const token of tokens) {
      const value = token[0];
      if (delimiters.has(value.toLowerCase()) || /^[,;:.?]$/.test(value)) break;
      if (!names.includes(value) && !/^(?:\d|\.\d)/.test(value) && !/^[()+*/-]$/.test(value)) {
        if (end === 0) return null; // an unrelated prose mention, e.g. finite maximum
        throw new Error(`Unsupported variable or operator in complete source objective: '${value}' at character ${start + token.index!}`);
      }
      end = token.index! + value.length;
    }
    if (end === 0) return null;
    const expression = tail.slice(0, end).trim();
    parseLinearAffine(expression, names);
    const continuation = /^\s+and\s+([^,;?.]*)/i.exec(body.slice(start + end))?.[1];
    if (continuation && /^(?:[+-]?\d|\(|[A-Za-z]\b)/.test(continuation.trim()) && !/[<>=]/.test(continuation))
      throw new Error("Source objective has an unsupported additional affine operand");
    return { expression, end: start + end };
  };
  const candidates: SourceObjective[] = [];
  for (const direction of directions) {
    const after = direction.index! + direction[0].length;
    const descriptor = /^\s*(?:(?:the|objective|function|constant|value|of)\s+)*(?:[A-Za-z][A-Za-z0-9_]*\s*=\s*)?/i.exec(body.slice(after))!;
    const expression = readExpression(after + descriptor[0].length);
    if (expression) candidates.push({ ...expression, sense: sense(direction[0]), start: direction.index! });
  }
  if (candidates.length === 0) {
    // A source may define Z first and request its maximum afterwards. A unique
    // non-axis scalar definition and an unambiguous direction are required;
    // unrelated assignments and contradictory directions cannot be discarded.
    for (const definition of body.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*/g)) {
      if (names.includes(definition[1]!)) continue;
      const expression = readExpression(definition.index! + definition[0].length);
      if (!expression) throw new Error("Unresolved source objective definition");
      const label = definition[1]!, aliases = aliasesFor(label);
      const boundDirections = directions.filter((direction) => {
        const target = targetOf(direction);
        return target === label || (target && aliases.includes(target.toLowerCase())) || postfixDirection(direction, expression.end);
      });
      if (!boundDirections.length) throw new Error(`Objective direction is not bound to source definition ${label}`);
      const senses = new Set(boundDirections.map((direction) => sense(direction[0])));
      if (senses.size !== 1) throw new Error("Source objective direction is ambiguous");
      candidates.push({ ...expression, sense: [...senses][0]!, start: definition.index! });
    }
  }
  if (candidates.length !== 1) throw new Error("Source requires one complete unambiguous objective definition");
  const selected = candidates[0]!;
  const objectiveLabel = /\b([A-Za-z][A-Za-z0-9_]*)\s*=/.exec(body.slice(selected.start, selected.end))?.[1];
  const aliases = aliasesFor(objectiveLabel);
  for (const direction of directions) {
    const target = targetOf(direction);
    const boundReference = target === objectiveLabel || (target && aliases.includes(target.toLowerCase()));
    const postfix = postfixDirection(direction, selected.end);
    const derivedResult = direction.index! >= selected.end
      && /^\s+(?:(?:points?|solutions?)(?:\s+graphically)?|exists?|is\s+(?:finite|unbounded|bounded|attained))\s*(?:[.;?!]|$)/i.test(body.slice(direction.index! + direction[0].length));
    const explicitAction = /^(?:maximi[sz]|minimi[sz])|^(?:max|min)$/i.test(direction[0]);
    const requestContext = body.slice(0, direction.index!).split(/[.;?!:]/).at(-1) ?? "";
    const requested = /\b(?:find|determine|give|report|state|calculate|compute)\b/i.test(requestContext);
    if (sense(direction[0]) !== selected.sense && (explicitAction || boundReference || postfix || derivedResult))
      throw new Error(`Source requests contradictory objective directions: ${selected.sense} and ${sense(direction[0])}`);
    if ((explicitAction || requested) && direction.index! !== selected.start && target && !names.includes(target) && !boundReference && !postfix && !derivedResult)
      throw new Error(`Additional source objective request is unresolved: ${direction[0]} ${target}`);
  }
  return selected;
}
export function validateLinearSourceBinding(
  document: SceneDocument,
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const [constructionIndex, construction] of document.constructions.entries()) {
    if (
      !(LINEAR_REGION_OPERATORS as readonly string[]).includes(
        construction.operator,
      )
    )
      continue;
    try {
      if (
        typeof document.source.question !== "string" ||
        document.source.question.length > 8192
      )
        throw new Error(
          "Linear figures require bounded original question text",
        );
      const geometry = evaluateLinearRegionConstruction(
        construction.operator,
        construction.inputs,
      )[0]!;
      const input = geometry.input;
      const names =
        input.kind === "number_line_set"
          ? [input.variable ?? "x"]
          : (input.variables ?? ["x", "y"]);
      if (input.kind !== "number_line_set" && names.includes("x") && names.includes("y")
        && (names[0] !== "x" || names[1] !== "y"))
        throw new Error("Source x/y coordinates require canonical axis order ['x','y'] for boundary, corner and solution tuples");
      let question = explicitDomains(
        normalize(document.source.question),
        names,
      );
      const sourcePoints = input.kind !== "number_line_set" ? readLinearSourceReferencePoints(question, names) : null;
      if (sourcePoints) question = sourcePoints.maskedQuestion;
      if (
        /[∖⇒⇐⇔→↔⊕ℤℕ]|\\(?:setminus|implies|iff|mathbb\s*\{?[ZN])\b/.test(
          question,
        )
      )
        throw new Error("Unsupported mathematical source domain or connective");
      question = question.replace(
        /\b([A-Za-z][A-Za-z0-9_]*)\s*∈\s*ℝ/g,
        (_, variable: string) => {
          if (!names.includes(variable))
            throw new Error("Real domain must use a declared variable");
          return " ";
        },
      );
      if (/[∈∉]/.test(question))
        throw new Error("Unsupported mathematical source domain");
      if (
        /\b(?:integers?|natural\s+numbers?|whole\s+numbers?)\b/i.test(question)
      )
        throw new Error(
          "Continuous linear figures require a real-valued source domain",
        );
      if (
        input.kind !== "number_line_set" &&
        /\b(?:not|complement|unless|except|xor|neither|nor)\b/i.test(question)
      )
        throw new Error(
          "Unsupported negated or conditional planar source program",
        );
      if (
        /\bif\b(?!\s+possible\b)|\b(?:implies|otherwise|iff)\b/i.test(question)
      )
        throw new Error("Unsupported conditional source program");
      if (
        /\b(?:non[- ]?negative|non[- ]?positive|positive|negative)\s+(?:real\s+)?(?:variables?\b|[A-Za-z]\b)|\b[A-Za-z]\s+(?:and\s+[A-Za-z]\s+)?(?:are\s+|is\s+|both\s+)?(?:non[- ]?negative|non[- ]?positive|positive|negative)\b/i.test(
          question,
        )
      )
        throw new Error(
          "Source variable domains require explicit inequality clauses",
        );
      const ownedOutputs = new Set(
        document.constructions
          .filter((item) =>
            (LINEAR_REGION_OPERATORS as readonly string[]).includes(
              item.operator,
            ),
          )
          .flatMap((item) => item.outputs),
      );
      if (
        document.requiredEntityIds.some(
          (id) =>
            !ownedOutputs.has(id) &&
            document.entities.find((entity) => entity.id === id)?.kind !==
              "group",
        )
      )
        throw new Error(
          "Linear figure marks must all be emitted by verified linear operators",
        );
      let body = question;
      if (input.kind === "linear_feasible_region" && input.objective) {
        const objective = sourceObjective(body, names);
        if (
          objective.sense !== input.objective.sense ||
          !same(
            parseLinearAffine(objective.expression, names),
            parseLinearAffine(input.objective.expression, names),
          )
        )
          throw new Error(`Objective differs from original source: source ${objective.sense} '${objective.expression}', proposed ${input.objective.sense} '${input.objective.expression}'`);
        body =
          body.slice(0, objective.start) +
          " ".repeat(objective.end - objective.start) +
          body.slice(objective.end);
      } else if (
        input.kind === "linear_feasible_region" &&
        /\b(?:maximi[sz](?:e[ds]?|ing|ation)|minimi[sz](?:e[ds]?|ing|ation)|maximum|minimum|max|min)\b/i.test(body)
      )
        throw new Error("Source objective cannot be omitted");
      if (input.kind === "number_line_set") {
        const program = intervalSourceProgram(body, names[0]!) ?? booleanProgram(body, clauses(body, names));
        if (!same(signatures(inequalityLeaves(program), names), signatures(inequalityLeaves(input.expression), names)))
          throw new Error(`Number-line constraints differ from original source: source ${JSON.stringify(inequalityLeaves(program))}, proposed ${JSON.stringify(inequalityLeaves(input.expression))}`);
        const result = solveLinearFigure({
          kind: "number_line_set",
          variable: names[0],
          expression: program,
        });
        if (
          result.kind !== "number_line_set" ||
          geometry.solution.kind !== "number_line_set" ||
          !same(result.intervals, geometry.solution.intervals)
        )
          throw new Error(
            "Number-line Boolean solution differs from original source",
          );
      } else {
        const source = clauses(body, names);
        if (
          input.kind === "linear_half_plane" &&
          (source.length !== 1 || source[0]!.equality)
        )
          throw new Error(
            "Half-plane must represent the complete single source inequality",
          );
        if (
          input.kind === "linear_system" &&
          (source.length !== 2 || source.some((clause) => !clause.equality))
        )
          throw new Error(
            "System must represent the complete two source equations",
          );
        if (!isIntersectionProgram(booleanProgram(body, source, sourcePoints?.points.map((point) => point.label))))
          throw new Error(
            "A planar intersection or system cannot replace a source union or complement",
          );
        const proposed =
          input.kind === "linear_half_plane"
            ? [input.inequality]
            : input.kind === "linear_system"
              ? input.equations
              : input.constraints;
        if (
          !same(
            signatures(
              source.map((clause) => clause.text),
              names,
              input.kind === "linear_system",
            ),
            signatures(proposed, names, input.kind === "linear_system"),
          )
        )
          throw new Error(`Linear constraints differ from the complete original source program: source ${JSON.stringify(source.map((clause) => clause.text))}, proposed ${JSON.stringify(proposed)}`);
      }
    } catch (error) {
      issues.push({
        code: "linear_source_mismatch",
        message:
          error instanceof Error ? error.message : "Unresolved linear source",
        severity: "fatal",
        path: `constructions[${constructionIndex}]`,
        entityIds: construction.outputs,
      });
    }
  }
  return issues;
}
/** Authored semantic/derived labels cannot override the engine-owned solution. */
export function validateLinearClaims(
  document: SceneDocument,
  constructionIndex: number,
  geometry: LinearRegionGeometry,
  issues: SceneIssue[],
): void {
  const construction = document.constructions[constructionIndex]!;
  const protectedIds = new Set(construction.outputs);
  for (const entity of document.entities)
    if (entity.kind === "group") protectedIds.add(entity.id);
  for (const group of document.revealGroups)
    if (group.entityIds.some((id) => protectedIds.has(id)))
      protectedIds.add(group.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of document.constructions)
      if (
        item.outputs.some((id) => protectedIds.has(id)) ||
        Object.values(item.inputs).some(
          (value) => typeof value === "string" && protectedIds.has(value),
        )
      )
        for (const id of item.outputs)
          if (!protectedIds.has(id)) {
            protectedIds.add(id);
            changed = true;
          }
  }
  const claims = [
    ...document.entities
      .filter((entity) => protectedIds.has(entity.id))
      .flatMap((entity) => [
        entity.label,
        entity.semantic
          ? JSON.stringify(snapshotMathSourceData(entity.semantic))
          : undefined,
      ]),
    ...document.annotations
      .filter((annotation) =>
        annotation.targetIds.some((id) => protectedIds.has(id)),
      )
      .map((annotation) => annotation.text),
    ...document.constructions
      .filter(
        (item) =>
          item.outputs.some((id) => protectedIds.has(id)) &&
          item.operator === "label",
      )
      .flatMap((item) => [item.inputs.text, item.inputs.label])
      .filter((value): value is string => typeof value === "string"),
  ];
  if (
    document.annotations.some((annotation) => annotation.kind !== "narration")
  )
    issues.push({
      code: "untrusted_linear_annotation",
      message: "Linear shading, labels and endpoint marks are operator-owned",
      severity: "fatal",
      entityIds: construction.outputs,
    });
  for (const claim of claims) {
    if (!claim) continue;
    if (
      /^(?:solution|feasible region|number line|half[ -]plane|linear system|graph|region|system|inequality|inequalities)$/i.test(
        claim.trim(),
      )
    )
      continue;
    // Identity-only labels are permitted. All calculated values and solution
    // semantics are emitted by this operator, never silently overwritten.
    if (
      /[\d<>=≤≥]|\b(?:corner|vertex|vertices|feasible|infeasible|empty|maximum|minimum|optimum|supremum|infimum|unbounded|parallel|coincident|solution|shad(?:e|ed|ing)|solid|dashed|open|closed)\b/i.test(
        claim,
      )
    ) {
      // The original question may be quoted as a title, without a derived claim.
      const sourceExpressions =
        geometry.input.kind === "linear_half_plane"
          ? [geometry.input.inequality]
          : geometry.input.kind === "linear_system"
            ? geometry.input.equations
            : geometry.input.kind === "linear_feasible_region"
              ? geometry.input.constraints
              : [];
      if (
        sourceExpressions.some(
          (expression) =>
            normalize(claim).replace(/\s/g, "") ===
            normalize(expression).replace(/\s/g, ""),
        )
      )
        continue;
      issues.push({
        code: "untrusted_linear_claim",
        message:
          "Linear solution values and boundary semantics must be emitted by the verified operator",
        severity: "fatal",
        path: `constructions[${constructionIndex}]`,
        entityIds: construction.outputs,
      });
    }
  }
}
