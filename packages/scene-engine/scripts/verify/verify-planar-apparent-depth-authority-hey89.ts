import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { derivePlanarApparentDepth } from "../../src/physics/planarApparentDepthAuthority";

let checks=0;
const base={model:"paraxial_normal_view",coordinateFrameId:"source-frame",depthAxisId:"depth-axis",signConvention:"positive_into_object_medium",objectMediumId:"object-medium",viewerMediumId:"viewer-medium",nObject:1.5,nViewer:1,trueDepth:3,depthUnit:"m"};
const keys=Object.keys(base);
function check(value:unknown,message:string):asserts value{checks++;assert.ok(value,message);}
function reject(raw:unknown){const value=derivePlanarApparentDepth(raw);check(!value.ok,"invalid source input declines");check(!Object.hasOwn(value,"value"),"decline has no partial values");}
function solve(raw:unknown){const value=derivePlanarApparentDepth(raw);check(value.ok,`valid supplied input declined ${JSON.stringify(value)}`);if(!value.ok)throw new Error("unreachable");check(Object.isFrozen(value)&&Object.isFrozen(value.value),"immutable authority");return value.value;}
function close(actual:number,expected:number,message:string){checks++;if(expected===0){assert.equal(actual,0,message);assert.ok(!Object.is(actual,-0),"exact zero is canonical positive zero");return;}assert.ok(Number.isFinite(actual)&&actual!==0&&Math.abs(actual-expected)<=32*Number.EPSILON*Math.abs(expected),`${message}: ${actual} != ${expected}`);}
type Q={n:bigint;d:bigint};
function q(value:number):Q{const data=new DataView(new ArrayBuffer(8));data.setFloat64(0,value);const bits=data.getBigUint64(0);const exponent=Number((bits>>52n)&2047n);const fraction=bits&((1n<<52n)-1n);let n=(bits>>63n)?-fraction:fraction;if(exponent!==0)n=(bits>>63n)?-((1n<<52n)+fraction):(1n<<52n)+fraction;const power=(exponent===0?-1022:exponent-1023)-52;return power>=0?{n:n<<BigInt(power),d:1n}:{n,d:1n<<BigInt(-power)};}
function mul(a:Q,b:Q):Q{return{n:a.n*b.n,d:a.d*b.d};}
function div(a:Q,b:Q):Q{return{n:a.n*b.d,d:a.d*b.n};}
function sub(a:Q,b:Q):Q{return{n:a.n*b.d-b.n*a.d,d:a.d*b.d};}
function number(a:Q):number{return Number(a.n)/Number(a.d);}
function oracle(depth:number,object:number,viewer:number,divisor:number){const native=q(depth);const si=div(native,q(divisor));const ratio=div(q(viewer),q(object));const shiftFactor=div(sub(q(viewer),q(object)),q(object));return{apparent:number(mul(native,ratio)),apparentSI:number(mul(si,ratio)),shift:number(mul(native,shiftFactor)),shiftSI:number(mul(si,shiftFactor))};}
function validate(input:typeof base){const value=solve(input);const divisor=input.depthUnit==="m"?1:input.depthUnit==="cm"?100:1000;const expected=oracle(input.trueDepth,input.nObject,input.nViewer,divisor);close(value.apparentDepth,expected.apparent,"independent native apparent depth");close(value.apparentDepthSI,expected.apparentSI,"independent SI apparent depth");close(value.signedDepthShift,expected.shift,"independent native signed shift");close(value.signedDepthShiftSI,expected.shiftSI,"independent SI signed shift");close(value.trueDepth,input.trueDepth,"source depth retained");close(value.trueDepthSI,input.trueDepth/divisor,"true SI depth");check(value.model===input.model&&value.coordinateFrameId===input.coordinateFrameId&&value.depthAxisId===input.depthAxisId,"model/frame/axis retained");check(value.signConvention===input.signConvention&&value.objectMediumId===input.objectMediumId&&value.viewerMediumId===input.viewerMediumId,"positive depth convention and ordered media retained");check(value.nObject===input.nObject&&value.nViewer===input.nViewer&&value.depthUnit===input.depthUnit,"indices/unit retained without default");return value;}

if(process.argv.includes("--prototype-child")){
 const descriptors=keys.map(k=>Object.getOwnPropertyDescriptor(Object.prototype,k));
 try{keys.forEach(k=>Object.defineProperty(Object.prototype,k,{configurable:true,value:base[k as keyof typeof base]}));reject({});for(const key of keys){const raw:Record<string,unknown>={...base};delete raw[key];reject(raw);}const raw={...base};Object.defineProperty(raw,"nObject",{value:1.5,enumerable:false});solve(raw);}finally{keys.forEach((k,i)=>{const d=descriptors[i];if(d)Object.defineProperty(Object.prototype,k,d);else delete (Object.prototype as Record<string,unknown>)[k];});}
 console.log(`prototype child ${checks} checks`);process.exit(0);
}
const normal=validate(base);close(normal.apparentDepth,2,"3m object at index1.5 seen inindex1 appears2m deep");close(normal.signedDepthShift,-1,"negative depth-axis shift means apparent shallowing");
const deeper=validate({...base,nObject:1,nViewer:1.5});close(deeper.apparentDepth,4.5,"denser viewer makes apparent depth greater");close(deeper.signedDepthShift,1.5,"positive depth-axis shift means deeper");
validate({...base,nObject:1.25,nViewer:1.25});
const near=validate({...base,nObject:1,nViewer:1+Number.EPSILON,trueDepth:7});check(near.signedDepthShift>0,"near-equal source indices never snap to exactzero");
validate({...base,nObject:1+Number.EPSILON,nViewer:1,trueDepth:7});
for(const unit of ["m","cm","mm"]){const divisor=unit==="m"?1:unit==="cm"?100:1000;const value=validate({...base,trueDepth:3*divisor,depthUnit:unit});close(value.apparentDepthSI,2,"unit-equivalent SI depth");}
for(const object of [1e-6,0.2,1,4/3,1.5,2.37,20,1e6])for(const viewer of [1e-6,0.2,1,4/3,1.5,2.37,20,1e6])for(const siDepth of [1e-12,2.8e-9,0.125,4.5,1e6,1e12])for(const depthUnit of ["m","cm","mm"]){const divisor=depthUnit==="m"?1:depthUnit==="cm"?100:1000;validate({...base,nObject:object,nViewer:viewer,trueDepth:siDepth*divisor,depthUnit});}
for(const scale of [0.25,0.5,2,4]){const value=validate({...base,nObject:1.5*scale,nViewer:scale});close(value.apparentDepth,normal.apparentDepth,"common index-reference scaling cancels");close(value.signedDepthShift,normal.signedDepthShift,"calibration preserves signed shift");}
const reversed=validate({...base,objectMediumId:base.viewerMediumId,viewerMediumId:base.objectMediumId,nObject:base.nViewer,nViewer:base.nObject,trueDepth:normal.apparentDepth});close(reversed.apparentDepth,base.trueDepth,"inverse index transport recovers source depth");
for(const raw of [null,1,[],{},Object.assign(Object.create({}),base),{...base,[Symbol("extra")]:1},{...base,unknown:1},{...base,model:"finite_angle"},{...base,signConvention:"positive_toward_viewer"},{...base,depthUnit:"CM"},{...base,depthUnit:"px"},{...base,objectMediumId:base.viewerMediumId},{...base,coordinateFrameId:""},{...base,depthAxisId:""},{...base,nObject:0},{...base,nViewer:-1},{...base,nViewer:NaN},{...base,nObject:Infinity},{...base,nObject:1e-7},{...base,nViewer:1e7},{...base,trueDepth:0},{...base,trueDepth:-1},{...base,trueDepth:Number.MIN_VALUE},{...base,trueDepth:1e-13},{...base,trueDepth:1e13},{...base,trueDepth:Infinity},{...base,incidentAngle:0}])reject(raw);
for(const key of keys){const raw:Record<string,unknown>={...base};delete raw[key];reject(raw);}
let reads=0,writes=0;
for(const key of keys){const getter={...base};Object.defineProperty(getter,key,{enumerable:true,get(){reads++;return base[key as keyof typeof base];}});reject(getter);const setter={...base};Object.defineProperty(setter,key,{enumerable:true,set(){writes++;}});reject(setter);}
check(reads===0&&writes===0,"all accessors decline without invocation");
const coercion={valueOf(){reads++;return 3;},toString(){reads++;return "3";}};
reject({...base,trueDepth:coercion});reject({...base,nObject:coercion});reject({...base,coordinateFrameId:coercion});reject({...base,depthUnit:coercion});
check(reads===0&&writes===0,"boxed/coercible values cannot execute source code");
reject({...base,trueDepth:1e-10,depthUnit:"mm"});
reject({...base,trueDepth:1e16,depthUnit:"mm"});
reject({...base,depthAxisId:"axis/with/slash"});
reject({...base,viewerMediumId:"v".repeat(129)});
const largerDepth=validate({...base,trueDepth:6});close(largerDepth.apparentDepth,2*normal.apparentDepth,"depth scaling propagates apparent distance");close(largerDepth.signedDepthShift,2*normal.signedDepthShift,"depth scaling propagates signed shift");

for(const raw of [Object.freeze({...base}),Object.assign(Object.create(null),base),JSON.parse(JSON.stringify(base))])validate(raw);
const nonenum={};for(const key of keys)Object.defineProperty(nonenum,key,{value:base[key as keyof typeof base]});validate(nonenum as typeof base);
const child=spawnSync(process.execPath,[...process.execArgv,fileURLToPath(import.meta.url),"--prototype-child"],{encoding:"utf8"});check(child.status===0,`isolated prototype child ${child.stdout} ${child.stderr}`);
let seed=20261003;
const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
const holdout=Array.from({length:257},()=>({object:0.41+6*next(),viewer:0.67+5*next(),depth:0.031+9*next()}));
for(const sample of holdout)for(const depthUnit of ["m","cm","mm"]){const divisor=depthUnit==="m"?1:depthUnit==="cm"?100:1000;validate({...base,nObject:sample.object,nViewer:sample.viewer,trueDepth:sample.depth*divisor,depthUnit});}
console.log(`apparent-depth authority: ${checks} independent checks;1152 grid inputs;257 prelisted synthetic triples x3 units; getter/setter0; source/scene/lifecycle acceptance not claimed`);
