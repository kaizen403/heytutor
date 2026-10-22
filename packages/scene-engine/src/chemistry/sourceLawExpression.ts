/** Pure physical-law to display-expression lowering. Callers must independently
 * bind the model to the complete original source before using the identity proof. */
import type { SourceLawGraph, SourceLawRelation, LawAxis } from "./sourceLawGraph";
import { parseMathExpression } from "../math/expression";
import { parseLinearAffine } from "../math/linearRegion";
import { compareRational, deserializeRational } from "../math/exactRational";
const X=8,Y=5;
// This is the existing renderer coefficient serialization contract.
const numeric=(value:number)=>Number(value.toPrecision(13)).toString();
export function sourceLawCoordinates(axis: LawAxis): [number,number] {
  return axis.transform === "linear" ? axis.domain : axis.domain.map(Math.log10) as [number,number];
}
export function sourceLawCurveExpression(model: SourceLawGraph, relation: SourceLawRelation): string | null {
  const [lo,hi] = sourceLawCoordinates(model.x), [bottom,top] = sourceLawCoordinates(model.y);
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
/** Complete canonical identity for nonlinear laws, or exact affine coefficient
 * equality for supported linear laws. Finite samples are never an identity proof. */
export function sourceLawExpressionMatches(actual:string,model:SourceLawGraph,relation:SourceLawRelation):boolean {
  try {
    const expected=sourceLawCurveExpression(model,relation);if(!expected)return false;
    parseMathExpression(actual); // The actual ordinary function grammar still applies.
    if(relation.operator!=="affine"&&relation.operator!=="threshold_affine"&&relation.operator!=="log_coordinate")return actual===expected;
    const left=parseLinearAffine(actual,["x"]),right=parseLinearAffine(expected,["x"]);
    return (["a","b","constant"]as const).every(key=>compareRational(deserializeRational(left[key]),deserializeRational(right[key]))===0);
  }catch{return false;}
}
