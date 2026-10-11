import { snapshotMathSourceData } from '../compile/mathSourceData';
import { Q_ZERO as Z, Q_ONE as O, rational, parseRational, serializeRational as out, deserializeRational as read,
  addRational as add, subtractRational as sub, multiplyRational as mul, divideRational as div,
  negateRational as neg, compareRational as cmp, type Rational as Q, type ExactRational as Exact } from './exactRational';

export type { ExactRational } from './exactRational';
export type IntervalExpression = { inequality: string } | { union: IntervalExpression[] } | { intersection: IntervalExpression[] } | { complement: IntervalExpression };
export type LinearFigureInput =
  | { kind: 'number_line_set'; variable?: string; expression: IntervalExpression }
  | { kind: 'linear_half_plane'; variables?: [string, string]; inequality: string }
  | { kind: 'linear_feasible_region'; variables?: [string, string]; constraints: string[]; objective?: { expression: string; sense: 'max' | 'min' } }
  | { kind: 'linear_system'; variables?: [string, string]; equations: [string, string] };
export interface ExactPoint { x: Exact; y: Exact }
export interface ExactAffine { a: Exact; b: Exact; constant: Exact }
export interface LinearConstraint { a: Exact; b: Exact; rhs: Exact; strict: boolean; sourceId: string }
export interface ExactEndpoint { value: Exact; included: boolean }
/** Null lower/upper means negative/positive infinity, respectively. */
export interface ExactInterval { lower: ExactEndpoint | null; upper: ExactEndpoint | null }
export interface LinearCombinationCertificate { weights: Exact[]; a: Exact; b: Exact; rhs: Exact; strict: boolean }
export type FeasibilityCertificate = { feasible: true; witness: ExactPoint } | { feasible: false; contradiction: LinearCombinationCertificate };
export interface LinearCorner { point: ExactPoint; activeConstraintIds: string[]; included: boolean }
export interface ObjectiveBoundCertificate { weights: Exact[]; value: Exact; strict: boolean }
export type LinearExtremum =
  | { status: 'infeasible' }
  | { status: 'attained'; value: Exact; point: ExactPoint; bound: ObjectiveBoundCertificate }
  | { status: 'finite_limit'; value: Exact; closurePoint: ExactPoint; bound: ObjectiveBoundCertificate }
  | { status: 'unbounded'; basePoint: ExactPoint; direction: ExactPoint };
export interface LinearObjectiveSolution {
  expression: string; sense: 'max' | 'min'; coefficients: ExactAffine;
  range: ExactInterval | null;
  lowerBound: ObjectiveBoundCertificate | null; upperBound: ObjectiveBoundCertificate | null;
  extremum: LinearExtremum;
  cornerValues: Array<{ point: ExactPoint; value: Exact; included: boolean }>;
}
export interface NumberLineSolution { kind: 'number_line_set'; variable: string; intervals: ExactInterval[]; roots: Exact[] }
export interface HalfPlaneSolution {
  kind: 'linear_half_plane'; variables: [string, string]; constraints: LinearConstraint[];
  state: 'proper_half_plane' | 'empty' | 'all_plane'; feasibility: FeasibilityCertificate;
  boundaryPoint: ExactPoint | null; excludedWitness: ExactPoint | null;
}
export interface FeasibleRegionSolution {
  kind: 'linear_feasible_region'; variables: [string, string]; constraints: LinearConstraint[];
  feasibility: FeasibilityCertificate; dimension: 0 | 1 | 2 | null; bounded: boolean | null;
  closureVertices: LinearCorner[]; recessionWitness: ExactPoint | null;
  objective: LinearObjectiveSolution | null;
}
export interface LinearSystemSolution {
  kind: 'linear_system'; variables: [string, string]; equations: LinearConstraint[];
  determinant: Exact; relation: 'unique' | 'parallel' | 'coincident'; intersection: ExactPoint | null;
}
export type LinearFigureSolution = NumberLineSolution | HalfPlaneSolution | FeasibleRegionSolution | LinearSystemSolution;
export interface LinearProofIssue { code: string; message: string }
export interface LinearView { xMin: Exact; xMax: Exact; yMin: Exact; yMax: Exact }
export class LinearRegionError extends Error {}
type Affine = { a: Q; b: Q; c: Q };
type Row = { a: Q; b: Q; c: Q; strict: boolean; sourceId: string; weights: Q[] };
type Point = { x: Q; y: Q };
function fail(message: string): never { throw new LinearRegionError(message); }
const pointOut = (p: Point): ExactPoint => ({ x: out(p.x), y: out(p.y) });
const pointRead = (p: ExactPoint): Point => ({ x: read(p.x), y: read(p.y) });
function fields(value: object, names: readonly string[]): void { if (Object.keys(value).some((name) => !names.includes(name))) fail('Unsupported linear figure input field'); }
function variable(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(value)) fail('Invalid linear variable'); return value; }
function variables(value: unknown): [string, string] {
  if (value === undefined) return ['x', 'y'];
  if (!Array.isArray(value) || value.length !== 2) fail('Expected two distinct variables');
  const first = variable(value[0]); const second = variable(value[1]);
  if (first === second) fail('Expected two distinct variables');
  return [first, second];
}
function checkedNames(names: readonly string[]): readonly string[] {
  if (!Array.isArray(names) || names.length < 1 || names.length > 2 || new Set(names).size !== names.length) fail('Affine parser requires one or two distinct variables');
  return names.map(variable);
}
function mathText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) fail('Expected bounded mathematical expression');
  return value.replace(/\\(?:left|right)/g, '').replace(/\\(?:leq|le)\b/g, '<=').replace(/\\(?:geq|ge)\b/g, '>=')
    .replace(/\\(?:cdot|times)\b/g, '*').replace(/\\frac\s*\{\s*([+-]?\d+)\s*\}\s*\{\s*([+-]?\d+)\s*\}/g, '($1/$2)')
    .replace(/[≤]/g, '<=').replace(/[≥]/g, '>=').replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/');
}
function affine(value: string, names: readonly string[]): Affine {
  const text = mathText(value); const tokens: string[] = []; let offset = 0;
  while (offset < text.length) {
    if (/\s/.test(text[offset]!)) { offset++; continue; }
    const token = /^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|[()+*/-])/.exec(text.slice(offset))?.[0];
    if (!token) fail('Unsupported token in affine expression');
    tokens.push(token); offset += token.length;
    if (tokens.length > 128) fail('Affine expression exceeds 128 tokens');
  }
  let cursor = 0; let depth = 0;
  const constant = (q: Q): Affine => ({ a: Z, b: Z, c: q });
  const scalar = (a: Affine): boolean => a.a.n === 0n && a.b.n === 0n;
  const plus = (a: Affine, b: Affine): Affine => ({ a: add(a.a,b.a), b: add(a.b,b.b), c: add(a.c,b.c) });
  const scale = (a: Affine, q: Q): Affine => ({ a: mul(a.a,q), b: mul(a.b,q), c: mul(a.c,q) });
  const atom = (): Affine => {
    if (++depth > 24) fail('Affine expression nesting exceeds 24');
    const token = tokens[cursor++]; let result: Affine;
    if (token === '+' || token === '-') result = scale(atom(), token === '-' ? neg(O) : O);
    else if (token === '(') { result = sum(); if (tokens[cursor++] !== ')') fail('Unclosed affine parentheses'); }
    else if (token !== undefined && /^\d|^\./.test(token)) result = constant(parseRational(token));
    else if (token !== undefined && names.includes(token)) result = { a: token === names[0] ? O : Z, b: token === names[1] ? O : Z, c: Z };
    else return fail('Unknown variable or incomplete affine expression');
    depth--; return result;
  };
  const product = (): Affine => {
    let result = atom();
    while (cursor < tokens.length) {
      const token = tokens[cursor]!;
      const implicit = token === '(' || /^\d|^\.|^[A-Za-z]/.test(token);
      if (token !== '*' && token !== '/' && !implicit) break;
      if (!implicit) cursor++;
      const right = atom();
      if (token === '/') { if (!scalar(right)) fail('Variable denominator is not affine'); result = scale(result, div(O,right.c)); }
      else if (scalar(right)) result = scale(result, right.c);
      else if (scalar(result)) result = scale(right, result.c);
      else fail('Nonlinear multiplication is not supported');
    }
    return result;
  };
  const sum = (): Affine => {
    let result = product();
    while (tokens[cursor] === '+' || tokens[cursor] === '-') { const sign = tokens[cursor++]; result = plus(result, scale(product(), sign === '-' ? neg(O) : O)); }
    return result;
  };
  const result = sum(); if (cursor !== tokens.length) fail('Unexpected affine expression suffix'); return result;
}
/** Parses exact coefficients; it does not infer a source clause from prose. */
export function parseLinearAffine(expression: string, names: readonly string[] = ['x','y']): ExactAffine {
  const result = affine(expression, checkedNames(names)); return { a: out(result.a), b: out(result.b), constant: out(result.c) };
}
function clause(expression: string, names: readonly string[], sourceId: string, equalityOnly = false): Row[] {
  const text = mathText(expression); const matches = [...text.matchAll(/<=|>=|<|>|=/g)];
  if (matches.length !== 1) fail('A linear source clause requires exactly one comparison');
  const match = matches[0]!; const relation = match[0];
  if (equalityOnly && relation !== '=') fail('Linear systems require equations');
  const left = affine(text.slice(0,match.index), names); const right = affine(text.slice(match.index!+relation.length),names);
  const a = sub(left.a,right.a); const b = sub(left.b,right.b); const c = sub(right.c,left.c);
  const row = { a, b, c, strict: relation === '<' || relation === '>', sourceId, weights: [] };
  if (relation === '=') return [row, { ...row, a: neg(a), b: neg(b), c: neg(c) }];
  return relation === '>' || relation === '>=' ? [{ ...row, a: neg(a), b: neg(b), c: neg(c) }] : [row];
}
const rowOut = (r: Row): LinearConstraint => ({ a: out(r.a), b: out(r.b), rhs: out(r.c), strict: r.strict, sourceId: r.sourceId });
function rowRead(r: LinearConstraint): Row {
  fields(r,['a','b','rhs','strict','sourceId']);
  if(typeof r.strict!=='boolean'||typeof r.sourceId!=='string'||r.sourceId.length>64)fail('Invalid source row metadata');
  return { a: read(r.a), b: read(r.b), c: read(r.rhs), strict: r.strict, sourceId: r.sourceId, weights: [] };
}
function withWeights(rows: Row[]): Row[] { return rows.map((r,i) => ({ ...r, weights: rows.map((_,j) => i === j ? O : Z) })); }
function residual(r: Row, p: Point): Q { return sub(r.c,add(mul(r.a,p.x),mul(r.b,p.y))); }
function satisfies(rows: Row[], p: Point, closure = false): boolean { return rows.every((r) => r.strict && !closure ? residual(r,p).n > 0n : residual(r,p).n >= 0n); }
export function linearPointSatisfies(constraints: readonly LinearConstraint[], point: ExactPoint, closure = false): boolean {
  const source=snapshotMathSourceData({constraints,point});return satisfies(source.constraints.map(rowRead),pointRead(source.point),closure);
}
export function parseLinearConstraint(expression: string, names: readonly string[] = ['x','y'], equalityOnly = false): LinearConstraint[] {
  return clause(expression,checkedNames(names),'constraint_1',equalityOnly).map(rowOut);
}
/** Positive-proportional, orientation-preserving row identity; source IDs are omitted. */
export function linearConstraintSignature(constraint: LinearConstraint): string {
  const r = rowRead(constraint); const first = r.a.n !== 0n ? r.a : r.b.n !== 0n ? r.b : r.c;
  const scale = first.n < 0n ? neg(first) : first;
  const values = scale.n === 0n ? [Z,Z,Z] : [div(r.a,scale),div(r.b,scale),div(r.c,scale)];
  return JSON.stringify([...values.map(out),r.strict]);
}
type Bound = { value: Q; included: boolean; row: Row };
type Bounds = { lower: Bound | null; upper: Bound | null };
type Projection = { bounds: Bounds | null; contradiction: Row | null };
function combine(a: Row, first: Q, b: Row, second: Q): Row {
  return { a:add(mul(a.a,first),mul(b.a,second)), b:add(mul(a.b,first),mul(b.b,second)), c:add(mul(a.c,first),mul(b.c,second)),
    strict:(first.n > 0n && a.strict)||(second.n > 0n && b.strict),sourceId:'derived',
    weights:a.weights.map((value,i) => add(mul(value,first),mul(b.weights[i] ?? Z,second))) };
}
function intervalBounds(rows: Row[]): Projection {
  let lower: Bound | null = null; let upper: Bound | null = null;
  for (const r of rows) {
    if (r.a.n === 0n) { if (r.c.n < 0n || r.c.n === 0n && r.strict) return {bounds:null,contradiction:r}; continue; }
    const value = div(r.c,r.a); const next: Bound = { value,included:!r.strict,row:r };
    if (r.a.n > 0n) {
      if (!upper || cmp(value,upper.value)<0 || cmp(value,upper.value)===0 && r.strict) upper = next;
    } else if (!lower || cmp(value,lower.value)>0 || cmp(value,lower.value)===0 && r.strict) lower = next;
  }
  if (lower && upper && (cmp(lower.value,upper.value)>0 || cmp(lower.value,upper.value)===0 && !(lower.included && upper.included))) {
    return {bounds:null,contradiction:combine(upper.row,div(O,upper.row.a),lower.row,neg(div(O,lower.row.a)))};
  }
  return {bounds:{lower,upper},contradiction:null};
}
function projectY(rows: Row[]): Projection {
  const result = rows.filter((r) => r.b.n === 0n);
  const upper = rows.filter((r) => r.b.n > 0n); const lower = rows.filter((r) => r.b.n < 0n);
  for (const a of upper) for (const b of lower) result.push(combine(a,div(O,a.b),b,neg(div(O,b.b))));
  if (result.length > 512) fail('Linear projection exceeds 512 rows');
  return intervalBounds(result);
}
function pick(bounds: Bounds): Q {
  if (bounds.lower && bounds.upper) return div(add(bounds.lower.value,bounds.upper.value),rational(2n));
  if (bounds.lower) return add(bounds.lower.value,O);
  if (bounds.upper) return sub(bounds.upper.value,O);
  return Z;
}
function certificate(r: Row): LinearCombinationCertificate { return {weights:r.weights.map(out),a:out(r.a),b:out(r.b),rhs:out(r.c),strict:r.strict}; }
function feasible(rows: Row[]): FeasibilityCertificate {
  rows = withWeights(rows); const projection = projectY(rows);
  if (!projection.bounds) return {feasible:false,contradiction:certificate(projection.contradiction!)};
  const x = pick(projection.bounds);
  const yProjection = intervalBounds(rows.map((r) => ({...r,a:r.b,b:Z,c:sub(r.c,mul(r.a,x))})));
  if (!yProjection.bounds) fail('Exact projection failed witness reconstruction');
  const witness = {x,y:pick(yProjection.bounds)};
  if (!satisfies(rows,witness)) fail('Exact reconstructed witness violates original constraints');
  return {feasible:true,witness:pointOut(witness)};
}
const boundsOut = (bounds: Bounds): ExactInterval => ({lower:bounds.lower?{value:out(bounds.lower.value),included:bounds.lower.included}:null,upper:bounds.upper?{value:out(bounds.upper.value),included:bounds.upper.included}:null});
function objectiveProjection(source: Row[], cost: Affine): {bounds:Bounds;lower:ObjectiveBoundCertificate|null;upper:ObjectiveBoundCertificate|null} {
  if (cost.a.n === 0n && cost.b.n === 0n) {
    const r: Row = {a:Z,b:Z,c:Z,strict:false,sourceId:'constant',weights:source.map(()=>Z)};
    const bound = {value:cost.c,included:true,row:r};
    const proof = {weights:source.map(()=>out(Z)),value:out(cost.c),strict:false};
    return {bounds:{lower:bound,upper:bound},lower:proof,upper:proof};
  }
  const rows = withWeights(source).map((r) => cost.b.n !== 0n
    ? {...r,a:div(r.b,cost.b),b:sub(r.a,div(mul(r.b,cost.a),cost.b)),c:add(r.c,div(mul(r.b,cost.c),cost.b))}
    : {...r,a:div(r.a,cost.a),b:r.b,c:add(r.c,div(mul(r.a,cost.c),cost.a))});
  const projection = projectY(rows);
  if (!projection.bounds) fail('Objective projection of nonempty set became empty');
  const proof = (bound:Bound|null,lower:boolean): ObjectiveBoundCertificate|null => {
    if (!bound) return null; const divisor = lower ? neg(bound.row.a) : bound.row.a;
    return {weights:bound.row.weights.map((weight)=>out(div(weight,divisor))),value:out(bound.value),strict:!bound.included};
  };
  return {bounds:projection.bounds,lower:proof(projection.bounds.lower,true),upper:proof(projection.bounds.upper,false)};
}
function objectiveAt(cost: Affine,p:Point): Q { return add(add(mul(cost.a,p.x),mul(cost.b,p.y)),cost.c); }
const affineOut = (a:Affine): ExactAffine => ({a:out(a.a),b:out(a.b),constant:out(a.c)});
function equalPoint(a:Point,b:Point): boolean { return cmp(a.x,b.x)===0 && cmp(a.y,b.y)===0; }
function sortPoints(a:Point,b:Point): number { return cmp(a.x,b.x)||cmp(a.y,b.y); }
function corners(rows:Row[]): LinearCorner[] {
  const points:Point[]=[];
  for(let i=0;i<rows.length;i++) for(let j=i+1;j<rows.length;j++) {
    const a=rows[i]!; const b=rows[j]!; const determinant=sub(mul(a.a,b.b),mul(b.a,a.b));
    if(determinant.n===0n) continue;
    const p={x:div(sub(mul(a.c,b.b),mul(b.c,a.b)),determinant),y:div(sub(mul(a.a,b.c),mul(b.a,a.c)),determinant)};
    if(satisfies(rows,p,true)&&!points.some((other)=>equalPoint(other,p))) points.push(p);
  }
  return points.sort(sortPoints).map((p)=>({point:pointOut(p),activeConstraintIds:[...new Set(rows.filter((r)=>residual(r,p).n===0n).map((r)=>r.sourceId))],included:satisfies(rows,p)}));
}
function fixedObjectiveWitness(rows:Row[],cost:Affine,value:Q): ExactPoint {
  const c=sub(value,cost.c); const equation={a:cost.a,b:cost.b,c,strict:false,sourceId:'objective',weights:[]};
  const result=feasible([...rows,equation,{...equation,a:neg(cost.a),b:neg(cost.b),c:neg(c)}]);
  if(!result.feasible) fail('Finite objective endpoint has no certified witness');
  return result.witness;
}
function recession(rows:Row[],cost?:Affine,sense:'max'|'min'='max'): ExactPoint|null {
  const homogeneous=rows.map((r)=>({...r,c:Z,strict:false}));
  const candidates:Row[][]=cost ? [[{a:sense==='max'?neg(cost.a):cost.a,b:sense==='max'?neg(cost.b):cost.b,c:neg(O),strict:false,sourceId:'improvement',weights:[]}]]
    : [[{a:neg(O),b:Z,c:neg(O),strict:false,sourceId:'direction',weights:[]}],[{a:O,b:Z,c:neg(O),strict:false,sourceId:'direction',weights:[]}],[{a:Z,b:neg(O),c:neg(O),strict:false,sourceId:'direction',weights:[]}],[{a:Z,b:O,c:neg(O),strict:false,sourceId:'direction',weights:[]}]];
  for(const candidate of candidates) {const result=feasible([...homogeneous,...candidate]);if(result.feasible)return result.witness;}
  return null;
}
function dimension(rows:Row[]):0|1|2 {
  const weak=rows.map((r)=>({...r,strict:false})); const normals:Array<{a:Q;b:Q}>=[];
  for(const r of rows) {
    if(r.a.n===0n && r.b.n===0n) continue;
    const slack=objectiveProjection(weak,{a:neg(r.a),b:neg(r.b),c:r.c}).bounds.upper;
    if(slack&&slack.value.n===0n) normals.push({a:r.a,b:r.b});
  }
  if(normals.length===0)return 2;
  const first=normals[0]!;
  return normals.some((r)=>sub(mul(first.a,r.b),mul(r.a,first.b)).n!==0n)?0:1;
}
function objective(rows:Row[],input:{expression:string;sense:'max'|'min'},names:[string,string],feasibility:FeasibilityCertificate,vertices:LinearCorner[]):LinearObjectiveSolution {
  fields(input,['expression','sense']);if(input.sense!=='max'&&input.sense!=='min')fail('Objective sense must be max or min');
  const cost=affine(input.expression,names);
  const cornerValues=vertices.map((v)=>({point:v.point,value:out(objectiveAt(cost,pointRead(v.point))),included:v.included}));
  if(!feasibility.feasible)return {expression:input.expression,sense:input.sense,coefficients:affineOut(cost),range:null,lowerBound:null,upperBound:null,extremum:{status:'infeasible'},cornerValues};
  const projection=objectiveProjection(rows,cost); const endpoint=input.sense==='max'?projection.bounds.upper:projection.bounds.lower;
  let extremum:LinearExtremum;
  if(!endpoint) {
    const direction=recession(rows,cost,input.sense);if(!direction)fail('Unbounded objective lacks an improving recession certificate');
    extremum={status:'unbounded',basePoint:feasibility.witness,direction};
  } else {
    const bound=(input.sense==='max'?projection.upper:projection.lower)!;
    extremum=endpoint.included?{status:'attained',value:out(endpoint.value),point:fixedObjectiveWitness(rows,cost,endpoint.value),bound}
      :{status:'finite_limit',value:out(endpoint.value),closurePoint:fixedObjectiveWitness(rows.map((r)=>({...r,strict:false})),cost,endpoint.value),bound};
  }
  return {expression:input.expression,sense:input.sense,coefficients:affineOut(cost),range:boundsOut(projection.bounds),lowerBound:projection.lower,upperBound:projection.upper,extremum,cornerValues};
}
function region(input:Extract<LinearFigureInput,{kind:'linear_feasible_region'}>):FeasibleRegionSolution {
  fields(input,['kind','variables','constraints','objective']);const names=variables(input.variables);
  if(!Array.isArray(input.constraints)||input.constraints.length>16)fail('Feasible regions accept at most 16 source constraints');
  const rows=input.constraints.flatMap((expression,i)=>clause(expression,names,`constraint_${i+1}`));
  const feasibility=feasible(rows);const vertices=feasibility.feasible?corners(rows):[];
  let bounded:boolean|null=null;let dim:0|1|2|null=null;let direction:ExactPoint|null=null;
  if(feasibility.feasible) {
    const x=objectiveProjection(rows,{a:O,b:Z,c:Z}).bounds;const y=objectiveProjection(rows,{a:Z,b:O,c:Z}).bounds;
    bounded=Boolean(x.lower&&x.upper&&y.lower&&y.upper);dim=dimension(rows);
    if(!bounded){direction=recession(rows);if(!direction)fail('Unbounded region lacks a recession certificate');}
  }
  return {kind:input.kind,variables:names,constraints:rows.map(rowOut),feasibility,dimension:dim,bounded,closureVertices:vertices,recessionWitness:direction,
    objective:input.objective===undefined?null:objective(rows,input.objective,names,feasibility,vertices)};
}
type BooleanNode={rows:Row[]}|{op:'union'|'intersection';children:BooleanNode[]}|{op:'complement';child:BooleanNode};
function booleanProgram(input:IntervalExpression,name:string):{tree:BooleanNode;roots:Q[]} {
  let nodes=0;let atoms=0;const roots:Q[]=[];
  const visit=(expression:IntervalExpression,depth:number):BooleanNode=>{
    if(++nodes>128||depth>24||typeof expression!=='object'||expression===null||Array.isArray(expression))fail('Invalid or excessive interval Boolean expression');
    const keys=Object.keys(expression);if(keys.length!==1)fail('Interval expressions have exactly one operation');
    if('inequality' in expression){if(++atoms>32)fail('Number line supports at most 32 atoms');const rows=clause(expression.inequality,[name],`atom_${atoms}`);for(const r of rows)if(r.a.n!==0n){const root=div(r.c,r.a);if(!roots.some((v)=>cmp(v,root)===0))roots.push(root);}return {rows};}
    if('complement' in expression)return {op:'complement',child:visit(expression.complement,depth+1)};
    const op='union' in expression?'union':'intersection';const children=op==='union'?(expression as {union:IntervalExpression[]}).union:(expression as {intersection:IntervalExpression[]}).intersection;
    if(!Array.isArray(children)||children.length>32)fail('Interval Boolean operation requires bounded children');
    return {op,children:children.map((child)=>visit(child,depth+1))};
  };
  return {tree:visit(input,0),roots:roots.sort(cmp)};
}
export function validateIntervalExpression(expression:IntervalExpression,name='x'):void { booleanProgram(snapshotMathSourceData(expression),variable(name)); }
function booleanAt(tree:BooleanNode,value:Q):boolean {
  if('rows' in tree)return satisfies(tree.rows,{x:value,y:Z});
  if(tree.op==='complement')return !booleanAt(tree.child,value);
  return tree.op==='union'?tree.children.some((node)=>booleanAt(node,value)):tree.children.every((node)=>booleanAt(node,value));
}
function numberLine(input:Extract<LinearFigureInput,{kind:'number_line_set'}>):NumberLineSolution {
  fields(input,['kind','variable','expression']);const name=variable(input.variable??'x');const {tree,roots}=booleanProgram(input.expression,name);const pieces:ExactInterval[]=[];
  for(let i=0;i<=roots.length;i++) {
    const lo=roots[i-1];const hi=roots[i];const sample=lo&&hi?div(add(lo,hi),rational(2n)):lo?add(lo,O):hi?sub(hi,O):Z;
    if(booleanAt(tree,sample))pieces.push({lower:lo?{value:out(lo),included:false}:null,upper:hi?{value:out(hi),included:false}:null});
    if(hi&&booleanAt(tree,hi))pieces.push({lower:{value:out(hi),included:true},upper:{value:out(hi),included:true}});
  }
  const result:ExactInterval[]=[];
  for(const p of pieces) {
    const last=result.at(-1);
    if(last&&last.upper&&p.lower&&cmp(read(last.upper.value),read(p.lower.value))===0&&(last.upper.included||p.lower.included)){
      if(!p.upper)last.upper=null;else if(cmp(read(last.upper.value),read(p.upper.value))<0)last.upper=p.upper;else last.upper.included=last.upper.included||p.upper.included;
    }else result.push(p);
  }
  return {kind:input.kind,variable:name,intervals:result,roots:roots.map(out)};
}
function system(input:Extract<LinearFigureInput,{kind:'linear_system'}>):LinearSystemSolution {
  fields(input,['kind','variables','equations']);const names=variables(input.variables);
  if(!Array.isArray(input.equations)||input.equations.length!==2)fail('Linear system requires exactly two equations');
  const rows=input.equations.map((expression,i)=>clause(expression,names,`equation_${i+1}`,true)[0]!);
  if(rows.some((r)=>r.a.n===0n&&r.b.n===0n))fail('A two-line system requires two nonzero line normals');
  const [a,b]=rows as [Row,Row];const determinant=sub(mul(a.a,b.b),mul(b.a,a.b));
  const intersection=determinant.n===0n?null:{x:div(sub(mul(a.c,b.b),mul(b.c,a.b)),determinant),y:div(sub(mul(a.a,b.c),mul(b.a,a.c)),determinant)};
  const coincident=sub(mul(a.a,b.c),mul(b.a,a.c)).n===0n&&sub(mul(a.b,b.c),mul(b.b,a.c)).n===0n;
  return {kind:input.kind,variables:names,equations:rows.map(rowOut),determinant:out(determinant),relation:intersection?'unique':coincident?'coincident':'parallel',intersection:intersection?pointOut(intersection):null};
}
function halfPlane(input: Extract<LinearFigureInput,{kind:'linear_half_plane'}>): HalfPlaneSolution {
  fields(input,['kind','variables','inequality']); const names = variables(input.variables); const rows = withWeights(clause(input.inequality,names,'constraint_1'));
  if (rows.length !== 1) fail('A half-plane requires an inequality');
  const r = rows[0]!;
  if (r.a.n === 0n && r.b.n === 0n) {
    const feasible = r.strict ? r.c.n > 0n : r.c.n >= 0n;
    return { kind: input.kind, variables:names, constraints:rows.map(rowOut), state:feasible?'all_plane':'empty',
      feasibility:feasible?{feasible:true,witness:pointOut({x:Z,y:Z})}:{feasible:false,contradiction:{weights:[out(O)],a:out(Z),b:out(Z),rhs:out(r.c),strict:r.strict}}, boundaryPoint:null,excludedWitness:null };
  }
  const boundary = r.a.n !== 0n ? { x:div(r.c,r.a), y:Z } : { x:Z,y:div(r.c,r.b) };
  return { kind:input.kind,variables:names,constraints:rows.map(rowOut),state:'proper_half_plane',
    feasibility:{feasible:true,witness:pointOut({x:sub(boundary.x,r.a),y:sub(boundary.y,r.b)})},boundaryPoint:pointOut(boundary),excludedWitness:pointOut({x:add(boundary.x,r.a),y:add(boundary.y,r.b)}) };
}
export function solveLinearFigure(raw: LinearFigureInput): LinearFigureSolution {
  const input = snapshotMathSourceData(raw);
  if (input.kind === 'linear_half_plane') return halfPlane(input);
  if (input.kind === 'linear_feasible_region') return region(input);
  if (input.kind === 'number_line_set') return numberLine(input);
  if (input.kind === 'linear_system') return system(input);
  return fail('Unknown linear figure kind');
}
function sameExact(a:Exact,b:Exact):boolean {return cmp(read(a),read(b))===0;}
function exactCombination(constraints:readonly LinearConstraint[],weights:readonly Exact[]):Row {
  if(weights.length!==constraints.length)fail('Certificate multiplier count differs from source row count');
  let a=Z;let b=Z;let c=Z;let strict=false;
  constraints.forEach((constraint,i)=>{const q=read(weights[i]!);if(q.n<0n)fail('Certificate multipliers must be nonnegative');const r=rowRead(constraint);a=add(a,mul(q,r.a));b=add(b,mul(q,r.b));c=add(c,mul(q,r.c));strict ||= q.n>0n&&r.strict;});
  return {a,b,c,strict,sourceId:'certificate',weights:weights.map(read)};
}
/** Checks nonnegative row-combination algebra without invoking the solver. */
export function verifyLinearCombinationCertificate(constraints:readonly LinearConstraint[],proof:LinearCombinationCertificate):boolean {
  try {const captured=snapshotMathSourceData({constraints,proof});constraints=captured.constraints;proof=captured.proof;const sum=exactCombination(constraints,proof.weights);return cmp(sum.a,read(proof.a))===0&&cmp(sum.b,read(proof.b))===0&&cmp(sum.c,read(proof.rhs))===0&&sum.strict===proof.strict;}
  catch{return false;}
}
/** Witness or contradiction checker; it is independent of elimination. */
export function verifyLinearFeasibilityCertificate(constraints:readonly LinearConstraint[],proof:FeasibilityCertificate):boolean {
  try {
    const captured=snapshotMathSourceData({constraints,proof});constraints=captured.constraints;proof=captured.proof;
    if(proof.feasible===true)return linearPointSatisfies(constraints,proof.witness);
    if(proof.feasible!==false||!verifyLinearCombinationCertificate(constraints,proof.contradiction))return false;
    const r=proof.contradiction;const c=read(r.rhs);
    return read(r.a).n===0n&&read(r.b).n===0n&&(c.n<0n||c.n===0n&&r.strict);
  }catch{return false;}
}
/** Exact dual upper/lower bound check over the original source rows. */
export function verifyLinearObjectiveBound(constraints:readonly LinearConstraint[],cost:ExactAffine,proof:ObjectiveBoundCertificate,sense:'max'|'min'):boolean {
  try {
    if(sense!=='max'&&sense!=='min')return false;
    const captured=snapshotMathSourceData({constraints,cost,proof});constraints=captured.constraints;cost=captured.cost;proof=captured.proof;
    const sum=exactCombination(constraints,proof.weights);const sign=sense==='max'?O:neg(O);
    return cmp(sum.a,mul(read(cost.a),sign))===0&&cmp(sum.b,mul(read(cost.b),sign))===0&&
      cmp(read(proof.value),add(read(cost.constant),mul(sum.c,sign)))===0&&sum.strict===proof.strict;
  }catch{return false;}
}
/** A nonzero recession direction, optionally with strictly improving cost. */
export function verifyLinearRecessionCertificate(constraints:readonly LinearConstraint[],direction:ExactPoint,cost?:ExactAffine,sense:'max'|'min'='max'):boolean {
  try {
    if(sense!=='max'&&sense!=='min')return false;
    const captured=snapshotMathSourceData({constraints,direction,cost});constraints=captured.constraints;direction=captured.direction;cost=captured.cost;
    const d=pointRead(direction);if(d.x.n===0n&&d.y.n===0n)return false;
    if(constraints.some((r)=>add(mul(read(r.a),d.x),mul(read(r.b),d.y)).n>0n))return false;
    if(cost){const value=add(mul(read(cost.a),d.x),mul(read(cost.b),d.y));return sense==='max'?value.n>0n:value.n<0n;}
    return true;
  }catch{return false;}
}
/** Checks rank, source incidence, strict inclusion, duplicates and all source pairs. */
export function verifyLinearCorners(constraints:readonly LinearConstraint[],supplied:readonly LinearCorner[]):LinearProofIssue[] {
  const issues:LinearProofIssue[]=[];const issue=(message:string):void=>{issues.push({code:'invalid_linear_corners',message});};
  try {
    const captured=snapshotMathSourceData({constraints,supplied});constraints=captured.constraints;supplied=captured.supplied;
    if(supplied.length>496)fail('Corner list exceeds source-pair capacity');
    const rows=constraints.map(rowRead);const points=supplied.map((corner)=>pointRead(corner.point));
    supplied.forEach((corner,i)=>{
      const p=points[i]!;const active=rows.filter((r)=>residual(r,p).n===0n);
      if(!satisfies(rows,p,true))issue('Closure corner violates an original weak inequality');
      if(corner.included!==satisfies(rows,p))issue('Corner strict-boundary inclusion is incorrect');
      if(points.slice(0,i).some((other)=>equalPoint(other,p)))issue('Corner list has a duplicate exact point');
      const ids=[...new Set(active.map((r)=>r.sourceId))].sort();
      if(!Array.isArray(corner.activeConstraintIds)||corner.activeConstraintIds.length!==ids.length||[...corner.activeConstraintIds].sort().some((id,j)=>id!==ids[j]))issue('Corner active original constraint IDs are incorrect');
      if(!active.some((a,j)=>active.slice(j+1).some((b)=>sub(mul(a.a,b.b),mul(b.a,a.b)).n!==0n)))issue('Corner lacks two independent tight original boundaries');
    });
    // Completeness is a source-pair obligation, independent of the supplied list.
    for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
      const a=rows[i]!;const b=rows[j]!;const determinant=sub(mul(a.a,b.b),mul(b.a,a.b));if(determinant.n===0n)continue;
      const p={x:div(sub(mul(a.c,b.b),mul(b.c,a.b)),determinant),y:div(sub(mul(a.a,b.c),mul(b.a,a.c)),determinant)};
      if(satisfies(rows,p,true)&&!points.some((point)=>equalPoint(point,p)))issue('An original-boundary mathematical corner is missing');
    }
  }catch(error){issue(error instanceof Error?error.message:'Invalid corner metadata');}
  return issues;
}
function stable(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stable((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value)??'undefined';
}
function objectiveProofIssues(rows:Row[],request:{expression:string;sense:'max'|'min'},names:[string,string],vertices:LinearCorner[],feasibility:FeasibilityCertificate,supplied:LinearObjectiveSolution):LinearProofIssue[] {
  fields(request,['expression','sense']);if(request.sense!=='max'&&request.sense!=='min')fail('Objective sense must be max or min');
  const issues:LinearProofIssue[]=[];const check=(condition:boolean,message:string):void=>{if(!condition)issues.push({code:'invalid_linear_objective',message});};
  const cost=affine(request.expression,names);const exactCost=affineOut(cost);const constraints=rows.map(rowOut);
  check(supplied.expression===request.expression&&supplied.sense===request.sense,'Objective expression or sense differs from source');
  check(stable(supplied.coefficients)===stable(exactCost),'Objective exact coefficients differ from source');
  if(!feasibility.feasible){check(supplied.range===null&&supplied.extremum.status==='infeasible'&&supplied.lowerBound===null&&supplied.upperBound===null&&supplied.cornerValues.length===0,'Infeasible source has objective values or an optimum');return issues;}
  if(!supplied.range)fail('Nonempty source is missing its objective range');
  const endpoint=(bound:ExactEndpoint|null,proof:ObjectiveBoundCertificate|null,sense:'max'|'min'):void=>{
    if(!bound){check(proof===null&&recession(rows,cost,sense)!==null,'Infinite objective endpoint lacks a recession direction');return;}
    check(typeof bound.included==='boolean'&&proof!==null&&sameExact(proof.value,bound.value)&&proof.strict===!bound.included&&verifyLinearObjectiveBound(constraints,exactCost,proof,sense),'Objective endpoint bound certificate is invalid');
    // Tightness/attainment checks lift a value into the original set or its closure.
    fixedObjectiveWitness(bound.included?rows:rows.map((r)=>({...r,strict:false})),cost,read(bound.value));
  };
  endpoint(supplied.range.lower,supplied.lowerBound,'min');endpoint(supplied.range.upper,supplied.upperBound,'max');
  if(supplied.range.lower&&supplied.range.upper){const comparison=cmp(read(supplied.range.lower.value),read(supplied.range.upper.value));check(comparison<0||comparison===0&&supplied.range.lower.included&&supplied.range.upper.included,'Nonempty source has an empty objective range');}
  const wanted=request.sense==='max'?supplied.range.upper:supplied.range.lower;const result=supplied.extremum;
  if(!wanted){check(result.status==='unbounded'&&linearPointSatisfies(constraints,result.basePoint)&&verifyLinearRecessionCertificate(constraints,result.direction,exactCost,request.sense),'Unbounded objective certificate is invalid');}
  else if(wanted.included){check(result.status==='attained'&&sameExact(result.value,wanted.value)&&sameExact(result.bound.value,result.value)&&linearPointSatisfies(constraints,result.point)&&cmp(objectiveAt(cost,pointRead(result.point)),read(result.value))===0&&verifyLinearObjectiveBound(constraints,exactCost,result.bound,request.sense)&&!result.bound.strict,'Attained optimum certificate is invalid');}
  else {check(result.status==='finite_limit'&&sameExact(result.value,wanted.value)&&sameExact(result.bound.value,result.value)&&linearPointSatisfies(constraints,result.closurePoint,true)&&cmp(objectiveAt(cost,pointRead(result.closurePoint)),read(result.value))===0&&verifyLinearObjectiveBound(constraints,exactCost,result.bound,request.sense)&&result.bound.strict,'Finite nonattained objective limit certificate is invalid');}
  check(supplied.cornerValues.length===vertices.length,'Objective corner value list is incomplete');
  const seen:Point[]=[];
  for(const corner of supplied.cornerValues){const p=pointRead(corner.point);const matching=vertices.find((v)=>equalPoint(pointRead(v.point),p));check(Boolean(matching)&&matching?.included===corner.included&&cmp(objectiveAt(cost,p),read(corner.value))===0&&!seen.some((v)=>equalPoint(v,p)),'Corner objective evaluation is invalid');seen.push(p);}
  return issues;
}
/** Mandatory source, witness, dual algebra and complete-corner verification. */
export function verifyLinearFigureSolution(rawInput:LinearFigureInput,rawSolution:LinearFigureSolution):LinearProofIssue[] {
  const issues:LinearProofIssue[]=[];const check=(condition:boolean,message:string):void=>{if(!condition)issues.push({code:'invalid_linear_solution',message});};
  try {
    const input=snapshotMathSourceData(rawInput);const solution=snapshotMathSourceData(rawSolution);
    if(input.kind!==solution.kind)fail('Solution kind differs from source request');
    if(input.kind==='number_line_set'&&solution.kind==='number_line_set'){
      const expected=numberLine(input);check(stable(expected)===stable(solution),'Number-line set or endpoint inclusion differs from Boolean source');return issues;
    }
    if(input.kind==='linear_system'&&solution.kind==='linear_system'){
      const expected=system(input);check(stable(expected)===stable(solution),'Exact system determinant, relation or intersection is incorrect');
      if(solution.intersection)check(solution.equations.every((row)=>residual(rowRead(row),pointRead(solution.intersection!)).n===0n),'System intersection misses an original equation');return issues;
    }
    if(input.kind==='linear_half_plane'&&solution.kind==='linear_half_plane'){
      fields(input,['kind','variables','inequality']);const names=variables(input.variables);const rows=clause(input.inequality,names,'constraint_1');
      if(rows.length!==1)fail('Half-plane source must be an inequality');
      check(stable(solution.variables)===stable(names)&&stable(solution.constraints)===stable(rows.map(rowOut)),'Half-plane source coefficients or relation are incorrect');
      check(verifyLinearFeasibilityCertificate(solution.constraints,solution.feasibility),'Half-plane feasibility certificate is invalid');
      const r=rows[0]!;
      if(r.a.n===0n&&r.b.n===0n){const nonempty=r.strict?r.c.n>0n:r.c.n>=0n;check(solution.state===(nonempty?'all_plane':'empty')&&solution.boundaryPoint===null&&solution.excludedWitness===null,'Constant inequality has a fabricated boundary or wrong state');}
      else {check(solution.state==='proper_half_plane'&&solution.feasibility.feasible&&solution.boundaryPoint!==null&&residual(r,pointRead(solution.boundaryPoint)).n===0n&&solution.excludedWitness!==null&&residual(r,pointRead(solution.excludedWitness)).n<0n,'Half-plane side or boundary certificate is invalid');}
      return issues;
    }
    if(input.kind==='linear_feasible_region'&&solution.kind==='linear_feasible_region'){
      fields(input,['kind','variables','constraints','objective']);const names=variables(input.variables);
      if(!Array.isArray(input.constraints)||input.constraints.length>16)fail('Excessive source constraints');
      const rows=input.constraints.flatMap((expression,i)=>clause(expression,names,`constraint_${i+1}`));
      check(stable(solution.variables)===stable(names)&&stable(solution.constraints)===stable(rows.map(rowOut)),'Region source coefficients or strict relations are incorrect');
      check(verifyLinearFeasibilityCertificate(rows.map(rowOut),solution.feasibility),'Region feasibility certificate is invalid');
      if(!solution.feasibility.feasible)check(solution.dimension===null&&solution.bounded===null&&solution.closureVertices.length===0&&solution.recessionWitness===null,'Empty actual region carries geometry or boundedness claims');
      else {
        issues.push(...verifyLinearCorners(rows.map(rowOut),solution.closureVertices));check(solution.dimension===dimension(rows),'Region dimension is incorrect');
        const x=objectiveProjection(rows,{a:O,b:Z,c:Z}).bounds;const y=objectiveProjection(rows,{a:Z,b:O,c:Z}).bounds;const bounded=Boolean(x.lower&&x.upper&&y.lower&&y.upper);
        check(solution.bounded===bounded,'Region boundedness is incorrect');check(bounded?solution.recessionWitness===null:solution.recessionWitness!==null&&verifyLinearRecessionCertificate(rows.map(rowOut),solution.recessionWitness),'Region recession certificate is invalid');
      }
      if(input.objective!==undefined){if(!solution.objective)fail('Requested objective is missing');issues.push(...objectiveProofIssues(rows,input.objective,names,solution.closureVertices,solution.feasibility,solution.objective));}
      else check(solution.objective===null,'Unrequested objective result is present');return issues;
    }
    fail('Unknown linear figure variant');
  }catch(error){issues.push({code:'invalid_linear_solution',message:error instanceof Error?error.message:'Invalid exact linear metadata'});return issues;}
}
