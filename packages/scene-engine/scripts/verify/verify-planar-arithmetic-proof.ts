import assert from "node:assert/strict";
import { createPlanarArithmeticProof, type PlanarProofRole } from "../../src/ir/planarArithmeticProof";
const source = {pointName:"P",footName:"F",point:{x:1,y:2},line:{a:3,b:4,c:-5}};
const proof = createPlanarArithmeticProof(source);
const examples: Array<[PlanarProofRole,string,boolean]> = [
  ["x","x_F=(x_P*n2-a*s)/n2",true],
  ["y","y_F=y_P-(2*b)*(2*s)/(4*n2)",true],
  ["distance","d=abs(-s)/sqrt(b^2+a^2)",true],
  ["distance","d=abs(s)/(sqrt(n2)+a-a)",true],
  ["residual","s=a*1+b*2+c",true],
  ["distance","d=abs(a*1+b*2+c)/sqrt(n2)",true],
  ["x","x_F=x_P-a*s/25",true],
  ["foot","F=P-(s/n2)*(a,b)",true],
  ["displacement","(x_F-x_P,y_F-y_P)=-(s/n2)*(3,4)",true],
  ["incidence","a*x_F+b*y_F+c=0",true],
  ["distance","d=abs(s)/(a+b-2)",false],
  ["distance","d=abs(s)/sqrt(a*b+13)",false],
  ["x","x_F=x_P-a*s/(a+b-2)^2",false],
  ["y","y_F=y_P-(a+1)*s/n2",false],
  ["x","x_F=d-0.92",false],
  ["x","x_F=x_P-a*s/n2+0.000000000000001*s",false],
  ["x","x_F=0.28+0*x",false],
  ["x","x_F=0.28+0*x _P",false],
  ["norm","n2=n2+s-s",false],
  ["residual","s=s+n2-n2",false],
  ["x","x_F=x_P-a*s/n2+0/(0.1+0.2-0.3)",false],
  ["x","x_F=x_P-a*s/n2+0/(a-a)",false],
  ["x","x_F=x_P-a*s/n2+0*a^5",false],
  ["x","x_F="+"(".repeat(25)+"x_P-a*s/n2"+")".repeat(25),false],
  ["x","x_F=x_P-a*s/n2+"+"0+".repeat(128)+"0",false],
  ["x","x_F=x_P-a*s/n2+0*1e101",false],
  ["x","x_F=x_P-a*s/n2+0*(9007199254740993-9007199254740992)",false],
  ["distance","d=abs(s)/sqrt(n2+s-s)",false],
  ["distance","d=abs(s)/sqrt(-n2)",false],
  ["x","x_F=x_P-a*s/sqrt(n2)^2",false], // explicitly unsupported radical identity
];
let checks = 0;
for (const [role,text,expected] of examples) { checks++; assert.equal(proof.proves(text,role),expected,text); }
// Same formula proof at independently chosen signed/scaled source normals;
// these are domain checks, not samples used by the implementation to prove laws.
for (const line of [{a:-6,b:-8,c:10},{a:.5,b:1,c:-2},{a:1,b:0,c:-5},{a:0,b:1,c:-2}]) {
  const signed=createPlanarArithmeticProof({...source,line});
  for (const [role,text] of examples.filter(example=>example[2]).slice(0,4)) { checks++; assert.ok(signed.proves(text,role),text); }
}
const incidence=createPlanarArithmeticProof({...source,point:{x:3,y:4},line:{a:3,b:4,c:-25}});
for (const [text,expected] of [["d=abs(s)/sqrt(n2)",true],["d=d*s/s",false]] as const) {checks++;assert.equal(incidence.proves(text,"distance"),expected,text);}
const zeroNormal=createPlanarArithmeticProof({...source,line:{a:0,b:0,c:1}});checks++;assert.equal(zeroNormal.proves("d=0","distance"),false);
for (const bounded of [{...source,point:{x:1e-100,y:1e-100},line:{a:1e-100,b:1e-100,c:0}},{...source,point:{x:Infinity,y:2}}]) {
  checks++;assert.equal(createPlanarArithmeticProof(bounded).proves("d=abs(s)/sqrt(n2)","distance"),false);
}
console.log(`planar arithmetic proof: ${checks} checks passed`);
