/** Generic lowering of checked physical law/domain data to ordinary scene
 * axes, function curves, points and fatal assertions. No validator exemptions. */
import type { SceneDocument } from "../types";
import { parseMathExpression } from "../math/expression";
import { ChemScene } from "./sceneKit";
import type { SourceLawGraph, SourceLawRelation, LawAxis } from "./sourceLawGraph";

const X = 8, Y = 5;
const finite = (value: number) => Number.isFinite(value);
const numeric = (value: number) => Number(value.toPrecision(13)).toString();
const fmt = (value: number) => value === 0 ? "0" : (Math.abs(value) >= 1e4 || Math.abs(value)<.001 ? Number(value.toPrecision(4)).toExponential() : Number(value.toPrecision(6)).toString()).replace(/e\+?(-?)0*(\d+)/,"e$1$2");
function coordinates(axis: LawAxis): [number,number] {
  return axis.transform === "linear" ? axis.domain : axis.domain.map(Math.log10) as [number,number];
}
function display(axis: LawAxis, value: number, span: number): number {
  const [lo,hi] = coordinates(axis);
  return ((axis.transform === "log10" ? Math.log10(value) : value)-lo)*span/(hi-lo);
}
export function sourceLawValue(relation: SourceLawRelation, x: number): number {
  if (relation.operator === "positive_quadratic") return 2*relation.product/(Math.sqrt(x*x+4*relation.product)+x);
  if (relation.operator === "ratio_complements") {
    const r = 10**(x-relation.pK); return relation.complement ? 1/(1+r) : r/(1+r);
  }
  return relation.slope*x+relation.intercept;
}
function expression(model: SourceLawGraph, relation: SourceLawRelation): string | null {
  const [lo,hi] = coordinates(model.x), [bottom,top] = coordinates(model.y);
  if (relation.operator === "affine" || relation.operator === "threshold_affine" || relation.operator === "log_coordinate") {
    if (model.x.transform !== "linear" || model.y.transform !== "linear") return null;
    return `${numeric((relation.slope*lo+relation.intercept-bottom)*Y/(top-bottom))}+(${numeric(relation.slope*(hi-lo)*Y/(top-bottom)/X)})*x`;
  }
  const physicalX = `(${numeric(lo)}+${numeric((hi-lo)/X)}*x)`;
  if (relation.operator === "ratio_complements") {
    if (model.x.transform !== "linear" || model.y.transform !== "linear") return null;
    const r = `10^(${physicalX}-${numeric(relation.pK)})`;
    return `${Y}*((${relation.complement ? "1" : r})/(1+${r})-${numeric(bottom)})/${numeric(top-bottom)}`;
  }
  if (relation.operator !== "positive_quadratic" || model.x.transform !== "log10" || model.y.transform !== "log10" || !(relation.product > 0)) return null;
  const rootLog = Math.log10(Math.sqrt(relation.product));
  const z = `10^(${numeric(lo-rootLog)}+${numeric((hi-lo)/X)}*x)`;
  return `${numeric(Y/(top-bottom))}*(${numeric(rootLog-bottom)}+log(2/(sqrt((${z})^2+4)+${z}))/log(10))`;
}
/** For external typed adapters (e.g. ΔG=H−TS). Callers must independently
 * bind every source operand/domain and decline unsupported requested marks. */
export function buildSourceLawGraphFigure(model: SourceLawGraph): SceneDocument | null {
  if (model.version !== "chemistry-source-law-graph/v1" || !model.question || !model.curves.length || !model.bindings.length) return null;
  for (const axis of [model.x,model.y]) {
    if (!axis.domain.every(finite) || !(axis.domain[1]>axis.domain[0]) || (axis.transform === "log10" && !(axis.domain[0]>0))) return null;
  }
  const sources = [model.relationSource,...model.bindings.flatMap(value=>[value.scalarSource,...(value.unitSource?[value.unitSource]:[])])];
  if (sources.some(value=>value.span.start<0 || value.span.end>model.question.length || value.span.end<=value.span.start || model.question.slice(value.span.start,value.span.end)!==value.text)) return null;
  if (model.bindings.some(value=>!finite(value.value))) return null;
  for (const point of model.points) {
    const curve = model.curves.find(curve=>curve.id===point.curveId);
    if (!curve || !finite(point.x) || !finite(point.y) || Math.abs(sourceLawValue(curve.relation,point.x)-point.y)>1e-9*Math.max(Math.abs(point.y),1e-30)) return null;
    if (point.detached ? !(point.x===0 && model.x.transform==="log10" && curve.relation.operator==="positive_quadratic") : point.x<curve.domain[0] || point.x>curve.domain[1]) return null;
  }
  const facts=model.bindings.filter(binding=>binding.symbol);
  const factText=(binding: SourceLawGraph["bindings"][number])=>`${binding.symbol}=${fmt(binding.value)}`;
  if ([model.x.label,model.y.label,...(model.regions ?? []).map(region=>region.label),...facts.map(factText)].some(value=>value.split(/\s+/).some(word=>word.length>16))) return null;
  const c = new ChemScene(model.question,"source-supplied law on its declared domain",model.family);
  const text = (id: string, x: number, y: number, value: string, role: string): string[] => {
    const words=value.split(/\s+/).filter(Boolean), lines: string[]=[];
    if (words.some(word=>word.length>16)) throw new Error("unrenderable full law identifier");
    for (const word of words) {
      const last=lines.length-1;
      if (last>=0 && lines[last]!.length+word.length+1<=16) lines[last]+=` ${word}`;
      else lines.push(word);
    }
    return lines.map((line,index)=>c.text(`${id}_${index}`,{x,y:y-index*.8},line,role));
  };
  const ids: string[] = [c.scene.axes("law_axes",-.25,X+.35,-.25,Y+.4,"physical law axes")];
  ids.push(...text("law_x_label",X/2,-.8,model.x.label,"horizontal physical quantity"));
  ids.push(...text("law_y_label",X/2,Y+2.3,model.y.label,"vertical physical quantity"));
  ids.push(...text("law_x_min",0,-.35,fmt(model.x.domain[0]),"domain lower bound"));
  ids.push(...text("law_x_max",X,-.35,fmt(model.x.domain[1]),"domain upper bound"));
  ids.push(...text("law_y_min",-2.8,0,fmt(model.y.domain[0]),"vertical lower bound"));
  ids.push(...text("law_y_max",-2.8,Y,fmt(model.y.domain[1]),"vertical upper bound"));
  if (model.y.transform==="linear" && model.y.domain[0]<0 && model.y.domain[1]>0) {
    const y0=display(model.y,0,Y);
    const a=c.scene.helper("physical_zero_start",{x:0,y:y0},"zero reference start");
    const b=c.scene.helper("physical_zero_end",{x:X,y:y0},"zero reference end");
    ids.push(c.scene.segment("physical_zero",a,b,"physical y=0 reference","y=0"));
  }
  for (const [index,region] of (model.regions ?? []).entries()) {
    if (region.domain[0]<model.x.domain[0] || region.domain[1]>model.x.domain[1] || !(region.domain[1]>region.domain[0])) return null;
    const center=(display(model.x,region.domain[0],X)+display(model.x,region.domain[1],X))/2;
    ids.push(...text(`law_region_${index}`,center,Y*.55,region.label,region.meaning));
  }
  for (const curve of model.curves) {
    if (!curve.domain.every(finite) || curve.domain[0]<model.x.domain[0] || curve.domain[1]>model.x.domain[1] || !(curve.domain[1]>curve.domain[0])) return null;
    const text = expression(model,curve.relation); if (!text) return null;
    try { parseMathExpression(text); } catch { return null; }
    const start = display(model.x,curve.domain[0],X), stop = display(model.x,curve.domain[1],X);
    ids.push(c.scene.curve(curve.id,text,start,stop,`${curve.label} over source domain`,curve.label,129));
    const construction=c.scene.constructions.find(value=>value.id===`make_${curve.id}`)!;
    construction.inputs={...construction.inputs,xMin:start,xMax:stop};
    // Proof samples are independently evaluated in physical coordinates, then
    // compared to the compiled display expression through normal assertions.
    for (const [index,fraction] of [0,.25,.5,.75,1].entries()) {
      const transform = model.x.transform === "linear" ? curve.domain : curve.domain.map(Math.log10);
      const transformed = transform[0]!+(transform[1]!-transform[0]!)*fraction;
      const x = model.x.transform === "linear" ? transformed : 10**transformed;
      const y = sourceLawValue(curve.relation,x);
      if (!finite(y) || y<model.y.domain[0]-Math.abs(model.y.domain[0])*1e-10 || y>model.y.domain[1]+Math.abs(model.y.domain[1])*1e-10) return null;
      c.scene.assert(`${curve.id}_law_${index}`,"function_value",[curve.id],{x:display(model.x,x,X),y:display(model.y,y,Y)});
    }
  }
  model.points.forEach((point,index)=>{
    const curve = model.curves.find(curve=>curve.id===point.curveId); if (!curve) return;
    const label = String.fromCharCode(65+index);
    const legendY=Y-index*.85;
    ids.push(...text(`law_datum_${index}_x`,X+2.7,legendY,`${label}: x=${fmt(point.x)}`,"source-law coordinate x"));
    ids.push(...text(`law_datum_${index}_y`,X+6,legendY,`y=${fmt(point.y)}`,"source-law coordinate y"));
    if (point.detached) {
      ids.push(c.scene.point(`law_datum_${index}`,{x:1,y:-2.4},"separate zero-input datum",label));
      ids.push(...text(`law_datum_${index}_label`,1,-3.2,"zero: separate","non-logarithmic zero datum"));
    } else {
      const x = display(model.x,point.x,X), y = display(model.y,point.y,Y);
      ids.push(c.scene.point(`law_datum_${index}`,{x,y},`${curve.label} source-law coordinate`));
      c.scene.entities.find(entity=>entity.id===`law_datum_${index}`)!.label=label;
      c.scene.assert(`law_datum_${index}_on_curve`,"function_value",[curve.id],{x,y});
    }
  });
  facts.forEach((binding,index)=>{
    const y=Y+1.3+index*.85;
    ids.push(...text(`law_fact_${index}`,X+2.7,y,factText(binding),"source law given"));
    if (binding.unit!=="1") ids.push(...text(`law_fact_${index}_unit`,X+6,y,binding.unit,"source law given unit"));
  });
  c.scene.group("source_law_figure",ids,"source law and measured domain");
  const document = c.build({caption:[model.relationSource.text,...model.notes].join(" ")});
  document.source = {...document.source,sourceModel:model.version,sourceLawGraph:model,sourceLawPlot:{xDisplayDomain:[0,X],yDisplayDomain:[0,Y]}};
  return document;
}
