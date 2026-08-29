/**
 * Optics and modern-physics archetypes. Mirror and lens diagrams are laid out
 * from the mirror/lens formula with the Cartesian sign convention; refraction
 * uses the engine's refract_at / surface_contact / refract_direction chain so
 * Snell's law is asserted, never approximated.
 */
import { evaluateOpticsLaw } from "../../physics/opticsLaws";
import { sagOf } from "../../compile/opticsSurfaces";
import { DEG, SceneBuilder, fmt, withUnit, type Vec2 } from "../document";
import { grounded, maybeNum, num, text, type GeneratorContext, type GeneratorTable } from "./context";

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

function sphericalMirror(context: GeneratorContext) {
  const kind = text(context, "kind", "concave");
  const uMag = Math.abs(num(context, "u", 30));
  const fMag = Math.abs(num(context, "f", 10));
  if (uMag <= 0 || fMag <= 0) return null;
  // Cartesian convention: pole at the origin, light travels from the left.
  const u = -uMag;
  const f = kind === "concave" ? -fMag : fMag;
  const v = 1 / (1 / f - 1 / u);
  if (!Number.isFinite(v) || Math.abs(v) > 12 * uMag) return null;
  const m = -v / u;
  const h = 0.28 * Math.max(fMag, uMag / 3);
  const R = 2 * fMag;
  const centreX = kind === "concave" ? -R : R;
  const scene = new SceneBuilder(context.question, `${kind} mirror ray diagram from the mirror formula (u=${fmt(uMag)}, f=${fmt(fMag)})`, "spherical_mirror");
  scene.quantity("u", "u", u, "cm");
  scene.quantity("f", "f", f, "cm");
  scene.quantity("v", "v", v, "cm");

  const leftmost = Math.min(u, v, centreX, -fMag) - 0.2 * uMag;
  const rightmost = Math.max(v, centreX, 0) + 0.15 * uMag + 0.5;
  scene.point("axis_l", { x: leftmost, y: 0 }, "principal axis end");
  scene.point("axis_r", { x: rightmost, y: 0 }, "principal axis end");
  scene.line("axis", "axis_l", "axis_r", "principal axis");
  scene.point("P", { x: 0, y: 0 }, "pole", "P");
  scene.point("C", { x: centreX, y: 0 }, "centre of curvature", "C");
  scene.point("F", { x: centreX / 2, y: 0 }, "focus", "F");
  const arcHalfAngle = clamp((Math.asin(Math.min(0.95, (h * 2.2) / R)) / DEG), 18, 40);
  const facing = kind === "concave" ? 0 : 180;
  scene.arc("mirror", "C", R, facing - arcHalfAngle, facing + arcHalfAngle, `${kind} mirror`, "M");

  scene.point("O_base", { x: u, y: 0 }, "object foot", "O");
  scene.point("O_tip", { x: u, y: h }, "object tip");
  scene.vector("object", "O_base", { end: "O_tip" }, "object", "object");
  const imageHeight = m * h;
  scene.point("I_base", { x: v, y: 0 }, "image foot", "I");
  scene.point("I_tip", { x: v, y: imageHeight }, "image tip");
  scene.vector("image", "I_base", { end: "I_tip" }, `${v < 0 ? "real" : "virtual"} image`, "image");

  const mirrorXAt = (y: number): number => centreX + (kind === "concave" ? 1 : -1) * Math.sqrt(Math.max(R * R - y * y, 0));
  // Ray 1: parallel to the axis, reflects through (or away from) F.
  scene.point("M1", { x: mirrorXAt(h), y: h }, "incidence point on the mirror");
  scene.segment("ray1_in", "O_tip", "M1", "incident ray parallel to the axis");
  // Ray 2: aimed at (or through) F, reflects parallel.
  const focusX = centreX / 2;
  const slope2 = (0 - h) / (focusX - u);
  const y2 = h + slope2 * (mirrorXAt(0) - u);
  const yHit2 = clamp(y2, -0.9 * h, 0.9 * h);
  scene.point("M2", { x: mirrorXAt(yHit2), y: yHit2 }, "incidence point on the mirror");
  scene.segment("ray2_in", "O_tip", "M2", "incident ray through the focus");
  if (v < 0) {
    scene.paraxialRay("ray1_out", "M1", "I_tip", "reflected ray through F (paraxial)");
    scene.paraxialRay("ray2_out", "M2", "I_tip", "reflected ray parallel to the axis (paraxial)");
    scene.assert("rays_converge", "converges", ["ray1_out", "ray2_out", "I_tip"], true);
  } else {
    const away = (from: Vec2, through: Vec2, length: number): Vec2 => {
      const dx = from.x - through.x;
      const dy = from.y - through.y;
      const norm = Math.hypot(dx, dy) || 1;
      return { x: from.x + (dx / norm) * length, y: from.y + (dy / norm) * length };
    };
    scene.point("ray1_far", away({ x: mirrorXAt(h), y: h }, { x: v, y: imageHeight }, uMag * 0.8), "reflected ray end");
    scene.point("ray2_far", away({ x: mirrorXAt(yHit2), y: yHit2 }, { x: v, y: imageHeight }, uMag * 0.8), "reflected ray end");
    scene.paraxialRay("ray1_out", "M1", "ray1_far", "reflected ray, diverging (paraxial)");
    scene.paraxialRay("ray2_out", "M2", "ray2_far", "reflected ray, diverging (paraxial)");
    scene.segment("ray1_ext", "M1", "I_tip", "virtual extension behind the mirror");
    scene.segment("ray2_ext", "M2", "I_tip", "virtual extension behind the mirror");
    scene.assert("extensions_meet", "converges", ["ray1_ext", "ray2_ext", "I_tip"], true);
  }
  scene.point("dim_u_a", { x: u, y: -0.35 * h }, "object distance start");
  scene.point("dim_u_b", { x: 0, y: -0.35 * h }, "object distance end");
  scene.dimension("dim_u", "dim_u_a", "dim_u_b", "object distance", grounded(context, "u") ? `u=${withUnit(uMag, "cm")}` : "u");
  scene.point("dim_f_a", { x: focusX, y: -0.7 * h }, "focal length start");
  scene.point("dim_f_b", { x: 0, y: -0.7 * h }, "focal length end");
  scene.dimension("dim_f", "dim_f_a", "dim_f_b", "focal length", grounded(context, "f") ? `f=${withUnit(fMag, "cm")}` : "f");
  scene.assert("object_on_axis", "on", ["O_base", "axis"]);
  scene.assert("image_on_axis", "on", ["I_base", "axis"]);
  scene.assert("m1_on_mirror", "on", ["M1", "mirror"]);
  scene.assert("f_is_half_r", "distance_ratio", ["P", "F", "P", "C"], 0.5);
  if (grounded(context, "u") && grounded(context, "f")) {
    scene.assert("image_distance", "distance_ratio", ["P", "I_base", "P", "O_base"], Number((Math.abs(v) / uMag).toFixed(6)));
  }
  scene.labelled("P", "F", "C", "O_base", "I_base");
  scene.group("setup", ["axis_l", "axis_r", "axis", "P", "C", "F", "mirror", "O_base", "O_tip", "object", "dim_u_a", "dim_u_b", "dim_u", "dim_f_a", "dim_f_b", "dim_f"], "the mirror, its pole, focus and centre, and the object");
  scene.group("rays", ["M1", "M2", "ray1_in", "ray2_in", "ray1_out", "ray2_out", ...(v < 0 ? [] : ["ray1_far", "ray2_far", "ray1_ext", "ray2_ext"])], "two principal rays locate the image", ["setup"]);
  scene.group("image_group", ["I_base", "I_tip", "image"], `the ${v < 0 ? "real, inverted" : "virtual, erect"} image`, ["rays"]);
  return scene.build();
}

function thinLens(context: GeneratorContext) {
  const kind = text(context, "kind", "convex");
  const uMag = Math.abs(num(context, "u", 20));
  const fMag = Math.abs(num(context, "f", 15));
  if (uMag <= 0 || fMag <= 0) return null;
  const u = -uMag;
  const f = kind === "convex" ? fMag : -fMag;
  const v = 1 / (1 / f + 1 / u);
  if (!Number.isFinite(v) || Math.abs(v) > 12 * uMag) return null;
  const m = v / u;
  const h = 0.28 * Math.max(fMag, uMag / 3);
  const scene = new SceneBuilder(context.question, `${kind} lens ray diagram from the lens formula (u=${fmt(uMag)}, f=${fmt(fMag)})`, "thin_lens");
  scene.quantity("u", "u", u, "cm");
  scene.quantity("f", "f", f, "cm");
  scene.quantity("v", "v", v, "cm");
  const leftmost = Math.min(u, v, -2 * fMag) - 0.15 * uMag;
  const rightmost = Math.max(v, 2 * fMag) + 0.15 * uMag;
  scene.point("axis_l", { x: leftmost, y: 0 }, "principal axis end");
  scene.point("axis_r", { x: rightmost, y: 0 }, "principal axis end");
  scene.line("axis", "axis_l", "axis_r", "principal axis");
  scene.point("O", { x: 0, y: 0 }, "optical centre", "O");
  const aperture = 1.6 * h;
  const rMag = Math.max(aperture * 2.4, fMag * 0.35);
  const r1 = kind === "convex" ? rMag : -rMag;
  const r2 = kind === "convex" ? -rMag : rMag;
  scene.lensSection("lens", { center: "O", axis: "axis", radius1: r1, radius2: r2, halfHeight: aperture }, `${kind} lens`, "L");
  scene.point("F1", { x: -fMag, y: 0 }, "first focus", "F");
  scene.point("F2", { x: fMag, y: 0 }, "second focus", "F'");
  scene.point("O_base", { x: u, y: 0 }, "object foot", "A");
  scene.point("O_tip", { x: u, y: h }, "object tip", "B");
  scene.vector("object", "O_base", { end: "O_tip" }, "object", "object");
  const imageHeight = m * h;
  scene.point("I_base", { x: v, y: 0 }, "image foot", "A'");
  scene.point("I_tip", { x: v, y: imageHeight }, "image tip", "B'");
  scene.vector("image", "I_base", { end: "I_tip" }, `${v > 0 ? "real" : "virtual"} image`, "image");
  scene.point("L1", { x: 0, y: h }, "ray 1 crossing the lens");
  scene.segment("ray1_in", "O_tip", "L1", "ray parallel to the axis");
  scene.segment("ray2_in", "O_tip", "O", "ray through the optical centre");
  if (v > 0) {
    scene.paraxialRay("ray1_out", "L1", "I_tip", "refracted ray through F' (paraxial)");
    scene.segment("ray2_out", "O", "I_tip", "undeviated ray through the optical centre");
    scene.assert("rays_converge", "converges", ["ray1_out", "ray2_out", "I_tip"], true);
  } else {
    const extend = (from: Vec2, through: Vec2, length: number): Vec2 => {
      const dx = through.x - from.x;
      const dy = through.y - from.y;
      const norm = Math.hypot(dx, dy) || 1;
      return { x: through.x + (dx / norm) * length, y: through.y + (dy / norm) * length };
    };
    const f2: Vec2 = { x: fMag, y: 0 };
    const out1 = kind === "convex" ? extend({ x: 0, y: h }, f2, uMag) : extend({ x: -fMag, y: 0 }, { x: 0, y: h }, uMag);
    scene.point("ray1_far", out1, "refracted ray end");
    scene.point("ray2_far", extend({ x: u, y: h }, { x: 0, y: 0 }, uMag), "undeviated ray end");
    scene.paraxialRay("ray1_out", "L1", "ray1_far", "refracted ray, diverging (paraxial)");
    scene.segment("ray2_out", "O", "ray2_far", "undeviated ray through the optical centre");
    scene.segment("ray1_ext", "L1", "I_tip", "virtual extension");
    scene.segment("ray2_ext", "O", "I_tip", "virtual extension");
    scene.assert("extensions_meet", "converges", ["ray1_ext", "ray2_ext", "I_tip"], true);
  }
  scene.point("dim_u_a", { x: u, y: -0.45 * h }, "object distance start");
  scene.point("dim_u_b", { x: 0, y: -0.45 * h }, "object distance end");
  scene.dimension("dim_u", "dim_u_a", "dim_u_b", "object distance", grounded(context, "u") ? `u=${withUnit(uMag, "cm")}` : "u");
  scene.point("dim_v_a", { x: 0, y: -0.85 * h }, "image distance start");
  scene.point("dim_v_b", { x: v, y: -0.85 * h }, "image distance end");
  scene.dimension("dim_v", "dim_v_a", "dim_v_b", "image distance", grounded(context, "u") && grounded(context, "f") ? `v=${withUnit(Math.abs(v), "cm")}` : "v");
  scene.assert("centre_on_axis", "on", ["O", "axis"]);
  scene.assert("object_on_axis", "on", ["O_base", "axis"]);
  scene.assert("image_on_axis", "on", ["I_base", "axis"]);
  if (grounded(context, "u") && grounded(context, "f")) {
    scene.assert("image_distance", "distance_ratio", ["O", "I_base", "O", "O_base"], Number((Math.abs(v) / uMag).toFixed(6)));
    scene.assert("focal_ratio", "distance_ratio", ["O", "F2", "O", "O_base"], Number((fMag / uMag).toFixed(6)));
  }
  scene.labelled("O", "F1", "F2", "O_base", "I_base");
  scene.group("setup", ["axis_l", "axis_r", "axis", "O", "lens", "F1", "F2", "O_base", "O_tip", "object", "dim_u_a", "dim_u_b", "dim_u"], "the lens, its foci and the object");
  scene.group("rays", ["L1", "ray1_in", "ray2_in", "ray1_out", "ray2_out", ...(v > 0 ? [] : ["ray1_far", "ray2_far", "ray1_ext", "ray2_ext"])], "two principal rays locate the image", ["setup"]);
  scene.group("image_group", ["I_base", "I_tip", "image", "dim_v_a", "dim_v_b", "dim_v"], `the ${v > 0 ? "real, inverted" : "virtual, erect"} image`, ["rays"]);
  return scene.build();
}

function planeRefraction(context: GeneratorContext) {
  const i = num(context, "i", 45);
  const n1 = num(context, "n1", 1);
  const n2 = num(context, "n2", 1.5);
  if (i <= 0 || i >= 90 || n1 <= 0 || n2 <= 0) return null;
  const sinR = (n1 / n2) * Math.sin(i * DEG);
  if (sinR >= 1) return null;
  const r = Math.asin(sinR) / DEG;
  const scene = new SceneBuilder(context.question, `refraction at a plane interface: i=${fmt(i)}°, n1=${fmt(n1)}, n2=${fmt(n2)}`, "plane_refraction");
  scene.quantity("i", "i", i, "degree");
  scene.quantity("n1", "n1", n1, "");
  scene.quantity("n2", "n2", n2, "");
  scene.quantity("r", "r", r, "degree");
  scene.point("s_a", { x: -4, y: 0 }, "interface end");
  scene.point("s_b", { x: 4, y: 0 }, "interface end");
  scene.line("interface", "s_a", "s_b", "interface between the media");
  scene.point("P", { x: 0, y: 0 }, "point of incidence", "P");
  scene.entities.push({ id: "incident", kind: "ray", role: "incident ray", label: "incident" });
  scene.entities.push({ id: "normal", kind: "line", role: "normal at P", label: "normal" });
  scene.entities.push({ id: "refracted", kind: "ray", role: "refracted ray", label: "refracted" });
  scene.constructions.push({
    id: "make_refraction",
    operator: "refract_at",
    inputs: { point: "P", surface: "interface", incidentAngleDeg: i, n1, n2, span: 3.2 },
    outputs: ["incident", "normal", "refracted"],
  });
  scene.point("medium1", { x: -3.2, y: 1.6 }, "upper medium label", n1 === 1 ? "air, n1=1" : `n1=${fmt(n1)}`);
  scene.point("medium2", { x: -3.2, y: -1.6 }, "lower medium label", `n2=${fmt(n2)}`);
  scene.angleMark("angle_i", "P", "incident", "normal", `i=${fmt(i)}°`, 1.1);
  scene.angleMark("angle_r", "P", "refracted", "normal", `r=${fmt(r)}°`, 0.8);
  scene.assert("snell", "snells_law", ["incident", "normal", "refracted"], { n1, n2 });
  scene.assert("normal_perp", "perpendicular", ["normal", "interface"]);
  scene.assert("incidence_angle", "angle_between", ["incident", "normal"], { value: i, unit: "degree" });
  scene.assert("p_on_interface", "on", ["P", "interface"]);
  scene.labelled("P", "incident");
  return scene.build();
}

function prism(context: GeneratorContext) {
  const A = num(context, "A", 60);
  const n = num(context, "n", 1.5);
  let i = maybeNum(context, "i");
  const minimumDeviation = /\bminimum deviation\b/i.test(context.question);
  if (A <= 0 || A >= 120 || n <= 1) return null;
  if (i === null || minimumDeviation) {
    // Minimum deviation: symmetric passage, r1 = r2 = A/2.
    const sinI = n * Math.sin((A / 2) * DEG);
    if (sinI >= 1) return null;
    i = Math.asin(sinI) / DEG;
  }
  const r1 = Math.asin(Math.sin(i * DEG) / n) / DEG;
  const r2 = A - r1;
  const sinE = n * Math.sin(r2 * DEG);
  const totalInternal = sinE >= 1;
  const e = totalInternal ? null : Math.asin(sinE) / DEG;
  const deviation = e === null ? null : i + e - A;

  const base = 6;
  const apex: Vec2 = { x: base / 2, y: (base / 2) / Math.tan((A / 2) * DEG) };
  const scene = new SceneBuilder(context.question, `ray through a prism of angle ${fmt(A)}°, n=${fmt(n)}, incidence ${fmt(i)}°${minimumDeviation ? " (minimum deviation)" : ""}`, "prism");
  scene.quantity("A", "A", A, "degree");
  scene.quantity("n", "n", n, "");
  scene.quantity("i", "i", i, "degree");
  if (deviation !== null) scene.quantity("delta", "delta", deviation, "degree");
  scene.point("B", { x: 0, y: 0 }, "base vertex", "B");
  scene.point("C", { x: base, y: 0 }, "base vertex", "C");
  scene.point("Apex", apex, "apex", "A");
  scene.polygon("prism", ["B", "Apex", "C"], "prism section", `A=${fmt(A)}°`);
  scene.segment("face1", "B", "Apex", "first refracting face");
  scene.segment("face2", "Apex", "C", "second refracting face");
  const p1: Vec2 = { x: apex.x * 0.5, y: apex.y * 0.5 };
  scene.point("P1", p1, "first point of incidence", "P");
  scene.entities.push({ id: "incident", kind: "ray", role: "ray entering the first face", label: "incident" });
  scene.entities.push({ id: "normal1", kind: "line", role: "normal at the first face" });
  scene.entities.push({ id: "refracted", kind: "ray", role: "ray inside the prism after the first face" });
  scene.constructions.push({
    id: "make_first_refraction",
    operator: "refract_at",
    inputs: { point: "P1", surface: "face1", incidentAngleDeg: i, n1: 1, n2: n, tangentSign: 1, span: 2.6 },
    outputs: ["incident", "normal1", "refracted"],
  });
  scene.entities.push({ id: "P2", kind: "point", role: "second point of incidence", label: "Q" });
  scene.entities.push({ id: "internal", kind: "vector", role: "internal ray reaching the second face" });
  scene.constructions.push({
    id: "make_contact2",
    operator: "surface_contact",
    inputs: { origin: "P1", surface: "face2", parallelTo: "refracted", which: "nearest_forward" },
    outputs: ["P2", "internal"],
  });
  scene.normalAt("normal2", "P2", "face2", "normal at the second face");
  if (!totalInternal) {
    scene.entities.push({ id: "emergent", kind: "ray", role: "emergent ray", label: "emergent" });
    scene.constructions.push({
      id: "make_emergent",
      operator: "refract_direction",
      inputs: { origin: "P2", incoming: "internal", normal: "normal2", n1: n, n2: 1 },
      outputs: ["emergent"],
    });
    scene.assert("snell2", "snells_law", ["internal", "normal2", "emergent"], { n1: n, n2: 1 });
    if (deviation !== null) {
      scene.assert("deviation", "angle_between", ["incident", "emergent"], { value: Number(deviation.toFixed(4)), unit: "degree" });
      scene.point("delta_note", { x: base + 0.6, y: apex.y * 0.25 }, "deviation note", `δ=${fmt(deviation)}°`);
    }
  } else {
    scene.entities.push({ id: "reflected", kind: "ray", role: "totally internally reflected ray", label: "TIR" });
    scene.constructions.push({
      id: "make_reflected",
      operator: "reflect_direction",
      inputs: { origin: "P2", incoming: "internal", normal: "normal2" },
      outputs: ["reflected"],
    });
  }
  scene.angleMark("angle_i", "P1", "incident", "normal1", `i=${fmt(i)}°`, 0.9);
  scene.assert("snell1", "snells_law", ["incident", "normal1", "refracted"], { n1: 1, n2: n });
  scene.assert("incidence", "angle_between", ["incident", "normal1"], { value: Number(i.toFixed(4)), unit: "degree" });
  scene.assert("p1_on_face", "on", ["P1", "face1"]);
  scene.assert("apex_angle", "angle_between", ["face1", "face2"], { value: A, unit: "degree" });
  scene.labelled("Apex", "incident");
  return scene.build();
}

function doubleSlit(context: GeneratorContext) {
  const d = maybeNum(context, "d");
  const D = maybeNum(context, "D");
  const lambda = maybeNum(context, "lambda");
  const scene = new SceneBuilder(context.question, "Young's double slit: two slits, the screen and the fringe pattern", "double_slit");
  if (d !== null && grounded(context, "d")) scene.quantity("d", "d", d, "mm");
  if (D !== null && grounded(context, "D")) scene.quantity("D", "D", D, "m");
  if (lambda !== null && grounded(context, "lambda")) scene.quantity("lambda", "lambda", lambda, "nm");
  scene.point("S", { x: -3, y: 0 }, "source", "S");
  scene.point("slit_centre", { x: 0, y: 0 }, "slit plane centre");
  scene.entities.push({ id: "slits", kind: "aperture", role: "double slit", label: "S1, S2" });
  scene.constructions.push({
    id: "make_slits",
    operator: "aperture",
    inputs: { center: "slit_centre", orientation: "vertical", length: 5, slitCount: 2, slitWidth: 0.25, slitSeparation: 1.2 },
    outputs: ["slits"],
  });
  scene.point("S1", { x: 0, y: 0.6 }, "slit", "S1");
  scene.point("S2", { x: 0, y: -0.6 }, "slit", "S2");
  scene.point("screen_top", { x: 7, y: 3 }, "screen end");
  scene.point("screen_bottom", { x: 7, y: -3 }, "screen end");
  scene.segment("screen", "screen_top", "screen_bottom", "screen");
  scene.entities.push({ id: "fringes", kind: "screen_pattern", role: "fringe pattern on the screen" });
  scene.constructions.push({
    id: "make_fringes",
    operator: "screen_pattern",
    inputs: { start: "screen_top", end: "screen_bottom", pattern: "interference", count: 7, spacing: 0.7, centralWidth: 0.5 },
    outputs: ["fringes"],
  });
  scene.point("O", { x: 7, y: 0 }, "central bright fringe", "O");
  scene.point("Pf", { x: 7, y: 0.7 }, "first bright fringe", "P");
  scene.segment("ray1", "S1", "Pf", "ray from S1");
  scene.segment("ray2", "S2", "Pf", "ray from S2");
  scene.segment("axis", "slit_centre", "O", "central line");
  scene.point("dim_d_a", { x: -0.6, y: 0.6 }, "slit separation start");
  scene.point("dim_d_b", { x: -0.6, y: -0.6 }, "slit separation end");
  scene.dimension("dim_d", "dim_d_a", "dim_d_b", "slit separation", d !== null && grounded(context, "d") ? `d=${withUnit(d, "mm")}` : "d");
  scene.point("dim_D_a", { x: 0, y: -3.4 }, "screen distance start");
  scene.point("dim_D_b", { x: 7, y: -3.4 }, "screen distance end");
  scene.dimension("dim_D", "dim_D_a", "dim_D_b", "screen distance", D !== null && grounded(context, "D") ? `D=${withUnit(D, "m")}` : "D");
  scene.point("dim_beta_a", { x: 7.5, y: 0 }, "fringe width start");
  scene.point("dim_beta_b", { x: 7.5, y: 0.7 }, "fringe width end");
  scene.dimension("dim_beta", "dim_beta_a", "dim_beta_b", "fringe width", "β");
  scene.assert("screen_parallel", "parallel", ["screen", "slits"]);
  scene.assert("axis_perp", "perpendicular", ["axis", "screen"]);
  scene.assert("o_on_screen", "on", ["O", "screen"]);
  scene.labelled("S1", "S2", "O");
  return scene.build();
}

function photoelectric(context: GeneratorContext) {
  const phi = maybeNum(context, "workFunction");
  const lambda = maybeNum(context, "lambda");
  const photon = maybeNum(context, "photonEnergy") ?? (lambda !== null ? 1240 / lambda : null);
  const phiValue = phi ?? 2;
  const photonValue = photon ?? Math.max(phiValue * 1.5, phiValue + 1);
  if (photonValue <= phiValue) return null;
  const kMax = photonValue - phiValue;
  const scene = new SceneBuilder(context.question, "photoelectric energy balance: photon energy, work function and maximum kinetic energy", "photoelectric");
  if (phi !== null && grounded(context, "workFunction")) scene.quantity("phi", "phi", phi, "eV");
  if (photon !== null) scene.quantity("E", "E", photonValue, "eV");
  scene.axes("axes", -0.5, 4, -0.2 * photonValue, 1.25 * photonValue, "energy axis", "E (eV)");
  scene.point("zero", { x: 0, y: 0 }, "zero of energy");
  scene.point("phi_top", { x: 0, y: phiValue }, "work function mark", `φ=${fmt(phiValue)} eV`);
  scene.point("E_top", { x: 0, y: photonValue }, "photon energy mark", `hν=${fmt(photonValue)} eV`);
  scene.point("phi_bar_end", { x: 3, y: phiValue }, "work function line end");
  scene.segment("phi_level", "phi_top", "phi_bar_end", "work function line");
  scene.point("E_bar_end", { x: 3, y: photonValue }, "photon energy line end");
  scene.segment("E_level", "E_top", "E_bar_end", "photon energy line");
  scene.point("photon_base", { x: 1, y: 0 }, "photon arrow base");
  scene.point("photon_tip", { x: 1, y: photonValue }, "photon arrow tip");
  scene.vector("photon", "photon_base", { end: "photon_tip" }, "photon energy", "hν");
  scene.point("k_base", { x: 2.2, y: phiValue }, "kinetic energy base");
  scene.point("k_tip", { x: 2.2, y: photonValue }, "kinetic energy tip");
  scene.vector("kinetic", "k_base", { end: "k_tip" }, "maximum kinetic energy", `K=${fmt(kMax)} eV`);
  scene.point("w_base", { x: 2.2, y: 0 }, "work function base");
  scene.point("w_tip", { x: 2.2, y: phiValue }, "work function tip");
  scene.vector("work", "w_base", { end: "w_tip" }, "work function", "φ");
  scene.assert("levels_parallel", "parallel", ["phi_level", "E_level"]);
  if (phi !== null && photon !== null && grounded(context, "workFunction")) {
    scene.assert("energy_ratio", "distance_ratio", ["w_base", "w_tip", "photon_base", "photon_tip"], Number((phiValue / photonValue).toFixed(6)));
  }
  scene.labelled("phi_top", "E_top");
  return scene.build();
}

function lensMaker(context: GeneratorContext) {
  const n = num(context, "n", 1.5);
  const n0 = num(context, "n0", 1);
  const kind = text(context, "kind", "biconvex");
  let R1 = maybeNum(context, "R1");
  let R2 = maybeNum(context, "R2");
  if (R1 === null || R2 === null) {
    if (kind === "biconcave") {
      R1 = -20;
      R2 = 20;
    } else if (kind === "plano-convex") {
      R1 = 20;
      R2 = 800;
    } else if (kind === "plano-concave") {
      R1 = -20;
      R2 = 800;
    } else {
      R1 = 20;
      R2 = -20;
    }
  }
  const height = 3.6;
  const finiteRadii = [R1, R2].filter((radius) => Math.abs(radius) < 200).map((radius) => Math.abs(radius));
  const rMin = Math.min(...finiteRadii, Number.POSITIVE_INFINITY);
  const display = 2.6 * height;
  const scale = rMin > 0 && Number.isFinite(rMin) ? display / rMin : 1;
  const displayRadius = (radius: number): number =>
    Math.abs(radius) > 200 ? Math.sign(radius) * 400 : radius * scale;
  const dR1 = displayRadius(R1);
  const dR2 = displayRadius(R2);
  const thickness = sagOf(dR1, height) + sagOf(dR2, height) + 0.45;
  let focal: number | null = null;
  try {
    focal = evaluateOpticsLaw("lens_maker", {
      lensIndex: n,
      mediumIndex: n0,
      radius1: R1,
      radius2: R2,
    }).focalLength ?? null;
  } catch {
    focal = null;
  }
  const scene = new SceneBuilder(
    context.question,
    `${kind} lens from the lens-maker radii R1=${fmt(R1)}, R2=${fmt(R2)}`,
    "lens_maker",
  );
  if (grounded(context, "n")) scene.quantity("n", "n", n, "");
  if (grounded(context, "R1")) scene.quantity("R1", "R1", R1, "cm");
  if (grounded(context, "R2")) scene.quantity("R2", "R2", R2, "cm");
  if (focal !== null && Number.isFinite(focal)) scene.quantity("f", "f", focal, "cm");
  const left = Math.min(-Math.abs(dR1), -thickness) - 1.2;
  const right = Math.max(Math.abs(dR2) > 200 ? thickness + 1.2 : Math.abs(dR2), thickness) + 1.2;
  scene.point("axis_l", { x: left, y: 0 }, "principal axis end");
  scene.point("axis_r", { x: right, y: 0 }, "principal axis end");
  scene.line("axis", "axis_l", "axis_r", "principal axis");
  scene.point("O", { x: 0, y: 0 }, "optical centre", "O");
  scene.point("V1", { x: -thickness / 2, y: 0 }, "first surface vertex", "P1");
  scene.point("V2", { x: thickness / 2, y: 0 }, "second surface vertex", "P2");
  scene.point("C1", { x: -thickness / 2 + dR1, y: 0 }, "centre of curvature", "C1");
  scene.point("C2", { x: thickness / 2 + dR2, y: 0 }, "centre of curvature", "C2");
  scene.sphericalSurface("face1", {
    vertex: "V1",
    center: "C1",
    axis: "axis",
    halfHeight: height,
    signedRadius: dR1,
  }, "first spherical surface", "R1");
  scene.sphericalSurface("face2", {
    vertex: "V2",
    center: "C2",
    axis: "axis",
    halfHeight: height,
    signedRadius: dR2,
  }, "second spherical surface", "R2");
  scene.segment("radius1", "C1", "V1", "radius of the first surface");
  scene.segment("radius2", "C2", "V2", "radius of the second surface");
  const displayFocus = focal !== null && Number.isFinite(focal) ? focal * scale : null;
  if (displayFocus !== null && Math.abs(displayFocus) < Math.max(Math.abs(left), Math.abs(right)) * 1.2) {
    scene.point("F", { x: displayFocus, y: 0 }, "focus", "F");
    scene.assert("focus_on_axis", "on", ["F", "axis"]);
  }
  scene.assert("o_on_axis", "on", ["O", "axis"]);
  scene.assert("v1_on_axis", "on", ["V1", "axis"]);
  scene.assert("v2_on_axis", "on", ["V2", "axis"]);
  scene.assert("c1_on_axis", "on", ["C1", "axis"]);
  scene.assert("c2_on_axis", "on", ["C2", "axis"]);
  scene.assert("v1_on_face", "on", ["V1", "face1"]);
  scene.assert("v2_on_face", "on", ["V2", "face2"]);
  if (grounded(context, "R1") && grounded(context, "R2") && Math.abs(R2) > 1e-6) {
    scene.assert(
      "radius_ratio",
      "distance_ratio",
      ["C1", "V1", "C2", "V2"],
      Number((Math.abs(R1) / Math.abs(R2)).toFixed(6)),
    );
  }
  scene.labelled("O", "C1", "C2", "V1", "V2");
  scene.group(
    "setup",
    ["axis_l", "axis_r", "axis", "O", "V1", "V2", "C1", "C2", "face1", "face2", "radius1", "radius2"],
    "the two spherical surfaces of the lens, with centres C1 and C2",
  );
  return scene.build();
}

function sphericalRefraction(context: GeneratorContext) {
  const kind = text(context, "kind", "convex");
  const uMag = Math.abs(num(context, "u", grounded(context, "u") ? 30 : 12));
  const Rmag = Math.abs(num(context, "R", 10));
  const n1 = num(context, "n1", 1);
  const n2 = num(context, "n2", 1.5);
  if (uMag <= 0 || Rmag <= 0 || n1 <= 0 || n2 <= 0) return null;
  const R = kind === "concave" ? -Rmag : Rmag;
  const u = -uMag;
  let v: number | null = null;
  try {
    v = evaluateOpticsLaw("spherical_refraction", {
      n1,
      n2,
      objectDistance: u,
      radius: R,
    }).imageDistance ?? null;
  } catch {
    v = null;
  }
  if (v !== null && (!Number.isFinite(v) || Math.abs(v) > 12 * uMag)) v = null;
  const height = 0.55 * Rmag;
  const scene = new SceneBuilder(
    context.question,
    `${kind} spherical surface from the paraxial refraction law`,
    "spherical_refraction",
  );
  if (grounded(context, "u")) scene.quantity("u", "u", u, "cm");
  if (grounded(context, "R")) scene.quantity("R", "R", R, "cm");
  if (grounded(context, "n2")) scene.quantity("n2", "n2", n2, "");
  const objectX = u;
  const vertexX = 0;
  const centerX = R;
  const imageX = v ?? (kind === "convex" ? 2 * uMag : -2 * uMag);
  const left = Math.min(objectX, vertexX, centerX, imageX) - 0.2 * uMag;
  const right = Math.max(objectX, vertexX, centerX, imageX) + 0.2 * uMag;
  scene.point("axis_l", { x: left, y: 0 }, "principal axis end");
  scene.point("axis_r", { x: right, y: 0 }, "principal axis end");
  scene.line("axis", "axis_l", "axis_r", "principal axis");
  scene.point("O", { x: objectX, y: 0 }, "object position", "O");
  scene.point("V", { x: vertexX, y: 0 }, "surface vertex", "V");
  scene.point("C", { x: centerX, y: 0 }, "centre of curvature", "C");
  scene.point("I", { x: imageX, y: 0 }, "paraxial image", "I");
  scene.sphericalSurface("interface", {
    vertex: "V",
    center: "C",
    axis: "axis",
    halfHeight: height,
    signedRadius: R,
  }, "spherical surface");
  scene.segment("radius", "C", "V", "radius of curvature", "R");
  const contactY = height * 0.62;
  const contactX = centerX - Math.sign(R) * Math.sqrt(Math.max(Rmag * Rmag - contactY * contactY, 0));
  scene.point("P", { x: contactX, y: contactY }, "point of incidence", "P");
  scene.assert("p_on_surface", "on", ["P", "interface"]);
  scene.normalAt("normal", "P", "interface", "surface normal");
  scene.assert("o_on_axis", "on", ["O", "axis"]);
  scene.assert("v_on_axis", "on", ["V", "axis"]);
  scene.assert("c_on_axis", "on", ["C", "axis"]);
  scene.assert("i_on_axis", "on", ["I", "axis"]);
  scene.assert("v_on_surface", "on", ["V", "interface"]);
  if (v !== null && grounded(context, "u") && grounded(context, "R") && Math.abs(u) > 1e-6) {
    scene.assert(
      "image_distance",
      "distance_ratio",
      ["I", "V", "O", "V"],
      Number((Math.abs(v) / uMag).toFixed(6)),
    );
  }
  scene.labelled("O", "V", "C", "I");
  scene.group(
    "setup",
    ["axis_l", "axis_r", "axis", "O", "V", "C", "I", "interface", "radius", "P", "normal"],
    "the spherical surface and the points O, V, C, and I on the axis",
  );
  return scene.build();
}

export const OPTICS_GENERATORS: GeneratorTable = {
  spherical_mirror: sphericalMirror,
  thin_lens: thinLens,
  lens_maker: lensMaker,
  spherical_refraction: sphericalRefraction,
  plane_refraction: planeRefraction,
  prism,
  double_slit: doubleSlit,
  photoelectric,
};
