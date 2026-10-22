/** Private post-compile proof for source-owned solution-law context. A supplied
 * RenderScene is compared with a fresh ordinary compile, never trusted as proof. */
import type { RenderScene, SceneDocument, RenderPrimitive } from "../types";
import { compileSceneDocument } from "../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import { parseMathExpression } from "../math/expression";
import { sourceLawExpressionMatches } from "./sourceLawExpression";
import { readSourceLawGraph, type SourceLawGraph, type LawChemicalContext } from "./sourceLawGraph";

export interface LawContextColumn { lines: string[] }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (value: number) => value === 0 ? "0" : (Math.abs(value) >= 1e4 || Math.abs(value)<.001 ? Number(value.toPrecision(4)).toExponential() : Number(value.toPrecision(6)).toString()).replace(/e\+?(-?)0*(\d+)/,"e$1$2");
export function lawLabelLines(value: string): string[] {
  const words=value.split(/\s+/).filter(Boolean), lines: string[]=[];
  if (words.some(word=>word.length>16)) return [];
  for (const word of words) {
    const last=lines.length-1;
    if (last>=0 && lines[last]!.length+word.length+1<=16) lines[last]+=` ${word}`;
    else lines.push(word);
  }
  return lines;
}
function sourceModel(model: SourceLawGraph): SourceLawGraph | null {
  const read=readSourceLawGraph(model.question,"chem_solutions");
  // Complete original-source parsing re-establishes all dimensions, identities,
  // assumptions, requests and scalar spans; copied context cannot establish them.
  return read.state==="valid" && read.model.chemicalContext && same(model,read.model) ? read.model : null;
}
const charge = (symbol: string, value: number) => `${symbol}${Math.abs(value)===1?"":Math.abs(value)}${value>0?"+":"-"}`;
function columns(context: LawChemicalContext): LawContextColumn[] {
  if (context.kind==="solubility_equilibrium") {
    const cation=charge(context.cation.symbol,context.cation.charge), anion=charge(context.anion.symbol,context.anion.charge);
    const s=context.solubility.text,C=context.concentration.text;
    return [
      {lines:[`${context.solid.text}(s)`,`${s}: solubility`,`${context.donor.text} source`,`${C}: added ${context.donor.text}`]},
      {lines:["equilibrium",`${context.solid.text}(s)`,`⇌ ${cation}(aq)`,`+ ${anion}(aq)`,context.suppliedRelation.text.replace(/\s/g,""),`total ${anion}: ${C}+${s}`]},
      {lines:["common-ion","suppression",`${C} rises; ${s} falls`,"activities=conc","no complexes","no other rxns","range only"]},
    ];
  }
  const C=context.concentration.text;
  return [
    {lines:[`${context.acid.text}(aq)`,"ideal acid","fully ionised",`[H+]=${C}`]},
    {lines:["pH=-log10","([H+]/M)",`source ${C} range`]},
    {lines:["water ionisation","neglected","range only"]},
  ];
}
/** Facts are freshly derived from the complete external source, never flags. */
export function sourceLawContextColumns(model: SourceLawGraph): LawContextColumn[] | null {
  const fresh=sourceModel(model);
  return fresh?.chemicalContext ? columns(fresh.chemicalContext) : null;
}
function expectedLabels(model: SourceLawGraph, context: LawContextColumn[]): string[] {
  const values=[model.x.label,model.y.label,fmt(model.x.domain[0]),fmt(model.x.domain[1]),fmt(model.y.domain[0]),fmt(model.y.domain[1])];
  for (const region of model.regions??[]) values.push(region.label);
  model.points.forEach((point)=>{
    values.push(`x=${fmt(point.x)}`,`y=${fmt(point.y)}`);
    if (point.detached) values.push("zero: separate");
  });
  for (const fact of model.bindings.filter(binding=>binding.symbol)) {
    values.push(`${fact.symbol}=${fmt(fact.value)}`);
    if (fact.unit!=="1") values.push(fact.unit);
  }
  return [...values,...context.flatMap(column=>column.lines)].flatMap(lawLabelLines).sort();
}
function paintedLabel(primitive: RenderPrimitive): boolean {
  if (primitive.kind!=="label" || !primitive.text || !primitive.points.length || primitive.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))) return false;
  const p=primitive.provenance??{};
  for (const key of ["opacity","fontPx","fontSize","strokeWidth"]) {
    if (p[key]!==undefined && (typeof p[key]!=="number" || !Number.isFinite(p[key]) || p[key]<=0)) return false;
  }
  if (p.hidden===true || p.visible===false || p.transient===true) return false;
  const b=p.labelBounds as {x:number;y:number;width:number;height:number}|undefined;
  return !!b && [b.x,b.y,b.width,b.height].every(Number.isFinite) && b.width>0 && b.height>0 && b.x>=400 && b.y>=0 && b.x+b.width<=1160 && b.y+b.height<=700;
}
function physicalCurves(document: SceneDocument, model: SourceLawGraph): boolean {
  const actual=document.constructions.filter(c=>c.operator==="function_curve");
  if (actual.length!==model.curves.length) return false;
  for (const [index,c] of actual.entries()) {
    const expected=model.curves[index]!;
    if (typeof c.inputs.expression!=="string" || c.inputs.xMin!==0 || c.inputs.xMax!==8 || c.outputs.length!==1) return false;
    const entity=document.entities.find(e=>e.id===c.outputs[0]);
    if (entity?.kind!=="polyline" || entity.label!==expected.label) return false;
    if(!sourceLawExpressionMatches(c.inputs.expression,model,expected.relation))return false;
    const expression=parseMathExpression(c.inputs.expression);
    for(let i=0;i<=128;i++) {
      const t=i/128;
      const x=model.x.transform==="log10"?10**(Math.log10(model.x.domain[0])+t*Math.log10(model.x.domain[1]/model.x.domain[0])):model.x.domain[0]+t*(model.x.domain[1]-model.x.domain[0]);
      const relation=expected.relation;
      const y=relation.operator==="positive_quadratic"?2*relation.product/(Math.sqrt(x*x+4*relation.product)+x):relation.operator==="log_coordinate"?relation.slope*x+relation.intercept:NaN;
      const [lo,hi]=model.y.transform==="log10"?model.y.domain.map(Math.log10):model.y.domain;
      const display=((model.y.transform==="log10"?Math.log10(y):y)-lo!)*5/(hi!-lo!);
      if (!Number.isFinite(display) || Math.abs(expression.evaluate(t*8)-display)>1e-9) return false;
    }
  }
  return true;
}
/** Bounded semantic proof for this operator, not a general document authority.
 * Public callers still owe their own fresh ordinary compilation/admission. */
export function sourceLawContextInkIssue(document: SceneDocument, originalQuestion: string, suppliedPaint?: RenderScene): string | null {
  try {
    if (document.source.question!==originalQuestion) return "external_question_mismatch";
    const candidate=document.source.sourceLawGraph as SourceLawGraph|undefined;
    if (!candidate || candidate.question!==originalQuestion) return "missing_external_model";
    const model=sourceModel(candidate); if(!model?.chemicalContext) return "unproved_source_model";
    const context=columns(model.chemicalContext), labels=document.entities.filter(e=>e.kind==="label");
    if (!same(labels.map(e=>e.label).sort(),expectedLabels(model,context))) return "raw_label_inventory";
    // Every declared label is backed by its ordinary literal label construction
    // and reveal-group reference. IDs join records; they do not certify text.
    for (const entity of labels) {
      const constructions=document.constructions.filter(c=>c.outputs.includes(entity.id));
      if (constructions.length!==1 || constructions[0]!.operator!=="label" || constructions[0]!.inputs.text!==entity.label || !document.revealGroups.some(g=>g.entityIds.includes(entity.id))) return "raw_label_binding";
    }
    const caption=[model.relationSource.text,...model.notes].join(" ");
    if(document.annotations.length!==1 || document.annotations[0]!.kind!=="callout" || document.annotations[0]!.text!==caption || document.annotations[0]!.targetIds.length!==0) return "caption_source_mismatch";
    const otherLabels=document.entities.filter(e=>e.kind!=="label" && e.label!==undefined).map(e=>e.label).sort();
    const expectedOther=model.curves.map(c=>c.label).sort();
    if(!same(otherLabels,expectedOther)) return "foreign_nonlabel_text";
    if(document.constructions.some(c=>!["point","label","axes","function_curve"].includes(c.operator))) return "foreign_ink_operator";
    if(!physicalCurves(document,model)) return "physical_curve_mismatch";
    // Raw text/source checks precede the existing ordinary normalization. A
    // forged label cannot disappear in pruning and become a passing witness.
    const validated=validateSceneDocument(pruneDeadSceneEntities(structuredClone(document) as unknown as Record<string,unknown>));
    if(!validated.document) return "ordinary_structural_validation";
    const compiled=compileSceneDocument(validated.document);
    if(!compiled.ok || !compiled.renderScene || compiled.report.issues.some(i=>i.severity==="fatal")) return "ordinary_compile:"+compiled.report.issues.filter(i=>i.severity==="fatal").map(i=>`${i.code}:${i.entityIds?.join("/")}`).join(",");
    if(suppliedPaint && !same(suppliedPaint,compiled.renderScene)) return "stale_or_changed_paint";
    for (const entity of labels) {
      const native=compiled.renderScene.primitives.filter(p=>p.entityId===entity.id&&p.kind==="label");
      if(native.length!==1 || native[0]!.text!==entity.label || !paintedLabel(native[0]!)) return "unreadable_or_missing_label:"+entity.id;
    }
    return null;
  } catch (error) { return "invalid_context:"+(error instanceof Error?error.message:String(error)); }
}
export function verifySourceLawContextInk(document: SceneDocument, originalQuestion: string, suppliedPaint?: RenderScene): boolean {
  return sourceLawContextInkIssue(document,originalQuestion,suppliedPaint)===null;
}
