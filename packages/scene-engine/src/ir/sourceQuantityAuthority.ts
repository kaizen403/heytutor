import {applyMeasurementQuestionAuthority} from "./measurementQuestionPlanAuthority";
import {readFiniteProgressionSource} from "../math/finiteProgressionSource";
import {finiteProgressionSourceProgram} from "./finiteProgressionSourceProgram";
import {applyFiniteBinomialAuthority} from "./finiteBinomialPlanAuthority";
import {verifyMeasurementSourceAuthority,readScrewGaugeQuestion} from "./measurementSourceAuthority";
/**
 * One seam for source quantity authority.
 *
 * Several topics recompute their quantities from the submitted question
 * (a stated resistor circuit, a uniform circular state). Each one registers
 * here, and the live turn calls `applySourceQuantityAuthority` once, after
 * the ProblemIR reconciliation and before the plan becomes authoritative, so
 * the scene validation and the teaching prompt both read the corrected plan.
 *
 * Contract for a registered authority:
 * - Return null when its topic is not bound for this question. It must not
 *   touch a plan it does not own.
 * - Correct only values whose unit and symbol bind without doubt to one
 *   recomputed quantity; leave every other value exactly as written.
 * - A value of a class the topic recomputes that binds to no single quantity
 *   and equals none of that class is withdrawn from the plan, so narration
 *   never states it (circuit and uniform circular authorities both do this).
 * - Set `declineFigure` when a conflicting value remains that it cannot bind.
 *   The topic's own family re-checks the authoritative plan and declines its
 *   figure on such a value; the flag is reported for telemetry and callers.
 * - Pure and synchronous: no I/O, no model calls.
 *
 * Authorities run in registry order; each receives the plan the previous one
 * returned. Topics are disjoint by construction, so order only matters for
 * telemetry. To register a topic, add one entry to SOURCE_QUANTITY_AUTHORITIES.
 */
import { applyStaticContactTriangleAuthority } from "./staticContactTriangleAuthority";
import {applyCircleSourceAuthority} from "./circleSourceAuthority";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import { bindStatedCircuitProblem } from "./statedCircuitProblemBinding";
import { applyStatedCircuitAuthority, readStatedCircuitProblemSource, readCircuitUnit } from "./statedCircuitAuthority";
import { applyUniformCircularAuthority } from "../physics/uniformCircularSource";
import { applyRelativeMotionAuthority, type MotionQuantityAuthority } from "../physics/motionPlanAgreement";
import { applyRiverCrossingAuthority } from "../physics/riverCrossingSource";

export interface SourceQuantityCorrection {
  quantityId: string;
  symbol: string;
  previous: number;
  corrected: number;
  unit?: string;
}

export interface SourceQuantityAuthorityOutcome {
  topic: string;
  plan: TurnPlanV3;
  corrections: SourceQuantityCorrection[];
  declineFigure: boolean;
  issueCodes: string[];
}

export interface SourceQuantityAuthorityInput {
  question: string;
  plan: TurnPlanV3;
  problemIR: unknown;
}

export interface SourceQuantityAuthority {
  topic: string;
  apply(input: SourceQuantityAuthorityInput): SourceQuantityAuthorityOutcome | null;
}

const circuitAuthority: SourceQuantityAuthority = {
  topic: "physics|12|ohms-law-and-resistance",
  apply({ question, plan, problemIR }) {
    if (!problemIR || !readStatedCircuitProblemSource(question)) return null;
    if (!bindStatedCircuitProblem(question, problemIR)) {
      const withdrawn = new Set(plan.derived.filter((quantity) => readCircuitUnit(quantity.unit)).map((quantity) => quantity.id));
      return {
        topic: this.topic,
        plan: { ...plan, derived: plan.derived.filter((quantity) => !withdrawn.has(quantity.id)),
          qualitativeClaims: plan.qualitativeClaims.filter((claim) => !(claim.relatedQuantityIds ?? []).some((id) => withdrawn.has(id))) },
        corrections: [], declineFigure: true,
        issueCodes: ["circuit_problem_binding", ...[...withdrawn].map(() => "circuit_value_withdrawn")],
      };
    }
    const result = applyStatedCircuitAuthority(question, plan, { requireBoundClaims: true });
    if (!result) return null;
    const before = new Map([...plan.givens, ...plan.derived].map((quantity) => [quantity.id, quantity.value]));
    const corrections = [...result.plan.givens, ...result.plan.derived].flatMap((quantity) => {
      const previous = before.get(quantity.id);
      return previous !== undefined && previous !== quantity.value
        ? [{ quantityId: quantity.id, symbol: quantity.symbol, previous, corrected: quantity.value, unit: quantity.unit }]
        : [];
    });
    return { topic: this.topic, plan: result.plan, corrections, declineFigure: false, issueCodes: result.issues.map((issue) => issue.code) };
  },
};

const uniformCircularAuthority: SourceQuantityAuthority = {
  topic: "physics|2|uniform-circular-motion",
  apply({ question, plan, problemIR }) {
    const result = applyUniformCircularAuthority(question, plan, problemIR);
    if (!result) return null;
    return {
      topic: this.topic,
      plan: result.plan as unknown as TurnPlanV3,
      corrections: result.corrections,
      declineFigure: result.unbound.length > 0,
      issueCodes: [
        ...result.corrections.map(() => "ucm_value_corrected"),
        ...result.withdrawn.map(() => "ucm_value_withdrawn"),
        ...result.unbound.map(() => "ucm_value_unbound_conflict"),
      ],
    };
  },
};

function motionOutcome(topic: string, code: string, result: MotionQuantityAuthority): SourceQuantityAuthorityOutcome {
  return {
    topic,
    plan: result.plan as TurnPlanV3,
    corrections: result.corrections.map(({ quantityId, symbol, previous, corrected, unit }) => ({ quantityId, symbol, previous, corrected, unit })),
    declineFigure: result.unbound.length > 0,
    issueCodes: [
      ...result.corrections.map(() => `${code}_value_corrected`),
      ...result.withdrawn.map(() => `${code}_value_withdrawn`),
      ...result.unbound.map(() => `${code}_value_unbound_conflict`),
    ],
  };
}

const relativeMotionAuthority: SourceQuantityAuthority = {
  topic: "physics|2|relative-velocity",
  apply({ question, plan }) {
    const result = applyRelativeMotionAuthority(question, plan);
    return result ? motionOutcome(this.topic, "relative_motion", result) : null;
  },
};

const riverCrossingAuthority: SourceQuantityAuthority = {
  topic: "physics|2|relative-velocity-in-a-plane",
  apply({ question, plan }) {
    const result = applyRiverCrossingAuthority(question, plan);
    return result ? motionOutcome(this.topic, "river_crossing", result) : null;
  },
};

const staticContactTriangleAuthority:SourceQuantityAuthority = {
  topic:"static-contact-triangle",
  apply({question,plan}) {
    const result=applyStaticContactTriangleAuthority(question,plan);
    return result?{topic:this.topic,plan:result.plan,corrections:result.corrections,declineFigure:result.declineFigure,
      issueCodes:result.withdrawn.map(()=>"contact_triangle_value_withdrawn")}:null;
  },
};

export const SOURCE_QUANTITY_AUTHORITIES: readonly SourceQuantityAuthority[] = [
  {topic:"finite-polynomial-source",apply({question,plan,problemIR}){
    const result=applyFiniteBinomialAuthority(question,plan,problemIR);
    return result?{topic:this.topic,...result}:null;
  }},
  {topic:"finite-progression-source",apply({question,plan,problemIR}){
    if(problemIR==null || readFiniteProgressionSource(question).status!=="ok")return null;
    const admission=finiteProgressionSourceProgram(question,problemIR,plan);
    return admission.status==="ok"?{topic:this.topic,plan,declineFigure:false,issueCodes:[],corrections:[]}:{topic:this.topic,plan:{...plan,givens:[],derived:[],unknowns:[],qualitativeClaims:[]},declineFigure:true,issueCodes:["finite_progression_source_unbound"],corrections:[]};
  }},
  {topic:"measurement-source",apply({question,plan,problemIR}){
    if(problemIR==null){const early=applyMeasurementQuestionAuthority(question,plan);return early?{topic:this.topic,...early}:null;}
    if(readScrewGaugeQuestion(question).status==="none")return null;
    const result=verifyMeasurementSourceAuthority(problemIR,plan,question);
    const corrected=result.plan as TurnPlanV3;
    const old=new Map(plan.derived.map(row=>[row.id,row]));
    return {topic:this.topic,plan:corrected,declineFigure:result.status!=="verified",issueCodes:result.issues.map(row=>row.code),corrections:corrected.derived.flatMap(row=>{const before=old.get(row.id);return before && before.value!==row.value?[{quantityId:row.id,symbol:row.symbol,previous:before.value,corrected:row.value,unit:row.unit}]:[];})};
  }},

  {
    topic:"cartesian-circle-source",
    apply({question,plan,problemIR}) {
      const result=applyCircleSourceAuthority(question,plan,problemIR ?? undefined);
      if (!result) return null;
      const previous=new Map([...plan.givens,...plan.derived].map(row=>[row.id,row]));
      return {topic:this.topic,plan:result.plan,
        corrections:result.plan.derived.flatMap(row=> {
          const old=previous.get(row.id);
          return old && old.value!==row.value?[{quantityId:row.id,symbol:row.symbol,previous:old.value,corrected:row.value,unit:row.unit}]:[];
        }),
        declineFigure:result.issues.some(issue=>issue.code!=="circle_value_corrected"),issueCodes:result.issues.map(issue=>issue.code)};
    },
  },
  staticContactTriangleAuthority,
  circuitAuthority,
  uniformCircularAuthority,
  relativeMotionAuthority,
  riverCrossingAuthority,
];

export interface SourceQuantityAuthorityResult {
  plan: TurnPlanV3;
  outcomes: SourceQuantityAuthorityOutcome[];
}

export function applySourceQuantityAuthority(
  plan: TurnPlanV3,
  problemIR: unknown,
  question: string,
  authorities: readonly SourceQuantityAuthority[] = SOURCE_QUANTITY_AUTHORITIES,
): SourceQuantityAuthorityResult {
  const outcomes: SourceQuantityAuthorityOutcome[] = [];
  let current = plan;
  for (const authority of authorities) {
    const outcome = authority.apply({ question, plan: current, problemIR });
    if (!outcome) continue;
    outcomes.push(outcome);
    current = outcome.plan;
  }
  return { plan: current, outcomes };
}
