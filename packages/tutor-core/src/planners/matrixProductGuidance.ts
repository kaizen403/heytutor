import { readMatrixProductSourceProgram } from "@heytutor/scene-engine";

function exactText(entry: { numerator: string; denominator: string }): string {
  return entry.denominator === "1" ? entry.numerator : `${entry.numerator}/${entry.denominator}`;
}

function factor(value: string): string {
  return value.startsWith("-") || value.includes("/") ? `(${value})` : value;
}

/** Prompt-only source guidance. It does not produce or replace a returned plan or IR. */
export function matrixProductPlanningGuidance(question: string): string {
  const source = readMatrixProductSourceProgram(question);
  if (!source) return "";

  const givens = source.matrices.flatMap((matrix) => matrix.entries.flatMap((row, i) => row.map((_, j) => ({
    id: `${matrix.name}${i + 1}${j + 1}`,
    symbol: `${matrix.name}${i + 1}${j + 1}`,
    value: matrix.geometry.matrixArray.entries[i]![j]!,
    sourceText: matrix.quote,
  }))));
  const derived = source.products.flatMap((product) => {
    const left = source.matrices.find((matrix) => matrix.name === product.left)!;
    const right = source.matrices.find((matrix) => matrix.name === product.right)!;
    return product.geometry.matrixArray.exactEntries.flatMap((row, i) => row.map((entry, j) => {
      const id = `${product.name}${i + 1}${j + 1}`;
      const dependsOn = [...new Set([
        ...left.entries[i]!.map((_, k) => `${product.left}${i + 1}${k + 1}`),
        ...right.entries.map((_, k) => `${product.right}${k + 1}${j + 1}`),
      ])];
      const dot = left.entries[i]!.map((value, k) => `${factor(value)}*${factor(right.entries[k]![j]!)}`).join("+");
      return {
        id,
        symbol: id,
        value: product.geometry.matrixArray.entries[i]![j]!,
        sourceText: `${dot}=${exactText(entry)}`,
        provenance: "derived" as const,
        dependsOn,
      };
    }));
  });
  const unknowns = source.products.map((product) => ({ id: product.name, symbol: product.name, unit: "1" }));
  const sourceData = {
    matrices: source.matrices.map((matrix) => ({
      name: matrix.name,
      sourceQuote: matrix.quote,
      exactEntries: matrix.geometry.matrixArray.exactEntries,
      inputCellIds: matrix.entries.flatMap((row, i) => row.map((_, j) => `${matrix.name}${i + 1}${j + 1}`)),
    })),
    orderedProducts: source.products.map((product) => ({
      name: product.name,
      left: product.left,
      right: product.right,
      exactEntries: product.geometry.matrixArray.exactEntries,
    })),
    turnPlan: {
      question,
      givens,
      unknowns,
      derived,
      qualitativeClaims: [],
      lawIds: [],
      assumptions: [],
      visualRequirement: "optional",
    },
  };

  return `
BOUNDED MATRIX PRODUCT SOURCE GUIDANCE
${JSON.stringify(sourceData)}

Use the complete source data above for this turn. Keep question byte-for-byte unchanged. Include every source numeric input cell as a given with its exact ID and symbol (A11, A12, …), exact source value, and the supplied whole-literal sourceText. Include every cell of every ordered requested product as a derived quantity with the supplied ID, independently computed value, and the complete unique row/column input dependencies. Keep every ordered product as an unknown using its name for both ID and symbol and unit "1" (or omit the unit). Do not replace a matrix with a scalar zero or omit any source cell or product cell. Do not round source fractions before computing.
For the original ProblemIR, retain exactly one kind "given" fact per complete matrix literal, with evidence.quote equal to the supplied sourceQuote and its statement made by changing that quote's assignment separator to "is" (for example, sourceQuote "A = [[1, 2]]" becomes statement "Matrix A is [[1, 2]]"). Retain exactly one kind "requested" fact for each ordered product, with statement and evidence.quote each taken from that individual product ask verbatim in the unchanged QUESTION. For combined wording, use a product-specific exact substring for each fact (for example, "Compute AB" and "Compute BA"), not the whole sentence as evidence for both. Add one entity per source matrix with kind "other", label equal to its exact source name, and evidenceFactIds containing its matching given fact ID. Keep expressions, constraints, representationIntents, and solveRequests empty for this initial product-only contract. Preserve every additional source ask in the original IR; this guidance does not authorize dropping it. The complete original IR and returned TurnPlan remain independently audited; this guidance never substitutes either one or any solver result.
A nonmetric table is an optional visual representation. Do not add geometric measurements or inferred facts.
`;
}
