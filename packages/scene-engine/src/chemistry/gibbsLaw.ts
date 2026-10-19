/** Measured Gibbs affine law on a source-owned domain; schematic one-point mode stays separate. */
import type { SceneDocument, RenderScene } from "../types";
import { compileSceneDocument } from "../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import { parseMathExpression } from "../math/expression";
import { sourceLawExpressionMatches } from "./sourceLawExpression";
import { round } from "../archetypes/document";
import { lawLabelLines } from "./sourceLawContext";
import { CHEMISTRY_SCALAR_PATTERN, chemistryQuestionSpan, chemistryPlanBindingsValid,
  chemistryCanonicalValuesAgree, readChemistryQuantity, readChemistryQuantityDeclaration,
  type ChemistryDimension, type ChemistryQuantityConsumption, type ChemistryReading, type ChemistrySpan } from "./quantityReader";
import { readSourceQuantityRange, sourceQuantityRangeOwnsDimension, sourceQuantityRangeInventoryOwned } from "./sourceQuantityRange";
import { requestedSourceRoleStarts } from "./sourceRoleRequests";
import { buildSourceLawGraphFigure } from "./lawGraphFigure";
import type { LawBinding, SourceLawGraph } from "./sourceLawGraph";
import type { ChemPlanQuantity } from "./sceneKit";
import { SourceLawClauses, lawWord, type LawAxisMeaning } from "./sourceLawClauses";
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
/** A Gibbs line owns the whole requested representation as well as every
 * scalar. Unknown required marks or opposed axes cannot borrow a valid law. */
function completeGibbsSource(question: string, equation: ChemistrySpan, range: ChemistrySpan, declarations: ChemistrySpan[]): boolean {
  const clauses = new SourceLawClauses(question);
  const d = `(?:[Δδ∆]|${lawWord("Delta")})\\s*`;
  const change = `${d}G\\b`;
  const temperature = `(?:T\\b|${lawWord("temperature")})`;
  const energy = `(?:${change}|${lawWord("Gibbs")}\\s+(?:${lawWord("free")}\\s+)?${lawWord("energy")}(?:\\s+${lawWord("change")})?)`;
  const x: LawAxisMeaning = { symbol: "T", operation: "quantity", syntax: [temperature] };
  const y: LawAxisMeaning = { symbol: "ΔG", operation: "quantity", syntax: [energy] };
  const article = `(?:(?:${lawWord("the")}|${lawWord("a")})\\s+)?`;
  const verbs = ["draw", "plot", "sketch"].map(lawWord).join("|");
  const object = `(?:(?:${lawWord("line")}|${lawWord("graph")}|${lawWord("plot")})\\s+(?:${lawWord("of")}|${lawWord("for")})\\s+)?`;
  clauses.consume(`(?:${verbs})\\s+${article}${object}${energy}(?:\\s+(?:${lawWord("against")}|${lawWord("versus")})\\s+${article}${temperature})?`, "graph");
  if (!clauses.repeatedAxes(x, y)) return false;
  clauses.bind(equation, "relation"); clauses.bind(range, "domain");
  for (const declaration of declarations) clauses.bind(declaration, "declaration");
  const owner = /\b(?:show|use|using)\s+(?:(?:the|a)\s+)?(?:(?:relation|equation)\s*:?\s*)?$/i.exec(question.slice(0, equation.start));
  if (owner) clauses.bind({ start: owner.index, end: equation.end }, "relation");
  // Closed physical assumptions/grammar operators; arbitrary contextual prose
  // remains unowned even when it contains no scalar or drawing verb.
  clauses.consume(`${lawWord("for")}\\s+${article}(?:(?:${lawWord("chemical-change model")}|${lawWord("reaction")})\\s+${lawWord("at constant pressure")}|${lawWord("constant-pressure")}\\s+(?:${lawWord("reaction")}|${lawWord("model")}))`, "context");
  clauses.consume(`(?:${lawWord("using")}\\s+)?${lawWord("temperature-independent")}`, "context");
  clauses.consume(lawWord("independent of temperature"), "context");
  const mark = ["mark", "show", "label", "find", "determine"].map(lawWord).join("|");
  const zero = `(?:${lawWord("the")}\\s+)?(?:${lawWord("zero crossing")}|${change}\\s*=\\s*0)`;
  const signs = `(?:${lawWord("positive and negative")}|${lawWord("negative and positive")})`;
  const regions = `(?:(?:${lawWord("the")}|${lawWord("both")})\\s+)?(?:${lawWord("regions of")}\\s+${signs}(?:\\s+${change})?|${signs}\\s+(?:${change}\\s+)?${lawWord("regions")}|${lawWord("sign regions")})`;
  clauses.consume(`(?:${mark})\\s+${zero}(?:\\s+${lawWord("and")}\\s+${regions})?`, "mark");
  clauses.consume(`(?:${mark})\\s+${regions}`, "mark");
  return clauses.complete();
}
/** Claims a requested affine Gibbs plot with an explicit interval; no topic/ID lookup. */
export function claimsMeasuredGibbsGraph(question:string):boolean {
  return /\b(?:draw|plot|sketch)\b/i.test(question)
    && (new RegExp(`${delta}G\\b`,"i").test(question)||/\bGibbs\s+(?:free\s+)?energy\b/i.test(question))
    && /\b(?:from|over|between|for)\s+(?:[+−–—.\d-]|unknown\b|unreadable\b|unspecified\b)/i.test(question);
}
function readMeasuredGibbsModel(question:string,quantities:ChemPlanQuantity[]):SourceLawGraph|null {
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
  const consumed:ChemistryQuantityConsumption[]=[]; const declarations:ChemistrySpan[]=[]; const hs:Partial<Record<"H"|"S",ChemistryReading>>={};
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
    if(!reading || !/^\s*(?:=|is)\s*$/i.test(body.slice(owner.end,reading.source.span.start)))return null;
    declarations.push({start:owner.start,end:reading.source.span.end});
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
  if(!completeGibbsSource(body,equationSpan,range.span,declarations))return null;
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
  const boundaries=[a,...(crossing>a&&crossing<b?[crossing]:[]),b];
  model.regions=[];
  for(let index=1;index<boundaries.length;index++) {
    const lo=boundaries[index-1]!,hi=boundaries[index]!,mid=lo+(hi-lo)/2,value=H+slope*mid;
    if(!(mid>lo&&mid<hi)||!Number.isFinite(value)||value===0)return null;
    model.regions.push({domain:[lo,hi],label:value>0?"ΔG > 0":"ΔG < 0",meaning:value>0?"positive":"negative"});
  }
  return model;
}

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const fmt=(value:number)=>value===0?"0":(Math.abs(value)>=1e4||Math.abs(value)<.001?Number(value.toPrecision(4)).toExponential():Number(value.toPrecision(6)).toString()).replace(/e\+?(-?)0*(\d+)/,"e$1$2");
/** Private original-question witness for the affine sign-region operator.
 * It certifies this issuer's output, never arbitrary persisted/cache documents. */
export function verifyMeasuredGibbsRegionInk(document:SceneDocument,originalQuestion:string,suppliedPaint?:RenderScene):boolean {
  try {
    const model=readMeasuredGibbsModel(originalQuestion,[]);
    if(!model||document.source.question!==originalQuestion||!same(document.source.sourceLawGraph,model))return false;
    const relation=model.curves[0]!.relation;
    if(relation.operator!=="affine")return false;
    const texts=[model.x.label,model.y.label,...model.x.domain.map(fmt),...model.y.domain.map(fmt),
      ...model.points.flatMap((point,index)=>[`${String.fromCharCode(65+index)}: x=${fmt(point.x)}`,`y=${fmt(point.y)}`]),
      ...model.regions!.map(region=>region.label)];
    const labels=document.entities.filter(e=>e.kind==="label");
    if(!same(labels.map(e=>e.label).sort(),texts.flatMap(lawLabelLines).sort()))return false;
    const other=[model.curves[0]!.label,...model.points.map((_,i)=>String.fromCharCode(65+i)),
      ...(model.y.domain[0]<0&&model.y.domain[1]>0?["y=0"]:[])].sort();
    if(!same(document.entities.filter(e=>e.kind!=="label"&&e.label!==undefined).map(e=>e.label).sort(),other))return false;
    if(document.annotations.length!==1||document.annotations[0]!.kind!=="callout"||document.annotations[0]!.targetIds.length!==0||document.annotations[0]!.text!==[model.relationSource.text,...model.notes].join(" "))return false;
    const curves=document.constructions.filter(c=>c.operator==="function_curve");
    if(curves.length!==1||typeof curves[0]!.inputs.expression!=="string"||curves[0]!.inputs.xMin!==0||curves[0]!.inputs.xMax!==8)return false;
    const expression=parseMathExpression(curves[0]!.inputs.expression);
    // Whole-expression affine identity against the fresh source-derived display
    // coefficients is structural; finite samples remain rounding checks only.
    if(!sourceLawExpressionMatches(curves[0]!.inputs.expression,model,relation))return false;
    // Secondary source-value checks retain the existing physical rounding bar.
    for(let index=0;index<=128;index++) {
      const t=index/128,x=model.x.domain[0]+t*(model.x.domain[1]-model.x.domain[0]);
      const expected=(relation.slope*x+relation.intercept-model.y.domain[0])*5/(model.y.domain[1]-model.y.domain[0]);
      if(Math.abs(expression.evaluate(t*8)-expected)>1e-9)return false;
    }
    for(const region of model.regions!) {
      const entity=labels.find(e=>e.label===region.label&&e.role===region.meaning);if(!entity)return false;
      const construction=document.constructions.filter(c=>c.outputs.includes(entity.id));
      if(construction.length!==1||construction[0]!.operator!=="label"||construction[0]!.inputs.text!==region.label||!document.revealGroups.some(g=>g.entityIds.includes(entity.id)))return false;
      const anchor=document.constructions.find(c=>c.operator==="point"&&c.outputs.includes(String(construction[0]!.inputs.target)));
      const mid=region.domain[0]+(region.domain[1]-region.domain[0])/2;
      const x=(mid-model.x.domain[0])*8/(model.x.domain[1]-model.x.domain[0]);
      if(!anchor||anchor.inputs.x!==round(x)||anchor.inputs.y!==2.75)return false;
    }
    const validated=validateSceneDocument(pruneDeadSceneEntities(structuredClone(document)as unknown as Record<string,unknown>));if(!validated.document)return false;
    const compiled=compileSceneDocument(validated.document);if(!compiled.ok||!compiled.renderScene)return false;
    if(suppliedPaint&&!same(suppliedPaint,compiled.renderScene))return false;
    for(const region of model.regions!) {
      const entity=labels.find(e=>e.label===region.label&&e.role===region.meaning)!;
      const native=compiled.renderScene.primitives.filter(p=>p.entityId===entity.id&&p.kind==="label");
      if(native.length!==1||native[0]!.text!==region.label||!native[0]!.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))return false;
      const b=native[0]!.provenance?.labelBounds as {x:number;y:number;width:number;height:number}|undefined;
      if(!b||![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0||b.x<400||b.x+b.width>1160||b.y<0||b.y+b.height>700)return false;
    }
    return true;
  }catch{return false;}
}
export function buildMeasuredGibbsGraph(question:string,quantities:ChemPlanQuantity[]):SceneDocument|null {
  const model=readMeasuredGibbsModel(question,quantities);if(!model)return null;
  const document=buildSourceLawGraphFigure(model,question);if(!document)return null;
  const relation=model.curves[0]!.relation;if(relation.operator!=="affine")return null;
  for(const[index,region]of model.regions!.entries()) {
    const x=region.domain[0]+(region.domain[1]-region.domain[0])/2;
    document.assertions.push({id:`gibbs_sign_region_${index}`,predicate:"function_value",entities:[model.curves[0]!.id],
      expected:{x:(x-model.x.domain[0])*8/(model.x.domain[1]-model.x.domain[0]),y:(relation.slope*x+relation.intercept-model.y.domain[0])*5/(model.y.domain[1]-model.y.domain[0])},severity:"fatal",reason:`source affine value inside ${region.meaning} interval`});
  }
  return verifyMeasuredGibbsRegionInk(document,question)?document:null;
}
