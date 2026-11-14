/** Graham comparison law. Equal T/P and the same membrane are source facts;
 * equal volumes are additionally required when a time ratio replaces a rate ratio. */
import type { SceneDocument } from "../types";
import type { ProblemIR, ExpressionNodeIR } from "../ir/problemIR";
import { ChemScene, type ChemPlanQuantity } from "./sceneKit";
import { chemistryCompositionPlanAgrees } from "./massMolarity";
import { CHEMISTRY_SCALAR_PATTERN, readChemistryLiteral, parseChemistryScalar, chemistryCanonicalValuesAgree, type ChemistryReading, type ChemistrySpan } from "./quantityReader";
import { parseMathExpression } from "../math/expression";

export const EFFUSION_FAMILY = "chem_effusion" as const;
const scalar = CHEMISTRY_SCALAR_PATTERN;
const gas = String.raw`[A-Z][A-Za-z0-9]*`;
const context = String.raw`At\s+the\s+same\s+temperature\s+and\s+pressure,\s*gases\s+(?<a>${gas})\s+and\s+(?<b>${gas})\s+effuse\s+through\s+the\s+same\s+porous\s+membrane\.\s*`;
const known = String.raw`The\s+molar\s+mass\s+of\s+\k<a>\s+is\s+(?<mass>${scalar})\s*(?:g/mol|kg/mol)\.\s*`;
const ask = String.raw`\s*(?:Calculate|Find|Determine)\s+the\s+molar\s+mass\s+of\s+(?<target>${gas})\s*[.!?]?\s*$`;
const ratio = String.raw`(?<ratio>${scalar})`;
const patterns = [
  {mode:"rate" as const, expression:new RegExp(String.raw`^\s*${context}${known}The\s+effusion\s+rate\s+ratio\s+r_(?<num>${gas})\s*/\s*r_(?<den>${gas})\s*=\s*${ratio}\.${ask}`,"d")},
  {mode:"time" as const, expression:new RegExp(String.raw`^\s*${context}${known}For\s+equal\s+gas\s+volumes,\s*the\s+effusion\s+time\s+ratio\s+t_(?<num>${gas})\s*/\s*t_(?<den>${gas})\s*=\s*${ratio}\.${ask}`,"d")},
  {mode:"samples" as const, expression:new RegExp(String.raw`^\s*${context}${known}A\s+(?<va>${scalar})\s*(?:mL|L|dm\^?3|cm\^?3)\s+sample\s+of\s+\k<a>\s+takes\s+(?<ta>${scalar})\s*(?:s|min|h)\s+to\s+effuse\.\s*A\s+(?<vb>${scalar})\s*(?:mL|L|dm\^?3|cm\^?3)\s+sample\s+of\s+\k<b>\s+takes\s+(?<tb>${scalar})\s*(?:s|min|h)\s+to\s+effuse\.${ask}`,"d")},
];
export interface EffusionSource {
  question: string;
  knownGas: string;
  unknownGas: string;
  molarMass: ChemistryReading;
  /** Always r_known/r_unknown, never an untyped source quotient. */
  rateRatio: number;
  unknownMass: number;
  mode: "rate" | "time" | "samples";
  relationSpan: ChemistrySpan;
  bindings: readonly ChemistryReading[];
}
/** Subject presence comes from the typed gas comparison, never the word shared with clinical fluid accumulation. */
export function claimsEffusion(question: string): boolean { return readEffusionSource(question) !== null; }
export function readEffusionSource(question: string): EffusionSource | null {
  const entry = patterns.map(pattern=>({...pattern,match:pattern.expression.exec(question)})).find(entry=>entry.match);
  if (!entry?.match?.groups || !entry.match.indices?.groups) return null;
  const {mode,match}=entry, groups=match.groups!;
  const span=(name:string): ChemistrySpan=>{const [start,end]=match.indices!.groups![name]!;return {start,end};};
  if (groups.a===groups.b || groups.target!==groups.b) return null;
  const mass=readChemistryLiteral({question,scalarSpan:span("mass"),dimension:"molar_mass",targetUnit:"g/mol"});
  if (!mass.ok || !(mass.reading.value>0)) return null;
  const bindings: ChemistryReading[]=[mass.reading];
  let rateRatio: number;
  if (mode==="samples") {
    const values: number[]=[];
    for (const name of ["va","ta","vb","tb"]) {
      const dimension=name.startsWith("v")?"volume":"time";
      const reading=readChemistryLiteral({question,scalarSpan:span(name),dimension,targetUnit:dimension==="volume"?"L":"s"});
      if (!reading.ok || !(reading.reading.value>0)) return null;
      bindings.push(reading.reading);values.push(reading.reading.value);
    }
    const [va,ta,vb,tb]=values as [number,number,number,number];
    rateRatio=(va/ta)/(vb/tb);
  } else {
    // Exact original scalar span closes the unitless ratio; an appended unit,
    // changed species or a flipped quotient cannot survive the full relation.
    const readRatio=parseChemistryScalar(question,span("ratio"));
    if (!readRatio.ok || !(readRatio.reading>0)) return null;
    const raw=readRatio.reading;
    const forward=groups.num===groups.a && groups.den===groups.b;
    const reverse=groups.num===groups.b && groups.den===groups.a;
    if (!forward && !reverse) return null;
    const ordered=forward?raw:1/raw;
    rateRatio=mode==="rate"?ordered:1/ordered;
  }
  const unknownMass=mass.reading.value*rateRatio**2;
  if (![rateRatio,unknownMass].every(value=>Number.isFinite(value)&&value>0)) return null;
  const independent=parseMathExpression(`${mass.reading.value}*(${rateRatio})^2`).evaluate(0);
  if (!chemistryCanonicalValuesAgree(independent,unknownMass)
    || !chemistryCanonicalValuesAgree(Math.sqrt(unknownMass/mass.reading.value),rateRatio)) return null;
  return {question,knownGas:groups.a!,unknownGas:groups.b!,molarMass:mass.reading,rateRatio,unknownMass,mode,
    relationSpan:{start:mass.reading.source.span.end,end:question.length},bindings};
}

export function effusionProblem(question: string): ProblemIR | null {
  const source=readEffusionSource(question);
  if (!source) return null;
  const n=(value:number): ExpressionNodeIR=>({kind:"number",value});
  const root: ExpressionNodeIR={kind:"binary",operator:"*",left:n(source.molarMass.value),right:{kind:"binary",operator:"^",left:n(source.rateRatio),right:n(2)}};
  return {schemaVersion:"problem-ir/v1",id:"effusion_comparison",question,
    facts:[{id:"comparison",kind:"given",statement:question,evidence:{source:"question",start:0,end:question.length,quote:question}}],
    entities:[],constraints:[],representationIntents:[],expressions:[{id:"unknown_mass",valueType:"scalar",root,evidenceFactIds:["comparison"]}],
    solveRequests:[{id:"molar_mass",kind:"evaluate",expressionId:"unknown_mass"}]};
}
export function buildEffusionScene(question: string, quantities: ChemPlanQuantity[], _schematic: boolean): SceneDocument | null {
  const source=readEffusionSource(question);
  if (!source || !chemistryCompositionPlanAgrees(question,quantities,[
    {aliases:[`M_${source.knownGas}`,"known_mass"],value:source.molarMass.value,unit:"g/mol",dimension:"molar_mass"},
    {aliases:[`M_${source.unknownGas}`,"unknown_mass"],value:source.unknownMass,unit:"g/mol",dimension:"molar_mass",allowDerivedRounding:true},
    {aliases:["rate_ratio"],value:source.rateRatio,unit:"1",dimension:"dimensionless",allowDerivedRounding:source.mode==="samples"},
    ...source.bindings.slice(1).map((reading,index)=>({aliases:[[`V_${source.knownGas}`,`t_${source.knownGas}`,`V_${source.unknownGas}`,`t_${source.unknownGas}`][index]!],value:reading.value,unit:reading.canonicalUnit,dimension:reading.dimension})),
  ])) return null;
  const c=new ChemScene(question,"source-bound Graham effusion comparison",EFFUSION_FAMILY);
  const show=(value:number)=>String(Number(value.toPrecision(6)));
  const rows=[
    ["equal T", "equal p"],
    ["same membrane", "Graham law"],
    [`M_${source.knownGas}=${show(source.molarMass.value)}`,`M_${source.unknownGas}=${show(source.unknownMass)}`],
    ["g/mol", "g/mol"],
    [`r_${source.knownGas}/r_${source.unknownGas}=${show(source.rateRatio)}`,"r ~ 1/sqrt(M)"],
  ];
  if (source.mode === "time") rows.push(["equal volumes", `t_${source.knownGas}/t_${source.unknownGas}=${show(1/source.rateRatio)}`]);
  if (source.mode === "samples") {
    const [va,ta,vb,tb] = source.bindings.slice(1);
    rows.push([`V_${source.knownGas}=${show(va!.value)} L`, `V_${source.unknownGas}=${show(vb!.value)} L`],
      [`t_${source.knownGas}=${show(ta!.value)} s`, `t_${source.unknownGas}=${show(tb!.value)} s`]);
  }
  rows.forEach((row,i)=>row.forEach((text,j)=>c.text(`comparison_${i}_${j}`,{x:j*5,y:4-i*1.2},text,"source effusion comparison",{preserveText:true})));
  const document=c.build({caption:source.mode==="time"?"Equal source gas volumes make the time ratio inverse to the effusion rate ratio. M_unknown = M_known (r_known/r_unknown)^2. Nonmetric law diagram.":source.mode==="samples"?"Each source rate is volume divided by duration in common units. M_unknown = M_known (r_known/r_unknown)^2. Nonmetric law diagram.":"M_unknown = M_known (r_known/r_unknown)^2 under the explicitly equal source conditions. Nonmetric law diagram."});
  const values=[{id:"known_mass",symbol:`M_${source.knownGas}`,value:source.molarMass.value,unit:"g/mol",provenance:"given"},
    {id:"unknown_mass",symbol:`M_${source.unknownGas}`,value:source.unknownMass,unit:"g/mol",provenance:"derived"},
    // The canonical quotient may invert a source ratio or compose volume/time readings.
    {id:"rate_ratio",symbol:"rate_ratio",value:source.rateRatio,unit:"1",provenance:"derived"}];
  source.bindings.slice(1).forEach((reading,index)=>values.push({
    id:["known_volume","known_time","unknown_volume","unknown_time"][index]!,
    symbol:[`V_${source.knownGas}`,`t_${source.knownGas}`,`V_${source.unknownGas}`,`t_${source.unknownGas}`][index]!,
    value:reading.value,unit:reading.canonicalUnit,provenance:"given",
  }));
  document.quantities=values;
  document.source.slotSources=Object.fromEntries(values.map(q=>[q.id,"stem"]));
  document.source.answerQuantityIds=["unknown_mass"];
  document.source.defaultAnswerQuantityIds=["unknown_mass"];
  document.source.answerQuantityValues=Object.fromEntries(values.map(q=>[q.id,q.value]));
  document.source.answerLabelEntityIds=["comparison_2_1"];
  document.source.answerLabelAnnotationIds=[];
  document.source.sourceModel="graham_effusion/v1";
  return document;
}
