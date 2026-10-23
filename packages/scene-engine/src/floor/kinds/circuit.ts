/**
 * Circuit floor, from ProblemIR structure only.
 *
 * The parts and how they join come from a typed DC network, or from
 * connectivity constraints that join each component to exactly two node
 * points. A part's glyph comes from its own ProblemIR name and the unit of
 * the value bound to it, which must agree. Values are bound through shared
 * evidence facts and written as the question writes them. The question's
 * words never choose a part or a topology; they can only make the floor
 * decline (a part noun with no drawn part, a stated count that differs, a
 * stated polarity, "parallel" with nothing in parallel, "series" with nothing
 * in series, a part stated "through" with no part in series). Anything the
 * floor cannot draw exactly declines; it never simplifies.
 */
import type { FloorFacts } from "../facts";
import { boundUnknownTexts } from "../audit";
import { bindingFor, readFloorBindings, type FloorBinding } from "../bindings";
import type { FloorKindBuild } from "./index";
import { appendLabel, emptyParts, floorDocument, floorEntity, obligatedObjects, point, problemLabel } from "./shared";

type Glyph = "battery" | "ac_source" | "resistor" | "capacitor" | "inductor" | "lamp" | "ammeter" | "voltmeter";
const SOURCES: ReadonlySet<Glyph> = new Set(["battery", "ac_source"]);

interface Branch {
  id: string;
  from: string;
  to: string;
  glyph: Glyph;
  binding: FloorBinding | null;
  /** Its ProblemIR name when the question uses it. */
  name: string | null;
}

/** The glyph a ProblemIR component name states: whole words or a bare symbol, never a guess. */
function nameGlyph(label: string | null): Glyph | "ambiguous" | null {
  if (!label) return null;
  const words = label.toLowerCase().replace(/[_-]+/g, " ").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const has = (...nouns: string[]) => words.some((word) => nouns.includes(word));
  const found = new Set<Glyph>();
  if (has("resistor", "resistors", "resistance")) found.add("resistor");
  if (has("capacitor", "capacitors")) found.add("capacitor");
  if (has("inductor", "inductors", "coil")) found.add("inductor");
  if (has("lamp", "lamps", "bulb", "bulbs")) found.add("lamp");
  if (has("ammeter")) found.add("ammeter");
  if (has("voltmeter")) found.add("voltmeter");
  if (has("battery", "cell", "supply", "source", "emf")) found.add(has("ac", "alternating") ? "ac_source" : "battery");
  if (/^R\d*$/.test(label.trim())) found.add("resistor");
  if (/^C\d*$/.test(label.trim())) found.add("capacitor");
  if (/^L\d*$/.test(label.trim())) found.add("inductor");
  if (found.size > 1) return "ambiguous";
  return found.size === 1 ? [...found][0]! : null;
}

/** The glyph a bound value's unit states. A voltage could be a source or a reading, so it states none. */
function unitGlyph(binding: FloorBinding | null): Glyph | null {
  const unit = binding?.unitText.trim() ?? "";
  if (/^(?:[kMm]?Ω|[kM]?ohms?)$/i.test(unit)) return "resistor";
  if (/^[mµμnp]?F$/.test(unit)) return "capacitor";
  if (/^[mµμ]?H$/.test(unit)) return "inductor";
  return null;
}

const PART_NOUNS: Array<[RegExp, Glyph | null]> = [
  [/\bresistors?\b/i, "resistor"], [/\bcapacitors?\b/i, "capacitor"], [/\b(?:inductors?|coils?)\b/i, "inductor"],
  [/\b(?:lamps?|bulbs?)\b/i, "lamp"], [/\bammeters?\b/i, "ammeter"], [/\bvoltmeters?\b/i, "voltmeter"],
  [/\b(?:switch(?:es)?|keys?|diodes?|leds?|fuses?|motors?|transistors?|rheostats?|potentiometers?|galvanometers?|bridges?|jockeys?|thermistors?|ldrs?)\b/i, null],
];
const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COUNTED = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|several|many|some|n)\s+(?:[\p{L}\p{N}.,Ω-]+\s+){0,3}?(resistors|cells|batteries|capacitors|inductors|lamps|bulbs)\b/giu;

/** Text vetoes: the question's words may only stop the floor, never steer it. */
function vetoReason(question: string, branches: Branch[], groups: Branch[][]): string | null {
  const text = question.toLowerCase();
  const glyphs = new Set(branches.map((branch) => branch.glyph));
  for (const [noun, glyph] of PART_NOUNS) {
    if (noun.test(text) && (glyph === null || !glyphs.has(glyph))) return `the question names a part (${noun.exec(text)![0]}) the figure does not draw`;
  }
  for (const match of question.matchAll(COUNTED)) {
    const word = match[1]!.toLowerCase();
    const count = /^\d+$/.test(word) ? Number(word) : COUNT_WORDS[word];
    const plural = match[2]!.toLowerCase();
    const glyph: Glyph = plural.startsWith("res") ? "resistor" : plural.startsWith("cap") ? "capacitor" : plural.startsWith("ind") ? "inductor"
      : plural === "lamps" || plural === "bulbs" ? "lamp" : "battery";
    const drawn = branches.filter((branch) => branch.glyph === glyph || (glyph === "battery" && branch.glyph === "ac_source")).length;
    if (count === undefined || count !== drawn) return `the question states ${match[0]} but the structure holds ${drawn}`;
  }
  // Two or more parts of one type need a stated count, or each needs its own stated value or name.
  const counted = new Set([...question.matchAll(COUNTED)].map((match) => match[2]!.toLowerCase().replace(/ies$/, "y").replace(/s$/, "")));
  for (const glyph of glyphs) {
    const same = branches.filter((branch) => branch.glyph === glyph);
    if (same.length < 2) continue;
    const countedHere = [...counted].some((noun) => noun.startsWith(glyph.slice(0, 3)) || (glyph === "battery" && (noun === "cell" || noun === "battery")));
    const own = (branch: Branch) => branch.binding?.entityIds.length === 1 ? branch.binding.valueText : branch.name;
    const individual = same.every((branch) => own(branch)) && new Set(same.map(own)).size === same.length;
    if (!countedHere && !individual) return `${same.length} ${glyph} parts are neither counted nor each stated by the question`;
  }
  if (/\b(?:positive|negative)\s+(?:terminal|plate|pole)\b|\bpolarity\b|\b[+-]\s*ve\b/i.test(question)) return "a stated polarity is not drawn by the floor";
  const loads = groups.map((group) => group.filter((branch) => !SOURCES.has(branch.glyph)));
  const parallelDrawn = loads.some((group) => group.length >= 2);
  const seriesDrawn = groups.length >= 3 || (groups.length === 1 && branches.length === 2);
  if (/\bparallel\b/i.test(question) && !parallelDrawn) return "the question says parallel but nothing is drawn in parallel";
  if (/\bseries\b/i.test(question) && !seriesDrawn) return "the question says series but nothing is drawn in series";
  if (/\bthrough\s+(?:a|an|the|one)?\s*(?:[\p{L}\p{N}.Ω-]+\s+){0,3}?(?:resistor|capacitor|inductor|lamp|bulb|ammeter)\b/iu.test(question) &&
    !(groups.length >= 3 && loads.some((group) => group.length === 1))) {
    return "a part stated in series (\"through\") is not drawn in series";
  }
  return null;
}

/** Branches of the typed DC network, or of component-to-two-node constraints. Null when neither states the topology. */
function readNetlist(facts: FloorFacts): Array<{ id: string; from: string; to: string; kind: string | null }> | { declined: string } | null {
  const problem = facts.problem!;
  const dc = problem.solveRequests.filter((request) => request.kind === "dc_network");
  if (dc.length > 0) {
    const network = dc[0]!.network;
    if (dc.some((request) => JSON.stringify(request.network) !== JSON.stringify(network))) return { declined: "two different DC networks" };
    return network.branches.map((branch) => ({ id: branch.id, from: branch.from, to: branch.to, kind: branch.kind }));
  }
  const components = problem.entities.filter((entity) => entity.kind === "component");
  if (components.length === 0) return null;
  const points = new Set(problem.entities.filter((entity) => entity.kind === "point").map((entity) => entity.id));
  const branches: Array<{ id: string; from: string; to: string; kind: string | null }> = [];
  for (const component of components) {
    const joins = problem.constraints.filter((constraint) => constraint.kind === "connected" && constraint.entityIds.includes(component.id));
    const ends = joins.length === 1 && joins[0]!.kind === "connected" ? joins[0]!.entityIds.filter((id) => id !== component.id) : [];
    if (ends.length !== 2 || !ends.every((id) => points.has(id)) || ends[0] === ends[1]) {
      return { declined: `component ${component.id} is not joined to exactly two stated nodes` };
    }
    branches.push({ id: component.id, from: ends[0]!, to: ends[1]!, kind: null });
  }
  return branches;
}

export function buildCircuitFloor(facts: FloorFacts): FloorKindBuild | { declined: string } | null {
  if (!facts.problem) return null;
  const netlist = readNetlist(facts);
  if (!netlist || "declined" in netlist) return netlist;
  const bindings = readFloorBindings(facts);
  const branches: Branch[] = [];
  for (const raw of netlist) {
    if (raw.kind === "wire" || raw.kind === "open" || raw.kind === "current_source") return { declined: `a ${raw.kind} branch is not drawn by the floor` };
    const label = problemLabel(facts, raw.id);
    const named = nameGlyph(label);
    const binding = bindingFor(bindings, raw.id);
    const byUnit = unitGlyph(binding);
    const typed: Glyph | null = raw.kind === "resistor" ? "resistor" : raw.kind === "voltage_source" ? "battery" : null;
    const votes = [named, byUnit, typed].filter((vote): vote is Glyph | "ambiguous" => vote !== null);
    const glyph = votes[0];
    if (!glyph || glyph === "ambiguous" || votes.some((vote) => vote !== glyph && !(SOURCES.has(vote as Glyph) && SOURCES.has(glyph)))) {
      return { declined: `component ${raw.id} has no single stated part type` };
    }
    if (label && !facts.objects.find((object) => object.id === raw.id)?.name) return { declined: `component ${raw.id} carries a name the question does not use` };
    // The engine's inductor glyph is a two-sided wave a reader takes for a resistor; until it is a coil, no inductor is drawn.
    if (glyph === "inductor") return { declined: "the inductor glyph is not yet distinguishable from a resistor" };
    // The meter glyph is an empty circle (no A or V) whose leads stop short of it, so a loop through it reads as open.
    if (glyph === "ammeter" || glyph === "voltmeter") return { declined: "the meter glyph does not yet show A or V and leaves its leads open" };
    branches.push({ id: raw.id, from: raw.from, to: raw.to, glyph, binding, name: facts.objects.find((object) => object.id === raw.id)?.name ?? null });
  }
  if (branches.filter((branch) => SOURCES.has(branch.glyph)).length > 1) return { declined: "more than one source" };
  if (branches.length > 7) return { declined: "more parts than the floor lays out" };

  // Groups of branches between the same two nodes, and the node cycle they form.
  const key = (a: string, b: string) => [a, b].sort().join("|");
  const groupMap = new Map<string, Branch[]>();
  for (const branch of branches) groupMap.set(key(branch.from, branch.to), [...(groupMap.get(key(branch.from, branch.to)) ?? []), branch]);
  const nodes = [...new Set(branches.flatMap((branch) => [branch.from, branch.to]))];
  const neighbours = new Map(nodes.map((node) => [node, new Set<string>()]));
  for (const branch of branches) { neighbours.get(branch.from)!.add(branch.to); neighbours.get(branch.to)!.add(branch.from); }
  let order: string[];
  if (nodes.length === 2) order = nodes;
  else {
    if (nodes.some((node) => neighbours.get(node)!.size !== 2)) return { declined: "the stated network is not one loop of series and parallel groups" };
    const source = branches.find((branch) => SOURCES.has(branch.glyph));
    order = source ? [source.from, source.to] : [nodes[0]!, [...neighbours.get(nodes[0]!)!][0]!];
    while (order.length < nodes.length) {
      const next = [...neighbours.get(order.at(-1)!)!].find((node) => !order.includes(node));
      if (!next) return { declined: "the stated network is not one loop" };
      order.push(next);
    }
    if (!neighbours.get(order.at(-1)!)!.has(order[0]!)) return { declined: "the stated network does not close" };
  }
  // Two parts across one pair with no source draw as a plain loop, which reads as series: the arrangement would be lost.
  if (nodes.length === 2 && branches.length === 2 && !branches.some((branch) => SOURCES.has(branch.glyph)) && /\bparallel\b/i.test(facts.question)) {
    return { declined: "two parts in parallel with no source look like a series loop" };
  }
  const groups = nodes.length === 2 ? [branches]
    : order.map((node, index) => groupMap.get(key(node, order[(index + 1) % order.length]!)) ?? []);
  const vetoed = vetoReason(facts.question, branches, groups);
  if (vetoed) return { declined: vetoed };
  const placed = new Set([...branches.map((branch) => branch.id), ...nodes]);
  const unplaced = obligatedObjects(facts).filter((object) => !placed.has(object.id));
  if (unplaced.length > 0) return { declined: `obligated ${unplaced.map((object) => object.id).join(", ")} has no place in the stated network` };

  const built = emptyParts();
  const names: string[] = [];
  const height = 2.4, span = 3;
  const nodeEntity = (id: string, x: number, y: number) => {
    const name = facts.objects.find((object) => object.id === id)?.name ?? null;
    if (problemLabel(facts, id) && !name) throw new Error(`node ${id} carries a name the question does not use`);
    built.entities.push(floorEntity(id, "point", "stated circuit node", name, { objectId: id }));
    built.constructions.push(point(id, x, y));
    if (name) names.push(name);
    for (const text of boundUnknownTexts(facts, id)) built.annotations.push(appendLabel(`asked_${id}`, id, text));
  };
  const helper = (id: string, x: number, y: number) => {
    built.entities.push(floorEntity(id, "point", "wire corner", null, { stated: "a wire of the stated node" }));
    built.constructions.push(point(id, x, y));
  };
  let wires = 0;
  const wire = (start: string, end: string) => {
    const id = `wire_${++wires}`;
    built.entities.push(floorEntity(id, "connector", "wire", null, { stated: "joins points of one stated node" }));
    built.constructions.push({ id: `draw_${id}`, operator: "connect", inputs: { start, end }, outputs: [id] });
  };
  const part = (branch: Branch, start: string, end: string) => {
    const name = facts.objects.find((object) => object.id === branch.id)?.name ?? null;
    built.entities.push(floorEntity(branch.id, "component", `stated ${branch.glyph.replace("_", " ")}`, name,
      { objectId: branch.id, ...(branch.binding?.quantity ? { quantityIds: [branch.binding.quantity.quantityId] } : {}) }));
    built.constructions.push({ id: `draw_${branch.id}`, operator: "symbol", inputs: { symbol: branch.glyph, start, end }, outputs: [branch.id] });
    if (name) names.push(name);
    // A part named by its own quantity symbol ("R") already carries that quantity's value from the engine.
    const namedBySymbol = Boolean(name && branch.binding?.quantity && name === branch.binding.quantity.symbol);
    if (branch.binding && !namedBySymbol && !(name ?? "").includes(branch.binding.valueText)) {
      built.annotations.push(appendLabel(`value_${branch.id}`, branch.id, branch.binding.valueText));
    }
    for (const text of boundUnknownTexts(facts, branch.id)) built.annotations.push(appendLabel(`asked_${branch.id}`, branch.id, text));
  };
  try {
    if (nodes.length === 2) {
      // Two nodes: a ladder, each part on its own rung between the two rails.
      const [bottom, top] = order as [string, string];
      nodeEntity(bottom, 0, 0);
      nodeEntity(top, 0, height);
      const rungs = [...branches].sort((a, b) => Number(SOURCES.has(b.glyph)) - Number(SOURCES.has(a.glyph)));
      let lastBottom = bottom, lastTop = top;
      rungs.forEach((branch, index) => {
        if (index === 0) { part(branch, branch.from === bottom ? bottom : top, branch.from === bottom ? top : bottom); return; }
        const b = `${bottom}_rung${index}`, t = `${top}_rung${index}`;
        helper(b, span * index, 0); helper(t, span * index, height);
        wire(lastBottom, b); wire(lastTop, t);
        part(branch, branch.from === bottom ? b : t, branch.from === bottom ? t : b);
        lastBottom = b; lastTop = t;
      });
      built.assertions.push({ id: "floor_parallel_pair", predicate: "sameTerminalPair", entities: branches.map((branch) => branch.id),
        expected: true, severity: "fatal", reason: "the stated parts share one terminal pair" });
    } else {
      // One loop: the first group on the left edge, the next ones along the top, the last one down the right edge.
      const k = order.length, width = span * (k - 2);
      order.forEach((node, index) => nodeEntity(node, index <= 1 ? 0 : span * (index - 1), index === 0 ? 0 : height));
      const corner = `${order[0]}_corner`;
      helper(corner, width, 0);
      wire(corner, order[0]!);
      const position = (node: string): [number, number] => {
        const at = node === corner ? k : order.indexOf(node);
        return at === k ? [width, 0] : [at <= 1 ? 0 : span * (at - 1), at === 0 ? 0 : height];
      };
      groups.forEach((group, index) => {
        const a = order[index]!, b = index === k - 1 ? corner : order[index + 1]!;
        // A parallel group spreads into its own rungs, away from the loop, so each value sits by its own part.
        const [ax, ay] = position(a), [bx, by] = position(b);
        const vertical = ax === bx;
        const outward = vertical ? (ax === 0 ? -1 : 1) : 1;
        group.forEach((branch, rung) => {
          const forward = branch.from === order[index];
          if (rung === 0) { part(branch, forward ? a : b, forward ? b : a); return; }
          const ra = `${branch.id}_from`, rb = `${branch.id}_to`;
          const offset = rung * (vertical ? span : 0.9) * outward;
          helper(ra, vertical ? ax + offset : ax, vertical ? ay : ay + offset);
          helper(rb, vertical ? bx + offset : bx, vertical ? by : by + offset);
          wire(a, ra); wire(b, rb);
          part(branch, forward ? ra : rb, forward ? rb : ra);
        });
        if (group.length >= 2) {
          built.assertions.push({ id: `floor_parallel_${index}`, predicate: "sameTerminalPair", entities: group.map((branch) => branch.id),
            expected: true, severity: "fatal", reason: "the stated parallel parts share one terminal pair" });
        }
      });
    }
  } catch (error) {
    return { declined: error instanceof Error ? error.message : String(error) };
  }
  if (!built.entities.some((entity) => entity.label) && built.annotations.length === 0) return { declined: "no part carries a stated name or value" };
  built.groups.push({ id: "floor_network", entityIds: built.entities.map((entity) => entity.id),
    cue: "The parts the question names, joined as its structure states, with their stated values." });
  return {
    document: floorDocument(facts, "circuit", built, "the stated network"),
    names,
    directedInk: false,
    reason: `stated network: ${branches.map((branch) => branch.glyph).join(", ")}`,
  };
}
