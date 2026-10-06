import type { TurnPlanV3 } from "../contracts/contractsV3";
import { rightTriangleQuantityRole, rightTriangleClaimSIValue } from "./rightTriangleSource";
import { readStaticContactTriangle } from "./staticContactTriangle";

/** Source roles own plan values; display defaults never supply a side or angle. */
export function applyStaticContactTriangleAuthority(question:string, plan:TurnPlanV3) {
  const source = readStaticContactTriangle(question);
  if (!source) return null;
  const corrections:Array<{quantityId:string;symbol:string;previous:number;corrected:number;unit?:string}> = [];
  const withdrawn = new Set<string>();
  const rows = (values:TurnPlanV3["givens"]) => values.flatMap(row=> {
    const role=rightTriangleQuantityRole(row);
    if (!role) return [row];
    const actual=rightTriangleClaimSIValue(row,role);
    if (actual===null || !Number.isFinite(actual)) { withdrawn.add(row.id); return []; }
    const expected=source.state[role];
    // SI conversion is linear; preserve the caller's correctly typed unit.
    const factor=rightTriangleClaimSIValue({...row,value:1},role)!;
    const corrected=expected/factor;
    if (row.value===corrected) return [row];
    corrections.push({quantityId:row.id,symbol:row.symbol,previous:row.value,corrected,unit:row.unit});
    return [{...row,value:corrected,sourceText:question}];
  });
  const givens=rows(plan.givens), derived=rows(plan.derived);
  const surviving=new Set([...givens,...derived].map(row=>row.id));
  return {plan:{...plan,givens,derived,
    qualitativeClaims:plan.qualitativeClaims.filter(claim=>(claim.relatedQuantityIds??[]).every(id=>surviving.has(id)))},
    corrections,withdrawn:[...withdrawn],declineFigure:withdrawn.size>0};
}
