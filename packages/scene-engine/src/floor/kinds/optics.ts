/**
 * Ray optics floor: the one element the question names (a convex or concave
 * lens, a concave or convex mirror) on its principal axis, its foci, and the
 * object at its stated distance, placed to scale against the stated focal
 * length so "between F and 2F" or "inside F" holds as written. It draws no
 * ray and no image: rays and image positions are analysis, and a mirror bent
 * the wrong way or an image in the wrong place is how optics fallbacks went
 * wrong. Two elements, a prism, a slab or a surface decline.
 */
import type { FloorFacts, FloorStatedValue } from "../facts";
import type { FloorKindBuild } from "./index";
import { emptyParts, floorDocument, floorEntity, obligatedObjects, point, unitDimension, valueLabel } from "./shared";

type Element = "convex_lens" | "concave_lens" | "concave_mirror" | "convex_mirror";

const ELEMENT_WORDS: Array<[RegExp, Element]> = [
  [/\b(?:convex|converging|biconvex)\s+lens\b/i, "convex_lens"],
  [/\b(?:concave|diverging|biconcave)\s+lens\b/i, "concave_lens"],
  [/\b(?:concave|converging)\s+mirror\b/i, "concave_mirror"],
  [/\b(?:convex|diverging)\s+mirror\b/i, "convex_mirror"],
];
const DECLINE = /\b(?:plane mirror|prism|slab|glass block|refracting surface|spherical surface|interface|telescope|microscope|eyepiece|objective|combination|in contact|two lenses|second lens|virtual object|converging beam|immersed|water|liquid|silvered|thick lens|cylindrical)\b/i;

export function opticsSignals(facts: FloorFacts): boolean {
  return ELEMENT_WORDS.some(([pattern]) => pattern.test(facts.question));
}

function roleOf(value: FloorStatedValue): "f" | "u" | "h" | null {
  if (unitDimension(value.unit) !== "length") return null;
  const context = value.context.toLowerCase();
  if (/\bfocal\b/.test(context) || /^f$/i.test(value.symbol)) return "f";
  if (/\b(?:tall|high|height|size)\b/.test(context) || /^h(?:_?o)?$/i.test(value.symbol)) return "h";
  if (/\bin front of\b|\bfrom the (?:lens|mirror|pole|optical cent(?:re|er))\b|\bobject distance\b|\bplaced at\b|\baway from\b/.test(context) ||
    /^u$/i.test(value.symbol)) return "u";
  return null;
}

export function buildOpticsFloor(facts: FloorFacts): FloorKindBuild | { declined: string } | null {
  if (!opticsSignals(facts)) return null;
  const elements = ELEMENT_WORDS.filter(([pattern]) => pattern.test(facts.question)).map(([, element]) => element);
  if (new Set(elements).size !== 1) return { declined: "the question names more than one optical element" };
  if (DECLINE.test(facts.question)) return { declined: "the setup has a part the optics floor does not draw" };
  const element = elements[0]!;
  const roles = new Map<"f" | "u" | "h", FloorStatedValue[]>();
  for (const value of facts.values) {
    const role = roleOf(value);
    if (role) roles.set(role, [...(roles.get(role) ?? []), value]);
  }
  if ([...roles.values()].some((values) => values.length > 1)) return { declined: "a stated optical length has more than one candidate" };
  const f = roles.get("f")?.[0] ?? null, u = roles.get("u")?.[0] ?? null, h = roles.get("h")?.[0] ?? null;
  if (!f && !u) return { declined: "neither the focal length nor the object distance is stated" };
  // Magnitudes only: the sign convention belongs to the narration, the picture follows the element.
  const fAbs = f ? Math.abs(f.value) : null, uAbs = u ? Math.abs(u.value) : null;
  if ((fAbs !== null && !(fAbs > 0)) || (uAbs !== null && !(uAbs > 0))) return { declined: "a stated length is zero" };
  const unplaced = obligatedObjects(facts).filter((object) => !/\b(?:lens|mirror|object|axis)\b/i.test(`${object.name ?? ""} ${object.id}`));
  if (unplaced.length > 0) return { declined: `obligated ${unplaced.map((object) => object.id).join(", ")} has no place before analysis` };
  const reach = Math.max(uAbs ?? 0, fAbs !== null ? 2 * fAbs : 0);
  const scale = 6 / reach;
  const lens = element === "convex_lens" || element === "concave_lens";
  const focal = fAbs !== null ? fAbs * scale : 3;

  const built = emptyParts();
  const names: string[] = [];
  const add = (...entities: ReturnType<typeof floorEntity>[]) => built.entities.push(...entities);
  const left = -(reach * scale) - 1.2, right = lens ? Math.max(focal * 2, 2.5) + 1 : Math.max(focal * 2, 2.5) + 1;
  add(floorEntity("axis_l", "point", "axis end", null, { stated: "principal axis" }),
    floorEntity("axis_r", "point", "axis end", null, { stated: "principal axis" }),
    floorEntity("axis", "line", "principal axis", null, { stated: "principal axis" }),
    floorEntity("P", "point", lens ? "optical centre" : "pole", lens ? "O" : "P", { stated: "the element's centre" }));
  built.constructions.push(point("axis_l", left, 0), point("axis_r", right, 0), point("P", 0, 0),
    { id: "draw_axis", operator: "line", inputs: { start: "axis_l", end: "axis_r" }, outputs: ["axis"] });
  names.push(lens ? "O" : "P");
  const elementName = (facts.question.match(ELEMENT_WORDS.find(([, kind]) => kind === element)![0]) ?? [""])[0]!.toLowerCase();
  if (lens) {
    const r = 9;
    add(floorEntity("element", "polygon", `stated ${elementName}`, elementName, { stated: elementName }));
    built.constructions.push({ id: "draw_element", operator: "lens_section", inputs: {
      center: "P", axis: "axis", radius1: element === "convex_lens" ? r : -r, radius2: element === "convex_lens" ? -r : r, halfHeight: 2.2,
    }, outputs: ["element"] });
  } else {
    const radius = 2 * focal;
    const half = Math.min(2.2, radius * 0.8);
    const spread = (Math.asin(half / radius) * 180) / Math.PI;
    const concave = element === "concave_mirror";
    add(floorEntity("C_mirror", "point", "centre of curvature", "C", { stated: "the mirror's curvature" }),
      floorEntity("element", "arc", `stated ${elementName}`, elementName, { stated: elementName }));
    built.constructions.push(point("C_mirror", concave ? -radius : radius, 0), { id: "draw_element", operator: "arc", inputs: {
      center: "C_mirror", radius, startAngle: concave ? -spread : 180 - spread, endAngle: concave ? spread : 180 + spread, angleUnit: "degrees",
    }, outputs: ["element"] });
    names.push("C");
  }
  names.push(elementName);
  if (fAbs !== null) {
    // Real focus on the object side for a concave mirror; behind a convex mirror; both sides of a lens.
    const focusX = element === "convex_mirror" ? focal : -focal;
    add(floorEntity("F", "point", "focus", "F", { stated: "focal length" }));
    built.constructions.push(point("F", focusX, 0));
    names.push("F");
    if (lens) {
      add(floorEntity("F2", "point", "second focus", "F′", { stated: "focal length" }));
      built.constructions.push(point("F2", focal, 0));
      names.push("F′");
    }
    add(floorEntity("f_a", "point", "dimension end", null, { stated: "focal length" }),
      floorEntity("f_b", "point", "dimension end", null, { stated: "focal length" }),
      floorEntity("dim_f", "dimension", "stated focal length", valueLabel(f!), { quantityIds: [f!.quantityId] }));
    built.constructions.push(point("f_a", focusX, -2.9), point("f_b", 0, -2.9),
      { id: "draw_dim_f", operator: "dimension", inputs: { start: "f_a", end: "f_b" }, outputs: ["dim_f"] });
    built.assertions.push({ id: "floor_focus_on_axis", predicate: "on", entities: ["F", "axis"], expected: true, severity: "fatal", reason: "the focus lies on the axis" });
  }
  if (uAbs !== null) {
    const x = -uAbs * scale;
    add(floorEntity("object_foot", "point", "object foot on the axis", null, { stated: "object position" }),
      floorEntity("object_tip", "point", "object tip", null, { stated: "object" }),
      floorEntity("object", "vector", "stated upright object", h ? valueLabel(h) : "object", { stated: "object", ...(h ? { quantityIds: [h.quantityId] } : {}) }),
      floorEntity("u_a", "point", "dimension end", null, { stated: "object distance" }),
      floorEntity("u_b", "point", "dimension end", null, { stated: "object distance" }),
      floorEntity("dim_u", "dimension", "stated object distance", valueLabel(u!), { quantityIds: [u!.quantityId] }));
    built.constructions.push(point("object_foot", x, 0), point("object_tip", x, 1.3),
      { id: "draw_object", operator: "vector", inputs: { start: "object_foot", end: "object_tip" }, outputs: ["object"] },
      point("u_a", x, 2.9), point("u_b", 0, 2.9),
      { id: "draw_dim_u", operator: "dimension", inputs: { start: "u_a", end: "u_b" }, outputs: ["dim_u"] });
    if (!h) names.push("object");
    built.assertions.push({ id: "floor_object_on_axis", predicate: "on", entities: ["object_foot", "axis"], expected: true, severity: "fatal", reason: "the object stands on the axis" });
    if (fAbs !== null) {
      built.assertions.push({ id: "floor_object_to_scale", predicate: "distance_ratio", entities: ["P", "F", "P", "object_foot"], expected: fAbs / uAbs,
        severity: "fatal", reason: "the object sits at its stated distance against the stated focal length" });
    }
  }
  built.groups.push(
    { id: "floor_element", entityIds: built.entities.filter((entity) => !/^(?:object|u_|dim_u)/.test(entity.id)).map((entity) => entity.id), cue: `The ${elementName} on its principal axis.` },
    { id: "floor_object", entityIds: built.entities.filter((entity) => /^(?:object|u_|dim_u)/.test(entity.id)).map((entity) => entity.id), cue: "The object at its stated distance." },
  );
  return {
    document: floorDocument(facts, "optics", built, `the stated ${elementName} and object, before any ray`),
    names,
    directedInk: true,
    reason: `the stated ${elementName}${uAbs !== null ? " with the object at its stated distance" : ""}${fAbs !== null ? " and its foci" : ""}`,
  };
}
