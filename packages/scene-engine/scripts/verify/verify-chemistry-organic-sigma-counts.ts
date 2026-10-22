/** Intrinsic molecular counts include attached H; no admission-policy change. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolveChemistryStructure,auditChemistryRepresentation,compileSceneDocument,type ResolvedChemistrySpecies,type SceneDocument,type ChemistrySpeciesBinding} from '../../src/index';
interface Gold {name:string;sigma:number;pi:number}
const golds=(JSON.parse(readFileSync(new URL('./fixtures/chemistry-organic-sigma-counts.json',import.meta.url),'utf8')) as {rows:Gold[]}).rows;
const rows:Array<{id:string;passed:boolean;error:string|null}>=[];
function check(id:string,fn:()=>void){try{fn();rows.push({id,passed:true,error:null});}catch(error){rows.push({id,passed:false,error:String(error)});}}
/** Counterfactual count on the real resolved source graph. No TurnPlan or IR. */
function documentFor(name:string,resolved:ResolvedChemistrySpecies,count:number,textCount=count):SceneDocument {
 const question=`Draw the structure of ${name} and state its sigma-bond count.`,start=question.indexOf(name),speciesKey='species1';
 const entities:SceneDocument['entities']=[],constructions:SceneDocument['constructions']=[],nodes:ChemistrySpeciesBinding['nodes']=[],bonds:ChemistrySpeciesBinding['bonds']=[];
 for(const [i,node] of resolved.nodes.entries()){
  const id=`atom${i}`,point=node.label===null?id:`${id}_p`;
  entities.push({id:point,kind:'point',role:'construction helper'});constructions.push({id:`make_${point}`,operator:'point',inputs:{x:i,y:i%2*0.6,coordinateSpace:'world'},outputs:[point]});
  if(node.label!==null){entities.push({id,kind:'label',role:'source atom',label:node.label});constructions.push({id:`make_${id}`,operator:'label',inputs:{target:point,text:node.label},outputs:[id]});}
  nodes.push({nodeKey:node.key,entityId:id,electronEntityIds:[]});
 }
 for(const [i,bond] of resolved.bonds.entries()){
  const a=resolved.nodes.findIndex(n=>n.key===bond.a),b=resolved.nodes.findIndex(n=>n.key===bond.b),ids:string[]=[],dx=b-a,dy=(b%2-a%2)*0.6,length=Math.hypot(dx,dy);
  for(let stroke=0;stroke<bond.order;stroke++){
   const id=`bond${i}_${stroke}`,s=`${id}_s`,e=`${id}_e`,off=bond.order===1?0:stroke===0?-0.065:0.065;
   for(const [point,index] of [[s,a],[e,b]] as const){entities.push({id:point,kind:'point',role:'construction helper'});constructions.push({id:`make_${point}`,operator:'point',inputs:{x:index-dy/length*off,y:index%2*0.6+dx/length*off,coordinateSpace:'world'},outputs:[point]});}
   entities.push({id,kind:'segment',role:'source bond'});constructions.push({id:`make_${id}`,operator:'segment',inputs:{start:s,end:e},outputs:[id]});ids.push(id);
  }bonds.push({a:bond.a,b:bond.b,entityIds:ids});
 }
 const text=`σ = ${textCount}`,structuralEntityIds=[...nodes.map(n=>n.entityId),...bonds.flatMap(b=>b.entityIds)],allIds=entities.map(e=>e.id);
 return {schemaVersion:'scene-document/v2',visualDecision:{mode:'scene',reason:'source-bound count counterfactual'},source:{question,chemistryFamily:'chem_organic',chemistryRepresentation:{version:'chemistry-representation/v1',species:[{speciesKey,source:{start,end:start+name.length,text:name},resolver:'organic',identityKey:resolved.identityKey,nodes,bonds,entityIds:structuralEntityIds}],structuralEntityIds,structuralQuantities:[{quantityId:'sigma_count',speciesKey,rule:'sigma_bonds'}],structuralTexts:[{owner:'annotation',ownerId:'count',start:4,end:text.length,speciesKey,rule:'sigma_bonds'}]}},quantities:[{id:'sigma_count',symbol:'σ',value:count,unit:'1'}],entities,constructions,relations:[],assertions:[],annotations:[{id:'count',kind:'callout',targetIds:[],text}],requiredEntityIds:allIds,revealGroups:[{id:'molecule',entityIds:allIds,dependsOn:[],narrationCue:'source structure'}],teachingTimeline:[{id:'reveal_molecule',action:'reveal',targetId:'molecule',dependsOn:[]}]};
}
for(const gold of golds){
 const resolved=resolveChemistryStructure(gold.name,'organic');
 check(`${gold.name}: independent sigma/pi gold`,()=>{assert.ok(resolved?.molecule);assert.equal(resolved.facts.sigma_bonds,gold.sigma);assert.equal(resolved.facts.pi_bonds,gold.pi);});
 if(!resolved?.molecule)continue;
 if(gold.name==='methanal'){
  check('methanal: preserve inherited source-identity refusal',()=>{const d=documentFor(gold.name,resolved,gold.sigma),a=auditChemistryRepresentation(d,String(d.source.question));assert.ok(a.issues.some(i=>i.code==='chemistry_source_span'));assert.equal(a.structuralQuantityIds.size,0);assert.equal(compileSceneDocument(d).ok,false);});continue;
 }
 const heavyOnly=resolved.molecule.bonds.length;
 for(const [id,count,textCount,expected] of [['correct source count',gold.sigma,gold.sigma,true],['reject heavy-only count',heavyOnly,heavyOnly,false],['reject quantity-only mutation',heavyOnly,gold.sigma,false],['reject text-only mutation',gold.sigma,heavyOnly,false],['reject invented extra bond',gold.sigma+1,gold.sigma+1,false]] as const)check(`${gold.name}: ${id}`,()=>{
  const d=documentFor(gold.name,resolved,count,textCount),a=auditChemistryRepresentation(d,String(d.source.question)),c=compileSceneDocument(d);
  assert.equal(a.issues.length===0,expected,JSON.stringify(a.issues));assert.equal(c.ok,expected,JSON.stringify(c.report.issues));
  if(expected){assert.ok(c.renderScene);assert.ok(a.structuralQuantityIds.has('sigma_count'));assert.ok(a.auditedTexts.every(t=>!t.includes(`σ = ${gold.sigma}`)),'only proved structural number projected');}
  else{assert.equal(c.renderScene,null);assert.equal(a.structuralQuantityIds.size,0,'failed records grant no partial authority');assert.ok(a.issues.some(i=>i.code==='chemistry_structural_quantity'||i.code==='chemistry_structural_text'));}
 });
 check(`${gold.name}: physical unit is not a structural count`,()=>{const d=documentFor(gold.name,resolved,gold.sigma);d.quantities[0]!.unit='mol';const a=auditChemistryRepresentation(d,String(d.source.question));assert.ok(a.issues.some(i=>i.code==='chemistry_structural_quantity'));assert.equal(a.structuralQuantityIds.size,0);assert.equal(compileSceneDocument(d).ok,false);});
}
const result={scope:'intrinsic_organic_counts_and_actual_source_audit_compiler',passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>!r.passed).length,rows,liveFactoryScopeChanged:false,modelSpendUsd:0};
const at=process.argv.indexOf('--out');if(at>=0&&process.argv[at+1])writeFileSync(process.argv[at+1]!,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));if(result.failed)process.exitCode=1;
