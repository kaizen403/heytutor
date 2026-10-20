/**
 * Circuit floor: the components the question names, joined the way it says
 * (a series loop, or loads across one source), each with its stated value as
 * written. No current arrows, no polarity beyond the source glyph, no solved
 * voltage or current. An unrecognised part (switch, diode, transistor, meter
 * bridge) or an unstated topology declines the whole circuit: dropping or
 * guessing a stated part is how a fallback circuit becomes wrong.
 */
import type { FloorFacts, FloorObject, FloorStatedValue } from "../facts";
import type { FloorKindBuild } from "./index";
import {
  appendLabel, emptyParts, floorDocument, floorEntity, obligatedObjects, point, problemLabel, unitDimension, valueLabel,
} from "./shared";

type Glyph = "battery" | "ac_source" | "resistor" | "capacitor" | "inductor" | "lamp" | "ammeter" | "voltmeter" | "galvanometer";

const VALUE_DIMENSION: Partial<Record<Glyph, ReturnType<typeof unitDimension>>> = {
  battery: "voltage", ac_source: "voltage", resistor: "resistance", capacitor: "capacitance", inductor: "inductance",
};

const SOURCE: ReadonlySet<Glyph> = new Set(["battery", "ac_source"]);

/** The glyph a component's own source name asks for; null when the name is not a part the floor can draw. */
function glyphFor(object: FloorObject, label: string | null): Glyph | null {
  const text = `${label ?? ""} ${object.id}`.toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(?:switch|key|diode|transistor|bridge|potentiometer|jockey|rheostat|motor|generator|transformer|led)\b/.test(text)) return null;
  if (/\b(?:ammeter)\b/.test(text)) return "ammeter";
  if (/\b(?:voltmeter)\b/.test(text)) return "voltmeter";
  if (/\b(?:galvanometer)\b/.test(text)) return "galvanometer";
  if (/\b(?:a\.?c\.?|alternating)\b/.test(text) && /\b(?:source|supply|voltage|emf)\b/.test(text)) return "ac_source";
  if (/\b(?:battery|cell|supply|emf|source)\b/.test(text)) return "battery";
  if (/\b(?:resistor|resistance)\b/.test(text) || /^\s*r\s*\d*\b/.test(text)) return "resistor";
  if (/\bcapacitor\b/.test(text) || /^\s*c\s*\d*\b/.test(text)) return "capacitor";
  if (/\b(?:inductor|coil|inductance)\b/.test(text) || /^\s*l\s*\d*\b/.test(text)) return "inductor";
  if (/\b(?:lamp|bulb)\b/.test(text)) return "lamp";
  return null;
}

type Arrangement = "series" | "parallel" | { series: Part[]; parallel: Part[] };

interface Part {
  id: string;
  glyph: Glyph;
  /** Obligated source name, or null. */
  name: string | null;
  value: FloorStatedValue | null;
}

/** Stated topology words: "in series", "in parallel". Both, or neither with three or more parts, declines. */
function statedTopology(question: string): "series" | "parallel" | "both" | null {
  const text = question.toLowerCase();
  const series = /\b(?:in\s+series|series\s+(?:circuit|combination|connection|rl|rc|lcr|lc|rlc)|series\b)/.test(text);
  const parallel = /\b(?:in\s+parallel|parallel\s+(?:circuit|combination|connection|branch(?:es)?))/.test(text);
  if (series && parallel) return "both";
  return series ? "series" : parallel ? "parallel" : null;
}

/** Give each part the stated value written in its own name or evidence, else the one unambiguous value of its dimension. */
function assignValues(parts: Part[], objects: Map<string, FloorObject>, facts: FloorFacts): void {
  const free = new Set(facts.values.map((value) => value.quantityId));
  const take = (value: FloorStatedValue, part: Part) => { part.value = value; free.delete(value.quantityId); };
  for (const part of parts) {
    const dimension = VALUE_DIMENSION[part.glyph];
    if (!dimension) continue;
    const object = objects.get(part.id);
    const evidence = [part.name ?? "", ...(object?.quotes ?? [])].join(" | ");
    const own = facts.values.find((value) => free.has(value.quantityId) && unitDimension(value.unit) === dimension &&
      evidence.includes(value.valueText));
    if (own) take(own, part);
  }
  for (const glyph of new Set(parts.map((part) => part.glyph))) {
    const dimension = VALUE_DIMENSION[glyph];
    if (!dimension) continue;
    const waiting = parts.filter((part) => part.glyph === glyph && !part.value);
    const candidates = facts.values.filter((value) => free.has(value.quantityId) && unitDimension(value.unit) === dimension);
    if (waiting.length === 1 && candidates.length === 1 && parts.filter((part) => part.glyph === glyph).length === 1) {
      take(candidates[0]!, waiting[0]!);
    }
  }
}

export function buildCircuitFloor(facts: FloorFacts): FloorKindBuild | { declined: string } | null {
  const objects = new Map(facts.objects.map((object) => [object.id, object]));
  const intentIds = new Set(facts.intents.filter((intent) => intent.kind === "network" || intent.kind === "apparatus")
    .flatMap((intent) => intent.entityIds));
  const components = facts.objects.filter((object) => object.kind === "component" && (intentIds.size === 0 || intentIds.has(object.id)));
  if (components.length === 0) {
    if (facts.problem) return null;
    const inventory = inventoryWithoutProblem(facts);
    if (!inventory || "declined" in inventory) return inventory;
    return layOutCircuit(facts, inventory.parts, new Map());
  }
  const parts: Part[] = [];
  for (const object of components) {
    const label = problemLabel(facts, object.id);
    const glyph = glyphFor(object, label);
    if (!glyph) return { declined: `component ${object.id} is not a part the floor can draw` };
    if (label && !object.name) return { declined: `component ${object.id} carries a name the question does not use` };
    parts.push({ id: object.id, glyph, name: object.name, value: null });
  }
  return layOutCircuit(facts, parts, objects);
}

/**
 * Lay out a stated inventory. With a ProblemIR every obligated object must
 * find its place; without one (plan or concept inventory) the parts are the
 * whole of what is stated.
 */
function layOutCircuit(
  facts: FloorFacts,
  parts: Part[],
  objects: Map<string, FloorObject>,
): FloorKindBuild | { declined: string } {
  // Every other obligated object must be drawable too. The one point role the
  // floor places is the junction between two series loads ("the midpoint");
  // any other stated point it cannot place declines the figure.
  const unplaced = obligatedObjects(facts).filter((object) => !parts.some((part) => part.id === object.id));
  const junction = unplaced.length === 1 && unplaced[0]!.kind === "point" && unplaced[0]!.name &&
    /\b(?:mid ?point|junction)\b/i.test(unplaced[0]!.name) ? unplaced[0]! : null;
  if (unplaced.length > 0 && !junction) return { declined: `obligated ${unplaced.map((object) => object.id).join(", ")} has no stated place` };
  // A meter stated across one component (a ProblemIR "parallel" relation of
  // exactly that pair) is drawn across that component's own terminals; any
  // other relation the floor does not draw declines.
  const across = new Map<string, string>();
  for (const constraint of facts.constraints) {
    if (constraint.kind === "connected" || constraint.kind === "equation" || constraint.kind === "inequality") continue;
    const pair = constraint.kind === "parallel" ? constraint.entityIds : [];
    const meter = parts.find((part) => pair.includes(part.id) && (part.glyph === "voltmeter" || part.glyph === "galvanometer"));
    const partner = parts.find((part) => pair.includes(part.id) && part !== meter);
    if (pair.length !== 2 || !meter || !partner || across.has(meter.id) || SOURCE.has(partner.glyph)) {
      return { declined: "the circuit states a relation the floor does not draw" };
    }
    across.set(meter.id, partner.id);
  }
  if (parts.some((part) => part.glyph === "voltmeter" && !across.has(part.id))) {
    return { declined: "a voltmeter needs the component it is stated across" };
  }
  const sources = parts.filter((part) => SOURCE.has(part.glyph));
  const loads = parts.filter((part) => !SOURCE.has(part.glyph) && !across.has(part.id));
  if (sources.length > 1) return { declined: "more than one source" };
  if (loads.length === 0 || loads.length > 4) return { declined: "no load, or more loads than the floor lays out" };
  const topology = statedTopology(facts.question);
  assignValues(parts, objects, facts);
  // "First in series and then in parallel": both stated arrangements, one panel each.
  const sequence = facts.question.match(/\bfirst\b[^.?]*?\b(series|parallel)\b[^.?]*?\bthen\b[^.?]*?\b(series|parallel)\b/i);
  // "R in series with a parallel pair of P and Q": the parts the question names after the phrase form the parallel group.
  const groupPhrase = /\bin series with (?:a |the )?parallel (?:pair|combination|arrangement|group|set)\b/i.exec(facts.question);
  let layouts: Arrangement[];
  if (sequence && sequence[1]!.toLowerCase() !== sequence[2]!.toLowerCase()) {
    if (across.size > 0 || junction) return { declined: "meters and junctions are not drawn in two arrangements" };
    layouts = [sequence[1]!.toLowerCase() as "series" | "parallel", sequence[2]!.toLowerCase() as "series" | "parallel"];
  } else if (groupPhrase && !sequence) {
    const after = loads.filter((load) => load.value && load.value.sourceIndex > groupPhrase.index);
    const before = loads.filter((load) => !after.includes(load));
    if (after.length !== 2 || before.length !== 1 || loads.some((load) => !load.value) || across.size > 0 || junction) {
      return { declined: "the series and parallel parts are not each stated by value" };
    }
    layouts = [{ series: before, parallel: after }];
  } else {
    if (topology === "both") return { declined: "a series and parallel combination needs stated connections" };
    const layout = topology ?? (loads.length === 1 ? "series" : null);
    if (!layout) return { declined: "the question does not state how the parts are joined" };
    layouts = [layout];
  }
  if (layouts.some((layout) => layout === "parallel") && loads.length < 2) return { declined: "parallel needs two or more loads" };
  if (junction && !(layouts.length === 1 && layouts[0] === "series" && loads.length === 2)) return { declined: "a junction is placed only between two series loads" };

  const built = emptyParts();
  const names: string[] = [];
  const height = 2.4;
  const span = 1.8;
  const nodes: string[] = [];
  const addNode = (id: string, x: number, y: number) => {
    built.entities.push(floorEntity(id, "point", "circuit node", null, { stated: "terminal of a stated component" }));
    built.constructions.push(point(id, x, y));
    nodes.push(id);
  };
  const terminals = new Map<string, [string, string]>();
  const partEntity = (part: Part, start: string, end: string) => {
    terminals.set(part.id, [start, end]);
    const label = part.name ?? (part.value ? valueLabel(part.value) : null);
    built.entities.push(floorEntity(part.id, "component", `stated ${part.glyph.replace("_", " ")}`, label,
      { objectId: part.id, ...(part.value ? { quantityIds: [part.value.quantityId] } : {}) }));
    built.constructions.push({ id: `draw_${part.id}`, operator: "symbol", inputs: { symbol: part.glyph, start, end }, outputs: [part.id] });
    if (part.name) names.push(part.name);
    if (part.name && part.value && !part.name.includes(part.value.valueText)) {
      built.annotations.push(appendLabel(`value_${part.id}`, part.id, part.value.valueText));
    }
  };
  let wireCount = 0;
  const wire = (start: string, end: string) => {
    const id = `wire_${++wireCount}`;
    built.entities.push(floorEntity(id, "connector", "wire", null, { stated: "connection the question states" }));
    built.constructions.push({ id: `draw_${id}`, operator: "connect", inputs: { start, end }, outputs: [id] });
    return id;
  };
  const source = sources[0] ?? null;
  const panel = (layout: Arrangement, offset: number, suffix: string) => {
    const at = (id: string) => `${id}${suffix}`;
    const copy = (part: Part): Part => suffix ? { ...part, id: `${part.id}${suffix}` } : part;
    if (layout === "series") {
      const width = span * loads.length;
      addNode(at("n_bl"), offset, 0);
      addNode(at("n_tl"), offset, height);
      loads.forEach((_, index) => addNode(at(`n_t${index + 1}`), offset + span * (index + 1), height));
      addNode(at("n_br"), offset + width, 0);
      if (junction) {
        // The junction is the stated point itself, under its source name.
        const junctionNode = built.entities.find((entity) => entity.id === "n_t1")!;
        junctionNode.id = junction.id;
        junctionNode.label = junction.name!;
        junctionNode.role = "stated junction between the two series loads";
        junctionNode.provenance = { floor: true, objectId: junction.id };
        built.constructions.find((construction) => construction.outputs[0] === "n_t1")!.outputs = [junction.id];
        nodes[nodes.indexOf("n_t1")] = junction.id;
        names.push(junction.name!);
        const asked = facts.problem?.facts.filter((fact) => fact.kind === "requested" &&
          fact.evidence.quote.toLowerCase().includes(junction.name!.toLowerCase())) ?? [];
        const voltages = facts.unknowns.filter((unknown) =>
          unitDimension(facts.plan.unknowns.find((planned) => planned.id === unknown.quantityId)?.unit) === "voltage");
        if (asked.length === 1 && voltages.length === 1 && facts.unknowns.length === 1) {
          built.annotations.push(appendLabel(`asked_${junction.id}`, junction.id, `${voltages[0]!.symbol} = ?`));
        }
      }
      const node = (id: string) => junction && id === "n_t1" ? junction.id : at(id);
      const pathIds: string[] = [];
      if (source) { const part = copy(source); partEntity(part, at("n_bl"), at("n_tl")); pathIds.push(part.id); }
      else pathIds.push(wire(at("n_bl"), at("n_tl")));
      loads.forEach((load, index) => {
        const part = copy(load);
        partEntity(part, index === 0 ? at("n_tl") : node(`n_t${index}`), node(`n_t${index + 1}`));
        pathIds.push(part.id);
      });
      pathIds.push(wire(node(`n_t${loads.length}`), at("n_br")));
      if (source) pathIds.push(wire(at("n_br"), at("n_bl")));
      built.assertions.push({ id: at("floor_series_path"), predicate: "path", entities: pathIds, expected: true, severity: "fatal",
        reason: "the stated parts form one series path" });
      return;
    }
    // A ladder: the source (or the two terminals) on the left, then any stated
    // series part on the top rail, then each parallel load on its own rung.
    const series = layout === "parallel" ? [] : layout.series;
    const rungs = layout === "parallel" ? loads : layout.parallel;
    addNode(at("n_bl"), offset, 0);
    addNode(at("n_tl"), offset, height);
    if (source) partEntity(copy(source), at("n_bl"), at("n_tl"));
    let top = at("n_tl");
    series.forEach((load, index) => {
      const next = at(`n_s${index + 1}`);
      addNode(next, offset + span * (index + 1), height);
      partEntity(copy(load), top, next);
      top = next;
    });
    let bottom = at("n_bl");
    rungs.forEach((load, index) => {
      const x = offset + span * (series.length + index + 1);
      addNode(at(`n_b${index + 1}`), x, 0);
      addNode(at(`n_t${index + 1}`), x, height);
      wire(index === 0 ? top : at(`n_t${index}`), at(`n_t${index + 1}`));
      wire(index === 0 ? bottom : at(`n_b${index}`), at(`n_b${index + 1}`));
      partEntity(copy(load), at(`n_b${index + 1}`), at(`n_t${index + 1}`));
    });
    bottom = at("n_bl");
    const bank = rungs.map((load) => copy(load).id);
    built.assertions.push({ id: at("floor_parallel_pair"), predicate: "sameTerminalPair",
      entities: series.length === 0 && source ? [copy(source).id, ...bank] : bank, expected: true,
      severity: "fatal", reason: "the stated parallel parts share one terminal pair" });
  };
  layouts.forEach((layout, index) => panel(layout, index * (span * (loads.length + 2)), index === 0 ? "" : "__second"));
  for (const [meterId, partnerId] of across) {
    const meter = parts.find((part) => part.id === meterId)!;
    const ends = terminals.get(partnerId);
    if (!ends) return { declined: "a meter's stated partner is not drawn" };
    partEntity(meter, ends[0], ends[1]);
    built.assertions.push({ id: `floor_across_${meterId}`, predicate: "sameTerminalPair", entities: [meterId, partnerId], expected: true,
      severity: "fatal", reason: "the meter is stated across this component" });
    built.assertions.push({ id: `floor_parallel_${meterId}`, predicate: "parallel", entities: [meterId, partnerId], expected: true,
      severity: "fatal", reason: "the stated parallel relation" });
  }
  const described = layouts.map((layout) => typeof layout === "string" ? layout : "series and parallel").join(" then ");
  built.groups.push({ id: "floor_circuit", entityIds: built.entities.map((entity) => entity.id),
    cue: `The ${described} circuit the question describes, with its stated values.` });
  const labelled = parts.filter((part) => part.name || part.value).length;
  if (labelled === 0) return { declined: "no part carries a stated name or value" };
  return {
    document: floorDocument(facts, "circuit", built, `stated ${described} circuit`),
    names,
    directedInk: false,
    reason: `the stated ${described} circuit: ${parts.map((part) => part.glyph).join(", ")}`,
  };
}

const COUNT_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, "2": 2, "3": 3, "4": 4 };

/**
 * Without a ProblemIR the parts are the question's stated values (each one a
 * resistor, capacitor or inductor by its unit, one source when the question
 * names a battery, cell or supply), or, when the question states only an
 * arrangement ("what is a parallel circuit"), a source and two loads under
 * plain names. A part the question names but the floor cannot place (a meter,
 * a switch, a lamp, a bridge) declines.
 */
function inventoryWithoutProblem(facts: FloorFacts): { parts: Part[] } | { declined: string } | null {
  const text = facts.question.toLowerCase();
  if (!/\b(?:circuit|resistors?|capacitors?|inductors?|battery|cell)\b/.test(text)) return null;
  if (/\b(?:ammeter|voltmeter|galvanometer|switch|key|lamp|bulb|diode|transistor|bridge|potentiometer|rheostat|jockey|internal resistance|kirchhoff|loop|(?:first|second|third|each|one|two|three) branch(?:es)?|node|junction|between [a-z] and [a-z])\b/.test(text)) {
    return { declined: "the question names a part or node the floor cannot place without a ProblemIR" };
  }
  const glyphOfValue = (value: FloorStatedValue): Glyph | null => {
    const dimension = unitDimension(value.unit);
    return dimension === "resistance" ? "resistor" : dimension === "capacitance" ? "capacitor" : dimension === "inductance" ? "inductor" : null;
  };
  const loads = facts.values.filter((value) => glyphOfValue(value));
  const voltages = facts.values.filter((value) => unitDimension(value.unit) === "voltage");
  const namesSource = /\b(?:battery|cell|supply|source|emf)\b/.test(text);
  const others = facts.values.filter((value) => !loads.includes(value) && !voltages.includes(value));
  if (loads.length === 0 && voltages.length === 0 && others.length === 0) {
    if (!/\b(?:series|parallel)\s+(?:circuit|combination|connection)\b|\b(?:resistors?|cells?)\s+(?:connected\s+)?in\s+(?:series|parallel)\b/.test(text)) return null;
    const withSource = /\bcircuit\b/.test(text) || namesSource;
    return { parts: [
      ...(withSource ? [{ id: "source", glyph: "battery" as const, name: null, value: null }] : []),
      { id: "load_1", glyph: "resistor", name: "R₁", value: null },
      { id: "load_2", glyph: "resistor", name: "R₂", value: null },
    ] };
  }
  if (voltages.length > 1 || (voltages.length === 1 && !namesSource) || loads.length === 0) {
    return { declined: "the stated values do not name one source and its loads" };
  }
  for (const [word, count] of Object.entries(COUNT_WORDS)) {
    const stated = new RegExp(`\\b${word}\\s+(?:[\\w.Ωµμ-]+\\s+){0,2}(resistors|capacitors|inductors)\\b`).exec(text);
    if (!stated) continue;
    const glyph = stated[1]!.startsWith("res") ? "resistor" : stated[1]!.startsWith("cap") ? "capacitor" : "inductor";
    if (loads.filter((value) => glyphOfValue(value) === glyph).length !== count) {
      return { declined: `the question states ${count} ${stated[1]} but the plan holds a different number` };
    }
  }
  return { parts: [
    ...(voltages.length === 1 ? [{ id: "source", glyph: "battery" as const, name: null, value: voltages[0]! }] : []),
    ...loads.map((value, index) => ({ id: `load_${index + 1}`, glyph: glyphOfValue(value)!, name: null, value })),
  ] };
}
