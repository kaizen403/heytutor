import { readFileSync } from "node:fs";
import { compactSceneExampleDocument } from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

export interface DiagramExemplar {
  id: string;
  sourceKind: "curated" | "synthesized";
  question: string | null;
  depicts: string;
  figureKind: string | null;
  family: string | null;
  archetype: string | null;
  document: Record<string, unknown>;
}

export interface DiagramExampleQuery {
  question: string;
  families: readonly string[];
  archetypeId: string | null;
  plan?: TurnPlanV3 | null;
  limit?: number;
}

export interface DiagramExampleCatalogueEntry {
  id: string;
  figureKind: string;
  depicts: string;
}

export interface DiagramExampleCatalogue {
  entries: DiagramExampleCatalogueEntry[];
  text: string;
  /** Conservative approximation used to keep the cheap-model prompt bounded. */
  estimatedTokens: number;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "draw", "find", "for", "from", "in", "is", "of", "on",
  "show", "sketch", "the", "to", "using", "with",
]);

const MIN_LEXICAL_RETRIEVAL_SCORE = 100;
const MAX_CATALOGUE_TOKENS = 6_000;

const FIGURE_KIND_GROUPS: Record<string, readonly string[]> = {
  apparatus: [
    "faraday_induction", "magnetic_susceptibility", "motional_emf_rod", "photoelectric",
    "screw_gauge", "velocity_selector", "vernier_calliper", "chem_electrochem",
  ],
  chart_table: ["chem_orbital", "chem_periodic"],
  circuit: [
    "capacitor_network", "circuit_network", "inductance_coils", "logic_gates", "meter_bridge",
    "potentiometer", "resistor_network", "two_loop_network", "wheatstone_bridge",
  ],
  energy_diagram: ["binding_energy_curve", "bohr_transition", "chem_cft", "chem_mo", "energy_level", "shm_energy"],
  field_lines: [
    "bar_magnet", "dipole_in_field", "parallel_plates", "parallel_wires", "point_field",
    "solenoid_field", "straight_wire_field", "two_point_charges",
  ],
  function_plot: [
    "analytic_curve", "area_between_curves", "bounded_region", "chem_kinetics", "chem_solutions",
    "chem_thermo", "cooling_curve", "function_graph", "fx_graph_area", "radioactive_decay",
    "state_plot", "uniform_acceleration_vt", "vt_graph", "xt_graph",
  ],
  geometry: ["conic", "coordinate_figure", "ladder_wall", "space_lines", "space_point_plane"],
  molecule: ["chem_coordination", "chem_lewis", "chem_organic", "chem_vsepr"],
  motion_path: [
    "charge_in_magnetic_field", "collision_line", "free_fall", "projectile", "relative_motion_line",
    "revolving_charge", "river_boat", "satellite_orbit", "simple_pendulum", "spring_mass", "vertical_circle",
  ],
  ray_optics: ["compound_microscope", "lens_maker", "spherical_mirror", "spherical_refraction", "thin_lens"],
  solid_3d: ["chem_unit_cell"],
  vectors_fbd: [
    "atwood", "banked_road", "bar_magnet_in_field", "blocks_contact", "centre_of_mass",
    "circular_motion_level", "conical_pendulum", "contact_body", "current_loop_torque",
    "force_on_conductor", "hinged_rod", "incline_body", "lift_body", "vectors_resultant", "vector_diagram",
  ],
  wave: ["double_slit", "shm_superposition", "standing_wave", "wave_profile", "wave_types"],
};

const FIGURE_KIND_BY_GROUP = new Map(
  Object.entries(FIGURE_KIND_GROUPS).flatMap(([figureKind, groups]) =>
    groups.map((group) => [group, figureKind] as const)),
);

const GROUP_PLAIN_NAMES: Record<string, string> = {
  chem_cft: "crystal field theory orbital energy splitting diagram",
  chem_coordination: "coordination complex molecular structure",
  chem_electrochem: "electrochemical cell electrodes and salt bridge apparatus",
  chem_kinetics: "chemical kinetics reaction rate and activation energy graph",
  chem_lewis: "Lewis electron dot ionic and covalent bonding structure",
  chem_mo: "molecular orbital theory energy level diagram",
  chem_orbital: "atomic orbital electron configuration and filling diagram",
  chem_organic: "organic molecule structure and reaction scheme",
  chem_periodic: "periodic trend chart or table",
  chem_solutions: "solution concentration and vapour pressure graph",
  chem_thermo: "chemical thermodynamics energy or state graph",
  chem_unit_cell: "crystal unit cell solid three dimensional structure",
  chem_vsepr: "VSEPR molecular geometry bond shape",
  fx_graph_area: "function graph with area under the curve",
  shm_energy: "simple harmonic motion energy graph",
  shm_superposition: "simple harmonic motion superposition graph",
  vt_graph: "velocity time graph",
  xt_graph: "position time graph",
};

/** Stable scoring taxonomy; evaluation labels never enter runtime retrieval. */
export function figureKindForDiagramGroup(family: string | null, archetype: string | null): string | null {
  return FIGURE_KIND_BY_GROUP.get(archetype ?? "") ?? FIGURE_KIND_BY_GROUP.get(family ?? "") ?? null;
}

function stemToken(token: string): string {
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}

export function diagramQuestionTokens(question: string): string[] {
  return [...new Set(
    (question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .map(stemToken)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
  )];
}

export function diagramQuestionsNearDuplicate(left: string, right: string): boolean {
  const normalized = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (normalized(left) === normalized(right)) return true;
  const leftTokens = new Set(diagramQuestionTokens(left));
  const rightTokens = new Set(diagramQuestionTokens(right));
  if (Math.min(leftTokens.size, rightTokens.size) < 3) return false;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const containment = intersection / Math.min(leftTokens.size, rightTokens.size);
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return containment >= 0.8 && intersection / union >= 0.65;
}

function firstWords(value: string, count: number): string {
  return value.trim().split(/\s+/).filter(Boolean).slice(0, count).join(" ");
}

/** Compact semantic index sent to the cheap picker; source questions never enter it. */
export function buildDiagramExampleCatalogue(
  exemplars: readonly DiagramExemplar[],
): DiagramExampleCatalogue {
  const entries: DiagramExampleCatalogueEntry[] = [];
  const ordered = [...exemplars].sort((left, right) =>
    Number(right.sourceKind === "curated") - Number(left.sourceKind === "curated") ||
    left.id.localeCompare(right.id));
  for (const exemplar of ordered) {
    if (!exemplar.figureKind) continue;
    const candidate = {
      id: exemplar.id,
      figureKind: exemplar.figureKind,
      // Sixteen leaves room for long stable ids while remaining below the
      // brief's twenty-word ceiling and approximate 6k-token catalogue cap.
      depicts: firstWords(exemplar.depicts, 16),
    };
    const duplicate = entries.some((entry) =>
      entry.figureKind === candidate.figureKind &&
      diagramQuestionsNearDuplicate(entry.depicts, candidate.depicts));
    if (!duplicate) entries.push(candidate);
  }
  entries.sort((left, right) => left.id.localeCompare(right.id));
  const text = entries
    .map((entry) => `${entry.id} | ${entry.figureKind} | ${entry.depicts}`)
    .join("\n");
  const estimatedTokens = Math.ceil(text.length / 4);
  if (estimatedTokens >= MAX_CATALOGUE_TOKENS) {
    throw new Error(`diagram example catalogue is ${estimatedTokens} estimated tokens; expected under ${MAX_CATALOGUE_TOKENS}`);
  }
  return { entries, text, estimatedTokens };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plainWords(value: string): string {
  return (GROUP_PLAIN_NAMES[value] ?? value.replaceAll("_", " ")).replace(/\s+/g, " ").trim();
}

function uniqueText(values: readonly string[], limit: number): string[] {
  return [...new Set(values.map((value) => plainWords(value)).filter(Boolean))].slice(0, limit);
}

/** A source-independent description of what a verified document actually draws. */
export function buildDiagramExemplarDepicts(
  document: Record<string, unknown>,
  family: string | null,
  archetype: string | null,
): string {
  const entities = Array.isArray(document.entities) ? document.entities.filter(isRecord) : [];
  const entityById = new Map(entities.flatMap((entity) =>
    typeof entity.id === "string" ? [[entity.id, entity] as const] : []));
  const entityKinds = uniqueText(entities.flatMap((entity) => [
    typeof entity.kind === "string" ? entity.kind : "",
    typeof entity.role === "string" && entity.role !== "construction helper" ? entity.role : "",
  ]), 18);
  const labels = uniqueText([
    ...entities.flatMap((entity) => typeof entity.label === "string" ? [entity.label] : []),
    ...(Array.isArray(document.constructions) ? document.constructions.filter(isRecord).flatMap((construction) => {
      const inputs = isRecord(construction.inputs) ? construction.inputs : null;
      return inputs && typeof inputs.text === "string" ? [inputs.text] : [];
    }) : []),
  ], 18);
  const operators = uniqueText(
    Array.isArray(document.constructions) ? document.constructions.filter(isRecord).flatMap((construction) =>
      typeof construction.operator === "string" && construction.operator !== "point"
        ? [construction.operator]
        : []) : [],
    12,
  );
  const relations = uniqueText(
    Array.isArray(document.relations) ? document.relations.filter(isRecord).flatMap((relation) => {
      const relationName = [relation.predicate, relation.kind, relation.type]
        .find((value): value is string => typeof value === "string");
      const ids = [relation.entities, relation.entityIds, relation.between]
        .find((value): value is unknown[] => Array.isArray(value)) ?? [];
      const related = ids.flatMap((id) => {
        if (typeof id !== "string") return [];
        const entity = entityById.get(id);
        if (!entity) return [];
        const description = typeof entity.role === "string" ? entity.role : entity.kind;
        return typeof description === "string" ? [description] : [];
      });
      return relationName ? [`${relationName} ${related.join(" ")}`] : related;
    }) : [],
    12,
  );
  const heading = plainWords(archetype ?? family ?? "verified figure");
  return [
    heading,
    operators.length > 0 ? `construction: ${operators.join(", ")}` : "",
    entityKinds.length > 0 ? `entities: ${entityKinds.join(", ")}` : "",
    relations.length > 0 ? `relations: ${relations.join(", ")}` : "",
    labels.length > 0 ? `labels: ${labels.join(", ")}` : "",
  ].filter(Boolean).join("; ");
}

export function filterDiagramExemplarsForEvaluation(
  exemplars: readonly DiagramExemplar[],
  evaluationQuestions: readonly string[],
): DiagramExemplar[] {
  return exemplars.filter((exemplar) =>
    exemplar.question === null ||
    !evaluationQuestions.some((question) => diagramQuestionsNearDuplicate(exemplar.question!, question)));
}

export function diagramPlanRetrievalText(plan: TurnPlanV3 | null | undefined): string {
  if (!plan) return "";
  const quantities = [...plan.givens, ...plan.unknowns, ...plan.derived].flatMap((quantity) => [
    quantity.id,
    quantity.symbol,
    quantity.unit ?? "",
    "sourceText" in quantity ? quantity.sourceText ?? "" : "",
  ]);
  const claims = plan.qualitativeClaims.flatMap((claim) => [
    claim.claim,
    String(claim.expected),
    ...(claim.relatedEntityHints ?? []),
  ]);
  return [
    ...plan.lawIds,
    ...quantities,
    ...claims,
    `visual ${plan.visualRequirement}`,
  ].filter(Boolean).join(" ");
}

export function retrieveDiagramExemplars(
  exemplars: readonly DiagramExemplar[],
  query: DiagramExampleQuery,
): DiagramExemplar[] {
  const planTokens = new Set(diagramQuestionTokens(diagramPlanRetrievalText(query.plan)));
  const queryTokens = new Set(diagramQuestionTokens(
    `${query.question} ${diagramPlanRetrievalText(query.plan)}`,
  ));
  const familyHints = new Set(query.families);
  const scored = exemplars.map((exemplar) => {
    const searchable = `${exemplar.depicts} ${exemplar.sourceKind === "curated" ? exemplar.question ?? "" : ""}`;
    const tokens = new Set(diagramQuestionTokens(searchable));
    const intersection = [...tokens].filter((token) => queryTokens.has(token)).length;
    const planIntersection = [...tokens].filter((token) => planTokens.has(token)).length;
    const union = new Set([...tokens, ...queryTokens]).size;
    const lexical = intersection * 20 + (union > 0 ? intersection / union * 100 : 0);
    const family = exemplar.family && familyHints.has(exemplar.family) ? 50 : 0;
    const archetype = exemplar.archetype && exemplar.archetype === query.archetypeId ? 40 : 0;
    const promptChars = JSON.stringify(compactSceneExampleDocument(exemplar.document)).length;
    return {
      exemplar,
      score: lexical + family + archetype,
      strong:
        lexical >= MIN_LEXICAL_RETRIEVAL_SCORE ||
        planIntersection >= 2 ||
        family > 0 ||
        archetype > 0,
      promptChars,
    };
  });
  const ordered = scored.filter((entry) => entry.strong).sort((left, right) =>
    right.score - left.score || left.promptChars - right.promptChars || left.exemplar.id.localeCompare(right.exemplar.id));
  const promptable = ordered.filter((entry) => entry.promptChars <= 4_000);
  const oversized = ordered.filter((entry) => entry.promptChars > 4_000);
  return [...promptable, ...oversized]
    .slice(0, query.limit ?? 3)
    .map(({ exemplar }) => exemplar);
}

export function loadDiagramExemplarLibrary(
  path: string,
  evaluationQuestions: readonly string[],
): DiagramExemplar[] {
  const exemplars = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith("#"))
    .map((line, index) => {
      const value = JSON.parse(line) as Partial<DiagramExemplar>;
      if (
        typeof value.id !== "string" ||
        !(typeof value.question === "string" || value.question === null) ||
        typeof value.document !== "object" ||
        value.document === null ||
        Array.isArray(value.document)
      ) {
        throw new Error(`diagram exemplar line ${index + 1} is invalid`);
      }
      const sourceKind = value.sourceKind === "curated" || value.sourceKind === "synthesized"
        ? value.sourceKind
        : value.id.startsWith("curated:") ? "curated" : "synthesized";
      const family = typeof value.family === "string" ? value.family : null;
      const archetype = typeof value.archetype === "string" ? value.archetype : null;
      return {
        id: value.id,
        sourceKind,
        question: sourceKind === "curated" ? value.question : null,
        depicts: typeof value.depicts === "string" && value.depicts.trim()
          ? value.depicts
          : buildDiagramExemplarDepicts(value.document as Record<string, unknown>, family, archetype),
        figureKind: typeof value.figureKind === "string" ? value.figureKind : null,
        family,
        archetype,
        document: value.document as Record<string, unknown>,
      };
    });
  return filterDiagramExemplarsForEvaluation(exemplars, evaluationQuestions);
}
