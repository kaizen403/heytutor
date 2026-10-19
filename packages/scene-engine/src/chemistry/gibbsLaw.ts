/** Measured Gibbs affine law on a source-owned domain; schematic one-point mode stays separate. */
import type { SceneDocument } from "../types";
import { CHEMISTRY_SCALAR_PATTERN, chemistryQuestionSpan, chemistryPlanBindingsValid,
  chemistryCanonicalValuesAgree, readChemistryQuantity, readChemistryQuantityDeclaration,
  type ChemistryDimension, type ChemistryQuantityConsumption, type ChemistryReading, type ChemistrySpan } from "./quantityReader";
import { readSourceQuantityRange, sourceQuantityRangeOwnsDimension, sourceQuantityRangeInventoryOwned } from "./sourceQuantityRange";
import { requestedSourceRoleStarts } from "./sourceRoleRequests";
import { buildSourceLawGraphFigure } from "./lawGraphFigure";
import type { LawBinding, SourceLawGraph } from "./sourceLawGraph";
import type { ChemPlanQuantity } from "./sceneKit";
const delta=String.raw`(?:[Δδ∆]|\bDelta)\s*`;
const h=new RegExp(`(?:enthalpy\\s+change\\s*)?${delta}H\\b|\\benthalpy(?:\\s+change)?\\b`,"i");
const s=new RegExp(`(?:entropy\\s+change\\s*)?${delta}S\\b|\\bentropy(?:\\s+change)?\\b`,"i");
const g=new RegExp(`${delta}G\\b`,"gi");
const relation=new RegExp(`${delta}G\\s*=\\s*${delta}H\\s*[-−]\\s*T\\s*(?:[*·×]\\s*)?${delta}S\\b`,"gi");
const src=(question:string,span:ChemistrySpan)=>({span,text:question.slice(span.start,span.end)});
function binding(question:string,reading:ChemistryReading,role:string):LawBinding {
  const token=new RegExp(`^${CHEMISTRY_SCALAR_PATTERN}`).exec(reading.source.text)!;
  const scalar={start:reading.source.span.start,end:reading.source.span.start+token[0].trimEnd().length};
  const unit=reading.rawUnit?{start:reading.source.span.end-reading.rawUnit.length,end:reading.source.span.end}:undefined;
  return{role,value:reading.value,dimension:reading.dimension,unit:reading.canonicalUnit,scalarSource:src(question,scalar),...(unit?{unitSource:src(question,unit)}:{})};
}
/** Claims a requested affine Gibbs plot with an explicit interval; no topic/ID lookup. */
export function claimsMeasuredGibbsGraph(question:string):boolean {
  return /\b(?:draw|plot|sketch)\b/i.test(question)
    && (new RegExp(`${delta}G\\b`,"i").test(question)||/\bGibbs\s+(?:free\s+)?energy\b/i.test(question))
    && /\b(?:from|over|between|for)\s+(?:[+−–—.\d-]|unknown\b|unreadable\b|unspecified\b)/i.test(question);
}
export function buildMeasuredGibbsGraph(question:string,quantities:ChemPlanQuantity[]):SceneDocument|null {
  if(!claimsMeasuredGibbsGraph(question)||!chemistryPlanBindingsValid(question,quantities))return null;
  const body=question.slice(0,chemistryQuestionSpan(question).end);
  const plotOwner=new RegExp(`\\b(?:draw|plot|sketch)\\s+(?:(?:the|a)\\s+)?(?:(?:line|graph|plot)\\s+(?:of|for)\\s+)?(?:${delta}G\\b|Gibbs\\s+(?:free\\s+)?energy(?:\\s+change)?\\b)`,"i");
  if(!plotOwner.test(body))return null;
  const range=readSourceQuantityRange({question,dimension:"temperature",targetUnit:"K"});
  if(range.state!=="valid" || range.domain[0]<=0)return null;
  const expressions=[...body.matchAll(relation)]; if(expressions.length!==1)return null;
  const equation=expressions[0]!, equationSpan={start:equation.index!,end:equation.index!+equation[0].length};
  const equationTail=body.slice(equationSpan.end);
  const equationPrefix=body.slice(0,equationSpan.start).split(/[;!?\n]|\.(?=\s|$)/).at(-1)!;
  const completeOwner=equationPrefix.trim()===""||/\b(?:draw|plot|sketch|show|use|using)\s+(?:(?:the|a)\s+)?(?:(?:relation|equation)\s*:?\s*)?$/i.test(equationPrefix);
  if(!completeOwner)return null;
  // Parse the complete equation owner. A prefix of H-TS*2 or H-TS^2
  // cannot be used as the unmodified Gibbs law.
  if(!/^(?:\s*$|\s*[,.;!?]|\s+(?:from|over|between|for)\b|\s+and\s+(?:mark|show|label)\b)/i.test(equationTail))return null;
  const owners=([...[...body.matchAll(new RegExp(h.source,"gi"))].map(m=>({role:"H" as const,start:m.index!,end:m.index!+m[0].length,phrase:h})),
    ...[...body.matchAll(new RegExp(s.source,"gi"))].map(m=>({role:"S" as const,start:m.index!,end:m.index!+m[0].length,phrase:s}))])
    .filter(owner=>!(owner.start>=equationSpan.start && owner.end<=equationSpan.end))
    .filter((owner,index,all)=>!all.some((other,k)=>k!==index && other.start<=owner.start&&other.end>=owner.end&&(other.start<owner.start||other.end>owner.end)))
    .sort((a,b)=>a.start-b.start);
  const requested=requestedSourceRoleStarts(body,owners.map(owner=>({start:owner.start,end:owner.end})));
  const consumed:ChemistryQuantityConsumption[]=[]; const hs:Partial<Record<"H"|"S",ChemistryReading>>={};
  for(const[index,owner]of owners.entries()) {
    const next=owners[index+1];const boundary=/[;!?\n]|\.(?=\s|$)/.exec(body.slice(owner.end,next?.start??body.length));
    const end=boundary?owner.end+boundary.index:next?.start??body.length;
    const payload=body.slice(owner.end,end);
    if(next?.role===owner.role && /^\s*[,:(]?\s*$/.test(payload))continue;
    if(requested.has(owner.start))return null; // Additional requested H/S marks need their own complete operator.
    const dimensions=owner.role==="H"?["molar_energy","energy"] as const:["molar_entropy","entropy"] as const;
    let reading:ChemistryReading|null=null;
    for(const dimension of dimensions) {
      const targetUnit=dimension==="molar_energy"?"kJ/mol":dimension==="energy"?"kJ":dimension==="molar_entropy"?"J/(mol K)":"J/K";
      const read=readChemistryQuantity({question,after:new RegExp(`^(?:${owner.phrase.source})`,"i"),within:{start:owner.start,end},dimension,targetUnit});
      if(read.ok){reading=read.reading;break;}
    }
    if(!reading)return null;
    const previous=hs[owner.role];if(previous&&(previous.dimension!==reading.dimension||!chemistryCanonicalValuesAgree(previous.value,reading.value)))return null;
    hs[owner.role]=reading;consumed.push({reading,owner:owner.role});
  }
  if(!hs.H||!hs.S)return null;
  const molar=hs.H.dimension==="molar_energy";if(molar!==(hs.S.dimension==="molar_entropy"))return null;
  for(const dimension of ["molar_energy","energy","molar_entropy","entropy"] as const)
    if(!sourceQuantityRangeInventoryOwned({question,dimension:"temperature",targetUnit:"K"},range,dimension,
      consumed.filter(item=>item.reading.dimension===dimension)))return null;
  // Shared-unit lower endpoints have already been read against their explicit
  // source unit. The dimension inventory contains the unit-bearing occurrences.
  if(!sourceQuantityRangeOwnsDimension({question,dimension:"temperature",targetUnit:"K"},range))return null;
  const temperatureOwners=[...body.matchAll(/\b(?:temperature|T(?:_?\d+)?)(?![A-Za-z0-9_])/gi)];
  for(const owner of temperatureOwners) {
    const start=owner.index!,end=start+owner[0].length;
    if(start>=equationSpan.start&&end<=equationSpan.end)continue;
    if(/^[- ]independent\b/i.test(body.slice(end)))continue;
    if(range.span.start>=end&&body.slice(end,range.span.start).trim()==="")continue;
    const declaration=readChemistryQuantityDeclaration({question,after:new RegExp(`^(?:${owner[0].replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})`),within:{start,end:body.length},dimension:"temperature",targetUnit:"K",owner:"extra temperature"});
    if(declaration.state!=="absent")return null;
  }
  const owned=[...consumed.map(item=>item.reading.source.span),range.span];
  for(const mention of body.matchAll(g)) {
    if(mention.index!>=equationSpan.start&&mention.index!+mention[0].length<=equationSpan.end)continue;
    const tail=body.slice(mention.index!+mention[0].length);
    if(/^\s*(?:=|is\b)/i.test(tail)) {
      const zero=new RegExp(`^\\s*=\\s*(0)\\s*(?:and\\s+(?:mark|show|label)\\s+(?:(?:the|both)\\s+)?(?:positive\\s+and\\s+negative|negative\\s+and\\s+positive|sign)\\s+(?:${delta}G\\s+)?regions?)?\\s*(?=[.;!?]|$)`,"i").exec(tail);
      if(!zero||!/\b(?:mark|show|find|determine)\s*$/i.test(body.slice(0,mention.index)))return null;
      const start=mention.index!+mention[0].length+zero[0].indexOf("0");owned.push({start,end:start+1});
    }
  }
  for(const literal of body.matchAll(new RegExp(CHEMISTRY_SCALAR_PATTERN,"g"))) {
    const start=literal.index!+literal[0].length-literal[0].trimStart().length,end=literal.index!+literal[0].trimEnd().length;
    if(!owned.some(span=>span.start<=start&&span.end>=end))return null;
  }
  const H=hs.H.value, slope=-hs.S.value/1000;
  const [a,b]=range.domain;const ya=H+slope*a,yb=H+slope*b;
  if(!Number.isFinite(ya)||!Number.isFinite(yb)||slope===0)return null;
  const unit=molar?"kJ/mol":"kJ";const crossing=-H/slope;
  const model:SourceLawGraph={version:"chemistry-source-law-graph/v1",question,family:"chem_thermo",relationSource:src(question,equationSpan),
    bindings:[binding(question,hs.H,"enthalpy"),binding(question,hs.S,"entropy"),...range.readings.map((reading,index)=>({role:index===0?"domain lower":"domain upper",value:reading.value,dimension:"temperature" as ChemistryDimension,unit:"K",scalarSource:src(question,range.scalarSpans[index]!),unitSource:src(question,range.unitSpans[index]!)}))],
    x:{symbol:"T",label:"T / K",unit:"K",domain:[a,b],transform:"linear"},
    y:{symbol:"ΔG",label:`ΔG / ${unit}`,unit,domain:[Math.min(ya,yb,0),Math.max(ya,yb,0)],transform:"linear"},
    curves:[{id:"gibbs_line",label:"ΔG=ΔH−TΔS",relation:{operator:"affine",slope,intercept:H},domain:[a,b]}],
    points:[{curveId:"gibbs_line",x:a,y:ya},{curveId:"gibbs_line",x:b,y:yb}],notes:[`slope=${slope} ${unit}/K`]};
  if(crossing>=a&&crossing<=b){model.points.push({curveId:"gibbs_line",x:crossing,y:0,label:`ΔG=0 at ${crossing} K`});model.notes.push(`T<${crossing} K: ΔG${slope<0?">":"<"}0`,`T>${crossing} K: ΔG${slope<0?"<":">"}0`);}
  else model.notes.push(`ΔG${ya<0?"<":">"}0 on the source domain`);
  return buildSourceLawGraphFigure(model);
}
