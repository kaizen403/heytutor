import { evaluateMathExpression } from "../math/expression";
import {
  firstAngle,
  numbersWithUnit,
  UNIT,
  STEM_NUMBER,
  parseStemNumber,
  prepareStem,
} from "../archetypes/slots";

/** A later object's angle is not a measurement of the launch direction. */
export function projectileLaunchAngle(question: string): number | null {
  const launchStart =
    /\b(?:launched|projected|thrown|fired|kicked|hit|struck|shot)\b/i.exec(
      question,
    );
  const launchClause = launchStart
    ? question
        .slice(launchStart.index)
        .split(
          /\.(?!\d)|[;!?]|\band\b(?!\s+(?:(?:an?|the)\s+)?angle\s+(?:of\s+|is\s+)?\(?\s*[+-]?\d)|\b(?:hence|show|it|maximum)\b/i,
        )[0]!
    : "";
  return /\bhorizontally\b/i.test(launchClause)
    ? 0
    : /(?:\btheta\b|θ)(?!\s*[=:])/i.test(launchClause)
      ? null
      : firstAngle(launchClause);
}

/** A launch height is a length bound to the launch surface, never the next number after “cliff”. */
export function projectileLaunchHeight(question: string): number | null {
  const text = prepareStem(question);
  const length = `${STEM_NUMBER}\\s*(km|cm|mm|m(?:etres?|eters?)?)(?![a-z]|\\s*[/^]|\\s*s(?:\\b|\\^))`;
  const surface = `(?:cliff|tower|building|hill|platform|ledge)`;
  const patterns = [
    new RegExp(`${length}\\s*(?:-?high\\s+)?${surface}\\b`, "gi"),
    new RegExp(
      `\\b${surface}\\s+(?:(?:of\\s+)?height\\s+(?:of\\s+)?|(?:that|which)\\s+is\\s+|is\\s+)?${length}(?:\\s+high)?`,
      "gi",
    ),
    new RegExp(
      `\\b(?:from|at)\\s+(?:a\\s+)?height\\s+(?:of\\s+)?${length}`,
      "gi",
    ),
    new RegExp(
      `\\b(?:launch|initial)\\s+height\\s*(?:is|of|=)?\\s*${length}`,
      "gi",
    ),
  ];
  const values = patterns.flatMap((pattern, patternIndex) =>
    [...text.matchAll(pattern)].flatMap((match) => {
      // A target cliff is not the launch surface. The surface-valued forms
      // require a local source preposition; explicit launch-height forms carry
      // their own role in the matched phrase.
      if (
        patternIndex < 2 &&
        !/\b(?:from|off)\s+(?:(?:the\s+)?(?:top|edge)\s+of\s+)?(?:(?:a|an|the)\s+)?$/i.test(
          text.slice(0, match.index),
        )
      )
        return [];
      const value = parseStemNumber(match[1]!);
      const factor =
        match[2]!.toLowerCase() === "km"
          ? 1000
          : match[2]!.toLowerCase() === "cm"
            ? 0.01
            : match[2]!.toLowerCase() === "mm"
              ? 0.001
              : 1;
      return value !== null && value >= 0 ? [value * factor] : [];
    }),
  );
  return values.length > 0 && values.every((value) => value === values[0])
    ? values[0]!
    : null;
}

/** Cached archetype geometry must still agree with the source when no planner is present. */
export function projectileSourceIssues(
  question: string,
  document: import("../types").SceneDocument,
): Array<{ code: string; message: string }> {
  if (
    document.source.archetype !== "projectile" &&
    !["make_trajectory", "make_apex", "make_landing"].every((id) =>
      document.constructions.some((row) => row.id === id),
    )
  )
    return [];
  const height = projectileLaunchHeight(question);
  const speed = projectileLaunchSpeed(question);
  const gravity = projectileGravity(question);
  const angle = projectileLaunchAngle(question);
  const issues: Array<{ code: string; message: string }> = [];
  if (height !== null) {
    const quantity = document.quantities.find((row) => row.id === "h0");
    const launch = document.constructions.find((row) => row.id === "make_O");
    if (
      (height > 0 &&
        (!quantity ||
          typeof quantity.value !== "number" ||
          Math.abs(quantity.value - height) > 1e-6 ||
          quantity.unit !== "m")) ||
      !launch ||
      typeof launch.inputs.y !== "number" ||
      Math.abs(launch.inputs.y - height) > 1e-8
    )
      issues.push({
        code: "projectile_launch_height_source_mismatch",
        message:
          "Projectile launch height disagrees with the length bound to the source launch surface.",
      });
  }
  if (speed !== null) {
    const quantity = document.quantities.find((row) => row.id === "u");
    if (
      !quantity ||
      typeof quantity.value !== "number" ||
      Math.abs(quantity.value - speed) > 1e-6 ||
      quantity.unit !== "m/s"
    )
      issues.push({
        code: "projectile_launch_speed_source_mismatch",
        message: "Projectile launch speed disagrees with its source value.",
      });
  }
  if (
    height !== null &&
    speed !== null &&
    gravity !== null &&
    gravity > 0 &&
    angle !== null &&
    angle >= 0 &&
    angle < 90
  ) {
    const vx = speed * Math.cos((angle * Math.PI) / 180);
    const vy = speed * Math.sin((angle * Math.PI) / 180);
    const range =
      (vx * (vy + Math.sqrt(vy * vy + 2 * gravity * height))) / gravity;
    const curve = document.constructions.find(
      (row) => row.id === "make_trajectory",
    );
    const landing = document.constructions.find(
      (row) => row.id === "make_landing",
    );
    let valid =
      typeof landing?.inputs.x === "number" &&
      Math.abs(landing.inputs.x - range) <= 1e-7 &&
      typeof curve?.inputs.expression === "string";
    if (valid) {
      try {
        valid = [0, range / 2, range].every(
          (x) =>
            Math.abs(
              evaluateMathExpression(curve!.inputs.expression as string, x) -
                (height + (vy * x) / vx - (gravity * x * x) / (2 * vx * vx)),
            ) <= 1e-7,
        );
      } catch {
        valid = false;
      }
    }
    if (!valid)
      issues.push({
        code: "projectile_trajectory_source_mismatch",
        message:
          "Projectile trajectory disagrees with the independently computed source launch and gravity.",
      });
  }
  return issues;
}

/** Only a speed in the launch clause can set projectile geometry. */
export function projectileLaunchSpeed(question: string): number | null {
  const text = prepareStem(question);
  const launch =
    /\b(?:launched|projected|thrown|fired|kicked|hit|struck|shot)\b/i.exec(
      text,
    );
  if (!launch) return null;
  const clause = text
    .slice(launch.index)
    .split(/\.(?!\d)|[;!?]|\b(?:towards|hits?|strikes?|lands?)\b/i)[0]!;
  const speeds = numbersWithUnit(clause, UNIT.speed);
  // Distinct speeds require a role model beyond this single initial state.
  if (speeds.length !== 1 || speeds[0]! <= 0) return null;
  return /km\s*(?:\/\s*h|ph|h\^-1)/i.test(clause)
    ? speeds[0]! / 3.6
    : speeds[0]!;
}
export function projectileGravity(question: string): number | null {
  const text = prepareStem(question);
  const match = new RegExp(
    `(?:\\bg\\s*=|acceleration due to gravity(?: is| of| =)?)\\s*${STEM_NUMBER}(?:\\s*m\\s*\\/\\s*s\\^2(?![\\w^])|(?!\\s*(?:[*/^]|m\\b|cm\\b|km\\b)))`,
    "i",
  ).exec(text);
  return match ? parseStemNumber(match[1]!) : null;
}

/** The fully stated ballistic launch supplies one source state to narration and geometry. */
export function applyProjectileSourceAuthority(
  question: string,
  plan: import("../contracts/contractsV3").TurnPlanV3,
): import("../contracts/contractsV3").TurnPlanV3 | null {
  const height = projectileLaunchHeight(question);
  const speed = projectileLaunchSpeed(question);
  const angle = projectileLaunchAngle(question);
  const gravity = projectileGravity(question);
  if (
    height === null ||
    speed === null ||
    angle === null ||
    gravity === null ||
    gravity <= 0 ||
    angle < 0 ||
    angle >= 90 ||
    /\b(?:drag|wind|air resistance)\b/i.test(
      question.replace(/\b(?:ignore|neglect)\s+air resistance\b/gi, ""),
    )
  )
    return null;
  const inputs = [
    {
      id: "h0",
      symbol: "h0",
      aliases: ["h0", "h", "height", "launchheight", "towerheight"],
      value: height,
      unit: "m",
    },
    {
      id: "u",
      symbol: "u",
      aliases: ["u", "v0", "u0", "speed", "initialspeed", "initialvelocity"],
      value: speed,
      unit: "m/s",
    },
    {
      id: "theta",
      symbol: "theta",
      aliases: ["theta", "angle", "alpha"],
      value: angle,
      unit: "degree",
    },
    {
      id: "g",
      symbol: "g",
      aliases: ["g", "gravity"],
      value: gravity,
      unit: "m/s^2",
    },
  ];
  const key = (value: string) => value.replace(/[{}_\\\s]/g, "").toLowerCase();
  const givens = plan.givens.map((quantity) => {
    const input = inputs.find((row) =>
      row.aliases.includes(key(quantity.symbol)),
    );
    return input
      ? {
          ...quantity,
          value: input.value,
          unit: input.unit,
          sourceText: `${quantity.symbol} = ${input.value} ${input.unit}`,
        }
      : quantity;
  });
  for (const input of inputs) {
    if (givens.some((quantity) => input.aliases.includes(key(quantity.symbol))))
      continue;
    let id = input.id;
    while ([...givens, ...plan.derived].some((quantity) => quantity.id === id))
      id = `source_${id}`;
    givens.push({
      id,
      symbol: input.symbol,
      value: input.value,
      unit: input.unit,
      provenance: "given",
      sourceText: `${input.symbol} = ${input.value} ${input.unit}`,
    });
  }
  const vx = speed * Math.cos((angle * Math.PI) / 180);
  const vy0 = speed * Math.sin((angle * Math.PI) / 180);
  const time = (vy0 + Math.sqrt(vy0 * vy0 + 2 * gravity * height)) / gravity;
  const outputs: Record<string, { value: number; unit: string }> = {
    t: { value: time, unit: "s" },
    r: { value: vx * time, unit: "m" },
    vx: { value: vx, unit: "m/s" },
    vy: { value: vy0 - gravity * time, unit: "m/s" },
  };
  const touched = new Set<string>();
  const derived = plan.derived.map((quantity) => {
    const role = key(quantity.symbol);
    const evidence = `${quantity.id} ${quantity.sourceText ?? ""}`.replace(/[_{}]/g, " ");
    const proven = role === "t" ? /\b(?:total flight time|time of flight|flight time|time (?:to|until) (?:hit|reach)(?:s|ing)? (?:the )?ground)\b/i.test(evidence)
      : role === "r" ? /\b(?:range|horizontal (?:range|distance|displacement))\b/i.test(evidence)
      : role === "vy" ? /\b(?:landing|impact|final|just before (?:hitting|reaching) (?:the )?ground)\b/i.test(evidence)
      : role === "vx" ? /\bhorizontal (?:component|velocity|speed)\b/i.test(evidence) : false;
    const output = proven ? outputs[role] : undefined;
    if (!output || quantity.unit !== output.unit) return quantity;
    touched.add(quantity.id);
    return {
      ...quantity,
      value: output.value,
      sign: output.value < 0 ? ("negative" as const) : ("positive" as const),
      uncertainty: 0,
      sourceText: `Source ballistic equation ${quantity.symbol} = ${output.value} ${output.unit}`,
    };
  });
  return {
    ...plan,
    givens,
    derived,
    qualitativeClaims: plan.qualitativeClaims.filter(
      (claim) => !claim.relatedQuantityIds?.some((id) => touched.has(id)),
    ),
  };
}
