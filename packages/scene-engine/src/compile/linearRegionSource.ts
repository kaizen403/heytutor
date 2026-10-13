import type { SceneDocument, SceneIssue } from "../types";
import {
  solveLinearFigure,
  parseLinearConstraint,
  linearConstraintSignature,
  parseLinearAffine,
  type IntervalExpression,
  type LinearFigureInput,
} from "../math/linearRegion";
import { isLinearSourceIdentifier, readLinearSourceIntersectionNames, readLinearSourceReferencePoints } from "./linearSourcePoints";
export { readLinearSourceReferencePoints } from "./linearSourcePoints";
import {
  evaluateLinearRegionConstruction,
  LINEAR_REGION_OPERATORS,
  type LinearRegionGeometry,
} from "./linearRegionGeometry";
import { snapshotMathSourceData } from "./mathSourceData";
import type { ExactRational } from "../math/exactRational";

export interface LinearSourceIntervalRole {
  definition: string;
  lower?: ExactRational;
  upper?: ExactRational;
  lowerIncluded: boolean;
  upperIncluded: boolean;
}

interface SourceClause {
  text: string;
  start: number;
  end: number;
  equality: boolean;
}
/** A request the reader cannot prove supplies neither a figure nor a veto. */
class UnprovedLinearRequest extends Error {}

/** A leading question ordinal is presentation syntax, not an equation name.
 * Explicit declarations such as "line named Q1" retain their name. */
function withoutQuestionOrdinal(text: string): string {
  return text.replace(/^\s*(?:Q|Question\s+)\d+[a-z]?\s*:\s*/i, "");
}

/** A colon denotes a name only for an identifier or an explicit line declaration. */
export function readLinearSourceLineName(prefix: string): string | undefined {
  const declared = /\bline\s+(?:named|called)\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*$/i.exec(prefix);
  if (declared) return declared[1];
  const short = /\b([A-Za-z][A-Za-z0-9_]*)\s*:\s*$/.exec(withoutQuestionOrdinal(prefix))?.[1];
  return short && isLinearSourceIdentifier(short) ? short : undefined;
}

/**
 * Consume the prose outside already parsed operands. This is a positive,
 * bounded request vocabulary: an unfamiliar modifier or punctuation cannot
 * silently disappear while its neighbouring math becomes source authority.
 * Operand scope is checked separately by the Boolean grammar.
 */
function consumeLinearRequest(prose: string, declaredNames: readonly string[] = []): void {
  const names = new Set(declaredNames);
  const words = new Set((
    "let and or not complement union intersection of for where when satisfy satisfies satisfying subject such under given over with to in on at as by using then " +
    "teach me how help see explain use consider considering graph graphs graphically graphical solve shade shaded shading show showing plot represent draw illustrate indicate choose choosing label mark marking find determine state give report calculate compute " +
    "the a an all both each every real continuous domain number line lines half plane coordinate coordinates xaxis yaxis axis axes xy region common feasible solution solutions set points point pair system simultaneous equations equation " +
    "one two many count unique no none infinitely infinite parallel coincident consistent inconsistent dependent independent empty bounded unbounded full complete exact simplified names intercepts corners corner vertices vertex boundary boundaries solid dashed open closed strict " +
    "whether which that do does has have is are belongs belong lies lie included it its their they them this these those why meet meets cross crossing fractional keep exists finite value values maximizing minimizing maximized minimized maximize minimize maximum minimum max min optimum optimal profit cost revenue " +
    "including whose from figure classify method equivalent unrestricted possible please also named called denoted exist there same especially " +
    "maximise minimise maximised minimised maximising minimising " +
    "x y lpp rational endpoint endpoints ray direction understand works left right interval length vertical horizontal side correct style passes through origin identify identifying membership ordered pairs " +
    "redundant constraint constraints actually limits multiple can workshop chooses production amounts model uses put maximiser maximisers maximizer maximizers minimiser minimisers minimizer minimizers attaining entire feasibility permitted decide unboundedness prevents " +
    "inclusive either inequality inequalities enough defining must hold means positions numbers labelled labeling labelling inclusion status explicitly clearly geometric even share optimisation optimization convention form actual question asks only though stating describe coefficient coefficients simultaneously"
  ).split(" "));
  prose = prose.replace(/\binteger(?:\s+|-)coefficients?\b/gi, "coefficients");
  prose = prose.replace(/\b(?:the\s+)?two\s+different\s+endpoint\s+marks\b/gi, "endpoint marks");
  prose = prose.replace(/\bif\s+possible\b/gi, "possible");
  for (const location of prose.matchAll(/\b(?:on|in)\s+(?:[A-Za-z]+\s+){0,4}(?:number[ -]lines?|graphs?|axes|planes?)\b/gi)) {
    if (!/^(?:on\s+(?:(?:a|the|one)\s+)?(?:same\s+)?(?:number[ -]line|graph)|in\s+(?:(?:a|the|real)\s+)*(?:(?:coordinate|xy)\s+)?plane)$/i.test(location[0]))
      throw new UnprovedLinearRequest("The display location has unproved figure count or shared scope");
  }
  words.add("marks");
  for (const declaration of prose.matchAll(/\bsolution\s+set\s+(?:(?:named|called|denoted\s+by)\s+)?([A-Za-z][A-Za-z0-9_]*)\s*(?=of\b|for\b|on\b|satisfying\b|=|:|[.;?!]|$)/gi)) {
    if (!words.has(declaration[1]!.toLowerCase())) names.add(declaration[1]!);
  }
  // Literal membership queries are not additional set operands. Only this
  // complete scalar noun phrase may consume digits outside a comparison.
  prose = prose.replace(/\b(?:whether|is|does|do)\s+[+-]?(?:\d+(?:\.\d+)?|\.\d+)\s+(?:belongs?|lies?|included|is|in|on)\b/gi, "whether belongs");
  for (const token of prose.matchAll(/[A-Za-z][A-Za-z0-9_]*|[^\s]/g)) {
    if (names.has(token[0]) || words.has(token[0].toLowerCase()) || /^[,;:.?!()"-]$/.test(token[0])) continue;
    throw new UnprovedLinearRequest(`Unconsumed original request token '${token[0]}'`);
  }
}

function normalize(text: string): string {
  if (/\d\s*·\s*\d/.test(text))
    throw new UnprovedLinearRequest("A numeric middle dot has ambiguous decimal or multiplication semantics");
  return withoutQuestionOrdinal(text)
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
/** Refuse source syntax whose scope the bounded reader cannot certify. */
function assertLinearSourceGrammar(text: string): void {
  // Display cardinality belongs to the requested object, independent of a
  // preposition or where the display instruction appears in the request.
  const singular = new Set(["one", "single"]);
  const cardinality = /\b(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|single|both|many|multiple|several|each|every)\s+(?:(?:same|different|separate|distinct|coordinate|xy)\s+)*(?:number[ -]lines?|graphs?|planes?|canvases?)\b/gi;
  for (const display of text.matchAll(cardinality)) {
    const count = display[1]!.toLowerCase();
    const context = text.slice(0, display.index!);
    // "The two graphs ... show a unique solution" describes two plotted
    // functions. Frame cardinality is asserted by a display action or its
    // governing location/manner preposition, not by a descriptive noun alone.
    if (!/number[ -]lines?/i.test(display[0])
      && !/\b(?:on|in|using|with|as|use|graph|draw|plot|represent|show|illustrate)\s+(?:(?:a|an|the|me|same|exact|these|those)\s+)*$/i.test(context)) continue;
    if (!singular.has(count) && !/^0*1$/.test(count))
      throw new UnprovedLinearRequest("The requested display cardinality has no single shared figure scope");
  }
  if (/\bnumber[ -]lines\b|\b(?:each|every)\s+(?:solution\s+sets?|inequalities|intervals?|sets?|graphs?)\b/i.test(text))
    throw new UnprovedLinearRequest("Distributed source objects have no single certified result scope");
  if (/\b(?:complement\s+of|not)\s*(?:\(*\s*(?:the\s+)?)?(?:complement\s+of|not)\b/i.test(text))
    throw new Error("Repeated source complement requires an explicit supported scope");
  if (/\b(?:each\s+(?:of|inequality|interval|set|graph)|separately|separate\s+(?:axes|graphs?|number[ -]lines?))\b/i.test(text))
    throw new Error("Separate source requests cannot be merged into one linear program");
  if (/\bquadrants?\b|\bnon[- ]?negativity\b/i.test(text))
    throw new Error("Implicit planar domains require explicit supported inequality clauses");
  if (/\b(?:in|over)\s+[NZW]\b/i.test(text))
    throw new Error("Discrete source domains cannot be represented by continuous linear figures");
  if (/\d\s+(?:\d+\s*\/\s*\d+|\(\s*\d+\s*\/\s*\d+\s*\))/.test(text))
    throw new Error("Mixed source fractions cannot be read as implicit multiplication");
  if (/\b(?:shad(?:e|ing)|region|strip)\b[^.;?!]*\bbetween\s+(?:the\s+)?(?:two\s+)?lines?\b/i.test(text))
    throw new Error("A region between source lines cannot become a two-equation system");
}
/** Real-domain declarations are syntax, never additional affine operands. */
function sourceNotation(text: string, names: readonly string[]): string {
  let result = text;
  if (names.length === 2 && names[0] === "x" && names[1] === "y") {
    result = result.replace(/\b(?:in|over)\s+(?:R|ℝ)(?:\^2|²)\s*(?=[,;:.]|$)/gi, " ");
    result = result.replace(/\b(?:real\s+)?pairs?\s*\(\s*x\s*,\s*y\s*\)/gi, "real pairs");
    // A Cartesian set builder explicitly declares canonical x/y order. The
    // complete body is retained for the same affine/Boolean clause reader.
    result = result.replace(/(?:\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*)?\{\s*\(\s*x\s*,\s*y\s*\)\s*:\s*([^{}]+)\}/g,
      (_, label: string | undefined, body: string) => label ? ` solution set ${label} of ${body} ` : ` ${body} `);
  }
  const variables = names.join("|");
  result = result.replace(new RegExp(`\\b(?:there\\s+is\\s+)?no\\s+constraint\\s+on\\s+(?:${variables})\\s*(?=[.;?!]|$)`, "gi"), " ");
  // Explicit continuous-domain disclaimers do not apply Boolean complement
  // to the preceding region. Restrict to these complete noun phrases; an
  // actual integer restriction or mathematical NOT remains visible.
  result = result.replace(/\b(?:the\s+)?domain\s+is\s+continuous,\s*not\s+integer-valued\s*(?=[.;?!]|$)/gi, "the domain is continuous ");
  result = result.replace(/\bnot\s+an?\s+integer\s+problem\s*(?=[.;?!]|$)/gi, " ");
  result = result.replace(/\bdo\s+not\s+impose\s+an?\s+integer\s+restriction\s*(?=[.;?!]|$)/gi, " ");
  return result;
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
    new RegExp(`\\breal\\s+(?:(?:variables?|quantities)\\s+)?(${list})\\b(?!\\s*(?:<=|>=|[<>=]|,\\s*${name}\\b|and\\s+${name}\\b))`, "gi"),
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
function clauses(text: string, variables: readonly string[], sourcePointLabels: readonly string[] = []): SourceClause[] {
  const lineNames = [...text.matchAll(/\b[A-Za-z][A-Za-z0-9_]*\s*:/g)]
    .flatMap(match => readLinearSourceLineName(text.slice(0, match.index! + match[0].length)) ?? []);
  const sourceNames = [...sourcePointLabels, ...lineNames];
  const tokens = [
    ...text.matchAll(
      /(?:\d+(?:\.\d+|\.(?=[eE][+-]?\d))?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|<=|>=|[<>=()+*/-]|[^\s]/g,
    ),
  ];
  const output: SourceClause[] = [];
  let chunk: RegExpMatchArray[] = [];
  const requestedAtom = (): boolean => {
    const first = chunk[0]!, last = chunk.at(-1)!;
    const before = text.slice(0, first.index);
    const after = text.slice(last.index! + last[0].length);
    if (chunk.length === 1 && variables.includes(first[0])) {
      const name = `(?:${variables.join("|")})`;
      const list = `${name}(?:\\s*(?:,|and)\\s*${name})*(?:\\s*(?:,|and)\\s*)?`;
      // Bare coordinate requests are nouns in a bounded request clause, not a
      // second graph expression. Arithmetic and display verbs cannot match.
      if (new RegExp(`\\b(?:find|determine|give|report|state|calculate|compute|solve)\\s+(?:(?:for|the|exact|values?|of|both)\\s+)*(?:${list})?$`, "i").test(before)
        && new RegExp(`^(?:\\s*(?:,|and)\\s*${name})*\\s*(?=[.;?!]|$)`, "i").test(after)) return true;
    }
    // Number-line membership questions may name a literal source scalar. It
    // is a query about the already-read set, not another source comparison.
    return variables.length === 1
      && (chunk.length === 1 && /^(?:\d|\.\d)/.test(first[0])
        || chunk.length === 2 && /^[+-]$/.test(first[0]) && /^(?:\d|\.\d)/.test(last[0]))
      && /\b(?:whether|is|does|do)\s*$/i.test(before)
      && /^\s*(?:belongs?|lies?|included|is|in|on)\b/i.test(after);
  };
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
    } else if (chunk.some((token) => !/^[()]$/.test(token[0])) && !requestedAtom())
      throw new Error("An additional source mathematical expression cannot be omitted from the complete linear program");
    chunk = [];
  };
  const prose = new Set(
    "graph graphs graphically solve shade show plot represent draw illustrate choose chooses choosing consider considering of for where when satisfy satisfies satisfying and or not with to solution set points in on at as subject such under given over using by then find determine state give report real if possible the a an all values xaxis yaxis coordinate plane line lines region common simultaneously respectively including whether has have is are belongs pair why meet cross its".split(
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
    // A requested coordinate is a prose noun, not the affine subtraction
    // x-coordinate. Restrict to a complete request sentence, an empty math
    // chunk and a possessive/article; arithmetic continuations still refuse.
    const coordinateOffset = next?.[0] === "-" ? 2 : 1;
    const coordinate = tokens[i + coordinateOffset];
    const coordinateSuffix = coordinate ? text.slice(coordinate.index! + coordinate[0].length).split(/[.;?!]/)[0]!.trim() : "";
    if (variables.includes(value) && chunk.length === 0
      && /^(?:its|the)$/i.test(previous?.[0] ?? "")
      && coordinate?.[0] === "coordinate"
      && !/^(?:<=|>=|[<>=()+*/-])$/.test(tokens[i + coordinateOffset + 1]?.[0] ?? "")
      && /^(?:of\s+(?:(?:the|their)\s+intersection|[A-Za-z][A-Za-z0-9_]*))?$/i.test(coordinateSuffix)
      && /\b(?:find|determine|give|report|state|calculate|compute)\s+(?:its|the)\s*$/i.test(text.slice(0, token.index))) {
      flush(); i += coordinateOffset; continue;
    }
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
          (value.length === 1 && !prose.has(value.toLowerCase()) && !sourceNames.includes(value)
            && /\b(?:graph|plot|draw|show|represent)\s+(?:(?:the|function|expression|graph|of)\s+)*$/i.test(text.slice(0, token.index))) ||
          (!prose.has(value.toLowerCase()) &&
            ((last && (/^(?:\d|\.\d)/.test(last[0]) || value.length === 1)) ||
              /^[+*/(]$/.test(tokens[i + 1]?.[0] ?? "") ||
              variables.includes(tokens[i + 1]?.[0] ?? ""))))
      ) {
        if (!mathematicalJoin && !last && value.length > 1
          && variables.includes(nextValue) && token.index! + value.length < tokens[i + 1]!.index!)
          throw new UnprovedLinearRequest(`Unconsumed request word '${value}' before an affine operand`);
        throw new Error(
          `Unknown variable or function in original source expression: '${value}' at character ${token.index}`,
        );
      }
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
  allowConstraintSentences = false,
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
  // A trailing prose domain may restrict the entire union, rather than only
  // its final branch. That scope requires a grammar this reader does not own.
  let hasUnion = /\bunion\s+of\b/i.test(text.slice(0, groups[0]![0]!.start));
  for (let index = 0; index + 1 < groups.length; index++) {
    const gap = text.slice(groups[index]!.at(-1)!.end, groups[index + 1]![0]!.start);
    const explicitConnective = gap.replace(/\b(?:complement\s+of|and|or|union|intersection|not)\b/gi, "").replace(/[()\s]/g, "");
    if (hasUnion && explicitConnective.length > 0)
      throw new Error("A trailing source domain after a union has unresolved whole-set scope");
    if (/\bor\b|\bunion\b/i.test(gap)) hasUnion = true;
  }
  // No Boolean operand may disappear merely because it lacks a comparison.
  // Ordinary instructions such as "and label the axes" remain outside the
  // mathematical program, while "or x" and "or (x+y)" are incomplete math.
  const gaps = [text.slice(0, groups[0]![0]!.start), ...groups.map((group, index) => text.slice(group.at(-1)!.end, groups[index + 1]?.[0].start ?? text.length))];
  for (const [index, gap] of gaps.entries()) {
    // The first result noun after an action identifies its requested object.
    // A boundary request before its operand is not a shaded solution region;
    // an exclusive boundary request also cannot be a later annotation.
    const objects = gap.matchAll(/\b(?:graph|shade|show|plot|represent|draw|illustrate)\s+((?:[A-Za-z]+\s+)*?)(boundar(?:y|ies)|regions?|solutions?|sets?|points?|lines?)\b/gi);
    for (const object of objects)
      if (/^boundar/i.test(object[2]!) && (index === 0 || /\b(?:only|just)\b/i.test(object[1]!)))
        throw new UnprovedLinearRequest("The requested boundary object is not a filled solution set");
  }
  const names = [...sourcePointLabels, ...readLinearSourceIntersectionNames(text)];
  for (const clause of source) {
    const label = readLinearSourceLineName(text.slice(0, clause.start));
    if (label) names.push(label);
  }
  for (let gap of gaps) {
    for (const name of names) gap = gap.replace(new RegExp(`\\b${name}\\s*:\\s*`, "g"), " ");
    // The article in "and a horizontal line" is not a Boolean variable a.
    // This bounded display instruction cannot hide a mathematical clause.
    gap = gap.replace(/\band\s+(?:a|the)\s+(?:vertical|horizontal)\s+line\b/gi, " ");
    if (sourcePointLabels.length) {
      const names = `(?:${sourcePointLabels.join("|")})`;
      gap = gap.replace(new RegExp(`\\band\\s+${names}\\s+at\\s+(?:every|each)\\s+corner\\b`, "g"), " ");
      gap = gap.replace(new RegExp(`\\band\\s+${names}\\s+value\\b`, "g"), " ");
    }
    // A complete bare x/y result request is outside the set's Boolean program.
    // The sentence boundary prevents a comparison or arithmetic tail hiding
    // behind this noun phrase; those still remain mathematical source input.
    gap = gap.replace(/\b(?:find|determine|give|report|state|calculate|compute|solve)\s+(?:(?:for|the|exact|values?|of|both)\s+)*[xy](?:\s*(?:,|and)\s*[xy])*\s*(?=[.;?!]|$)/gi, " ");
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
  // Every gap has to be understood, not merely skipped by the affine scanner.
  // Display locations between operands cannot be absorbed as a connective:
  // they may terminate one figure and introduce another.
  for (const gap of gaps.slice(1, -1)) {
    if (/\b(?:on|in)\s+(?:(?:a|the|one|same|coordinate|xy)\s+)*(?:number[ -]line|graphs?|axes|plane)\b/i.test(gap))
      throw new UnprovedLinearRequest("A display location between operands has unproved shared scope");
    if (/\bthen\b/i.test(gap))
      throw new UnprovedLinearRequest("Sequential or conditional operands have unproved Boolean scope");
  }
  const strictBoundary = source.some(clause => ["<", ">"].includes(/<=|>=|<|>|=/.exec(clause.text)?.[0] ?? ""));
  const prose = strictBoundary ? gaps.join(" ").replace(/\bstrict[- ]boundary\s+exclusion\b/gi, " ") : gaps.join(" ");
  consumeLinearRequest(prose, names);
  const lexemes: string[] = [];
  const context = text.slice(0, groups[0]![0]!.start);
  const complementWhole =
    /\b(?:complement\s+of\s+(?:(?:the\s+)?(?:common\s+)?(?:solution(?:\s+set)?|set|region)\s+(?:of|satisfying)\s+)?|(?:do|does)\s+not\s+satisfy\s+)\(*\s*$/i.test(context);
  const contextNegations = context.match(/\b(?:not|complement)\b/gi) ?? [];
  if (contextNegations.length > 1 || contextNegations.length === 1
    && !complementWhole && !/\bnot\s*\(*\s*$/i.test(context))
    throw new Error("Unsupported original source negation scope cannot be omitted");
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
  const graphicalAction = /\b(?:graph|shade|show|plot|represent|draw|illustrate)\b/i;
  let hasGraphicalRequest = graphicalAction.test(context);
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
    const negations = gap.match(/\b(?:not|complement)\b/gi) ?? [];
    if (negations.length > 1 || negations.length === 1
      && !/\b(?:not|complement\s+of)\s*\(*\s*$/i.test(gap))
      throw new Error("Unsupported local source negation scope cannot be omitted");
    if (/;|\bnumber[ -]line\b[^.;?!]*[.;?!]/i.test(gap)
      || !allowConstraintSentences && /[.?!]/.test(gap)
      || hasGraphicalRequest && graphicalAction.test(gap))
      throw new Error("Additional graphical source requests cannot become a Boolean intersection");
    hasGraphicalRequest ||= graphicalAction.test(gap);
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
/** Exact DNF under a small explicit budget; unsupported equivalence defers. */
function planarBranches(program: IntervalExpression, negate = false): string[][] | null {
  if ("complement" in program) return planarBranches(program.complement, !negate);
  if ("inequality" in program) {
    if (!negate) return [[program.inequality]];
    const relation = /<=|>=|<|>|=/.exec(program.inequality);
    if (!relation) return null;
    const operators = relation[0] === "=" ? ["<", ">"] : [{ "<=": ">", ">=": "<", "<": ">=", ">": "<=" }[relation[0]]!];
    return operators.map(operator => [program.inequality.slice(0, relation.index) + operator + program.inequality.slice(relation.index + relation[0].length)]);
  }
  const union = "union" in program;
  const children = union ? program.union : program.intersection;
  const branches = children.map(child => planarBranches(child, negate));
  if (branches.some(branch => branch === null)) return null;
  if (union !== negate) {
    const values = (branches as string[][][]).flat();
    return values.length <= 32 ? values : null;
  }
  let result: string[][] = [[]];
  for (const child of branches as string[][][]) {
    if (result.length * child.length > 32) return null;
    result = result.flatMap(left => child.map(right => [...left, ...right]));
  }
  return result;
}

/** Preserve every exact source predicate after its own Boolean polarity. */
function planarPredicates(program: IntervalExpression, negate = false): string[] | null {
  if ("complement" in program) return planarPredicates(program.complement, !negate);
  if ("inequality" in program) return planarBranches(program, negate)?.flat() ?? null;
  const children = "union" in program ? program.union : program.intersection;
  const predicates = children.map(child => planarPredicates(child, negate));
  return predicates.some(child => child === null) ? null : (predicates as string[][]).flat();
}

/** A feasible symmetric-difference witness proves a Boolean contradiction. */
function planarBooleanAgreement(program: IntervalExpression, proposed: string[], variables: readonly string[]): boolean | null {
  if (variables.length !== 2) return null;
  const source = planarBranches(program), outsideSource = planarBranches(program, true);
  const candidate: IntervalExpression = { intersection: proposed.map(inequality => ({ inequality })) };
  const outsideCandidate = planarBranches(candidate, true);
  if (!source || !outsideSource || !outsideCandidate) return null;
  for (const [left, right] of [[source, outsideCandidate], [[proposed], outsideSource]] as const) {
    for (const a of left) for (const b of right) {
      // Candidate inputs may be within the native budget while a proof-only
      // witness adds another row. That is absence of proof, not disagreement.
      if (a.length + b.length > 16) return null;
      const solution = solveLinearFigure({ kind: "linear_feasible_region", variables: [variables[0]!, variables[1]!], constraints: [...a, ...b] });
      if (solution.kind !== "linear_feasible_region") return null;
      if (solution.feasibility.feasible) return false;
    }
  }
  return true;
}
/** Named real set builders and their explicit Boolean result definitions. */
function setBuilderSourceProgram(body: string, variable: string, setAliases?: Set<string>): IntervalExpression | null {
  const bindings = new Map<string, IntervalExpression>();
  const spans: Array<{ start: number; end: number }> = [];
  for (const match of body.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*\{\s*([A-Za-z][A-Za-z0-9_]*)(?:\s+in\s+(?:R|ℝ))?\s*:\s*([^{}]+)\}/g)) {
    if (match[2] !== variable || match[1] === variable || bindings.has(match[1]!)) throw new Error("Named set builders require one unambiguous declared real variable");
    const content = match[3]!;
    bindings.set(match[1]!, booleanProgram(content, clauses(content, [variable])));
    spans.push({ start: match.index!, end: match.index! + match[0].length });
    if (bindings.size > 16) throw new Error("Source named sets exceed 16 definitions");
  }
  if (!bindings.size) return null;
  const mask = (text: string, ranges: Array<{ start: number; end: number }>): string => {
    for (const span of ranges.slice().sort((a, b) => b.start - a.start)) text = text.slice(0, span.start) + " ".repeat(span.end - span.start) + text.slice(span.end);
    return text;
  };
  let residual = mask(body, spans);
  if (/[{}[\]]/.test(residual)) throw new Error("Every original set builder must be consumed completely");
  const read = (text: string): { program: IntervalExpression; end: number } => {
    const tokens = [...text.matchAll(/[A-Za-z][A-Za-z0-9_]*|[^\s]/g)];
    let cursor = 0;
    const word = () => tokens[cursor]?.[0].toLowerCase();
    const atom = (): IntervalExpression => {
      if (word() === "not" || word() === "complement") {
        cursor++; if (word() === "of") cursor++;
        return { complement: atom() };
      }
      if (word() === "(") { cursor++; const value = union(); if (word() !== ")") throw new Error("Unbalanced named-set expression"); cursor++; return value; }
      const token = tokens[cursor++];
      if (!token || !bindings.has(token[0])) throw new Error(`Unknown original named-set operand ${token?.[0]}`);
      return bindings.get(token[0])!;
    };
    const intersection = (): IntervalExpression => {
      let value = atom();
      while (["and", "intersect", "intersection", "minus"].includes(word() ?? "")) {
        const operation = word(); cursor++;
        const next = atom();
        value = { intersection: [value, operation === "minus" ? { complement: next } : next] };
      }
      return value;
    };
    const union = (): IntervalExpression => {
      let value = intersection();
      while (["or", "union"].includes(word() ?? "")) { cursor++; value = { union: [value, intersection()] }; }
      return value;
    };
    const program = union(), last = tokens[cursor - 1]!;
    const rest = text.slice(last.index! + last[0].length);
    if (rest.trimStart() && !/^(?:\s*[,;:.?!]|\s+(?:on|with|where|and\s+(?:draw|label|mark|state|classify))\b)/i.test(rest))
      throw new Error("Unsupported continuation of complete named-set expression");
    return { program, end: last.index! + last[0].length };
  };
  const results: IntervalExpression[] = [], resultSpans: Array<{ start: number; end: number }> = [];
  for (const definition of residual.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*/g)) {
    const label = definition[1]!;
    if (label === variable || bindings.has(label)) throw new Error("A source set result cannot redefine its givens");
    const start = definition.index! + definition[0].length;
    const selected = read(residual.slice(start));
    bindings.set(label, selected.program); results.push(selected.program);
    resultSpans.push({ start: definition.index!, end: start + selected.end });
  }
  if (results.length !== 1) throw new Error("Named set builders require one explicit complete result expression");
  residual = mask(residual, resultSpans);
  // A stated definition of set difference/intersection is independently
  // checked before its membership prose can be removed from the math spans.
  residual = residual.replace(/\b(?:Here\s+)?([A-Za-z][A-Za-z0-9_]*)\s+(minus|union|intersect(?:ion)?)\s+([A-Za-z][A-Za-z0-9_]*)\s+means\s+x\s+is\s+in\s+([A-Za-z][A-Za-z0-9_]*)\s+(AND|OR)\s+x\s+is\s+(not\s+)?in\s+([A-Za-z][A-Za-z0-9_]*)\s*(?=[.;?!]|$)/gi,
    (whole, a: string, operation: string, b: string, c: string, connective: string, negation: string | undefined, d: string) => {
      if (![a, b, c, d].every(name => bindings.has(name))) throw new Error("Set membership explanation uses an unknown source set");
      const lhs: IntervalExpression = /union/i.test(operation) ? { union: [bindings.get(a)!, bindings.get(b)!] } : { intersection: [bindings.get(a)!, /minus/i.test(operation) ? { complement: bindings.get(b)! } : bindings.get(b)!] };
      const right = negation ? { complement: bindings.get(d)! } : bindings.get(d)!;
      const rhs: IntervalExpression = /or/i.test(connective) ? { union: [bindings.get(c)!, right] } : { intersection: [bindings.get(c)!, right] };
      const solve = (expression: IntervalExpression) => solveLinearFigure({ kind: "number_line_set", variable, expression });
      if (!same(solve(lhs), solve(rhs))) throw new Error("Original set-membership explanation contradicts its Boolean definition");
      return " ".repeat(whole.length);
    });
  if (clauses(residual, [variable]).length) throw new Error("Additional source comparisons cannot be omitted from a named-set program");
  // Definitions and the one result expression own all parsed operation spans.
  // A remaining operator adjacent to a bound set is another mathematical
  // request, regardless of identifier length; prose consumption cannot own it.
  const remaining = [...residual.matchAll(/[A-Za-z][A-Za-z0-9_]*|[^\s]/g)]
    .map(token => token[0]).filter(token => !["(", ")", "of"].includes(token.toLowerCase()));
  for (let i = 0; i < remaining.length; i++) {
    const operation = remaining[i]!.toLowerCase();
    const before = bindings.has(remaining[i - 1] ?? ""), after = bindings.has(remaining[i + 1] ?? "");
    if (["union", "intersection", "intersect", "minus", "complement", "not"].includes(operation) && (before || after)
      || ["and", "or"].includes(operation) && before && after)
      throw new UnprovedLinearRequest("An additional named-set operation has no consumed source span");
  }
  consumeLinearRequest(residual, [...bindings.keys()]);
  for (const label of bindings.keys()) setAliases?.add(label);
  return results[0]!;
}
/** Bounded named interval literals are another spelling of the same real sets. */
function intervalSourceProgram(body: string, variable: string, setAliases?: Set<string>, intervalRoles?: Map<string, LinearSourceIntervalRole>): IntervalExpression | null {
  const bindings = new Map<string, IntervalExpression>();
  const roles = new Map<string, LinearSourceIntervalRole>();
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
    if (intervalRoles) roles.set(label, { definition: body.slice(definition.index!, end + 1),
      ...(lower === "-infinity" ? {} : { lower: parseLinearAffine(lower, [variable]).constant }),
      ...(upper === "infinity" ? {} : { upper: parseLinearAffine(upper, [variable]).constant }),
      lowerIncluded: opening === "[", upperIncluded: closing === "]" });
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
  if (/\b(?:unless|except|xor|neither|nor|setminus|minus)\b|[∖\\]/i.test(residual))
    throw new Error("Unsupported named-interval source connective");
  const references: SourceClause[] = [...residual.matchAll(/\b[A-Za-z][A-Za-z0-9_]*\b/g)]
    .filter((match) => bindings.has(match[0]))
    .map((match) => ({ text: match[0], start: match.index!, end: match.index! + match[0].length, equality: false }));
  if (!references.length) throw new Error("Source must request a complete named-interval program");
  if (new Set(references.map(reference => reference.text)).size !== references.length)
    throw new Error("Repeated named-interval operands require an unambiguous single result request");
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
  for (const label of bindings.keys()) setAliases?.add(label);
  for (const [label, role] of roles) intervalRoles?.set(label, role);
  return selected;
}

/** Whole real-set names from an independently admitted complete source program. */
export function readLinearSourceSetAliases(question: string): Set<string> {
  return readLinearSourceSetRoles(question).aliases;
}

/** Original set types and interval definitions; never planner scalar meanings. */
export function readLinearSourceSetRoles(question: string): { aliases: Set<string>; intervals: Map<string, LinearSourceIntervalRole> } {
  const empty = () => ({ aliases: new Set<string>(), intervals: new Map<string, LinearSourceIntervalRole>() });
  if (buildLinearSourceDocument(question)?.constructions[0]?.operator !== "number_line_set") return empty();
  try {
    const normalized = normalize(question);
    assertLinearSourceGrammar(normalized);
    const body = readLinearSourceReferencePoints(explicitDomains(sourceNotation(normalized, ["x"]), ["x"]), ["x"]).maskedQuestion;
    const aliases = new Set<string>();
    const intervals = new Map<string, LinearSourceIntervalRole>();
    if (!setBuilderSourceProgram(body, "x", aliases)) intervalSourceProgram(body, "x", aliases, intervals);
    for (const name of body.matchAll(/\bsolution\s+set\s+(?:(?:named|called|denoted\s+by)\s+)?([A-Za-z][A-Za-z0-9_]*)\s*(?=of\b|for\b|on\b|satisfying\b|=|:|[.;?!]|$)/gi)) {
      if (name[1] !== "x") aliases.add(name[1]!);
    }
    return { aliases, intervals };
  } catch { return empty(); }
}
interface SourceObjective {
  expression: string;
  sense: "max" | "min";
  start: number;
  end: number;
  label?: string;
}
/** Closed prose grammar for the native two-line graphical solution builder. */
function hasNativeSystemRequest(body: string, source: SourceClause[], pointLabels: readonly string[]): boolean {
  const names = new Set([...pointLabels, ...readLinearSourceIntersectionNames(body)]);
  let prose = body;
  for (const clause of source.slice().reverse()) {
    const label = readLinearSourceLineName(body.slice(0, clause.start));
    if (label) names.add(label);
    prose = prose.slice(0, clause.start) + " ".repeat(clause.end - clause.start) + prose.slice(clause.end);
  }
  // Only names already declared by an equation or intersection can be nouns.
  const words = new Set((
    "teach me how the two graphs and show a unique solution explain graphical system whose crossing has fractional coordinates keep intersection exact graphically why have no common help see of using vertical line horizontal solve pair by method label their point lines meet at both find its x coordinate for real y many solutions does use to determine number describe them cross in simultaneous with names simplified equations intercepts classify state full set equivalent where they exist from figure there are " +
    "please graph draw sketch represent plot mark give report calculate compute all every each value values count one none infinitely infinite parallel coincident consistent inconsistent dependent independent is which this these those it them on xy plane as then also"
  ).split(" "));
  for (const token of prose.matchAll(/[A-Za-z][A-Za-z0-9_]*|[^\s]/g)) {
    if (names.has(token[0]) || words.has(token[0].toLowerCase()) || /^[,;:.?!()'"-]$/.test(token[0])) continue;
    return false;
  }
  // Calculation verbs must request one of the native result roles; the
  // surrounding display vocabulary cannot turn a different result into one.
  const resultNouns = /^(?:(?:the|their|its|both|exact|full|complete|common|values?|of|for)\s+)*(?:[xy]\b|(?:point\s+of\s+)?intersection\b|coordinates?\b|intercepts?\b|(?:number|count)\s+of\s+solutions\b|solutions?(?:\s+set)?\b|where\s+they\s+(?:meet|cross)\b)/i;
  for (const action of prose.matchAll(/\b(?:find|determine|give|report|state|calculate|compute)\b/gi)) {
    if (!resultNouns.test(prose.slice(action.index! + action[0].length).trimStart())) return false;
  }
  for (const query of prose.matchAll(/\b(?:how\s+many|count)\b/gi)) {
    if (/^\s+of\s+solutions\b/i.test(prose.slice(query.index! + query[0].length))) continue;
    if (!/^\s+(?:the\s+)?solutions\b/i.test(prose.slice(query.index! + query[0].length))) return false;
  }
  return true;
}

export interface LinearSourceSystemLabels {
  lines: Array<{ names: string[]; interceptAxes: Array<"x" | "y"> }>;
  intersectionName?: string;
}

/** Source names join complete, equivalent equations; candidate row order supplies no identity. */
export function readLinearSourceSystemLabels(
  question: string,
  input: Extract<LinearFigureInput, { kind: "linear_system" }>,
): LinearSourceSystemLabels {
  if (typeof question !== "string" || question.length > 8192)
    throw new Error("System labels require bounded original source text");
  const variables = input.variables ?? ["x", "y"];
  const authority = readLinearBindingSource(question, variables, false);
  if (!authority || !isIntersectionProgram(authority.program))
    return { lines: input.equations.map(() => ({ names: [], interceptAxes: [] })) };
  const normalized = normalize(question);
  assertLinearSourceGrammar(normalized);
  const references = readLinearSourceReferencePoints(explicitDomains(sourceNotation(normalized, variables), variables), variables);
  const body = references.maskedQuestion.replace(/\b([A-Za-z][A-Za-z0-9_]*)\s*∈\s*ℝ/g, (_, variable: string) => {
    if (!variables.includes(variable)) throw new Error("Real domain must use a declared variable");
    return " ";
  });
  const source = clauses(body, variables, references.points.map(point => point.label));
  const program = booleanProgram(body, source, references.points.map(point => point.label), true);
  if (source.length !== 2 || !source.every(clause => clause.equality)
    || !isIntersectionProgram(program)
    || !same(signatures(source.map(clause => clause.text), variables, true), signatures(input.equations, variables, true)))
    throw new Error("System labels require the complete equivalent original two-equation program");
  const identity = (equation: string): string => JSON.stringify(signatures([equation], variables, true));
  const owners = source.map(clause => ({
    identity: identity(clause.text),
    name: readLinearSourceLineName(body.slice(0, clause.start)),
  }));
  const declared = new Map<string, string>();
  for (const owner of owners) {
    if (!owner.name) continue;
    if (owner.name.length > 32 || variables.includes(owner.name) || references.points.some(point => point.label === owner.name)
      || declared.has(owner.name) && declared.get(owner.name) !== owner.identity)
      throw new Error("Original line names must have one unambiguous geometric owner");
    declared.set(owner.name, owner.identity);
  }
  let prose = body;
  for (const clause of source.slice().reverse())
    prose = prose.slice(0, clause.start) + " ".repeat(clause.end - clause.start) + prose.slice(clause.end);
  const requested = new Map<string, Set<"x" | "y">>();
  for (const sentence of prose.split(/[.;?!]|(?:\band\s+|,\s*)(?=(?:label|mark|find|determine|give|report|state|calculate|compute)\b)/i)) {
    const action = /\b(?:label|mark|find|determine|give|report|state|calculate|compute)\b/i.exec(sentence);
    const request = action ? sentence.slice(action.index) : "";
    if (!/\bintercepts?\b/i.test(request)) continue;
    const mentioned = [...declared.keys()].filter(name => new RegExp(`\\b${name}\\b`).test(request));
    const all = !mentioned.length || /\btheir\b|\b(?:both|all|every|each)\s+(?:the\s+)?lines?\b/i.test(request);
    const axes: Array<"x" | "y"> = /\bx[- ]intercepts?\b/i.test(request) && !/\by[- ]intercepts?\b/i.test(request) ? ["x"]
      : /\by[- ]intercepts?\b/i.test(request) && !/\bx[- ]intercepts?\b/i.test(request) ? ["y"] : ["x", "y"];
    for (const owner of owners) if (all || owner.name && mentioned.includes(owner.name)) {
      const selected = requested.get(owner.identity) ?? new Set<"x" | "y">();
      axes.forEach(axis => selected.add(axis)); requested.set(owner.identity, selected);
    }
  }
  const intersectionNames = [...readLinearSourceIntersectionNames(body)];
  if (intersectionNames.length > 1 || intersectionNames.some(name => name.length > 32 || variables.includes(name) || declared.has(name)))
    throw new Error("Original intersection name must have one unambiguous geometric owner");
  return {
    lines: input.equations.map(equation => {
      const key = identity(equation);
      return { names: [...declared].filter(([, owner]) => owner === key).map(([name]) => name), interceptAxes: [...(requested.get(key) ?? [])] };
    }),
    ...(intersectionNames[0] ? { intersectionName: intersectionNames[0] } : {}),
  };

}
/** Read an affine objective completely, separately from its prose direction. */
function sourceObjective(body: string, names: readonly string[]): SourceObjective {
  const directionPattern = /\b(?:maximi[sz](?:e[ds]?|ing|ation)|minimi[sz](?:e[ds]?|ing|ation)|maximum|minimum|max|min)\b/gi;
  const directions = [...body.matchAll(directionPattern)];
  if (!directions.length) throw new Error("Objective direction is not explicit in source");
  const sense = (word: string): "max" | "min" => /^max/i.test(word) ? "max" : "min";
  const targetOf = (direction: RegExpMatchArray): string | undefined => /^\s*(?:(?:the|objective|function|constant|value|of)\s+)*(?:(?:profit|cost|revenue)\s+(?=[A-Za-z][A-Za-z0-9_]*\s*=))?([A-Za-z][A-Za-z0-9_]*)\b/i.exec(body.slice(direction.index! + direction[0].length))?.[1];
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
    const descriptor = /^\s*(?:(?:the|objective|function|constant|value|of)\s+)*(?:(?:profit|cost|revenue)\s+(?=[A-Za-z][A-Za-z0-9_]*\s*=))?(?:[A-Za-z][A-Za-z0-9_]*\s*=\s*)?/i.exec(body.slice(after))!;
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
  return { ...selected, ...(objectiveLabel ? { label: objectiveLabel } : {}) };
}
/**
 * Independently reconstruct a complete affine source program. No rejected
 * candidate, planner scalar, mark, annotation or display window is consumed.
 * The ordinary compiler must still prove and compile this whole document.
 * The supported coordinate grammar is deliberately x/y; unknown names and
 * ambiguous dimensions are refused rather than guessed from planner output.
 */
export function buildLinearSourceDocument(question: string): SceneDocument | null {
  if (typeof question !== "string" || question.length > 8192) return null;
  try {
    const normalized = normalize(question);
    assertLinearSourceGrammar(normalized);
    // This builder owns graphical solution sets and exact line intersections.
    // Additional geometric calculations stay with the planner's constructions.
    if (/\b(?:angles?|distances?|bisectors?|slopes?|areas?|tan(?:gent)?|reflections?|reflected|rotations?|rotated|translations?|translated)\b/i.test(normalized)) return null;
    const numberLineRequested = /\bnumber[ -]line\b/i.test(normalized)
      || /\breal\s+x\b/i.test(normalized) && !/\by\b|\b(?:half[ -]plane|coordinate\s+plane|pairs?)\b|(?:R|ℝ)(?:\^2|²)/i.test(normalized);
    let operator: string;
    let inputs: Record<string, unknown>;
    if (numberLineRequested) {
      const points = readLinearSourceReferencePoints(explicitDomains(sourceNotation(normalized, ["x"]), ["x"]), ["x"]);
      const body = points.maskedQuestion;
      const program = setBuilderSourceProgram(body, "x") ?? intervalSourceProgram(body, "x") ?? booleanProgram(body, clauses(body, ["x"]), points.points.map(point => point.label));
      operator = "number_line_set";
      inputs = { variable: "x", expression: program };
    } else {
      const names = ["x", "y"];
      const points = readLinearSourceReferencePoints(explicitDomains(sourceNotation(normalized, names), names), names);
      let body = points.maskedQuestion;
      const proseLabels = points.points.map(point => point.label);
      let objective: { expression: string; sense: "max" | "min" } | undefined;
      if (/\b(?:maximi[sz](?:e[ds]?|ing|ation)|minimi[sz](?:e[ds]?|ing|ation)|maximum|minimum|max|min)\b/i.test(body)) {
        const source = sourceObjective(body, names);
        if (source.label) proseLabels.push(source.label);
        objective = { expression: source.expression, sense: source.sense };
        body = body.slice(0, source.start) + " ".repeat(source.end - source.start) + body.slice(source.end);
      }
      const source = clauses(body, names, points.points.map(point => point.label));
      if (!source.length || !isIntersectionProgram(booleanProgram(body, source, proseLabels, true))) return null;
      if (source.length === 2 && source.every(clause => clause.equality) && !objective) {
        if (!hasNativeSystemRequest(body, source, proseLabels)) return null;
        operator = "linear_system";
        inputs = { variables: names, equations: source.map(clause => clause.text) };
      } else if (source.length === 1 && !source[0]!.equality && !objective) {
        operator = "linear_half_plane";
        inputs = { variables: names, inequality: source[0]!.text };
      } else if (source.every(clause => !clause.equality)) {
        operator = "linear_feasible_region";
        inputs = { variables: names, constraints: source.map(clause => clause.text), ...(objective ? { objective } : {}) };
      } else return null;
    }
    if (!readLinearBindingSource(question, operator === "number_line_set" ? ["x"] : ["x", "y"], operator === "number_line_set")) return null;
    const document: SceneDocument = {
      schemaVersion: "scene-document/v2",
      visualDecision: { mode: "scene", reason: "Complete original affine source program with engine-owned geometry and claims" },
      source: { question, representationTier: "exact_verified", nonMetric: false },
      quantities: [],
      entities: [{ id: "source_linear_region", kind: "linear_region", role: "solution" }],
      constructions: [{ id: "build_source_linear_region", operator, inputs, outputs: ["source_linear_region"] }],
      relations: [], assertions: [], annotations: [], requiredEntityIds: ["source_linear_region"],
      revealGroups: [{ id: "source_linear_setup", entityIds: ["source_linear_region"], dependsOn: [], narrationCue: "Explain the verified graphical solution and original reference points." }],
      teachingTimeline: [{ id: "show_source_linear_setup", action: "reveal", targetId: "source_linear_setup", dependsOn: [], narrationIntent: "Explain only the independently verified original source program." }],
    };
    return validateLinearSourceBinding(document).some(issue => issue.severity === "fatal") ? null : document;
  } catch { return null; }
}

/** Complete original two-equation authority for deterministic solver binding. */
export function readLinearSystemSource(question: string): Extract<LinearFigureInput, { kind: "linear_system" }> | null {
  const document = buildLinearSourceDocument(question);
  const construction = document?.constructions[0];
  if (!construction || construction.operator !== "linear_system") return null;
  const equations = construction.inputs.equations;
  if (!Array.isArray(equations) || equations.length !== 2) return null;
  const [first, second] = equations;
  if (typeof first !== "string" || typeof second !== "string") return null;
  return { kind: "linear_system", variables: ["x", "y"], equations: [first, second] };
}

interface LinearBindingSource {
  source: SourceClause[];
  program: IntervalExpression;
  objective?: SourceObjective;
  aliases?: Set<string>;
}

/** Source reconstruction has no proposed coefficients or candidate solution. */
function readLinearBindingSource(question: string, names: readonly string[], numberLine: boolean): LinearBindingSource | null {
  try {
    const normalized = normalize(question);
    assertLinearSourceGrammar(normalized);
    let body = explicitDomains(sourceNotation(normalized, names), names);
    const points = readLinearSourceReferencePoints(body, names);
    body = points.maskedQuestion;
    body = body.replace(/\b([A-Za-z][A-Za-z0-9_]*)\s*∈\s*ℝ/g, (_, variable: string) => {
      if (!names.includes(variable)) throw new Error("Real domain must use a declared variable");
      return " ";
    });
    const proseLabels = points.points.map(point => point.label);
    let objective: SourceObjective | undefined;
    if (!numberLine && /\b(?:maximi[sz](?:e[ds]?|ing|ation)|minimi[sz](?:e[ds]?|ing|ation)|maximum|minimum|max|min)\b/i.test(body)) {
      objective = sourceObjective(body, names);
      if (objective.label) proseLabels.push(objective.label);
      body = body.slice(0, objective.start) + " ".repeat(objective.end - objective.start) + body.slice(objective.end);
    }
    if (numberLine) {
      const aliases = new Set<string>();
      const named = setBuilderSourceProgram(body, names[0]!, aliases) ?? intervalSourceProgram(body, names[0]!, aliases);
      if (named) {
        signatures(inequalityLeaves(named), names);
        if (/\bstrict[- ]boundary\s+exclusion\b/i.test(body)
          && !inequalityLeaves(named).some(leaf => parseLinearConstraint(leaf, names).some(row => row.strict))) return null;
        if (hasAffirmativeDiscreteDomain(question, names, aliases)) return null;
        return { source: [], program: named, aliases };
      }
    }
    const source = clauses(body, names, proseLabels);
    const program = booleanProgram(body, source, proseLabels, true);
    signatures(inequalityLeaves(program), names);
    if (/\bstrict[- ]boundary\s+exclusion\b/i.test(body)
      && !inequalityLeaves(program).some(leaf => parseLinearConstraint(leaf, names).some(row => row.strict))) return null;
    if (hasAffirmativeDiscreteDomain(question, names)) return null;
    return { source, program, ...(objective ? { objective } : {}) };
  } catch {
    // A failed lexical, scope, or request proof is absence of authority. Only
    // the completed result above can enter a proposed/source comparison.
    return null;
  }
}

/** An independent domain veto requires an affirmative variable-domain clause. */
function hasAffirmativeDiscreteDomain(question: string, names: readonly string[], aliases: ReadonlySet<string> = new Set()): boolean {
  question = withoutQuestionOrdinal(question);
  const setAliases = new Set(aliases);
  // A literal real-set given proves its alias independently of the surrounding
  // request. An unproved later instruction cannot turn that alias into ℤ/ℕ.
  for (const given of question.matchAll(/\b([INZW])\s*=\s*\{\s*([A-Za-z][A-Za-z0-9_]*)(?:\s+in\s+(?:R|ℝ))?\s*:\s*([^{}]+)\}/g)) {
    if (!names.includes(given[2]!)) continue;
    try {
      const content = normalize(given[3]!);
      const program = booleanProgram(content, clauses(content, [given[2]!]));
      signatures(inequalityLeaves(program), [given[2]!]);
      setAliases.add(given[1]!);
    } catch { /* The literal source alias itself has no complete proof. */ }
  }
  const name = `(?:${names.join("|")})`;
  const list = `${name}(?:\\s*(?:,\\s*(?:and\\s*)?|and\\s+)${name})*`;
  const domainWords = "(?:(?:non[- ]?negative|non[- ]?positive|positive|negative)\\s+)?(?:integers?|integral(?:\\s+(?:values?|numbers?))?|natural\\s+numbers?|whole\\s+numbers?)";
  const domain = `(?:${domainWords}|[INZWℤℕ]|\\\\mathbb\\s*\\{?[INZW]\\}?)`;
  const discrete = (text: string): boolean => !setAliases.has(text) && (new RegExp(`^${domainWords}$`, "i").test(text)
    || /^(?:[INZWℤℕ]|\\mathbb\s*\{?[INZW]\}?)$/.test(text));
  const declared = (text: string): boolean => (text.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [])
    .filter(token => token.toLowerCase() !== "and").every(token => names.includes(token));
  const end = "(?=\\s|[.,;?!]|$)";
  const premiseHead = String.raw`(?:let|(?:given|assum(?:e|ing)|suppos(?:e|ing))(?:\s+that)?)`;
  const premisePrefix = new RegExp(String.raw`^\s*(?:(?:please\s+)?(?:${premiseHead}(?:\s+(?:the\s+)?(?:assumption|fact|condition)(?:\s+that)?)?|for|with|when|where)\s*)?$`, "i");
  const mathematicalAction = String.raw`(?:graph(?:ing)?|plot(?:ting)?|draw(?:ing)?|shade|shading|represent(?:ing)?|show(?:ing)?|illustrate|solve|solving|find(?:ing)?|determine|determining|calculate|calculating|compute|computing)`;
  const displayTextAction = String.raw`(?:label(?:l?ing)?|mark(?:ing)?|write|writing|annotate|annotating|caption(?:ing)?|omit|omitting)`;
  const domainRequestAction = String.raw`(?:${mathematicalAction}|explain(?:ing)?|teach|help|describe|discuss|demonstrate|walk|list|count|how\s+many)`;
  const action = String.raw`(?:${domainRequestAction}|consider(?:ing)?|state|stating|give|giving|report(?:ing)?|ask(?:ing)?|${premiseHead}|restrict|${displayTextAction})`;
  const actionHead = String.raw`(?:please\s+)?(?:(?:(?:do|does|did)\s+not|don['’]t|doesn['’]t|didn['’]t|never|not|without)\s+)?${action}\b`;
  const modalHead = String.raw`(?:should|can|could|may|might)\s+(?:[A-Za-z]+\s+){0,3}${action}\b`;
  const domainHead = `${list}\\s*(?:is\\b|are\\b|be\\b|in\\b|belongs?\\s+to\\b|∈|\\\\in\\b)`;
  // Scope recognition retains leading words; their roles are checked locally.
  // A later known head must not inherit the preceding object's qualification.
  const requestLead = String.raw`(?:[A-Za-z]+(?:['’][A-Za-z]+)?\s+)*?`;
  const governingHead = new RegExp(String.raw`^\s*${requestLead}(?=${actionHead}|${modalHead}|${domainHead})`, "i");
  const conjunction = String.raw`\b(?:and|then|but|yet|while|though|although|however|whereas)\b`;
  const displayObject = String.raw`(?:(?:solution\s+set|point|endpoint|boundary)\s+)?(?:labels?|captions?|annotations?|marks?|text)\b`;
  const displayModifier = String.raw`\b(?:without\s+(?=${action}\b)|without\s+(?:(?:a|an|any|the)\s+)?${displayObject}|with\s+no\s+${displayObject})`;
  const displayContentPrefix = new RegExp(String.raw`\b(?:${displayTextAction}\b|${displayObject}|(?:discuss|explain|describe)\s+(?:(?:the|this|that)\s+)?notation\b|(?:the|this|that)\s+(?:words|phrase)\b)`, "i");
  const displayContentSuffix = new RegExp(String.raw`\b(?:as|is|are|was|were)\s+(?:(?:a|an|the)\s+)?${displayObject}`, "i");
  const mathematicalRequestHead = new RegExp(String.raw`^\s*(?:please\s+)?(?:(?:should|can|could|may|might)\s+(?:[A-Za-z]+\s+){0,3})?${domainRequestAction}\b`, "i");
  const propositionObject = String.raw`(?:assertion|statement|claim|assumption|notation|proposition)`;
  const mentionedPropositionPrefix = new RegExp(String.raw`\b${propositionObject}(?:\s+(?:that|of|about|for|saying|showing))*\s*$`, "i");
  const mentionedPropositionSuffix = new RegExp(String.raw`^\s*[,:(]?\s*(?:as|is|are|was|were)\s+(?:(?:a|an|the)\s+)?(?:(?:false|invalid|incorrect|hypothetical|example\s+of(?:\s+(?:a|an|the))?)\s+)*${propositionObject}\b`, "i");
  const mentionedMathematicalObjectPrefix = /\b(?:hypothetical|illustrative|imaginary|counterfactual)\s+(?:(?:linear|number[ -]line|coordinate|integer|continuous|discrete)\s+)*(?:graphs?|plots?|figures?|diagrams?|examples?|regions?|(?:solution\s+)?sets?)\b/i;
  const mentionedMathematicalObjectSuffix = /^\s*[,:(]?\s*as\s+(?:(?:an?|the)\s+)?(?:hypothetical|illustrative|imaginary|counterfactual)\s+(?:example|graph|plot|figure|diagram)\b/i;
  const secondaryExamplePrefix = /^\s*(?:please\s+)?(?:discuss|explain|describe|consider|demonstrate|show)\s+(?:(?:me|us)\s+)?(?:an?|the|this|that|another)\s+example\s+(?:of\s+(?:(?:an?|the|this|that)\s+)?)?(?:graphs?|plots?|figures?|diagrams?|(?:solution\s+)?sets?)\b/i;
  // A noun can cite a subsidiary requested action rather than perform it:
  // discussing a claim to graph is different from explaining how to graph.
  const citedRequestComplement = new RegExp(String.raw`\b${propositionObject}\s+(?:to\s+|(?:that|of|about)\s+(?:[A-Za-z]+\s+)*?)(?:(?:not|never)\s+)?${mathematicalAction}\b`, "i");
  const nominalMathematicalHead = /^\s*(?:graphs?|plots?|figures?|diagrams?|regions?|(?:solution\s+)?sets?)\s+of\b/i;
  const frameAdjunctLead = /\b(?:in|for|at|on|during|after|before|under|within|throughout)\s+(?:[A-Za-z]+\s+)*[A-Za-z]+\s*$/i;
  const nominalDeterminerLead = /(?:^|\s)(?:an?|the|this|that|these|those|its|their)\s*$/i;
  const nominalHeadLead = new RegExp(String.raw`\b(?:${propositionObject}|examples?|quotations?)(?:\s+(?:of|to|about|for|that|an?|the))*\s*$`, "i");
  const deniedPropositionSuffix = /^\s*[,:(]?\s*(?:(?:is|are|was|were)\s+(?:false|invalid|incorrect|wrong|untrue)\b|without\s+(?:imposing|assuming|requiring|asserting)\b)/i;
  for (const match of question.matchAll(/(?:\.(?=\d)|[^.;?!])+[.;?!]?/g)) {
    const clause = match[0];
    // Scope ends only at an independently headed request/domain statement,
    // or a manner modifier governing a request action. Thus "but do not label"
    // and "with no labels" cannot negate the preceding type, whereas "is not
    // required" remains inside its domain predicate. Modifier boundaries are
    // zero width so the next instruction retains its head and negation.
    // Independent heads bound their own leading words, including unfamiliar
    // flow modifiers. Keep those words inside the new scope so negation,
    // hypothetical qualifications and cited/display roles remain visible.
    const boundaries = [...clause.matchAll(new RegExp(
      String.raw`(?:^\s*|[,;:]\s*(?:${conjunction}\s*)?|${conjunction}\s*)(?=${requestLead}(?:${actionHead}|${modalHead}|${domainHead}))|(?=${displayModifier})`, "gi"))];
    const affirmative = (assertion: RegExpMatchArray, predicate = false, object = false): boolean => {
      const start = assertion.index!, finish = start + assertion[0].length;
      const lower = boundaries.filter(boundary => boundary.index! + boundary[0].length <= start).at(-1);
      const upper = boundaries.find(boundary => boundary.index! >= finish);
      const prefix = clause.slice(lower ? lower.index! + lower[0].length : 0, start);
      const suffix = clause.slice(finish, upper?.index ?? clause.length);
      const lead = governingHead.exec(prefix + assertion[0])?.[0] ?? "";
      const ownedPrefix = prefix.slice(lead.length);
      const premise = premisePrefix.test(ownedPrefix);
      // Test the constituent governing the head, not every determiner in an
      // adjunct. A completed temporal/prepositional adjunct ("this time",
      // "in this case") leaves the following imperative or given intact.
      // A determiner or cited noun directly governing the head makes it a
      // nominal mention instead. Keep all original words for mood checks.
      const frameAdjunct = frameAdjunctLead.test(lead)
        && !/\b(?:of|to|about|for|that)\s*$/i.test(lead);
      if (!premisePrefix.test(prefix)
        && (nominalDeterminerLead.test(lead) || (nominalHeadLead.test(lead) && !frameAdjunct)
          || (lead.trim().length > 0 && nominalMathematicalHead.test(ownedPrefix)))) return false;
      // The independently headed scope does not erase its manner or mood.
      // Tentative/hypothetical instructions supply no affirmative type fact.
      if (/\b(?:hypothetically|illustratively|imaginarily|counterfactually|possibly|perhaps|maybe|potentially|conditionally)\b/i.test(prefix)
        || /\b(?:hypothetical|illustrative|imaginary|counterfactual)\b/i.test(lead)) return false;
      // A cited or denied proposition supplies no variable type. A genuine
      // given assumption has a different governing role from discussing one.
      if ((!premise && mentionedPropositionPrefix.test(prefix))
        || mentionedPropositionSuffix.test(suffix) || deniedPropositionSuffix.test(suffix)) return false;
      if (!new RegExp(String.raw`^\s*(?:please\s+)?${premiseHead}\b`, "i").test(ownedPrefix)
        && citedRequestComplement.test(ownedPrefix)) return false;
      // An explicitly hypothetical/illustrative mathematical object has its
      // own mentioned domain. It cannot type the variables of the governing
      // figure. This local prefix ends at independent request/domain heads,
      // so an actual given before or after that object keeps its authority.
      const mentionedObject = mentionedMathematicalObjectPrefix.exec(prefix);
      const positiveObjectMention = mentionedObject && !/\bnon(?:[-–—]\s*|\s+)$|\b(?:rather\s+than|instead\s+of)\s*$/i.test(prefix.slice(0, mentionedObject.index));
      if (!premise && (positiveObjectMention || mentionedMathematicalObjectSuffix.test(suffix))) return false;
      // An unqualified teaching example can itself be a discrete request.
      // Treat it as a secondary mentioned object only after a complete prior
      // continuous source program is proved. This reads a strictly shorter
      // prefix, without guessing a primary figure from nearby math spans.
      if (!premise && secondaryExamplePrefix.test(ownedPrefix)
        && readLinearBindingSource(question.slice(0, match.index! + (lower?.index ?? 0)), names, names.length === 1)) return false;
      // A domain phrase used as requested display content is an operand of
      // that instruction, never an independent declaration of variable type.
      const displayPrefix = object ? lead + ownedPrefix.replace(/^\s*(?:please\s+)?mark\s+(?:the\s+)?$/i, "") : prefix;
      if (displayContentPrefix.test(displayPrefix) || displayContentSuffix.test(suffix)) return false;
      // A quoted domain phrase is requested/reported text, not a type fact.
      if ([...clause.matchAll(/"[^"]*"|“[^”]*”|(?<![\p{L}\p{N}])'[^']*'/gu)]
        .some(quote => quote.index! <= start && quote.index! + quote[0].length >= finish)) return false;
      // Prove the governing context instead of promoting every domain-shaped
      // substring to a type. Unknown instructions supply no independent veto.
      if (!premise
        && !(/^restrict\b/i.test(assertion[0]) && /^\s*please\s*$/i.test(ownedPrefix))) {
        const head = mathematicalRequestHead.exec(ownedPrefix)
          ?? (object ? /^\s*(?:please\s+)?mark\b/i.exec(ownedPrefix)
            : new RegExp(String.raw`\b${mathematicalAction}\b`, "i").exec(prefix));
        if (!head) return false;
        if (object) {
          // A noun is a requested typed object only when its governing role
          // is proved; a comparison discussed elsewhere supplies no such role.
          try {
            let prose = normalize(ownedPrefix.slice(head.index + head[0].length));
            for (const operand of clauses(prose, names).reverse())
              prose = prose.slice(0, operand.start) + " ".repeat(operand.end - operand.start) + prose.slice(operand.end);
            consumeLinearRequest(prose, names);
          } catch { return false; }
        } else {
          const scope = prefix + assertion[0] + suffix;
          if (!/[<>=≤≥]/.test(scope) || !new RegExp(`(?<![A-Za-z_])${name}(?![A-Za-z0-9_])`).test(scope)) return false;
        }
        // The requested mathematical object can have a definite domain even
        // when its teaching prose is outside the whole-program reader grammar.
        // This proves only the local type, never a source figure or operands.
      }
      // A domain phrase can be negated or merely proposed after the match.
      // Read a continued predicate, not an unrelated display modifier such
      // as "without writing a caption" or "but do not label the set".
      const continuesDomain = /^\s*[,:(]?\s*(?:is|are|was|were|be|been|being|need|needs|do|does|did|must|will|would|should|can|could|may|might|not|no|never|if|unless|whether)\b/i.test(suffix);
      if (/\b(?:not|no|never|without|if|unless|whether)\b/i.test(prefix)
        || (continuesDomain && /\b(?:not|no|never|without|if|unless|whether|should|can|could|may|might)\b/i.test(suffix))
        || /\b(?:is|are|should|can|could|may|might)\s*$/i.test(prefix)) return false;
      const modal = /\b(?:should|can|could|may|might)\b/i.exec(prefix)?.[0].toLowerCase();
      if (modal) {
        const instruction = [...prefix.matchAll(/\b(?:graph|plot|draw|shade|represent|show|illustrate|let|given|restrict|state|give|report|find|determine|explain|ask)\b/gi)].at(-1)?.[0];
        // Asking whether to impose an assumption supplies no type fact. An
        // explicit graphical request still owns its supplied integer object.
        if (modal !== "can" || !instruction || !/^(?:graph|plot|draw|shade|represent|show|illustrate)$/i.test(instruction)) return false;
      }
      // Restrict is proved only as an imperative head, using the existing
      // optional polite request prefix. A modal subject or direct '?' asks
      // about choosing the restriction rather than independently stating it.
      if (/^restrict\b/i.test(assertion[0]) && (!/^\s*(?:please\s*)?$/i.test(ownedPrefix) || /^\s*\?/.test(suffix))) return false;
      // A bare type predicate followed by '?' asks about the domain. A type
      // attached to an explicit request/assumption remains a declaration:
      // "Can you graph ... for integer x?" still requests integer solutions.
      if (predicate && /\?/.test(suffix) && !/\b(?:let|given|for|over|with)\s*$/i.test(prefix)) return false;
      return true;
    };
    for (const [pattern, variableIndex, domainIndex, predicate] of [
      [new RegExp(`\\b(?:for|over|in|given|with)\\s+(${domain})\\s+(${list})${end}`, "gi"), 2, 1, false],
      [new RegExp(`\\b(${list})\\s*(?:∈\\s*|\\\\in\\s+|(?:is|are|be)\\s+(?:an?\\s+)?(?:in\\s+)?|in\\s+|(?:belongs?|belonging)\\s+to\\s+(?:the\\s+)?)(${domain})${end}`, "gi"), 1, 2, true],
      [new RegExp(`\\brestrict\\s+(${list})\\s+to\\s+(${domain})${end}`, "gi"), 1, 2, false],
    ] as const) for (const assertion of clause.matchAll(pattern))
      if (declared(assertion[variableIndex]!) && discrete(assertion[domainIndex]!) && affirmative(assertion, predicate)) return true;
    // These noun phrases name requested solutions/values/points rather than
    // a coefficient property or incidental discussion of integer arithmetic.
    // Bind their implicit variable only to math explicitly present in this
    // clause (or the named "values of x" object), never a nearby caption.
    for (const assertion of clause.matchAll(new RegExp(
      `\\b(${domainWords})(?:\\s+(?:solutions?|solution\\s+set|values?|points?))?(?:\\s+(?:of\\s+)?(${list}))?${end}`, "gi"))) {
      if (/^\s*coefficients?\b/i.test(clause.slice(assertion.index! + assertion[0].length))) continue;
      const prefix = clause.slice(0, assertion.index!);
      if (new RegExp(`\\b(?:is|are|be)\\s+(?:${list}\\s+)?(?:an?\\s+)?$`, "i").test(prefix)) continue;
      const variable = assertion[2];
      const mathematicalObject = /\b(?:solutions?|values?|points?|numbers?|integers)\b/i.test(assertion[0]) || variable !== undefined;
      const hasOperand = /[<>=≤≥]/.test(clause) && new RegExp(`(?<![A-Za-z_])${name}(?![A-Za-z0-9_])`).test(clause);
      if (mathematicalObject && (variable ? declared(variable) : hasOperand) && discrete(assertion[1]!) && affirmative(assertion, false, true)) return true;
    }
    // A postfix symbolic domain binds an explicitly quoted mathematical
    // comparison in the same clause, rather than any nearby prose noun.
    if (/[<>=]/.test(clause) && new RegExp(`(?<![A-Za-z_])${name}(?![A-Za-z0-9_])`).test(clause))
      for (const assertion of clause.matchAll(new RegExp(`\\b(?:in|over)\\s+(${domain})${end}`, "gi"))) {
        // An explicit variable predicate already has its own governing role.
        // Do not retry a cited "x in Z" as an unqualified postfix domain.
        if (new RegExp(`\\b${list}\\s*$`).test(clause.slice(0, assertion.index!))) continue;
        if (discrete(assertion[1]!) && affirmative(assertion)) return true;
      }
  }
  return false;
}

export function validateLinearSourceBinding(document: SceneDocument): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const [constructionIndex, construction] of document.constructions.entries()) {
    if (!(LINEAR_REGION_OPERATORS as readonly string[]).includes(construction.operator)) continue;
    try {
      const question = document.source.question;
      if (typeof question !== "string" || question.length > 8192)
        throw new Error("Linear figures require bounded original question text");
      const geometry = evaluateLinearRegionConstruction(construction.operator, construction.inputs)[0]!;
      const input = geometry.input;
      const names = input.kind === "number_line_set" ? [input.variable ?? "x"] : input.variables ?? ["x", "y"];
      // These are independent contradictions, not request-parser failures.
      if (input.kind !== "number_line_set" && names.includes("x") && names.includes("y") && (names[0] !== "x" || names[1] !== "y"))
        throw new Error("Source x/y coordinates require canonical axis order ['x','y'] for boundary, corner and solution tuples");
      if (geometry.solution.kind !== "number_line_set") {
        const rows = geometry.solution.kind === "linear_system" ? geometry.solution.equations : geometry.solution.constraints;
        for (const free of question.matchAll(/\bno\s+constraint\s+on\s+([xy])\s*(?=[.;?!]|$)/gi)) {
          const coefficient = free[1]!.toLowerCase() === "x" ? "a" : "b";
          if (rows.some(row => row[coefficient].numerator !== "0")) throw new Error("An original free-coordinate declaration contradicts a source constraint");
        }
      }
      if (input.kind === "linear_system") {
        // Independently quoted tuples and a genuine explicit intersection name
        // can contradict the candidate even when surrounding prose is unknown.
        let points: ReturnType<typeof readLinearSourceReferencePoints>["points"] = [];
        try { points = readLinearSourceReferencePoints(question, names).points; } catch { /* No complete literal tuple proof. */ }
        const intersectionNames = readLinearSourceIntersectionNames(question);
        const givens = points.filter(point => intersectionNames.has(point.label));
        const solution = geometry.solution;
        if (givens.length && (solution.kind !== "linear_system" || solution.relation !== "unique" || !solution.intersection
          || givens.some(point => !same(point.x, solution.intersection!.x) || !same(point.y, solution.intersection!.y))))
          throw new Error("An original named intersection tuple contradicts the complete source system");
      }
      const authority = readLinearBindingSource(question, names, input.kind === "number_line_set");
      if (hasAffirmativeDiscreteDomain(question, names, authority?.aliases))
        throw new Error("Continuous linear figures contradict an explicit discrete source domain");
      if (!authority) continue;
      const ownedOutputs = new Set(document.constructions
        .filter(item => (LINEAR_REGION_OPERATORS as readonly string[]).includes(item.operator))
        .flatMap(item => item.outputs));
      if (document.requiredEntityIds.some(id => !ownedOutputs.has(id) && document.entities.find(entity => entity.id === id)?.kind !== "group"))
        throw new Error("A complete native linear source requires every diagram mark to belong to its verified linear operators");
      if (input.kind === "linear_feasible_region") {
        if (Boolean(authority.objective) !== Boolean(input.objective)) throw new Error("Candidate and complete source objective presence differ");
        if (authority.objective && input.objective && (authority.objective.sense !== input.objective.sense
          || !same(parseLinearAffine(authority.objective.expression, names), parseLinearAffine(input.objective.expression, names))))
          throw new Error("Candidate objective contradicts the complete original source objective");
      } else if (authority.objective) throw new Error("Candidate omits the complete original source objective");
      if (input.kind === "number_line_set") {
        if (!same(signatures(inequalityLeaves(authority.program), names), signatures(inequalityLeaves(input.expression), names)))
          throw new Error("Candidate constraints contradict the complete original number-line source");
        const sourceSolution = solveLinearFigure({ kind: "number_line_set", variable: names[0], expression: authority.program });
        if (sourceSolution.kind !== "number_line_set" || geometry.solution.kind !== "number_line_set" || !same(sourceSolution.intervals, geometry.solution.intervals))
          throw new Error("Candidate Boolean solution contradicts the complete original number-line source");
      } else {
        const proposed = input.kind === "linear_half_plane" ? [input.inequality] : input.kind === "linear_system" ? input.equations : input.constraints;
        if (!isIntersectionProgram(authority.program)) {
          const predicates = planarPredicates(authority.program);
          if (predicates && !same(signatures(predicates, names), signatures(proposed, names)))
            throw new Error("Candidate predicates contradict exact original source boundaries or their Boolean polarity");
          if (planarBooleanAgreement(authority.program, proposed, names) === false)
            throw new Error("An exact feasible witness proves the candidate contradicts the original source Boolean region");
          continue;
        }
        const source = authority.source;
        if (input.kind === "linear_half_plane" && (source.length !== 1 || source[0]!.equality))
          throw new Error("Half-plane contradicts the complete source comparison count or kind");
        if (input.kind === "linear_system" && (source.length !== 2 || source.some(clause => !clause.equality)))
          throw new Error("System contradicts the complete source comparison count or kind");
        if (!same(signatures(source.map(clause => clause.text), names, input.kind === "linear_system"), signatures(proposed, names, input.kind === "linear_system")))
          throw new Error("Candidate linear constraints contradict the complete original source program");
      }
    } catch (error) {
      issues.push({ code: "linear_source_mismatch", message: error instanceof Error ? error.message : "Invalid linear candidate",
        severity: "fatal", path: `constructions[${constructionIndex}]`, entityIds: construction.outputs });
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
