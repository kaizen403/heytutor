import {readScrewGaugeQuestion,type MeasurementSourceRole} from './measurementSourceAuthority';
import type {TurnPlanV3} from '../contracts/contractsV3';
const factors:Record<string,number>={mm:1,cm:10,m:1000};
const symbols:Record<string,MeasurementSourceRole>={p:'pitch',pitch:'pitch',LC:'least_count',lc:'least_count',d:'true_reading',diameter:'true_reading',e0:'zero_error',e_0:'zero_error',zero_error:'zero_error'};
const prefix:Partial<Record<MeasurementSourceRole,string[]>>={pitch:['pitch','main scale pitch'],least_count:['least count','LC'],true_reading:['diameter','wire diameter'],zero_error:['zero error']};
const normalized=(text:string)=>text.replace(/\s+/g,' ').trim();
const countSymbols=new Set(['c','C','n','N','N_c','Nc','CSR','circular_reading','circular_scale_reading','count']);
/** Question arithmetic corrects recognized early roles, never constructs IR or a solver result. */
export function applyMeasurementQuestionAuthority(question:string,plan:TurnPlanV3){
 const read=readScrewGaugeQuestion(question);if(read.status==='none')return null;
 const corrections:Array<{quantityId:string;symbol:string;previous:number;corrected:number;unit?:string}>=[];
 const issueCodes:string[]=[];
 const withdraw=()=>({plan:{...plan,givens:[],derived:[],unknowns:[],qualitativeClaims:[]},corrections,issueCodes:[...issueCodes,'measurement_question_roles_withdrawn'],declineFigure:true});
 if(read.status!=='ok'){issueCodes.push(read.issue.code);return withdraw();}
 const used=new Set<MeasurementSourceRole>(),givens:TurnPlanV3['givens']=[];
 for(const row of plan.givens){
  const role=symbols[row.symbol],factor=typeof row.unit==='string'?factors[row.unit]:undefined;
  if(!role || !factor || used.has(role) || !read.evidence[role].some(evidence=>typeof row.sourceText==='string' && [normalized(evidence.quote),...(prefix[role]??[]).map(word=>`${word} ${normalized(evidence.quote)}`)].includes(normalized(row.sourceText))))return withdraw();
  used.add(role);const expected=read.values[role].value/factor;
  if(row.value!==expected)corrections.push({quantityId:row.id,symbol:row.symbol,previous:row.value,corrected:expected,unit:row.unit});
  givens.push({...row,value:expected,...(row.sign===undefined?{}:{sign:expected>0?'positive' as const:expected<0?'negative' as const:'zero' as const})});
 }
 if(used.size!==4 || plan.derived.length!==1 || plan.unknowns.length!==1)return withdraw();
 const row=plan.derived[0]!,unknown=plan.unknowns[0]!;
 if(row.id!==unknown.id || row.symbol!==unknown.symbol || !countSymbols.has(row.symbol) || ![row.unit,unknown.unit].every(unit=>unit==='division'||unit==='divisions'))return withdraw();
 const expected=read.values.circular_reading.value;
 if(row.value!==expected)corrections.push({quantityId:row.id,symbol:row.symbol,previous:row.value,corrected:expected,unit:'division'});
 const derived={...row,value:expected,unit:'division',dependsOn:givens.map(given=>given.id),...(row.sign===undefined?{}:{sign:expected>0?'positive' as const:'zero' as const})};
 if(corrections.length)issueCodes.push('measurement_question_values_corrected');
 if(plan.qualitativeClaims.length)issueCodes.push('measurement_question_claims_withdrawn');
 return {plan:{...plan,givens,derived:[derived],unknowns:[{...unknown,unit:'division'}],qualitativeClaims:[]},corrections,issueCodes,declineFigure:plan.visualRequirement!=='none'};
}
