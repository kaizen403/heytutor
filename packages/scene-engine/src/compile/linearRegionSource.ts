import type { SceneDocument, SceneIssue } from "../types";
import {
  solveLinearFigure,
  parseLinearConstraint,
  linearConstraintSignature,
  parseLinearAffine,
  type IntervalExpression,
} from "../math/linearRegion";
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
    .replace(/∨|\\(?:lor|vee|cup)\b/g, " or ")
    .replace(/∧|\\(?:land|wedge|cap)\b/g, " and ")
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
      `\\b(${domain})\\s+(?:real\\s+)?(?:variables?\\s+)?(${list})\\b(?!\\s+(?:intercepts?|coefficients?|axes?|directions?))`,
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
    new RegExp(`\\breal\\s+(?:variables?\\s+)?(${list})\\b`, "gi"),
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
          /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|[^\s]/g,
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
      /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|<=|>=|[<>=()+*/-]|[^\s]/g,
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
          throw new Error("Incomplete source comparison");
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
    "graph graphically solve shade show plot represent draw illustrate of for where satisfy satisfies and or not with to solution set points in on at subject such under given over using by then find determine state give report real if possible the a an all values xaxis yaxis coordinate plane line lines region common simultaneously respectively".split(
      " ",
    ),
  );
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const value = token[0];
    if (
      variables.includes(value) ||
      /^(?:\d|\.\d)/.test(value) ||
      /^(?:<=|>=|[<>=()+*/-])$/.test(value)
    )
      chunk.push(token);
    else {
      const last = chunk.at(-1);
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
          "Unknown variable or function in original source expression",
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
export function validateLinearSourceBinding(
  document: SceneDocument,
): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const construction of document.constructions) {
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
      let question = explicitDomains(
        normalize(document.source.question),
        names,
      );
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
      let sourceObjective:
        { expression: string; sense: "max" | "min" } | undefined;
      if (input.kind === "linear_feasible_region" && input.objective) {
        const match =
          /\b(maximi[sz]e|minimi[sz]e|maximum|minimum|max|min)\b\s*(?:(?:the|objective|function|constant|value|of)\s+)*(?:[A-Za-z][A-Za-z0-9_]*\s*=\s*)?/i.exec(
            body,
          );
        if (!match)
          throw new Error("Objective direction is not explicit in source");
        const start = match.index + match[0].length;
        const tail = body.slice(start);
        const tokens = [
          ...tail.matchAll(
            /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|[^\s]/g,
          ),
        ];
        const delimiters = new Set(
          "subject such under where given over with for and constraints using by on then find show determine state give report if".split(
            " ",
          ),
        );
        let end = 0;
        for (const token of tokens) {
          const value = token[0];
          if (delimiters.has(value.toLowerCase()) || /^[,;.?]$/.test(value))
            break;
          if (
            !names.includes(value) &&
            !/^(?:\d|\.\d)/.test(value) &&
            !/^[()+*/-]$/.test(value)
          )
            throw new Error(
              "Unsupported variable or operator in complete source objective",
            );
          end = token.index! + value.length;
        }
        const expression = tail.slice(0, end).trim();
        if (!expression) throw new Error("Unresolved source objective");
        sourceObjective = {
          expression,
          sense: /^(?:max)/i.test(match[1]!) ? "max" : "min",
        };
        if (
          sourceObjective.sense !== input.objective.sense ||
          !same(
            parseLinearAffine(sourceObjective.expression, names),
            parseLinearAffine(input.objective.expression, names),
          )
        )
          throw new Error("Objective differs from original source");
        body =
          body.slice(0, match.index) +
          " ".repeat(start + end - match.index) +
          body.slice(start + end);
      } else if (
        input.kind === "linear_feasible_region" &&
        /\b(?:maximi[sz]e|minimi[sz]e|maximum|minimum|max|min)\b/i.test(body)
      )
        throw new Error("Source objective cannot be omitted");
      const source = clauses(body, names);
      if (input.kind === "number_line_set") {
        const result = solveLinearFigure({
          kind: "number_line_set",
          variable: names[0],
          expression: booleanProgram(body, source),
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
        if (!isIntersectionProgram(booleanProgram(body, source)))
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
          throw new Error(
            "Linear constraints differ from the complete original source program",
          );
      }
    } catch (error) {
      issues.push({
        code: "linear_source_mismatch",
        message:
          error instanceof Error ? error.message : "Unresolved linear source",
        severity: "fatal",
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
