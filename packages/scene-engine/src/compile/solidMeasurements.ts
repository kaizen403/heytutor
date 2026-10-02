import type { SceneConstruction, SceneDocument, SceneIssue } from "../types";

type MeasurementKind = "radius" | "diameter" | "height" | "inner_radius";
interface Anchor { solid: string; at: number; fraction: number; angle: number }
const KINDS: readonly string[] = ["radius", "diameter", "height", "inner_radius"];
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6;
const angleCosine = (a: number, b: number) => Math.cos(((a - b) % 360) * Math.PI / 180);

/** Prove the meaning of spans anchored to a curved solid before any ink renders. */
export function validateSolidMeasurements(
  document: SceneDocument,
  issues: SceneIssue[],
  resolveNumber: (value: unknown) => number,
): void {
  const producers = new Map(document.constructions.flatMap((construction) =>
    construction.outputs.map((id) => [id, construction] as const)));
  const endpoint = (inputs: Record<string, unknown>, keys: string[]) =>
    keys.map((key) => inputs[key]).find((value) => value !== undefined);
  const anchor = (producer: SceneConstruction | undefined): Anchor => {
    if (producer?.operator !== "solid_anchor" || typeof producer.inputs.solid !== "string") {
      throw new Error("both endpoints must be derived solid_anchor points");
    }
    return {
      solid: producer.inputs.solid,
      at: resolveNumber(producer.inputs.at),
      fraction: resolveNumber(producer.inputs.radialFraction ?? 0),
      angle: resolveNumber(producer.inputs.angleDeg ?? 0),
    };
  };
  for (const construction of document.constructions) {
    if (construction.operator !== "dimension") continue;
    const start = endpoint(construction.inputs, ["start", "from", "a"]);
    const end = endpoint(construction.inputs, ["end", "to", "b"]);
    const first = typeof start === "string" ? producers.get(start) : undefined;
    const second = typeof end === "string" ? producers.get(end) : undefined;
    const explicit = construction.inputs.measurementKind;
    // Ordinary point-to-point spans do not claim a solid measurement meaning.
    if (explicit === undefined && construction.inputs.solid === undefined &&
        first?.operator !== "solid_anchor" && second?.operator !== "solid_anchor") continue;
    try {
      const role = document.entities.find((entity) => construction.outputs.includes(entity.id))?.role ?? "";
      const roleKind = kindFromRole(role);
      const kind = explicit ?? roleKind;
      if (typeof kind !== "string" || !KINDS.includes(kind)) throw new Error("solid measurement requires a declared measurementKind or an unambiguous measurement role");
      // A separate inner projection has an ordinary radius; a native cavity
      // uses inner_radius. Both describe a radius rather than a diameter.
      const radialKind = (value: string) => value === "inner_radius" ? "radius" : value;
      if (typeof explicit === "string" && roleKind !== undefined && radialKind(explicit) !== radialKind(roleKind)) throw new Error("declared measurementKind contradicts the measurement role");
      const a = anchor(first);
      const b = anchor(second);
      if (a.solid !== b.solid) throw new Error("both endpoints must belong to the same solid");
      if (construction.inputs.solid !== undefined && construction.inputs.solid !== a.solid) throw new Error("declared solid owner does not match the endpoint owners");
      const solid = producers.get(a.solid);
      if (solid?.operator !== "solid_projection") throw new Error("measurement owner must be a solid_projection");
      const solidKind = solid.inputs.kind;
      if (kind === "height") {
        const axialEnds = (close(a.at, 0) && close(b.at, 1)) || (close(a.at, 1) && close(b.at, 0));
        const cylinderRims = solidKind === "cylinder" && close(a.fraction, 1) && close(b.fraction, 1) && close(angleCosine(a.angle, b.angle), 1);
        const axisCentres = (solidKind === "cone" || solidKind === "frustum") && close(a.fraction, 0) && close(b.fraction, 0);
        if (!axialEnds || (!cylinderRims && !axisCentres)) throw new Error("height must join matching cylinder rims or cone/frustum axis centres at base and top");
        continue;
      }
      if (!close(a.at, b.at)) throw new Error("radial measurements must use the same circular section");
      if (solidKind === "sphere" && !close(a.at, 0.5)) throw new Error("sphere radius and diameter must use the equator through the sphere centre");
      if (solidKind === "hemisphere" && !close(a.at, 0)) throw new Error("hemisphere radius and diameter must use its base through the sphere centre");
      if (kind === "diameter") {
        if (!close(a.fraction, 1) || !close(b.fraction, 1) || !close(angleCosine(a.angle, b.angle), -1)) {
          throw new Error("diameter must join opposite rim points");
        }
      } else {
        let rim = 1;
        if (kind === "inner_radius") {
          if (solidKind !== "cylinder" || solid.inputs.innerRadius === undefined) throw new Error("inner_radius requires a hollow cylinder with a declared innerRadius");
          rim = resolveNumber(solid.inputs.innerRadius) / resolveNumber(solid.inputs.radius);
          if (!(rim > 0 && rim < 1)) throw new Error("inner radius must be positive and smaller than the outer radius");
        }
        if (!((close(a.fraction, 0) && close(b.fraction, rim)) || (close(b.fraction, 0) && close(a.fraction, rim)))) {
          throw new Error(`${kind} must join the section centre and its actual rim`);
        }
      }
    } catch (error) {
      issues.push({
        code: "invalid_solid_measurement", severity: "fatal",
        message: `${construction.id}: ${error instanceof Error ? error.message : String(error)}`,
        entityIds: construction.outputs,
      });
    }
  }
}

function kindFromRole(role: string): MeasurementKind | undefined {
  const words = role.replace(/_/g, " ").toLowerCase();
  if (/\b(?:inner|internal)\s+radius\b/.test(words)) return "inner_radius";
  const kinds = (["radius", "diameter", "height"] as const).filter((kind) => new RegExp(`\\b${kind}\\b`).test(words));
  return kinds.length === 1 ? kinds[0] : undefined;
}
