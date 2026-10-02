import {
  isPlannerVisibleSceneConstructionOperator,
  isPlannerVisibleSceneProofPredicate,
  PLANNER_VISIBLE_SCENE_CONSTRUCTION_OPERATORS as DEFAULT_SCENE_CONSTRUCTION_OPERATORS,
  PLANNER_VISIBLE_SCENE_PROOF_PREDICATES as DEFAULT_SCENE_PROOF_PREDICATES,
} from "@heytutor/scene-engine";

export {
  DEFAULT_SCENE_CONSTRUCTION_OPERATORS,
  DEFAULT_SCENE_PROOF_PREDICATES,
};

/**
 * Semantic scene-planning contract for the general scene engine.
 *
 * The planner describes intent and mathematical relationships. It never owns
 * layout or canvas coordinates; those belong to the deterministic compiler.
 */
export const SCENE_DOCUMENT_VERSION = "scene-document/v2" as const;

export interface ScenePlannerPromptContext {
  conversationContext?: string;
  constructionOperators?: readonly string[];
  proofPredicates?: readonly string[];
  planningGuidance?: readonly string[];
}

export function buildSceneDocumentPlannerPrompt(
  question: string,
  context: ScenePlannerPromptContext = {},
  detailedOperators?: readonly string[],
): string {
  const operators = context.constructionOperators === undefined
    ? DEFAULT_SCENE_CONSTRUCTION_OPERATORS
    : [...new Set(context.constructionOperators.filter(isPlannerVisibleSceneConstructionOperator))];
  const proofPredicates = context.proofPredicates === undefined
    ? DEFAULT_SCENE_PROOF_PREDICATES
    : context.proofPredicates.filter(isPlannerVisibleSceneProofPredicate);
  const operatorSet = new Set(operators);
  const fullCatalog = DEFAULT_SCENE_CONSTRUCTION_OPERATORS.every((operator) => operatorSet.has(operator));
  // A scoped planning request gets full contracts. A universal catalog keeps
  // every input/output shape concise rather than expanding with each feature.
  const operatorContracts = selectConstructionInputContracts(operators,
    detailedOperators ?? (fullCatalog ? [] : undefined));
  const conversation = context.conversationContext?.trim()
    ? `\nCONVERSATION CONTEXT\n${context.conversationContext.trim()}\n`
    : "";
  const capabilityGuidance = context.planningGuidance?.length
    ? `\nSELECTED VISUAL INVARIANTS\n${context.planningGuidance.map((item) => `- ${item}`).join("\n")}\n`
    : "";

  const assemble = (contracts: string): string => `${SCENE_DOCUMENT_PLANNER_PROMPT}

AVAILABLE CONSTRUCTION OPERATORS
${operators.join(",")}

OPERATOR INPUT CONTRACTS
${contracts}

AVAILABLE PROOF PREDICATES
${proofPredicates.join(", ")}
${capabilityGuidance}
${conversation}
QUESTION
${question}

Return the complete ${SCENE_DOCUMENT_VERSION} JSON object now.`;
  const prompt = assemble(operatorContracts);
  // Combined semantic families may outgrow the same transport budget as the
  // universal catalog. Keep every contract shape and conditional output order.
  return detailedOperators === undefined && !fullCatalog && prompt.length + 800 > 24_500
    ? assemble(selectConstructionInputContracts(operators, []))
    : prompt;
}

export const SCENE_DOCUMENT_PLANNER_PROMPT = `Return complete scene-document/v2 JSON only: no pixels,tags,prose,raw paths or topic templates.
Keys:schemaVersion,visualDecision,source,quantities,entities,constructions,relations:[],assertions,annotations,requiredEntityIds,revealGroups,teachingTimeline.
Entity:{id,kind,role?,label?}; Construction:{id,operator,inputs,outputs}; Assertion:{id,predicate,entities,expected,severity}; Annotation:{id,kind,targetIds,text?,placementIntent?,quantityId?,style?}.

AUTHORITY
- Faithful supported visual:scene; otherwise text_only,empty arrays.
- Show the problem setup, not a solved answer sheet. Setup before calculation. Do not place derived scalar answers in the initial scene; spatial targets need exact plan-backed geometry.
- Question/AUTHORITATIVE TURN PLAN are fixed evidence. Copy exact quantity id/value/unit. Invent no measurements,signs,components,topology or assumptions. Display lengths never establish physical values.
- World coordinates certify metrics/directions; nonmetric layout uses inline dimensionless literals. Quantities are evidence, never display sizes.
- Resolve references; one producer per required visible entity. Order dependencies; reuse IDs. Duplicate geometry/terminal pairs are fatal. Preserve output arity/order.
- Use deterministic operators for curves,regions,solids,intersections,transforms,normals,rays. Function regions:function_curve + function_region. Never guess.
- refract_direction is the visible outgoing ray. Do not output a direction helper or wrap the result in ray/vector.

RELATIONS
- Physical vectors/angles:world points,named proofs. on:[point,path];converges:[path1,path2,target];between:[middle,end1,end2];same_side:[point,point,origin]. between/equal_length:geometry only.
- Incoming ray:surface_contact -> normal_at -> reflect_direction/refract_direction. Given contact incidence:reflect_at/refract_at. One representation per ray.
- Circuit components use symbol,two distinct terminals; never connect/segment or duplicate its edge. Series shares consecutive terminals; parallel shares a pair. Prove path,sameTerminalPair,pathCount,connected or degree.
- Closed routes:shared p0...p(N-1),edge i:p(i)->p(i+1 mod N). Split contacts at shared IDs. Overlap,crossing,on or equal coordinates with distinct IDs never prove connectivity. Named sides use shared terminals. Up/down vertical; left/right horizontal.
- Page normal:[0,0,-1] into-page cross;[0,0,1] out-of-page dot,never planar arrows. Compared/disconnected views:disjoint reveal groups. Cross-view connectors require explicit short/bypass.
- requiredEntityIds:existence; omit exists. At most6 assertions. equal_angle:four paths; angle_between:two,expected:{value,unit:"degree"|"radian"}; function_value:[curve],expected:{x,y}; root:[curve],expected:x|{x}.

LABELS AND REVEAL
- Labels identify owners/values in at most16 characters; explain in narration. Do not add a figure title or caption. The board does not draw a line under the figure.
- Attach to existing owners. No positioning geometry or helper/unnamed junction/wire terminal labels. Paths from targetIds,never coordinates/CIRCLE_AROUND.
- Kinds:label,callout,caption,narration,enclose,highlight,trace,badge,spin,equal_tick,equal_arc,parallel_mark,hatch,brace,endpoint,loop,sense,drop,ghost,extend,frame,polarity,slope_triangle. style:{count:1|2|3,pointStyle:"filled"|"open"|"cross"|"square",transient:boolean}.
- One group unless staged/separate views. revealGroups.entityIds:entity IDs; timeline acts on existing targets.
Entity kinds:point,segment,ray,line,circle,arc,rectangle,polygon,polyline,vector,axes,object,component,connector,label,dimension,angle_mark,right_angle_mark,tick_mark,sign_badge,wavefront_family,aperture,screen_pattern,transverse_field,polarizer,group.`;

export const SCENE_CONSTRUCTION_INPUT_CONTRACTS = `Use these exact input keys. Entity references are stable ID strings. Numeric inputs may be numbers or quantity IDs.
- point: {x, y, coordinateSpace:"world"|"layout"}. World coordinates preserve physical distances, angles, and directions; exact givens stay exact, while an unstated vector length may use a normalized local frame. Layout coordinates are small dimensionless integers used only to arrange topology with no metric or directional claim.
- segment/connect: {start: point_id, end: point_id}.
- vector: {start: point_id, end: point_id, direction?: vector_id|[dx,dy]|[dx,dy,dz], length?:positive_number}. When direction is present, direction defines orientation; a distinct start/end defines display length, otherwise length or a normalized unit length is used. A pure [0,0,-1] or [0,0,1] direction is the only correct representation for into-page or out-of-page respectively.
- ray/line: {start: point_id, end: point_id} or {start: point_id, direction: [dx,dy]}.
- circle: {center: point_id, radius}.
- circle_from_three_points: {a:point_id,b:point_id,c:point_id}. Output one circle computed through three distinct noncollinear points. Degenerate or numerically unverifiable triples fail closed; never guess the circumcenter or radius.
- circle_tangent_at: {circle:circle_id,point:point_id,span:positive_number}. Output one line perpendicular to the radius at a point on the circle; off-circle points fail closed. span is the full represented length.
- circle_tangency_points: {circle:circle_id,externalPoint:point_id}. Output two points of contact from a strictly external point, ordered by positive then negative cross product with the centre-to-external-point direction. Inside, on-circle, and numerically ambiguous cases fail closed. Reuse the contacts to draw tangent segments.
- circle_intersections: {circleA:circle_id,circleB:circle_id,mode:"two"|"tangent"}. Output two points for mode two, ordered positive then negative cross product with the centre-to-centre direction; mode tangent outputs one point. The requested multiplicity must be mathematically correct. Disjoint, concentric, coincident, and ambiguous cases fail closed.
- arc: {center: point_id, radius, startAngle, endAngle, angleUnit: "degrees"|"radians"}.
- rectangle: {center: point_id, width, height}.
- polygon/polyline: {points: [point_id,...]}.
- axes: {xMin, xMax, yMin, yMax}.
- midpoint: {a: point_id, b: point_id}.
- intersection: {first: line_or_segment_id, second: line_or_segment_id}.
- surface_intersection: {origin,surface}. Full shape: {origin: point_id, surface: line_or_circle_or_arc_id, direction?:vector_id|[dx,dy], through?:point_id, parallelTo?:path_id, which?:"nearest_forward"|"farthest_forward"}. Supply exactly one of direction, through, or parallelTo; prefer through/parallelTo when the relationship is known.
- surface_contact: same inputs as surface_intersection and exactly two fresh outputs [hit_point_id, incident_vector_id]. origin must be a distinct off-surface point; through must differ from origin. Use this instead of surface_intersection for visible reflection/refraction paths, and never reuse an ID already produced by another construction.
- A surface_contact hit point and a normal_at output may be implicit construction helpers when they are consumed by later operators and do not need a visible mark. Visible outputs such as the incident vector still require a declared entity.
- normal_at: {point: point_id, surface: line_or_circle_or_arc_id}.
- normal_at outputs solver-only geometry. It is used by reflection/refraction but is not drawn; construct a separate visible normal only when the question explicitly asks for one.
- normal_at still has exactly one stable output helper ID even when that helper is not declared as a visible entity or added to a reveal group. Never emit outputs:[] for normal_at.
- project: {point: point_id, line: line_or_segment_id}.
- translate: {point: point_id, vector: vector_id|[dx,dy]}.
- rotate: {point: point_id, center: point_id, angle, angleUnit}.
- reflect_point: {point: point_id, line: line_or_segment_id}.
- affine_point: {point:point_id,matrix:[[a,b],[c,d]],translation?:[tx,ty],inverse?:false}. Output one planar point computed as A*p+t, or A^-1*(p-t) when inverse=true. Matrix scalars are dimensionless; source coordinates and translation share one length scale. Singular forward matrices may project points; singular/ill-conditioned inverses fail closed. Do not pass 3D or field-result geometry.
- affine_path: {path:path_id,matrix:[[a,b],[c,d]],translation?:[tx,ty],inverse?:false}. Output one entity with the same kind as the source planar path, preserving closure/direction/infinite-line status. Derive every vertex by the matrix. Regions that collapse to a line or point fail closed. Sampled-curve, conic, field, and 3D identities are unsupported here; never discard their mathematical metadata to imitate a transformed figure. Chain transforms through output IDs for composition.
- reflect_direction: {origin: point_id, incoming: vector_id, normal: vector_id}. Output exactly one visible reflected ray entity. Do not output a direction helper or wrap the result in ray/vector.
- refract_direction: {origin: point_id, incoming: vector_id, normal: vector_id, n1, n2}. Output exactly one visible refracted ray entity. Do not output a direction helper or wrap the result in ray/vector.
- reflect_at: {point, surface, incidentAngleDeg, tangentSign?:-1|1, span?}. Outputs [incident_ray, normal, reflected_ray]. Prefer it for a stated angle at a known contact.
- refract_at: {point, surface, incidentAngleDeg, n1, n2, tangentSign?:-1|1, span?}. Outputs [incident_ray, normal, refracted_ray] using Snell's law. Prefer it for a stated angle; do not duplicate its rays with low-level operators.
- parallel_through/perpendicular_through: {through: point_id, line: line_or_segment_id}.
- angle_bisector: {vertex: point_id, a: point_id, b: point_id}.
- angle_mark: {vertex: point_id, a: point_or_path_id, b: point_or_path_id, radius?, count?:1|2|3}. Each path must meet the vertex at one endpoint. Marks the smaller angle between the two arms. count draws concentric congruence arcs. Bind a measured value with an annotation quantityId or an angle_between assertion; do not invent a degree label.
- right_angle_mark: {vertex: point_id, a: point_or_path_id, b: point_or_path_id, size?}. Each path must meet the vertex at one endpoint.
- tick_mark: {target: line_or_segment_id, at?:0..1, size?, count?:1|2|3, family?:string}. Matching family IDs share the same tick count. count is 1, 2, or 3 congruence marks perpendicular to the target at the parametric location.
- sign_badge: {target: line_or_segment_or_vector_id, sense:"positive"|"clockwise"|"counterclockwise", at?:0..1}. A compact owned direction or rotation convention mark. Never a teaching-model ARROW.
- vector_components: {origin: point_id, vector: vector_id|[dx,dy], basis?: line_or_segment_or_vector_id} and exactly two output entity IDs. Without basis, outputs are Cartesian x then y components. With basis, outputs must be [parallel_component_id, perpendicular_component_id]. For an incline or any rotated frame, always provide the physical surface/axis as basis; never label Cartesian components as parallel/perpendicular.
- dimension: {start: point_id, end: point_id}.
- symbol: {symbol,start,end}. Full shape: {symbol:"resistor"|"battery"|"cell"|"capacitor"|"inductor"|"lamp"|"galvanometer"|"ammeter"|"voltmeter"|"ac_source"|"diode"|"zener"|"switch", start: point_id, end: point_id}. The symbol itself connects those terminals. Use connect only between two point IDs for an additional ordinary wire.
- label: {target: entity_id, text}. The target may be a point or rendered geometry. The output must be one label entity whose compact entity.label matches text. Use this only for a symbol or value that needs a precise constructed anchor; ordinary object labels still belong on their owner entity or in annotations.
- function_curve: {expression, variable?:"x", xMin, xMax, samples?}. Expressions support numeric literals, x, pi, e, explicit + - * / ^, parentheses, and sin/cos/tan/asin/acos/atan/sqrt/abs/exp/log/ln. Multiplication must be explicit. samples defaults to 65 and, when supplied, must be an odd integer from 17 to 161. Use only a domain where the function stays finite and continuous; never bridge an asymptote.
- function_region: {upper: function_curve_id, lower: function_curve_id, xMin?, xMax?, samples?}. Deterministically samples both function curves over their shared domain and closes the boundary with the upper curve in reverse order. Use this for every region whose boundary is defined by functions.
- constraint_region: {constraints: [{expression, relation:"le"|"ge"}, ...], xMin, xMax, yMin, yMax, samples?}. The feasible set where every constraint holds, with expression F(x,y) in the implicit_curve language and relation le meaning F<=0, ge meaning F>=0. Use it for a region stated as inequalities (a circle cut by a line, a quadrant clip, a parabola inside a circle) with 1 to 6 constraints. The compiler fails closed on an empty set, a set that splits into pieces, or a column with two separate feasible runs; do not try to bridge those.
- parametric_curve: {xExpression, yExpression, parameter?:"t", tMin, tMax, samples?}. Both expressions use t and the same safe expression language as function_curve. The finite continuous parameter domain and odd sample count are mandatory.
- polar_curve: {radiusExpression, parameter?:"theta", thetaMin, thetaMax, samples?}. Angles are radians. radiusExpression uses theta and the same safe expression language as function_curve.
- implicit_curve: {expression, xMin, xMax, yMin, yMax, xSamples?, ySamples?}. expression is F(x,y), with the visible contour defined by F(x,y)=0. It uses the safe function_curve expression language plus y. xSamples and ySamples default to 65 and must each be integers from 17 to 161. Bounds must be finite and ordered. The compiler fails closed on discontinuities, unresolved multiple edge crossings, empty contours, or excessive contour complexity; narrow the domain or increase the grid instead of inventing a trace.
- conic: {kind:"ellipse"|"hyperbola"|"parabola", center?:point_id, vertex?:point_id, rotationDeg?:0, a?, b?, p?, tMin?, tMax?, samples?}. Ellipse and hyperbola use center and positive a,b (ellipse a>=b); parabola uses vertex and signed nonzero p for local y^2=4px. Hyperbola and parabola require finite ordered tMin,tMax; ellipse uses a complete revolution. samples defaults to129 and is an integer17..513. Output one polyline. Use explicit parameters only when supplied or authoritatively derived; otherwise use the stated implicit equation.
- conic_anchor: {conic:conic_id, feature:"center"|"vertex"|"co_vertex"|"focus"|"latus_rectum_endpoint"|"curve_point", side?:-1|1, transverseSide?:-1|1, at?, branch?:-1|1}. Output one point computed from that conic. Paired features require side. Parabola has no center/co_vertex and its unique vertex/focus omit side. Latus rectum endpoints require transverseSide. curve_point uses at (ellipse angle in radians, hyperbola parameter, or parabola parameter); hyperbola also requires branch. Never guess foci or vertices with point.
- conic_directrix: {conic:conic_id, side?:-1|1, span:positive_number}. Output one line; ellipse/hyperbola require side, parabola omits it. A circle has no finite directrix.
- conic_asymptotes: {conic:hyperbola_id, span:positive_number}. Output one polyline containing two separate derived asymptote paths.
- conic_tangent: {conic:conic_id, at, branch?:-1|1, span:positive_number}. Output one line derived at the same parameter as conic_anchor curve_point. Hyperbola requires branch. Do not supply a guessed slope.
- triangle_from_sides: {sideAB, sideBC, sideCA, origin?:point_id|[0,0], headingDeg?:0, orientation?:-1|1}. Construct an unambiguous SSS triangle. Output exactly [A,B,C,outline] with entity kinds [point,point,point,polygon]. headingDeg sets A to B direction; orientation chooses the side of AB. All sides must be positive and satisfy strict triangle inequalities; never guess vertices from side lengths.
- triangle_from_sas: {sideAB, sideCA, angleADeg, origin?:point_id|[0,0], headingDeg?:0, orientation?:-1|1}. Side quantities must use compatible length units. Construct SAS with the included angle at A strictly between 0 and 180 degrees. Output [A,B,C,outline] as points and polygon.
- triangle_from_asa: {sideAB, angleADeg, angleBDeg, origin?:point_id|[0,0], headingDeg?:0, orientation?:-1|1}. Construct ASA with the given side AB and endpoint angles; both angles are positive and sum to less than180 degrees. Output [A,B,C,outline] as points and polygon. Ambiguous SSA is unsupported.
- triangle_center: {a:point_id, b:point_id, c:point_id, kind:"centroid"|"incenter"|"circumcenter"|"orthocenter"}. Output one point derived from three non-collinear vertices. Reuse these points for medians, altitudes, incircles, or circumcircles.
- vector_sum: {vectors:[vector_id,...], origin:point_id|[x,y]}. Output one vector with exact summed components, relocated to the stated origin. 1..32 ordinary verified finite directed vectors; this operator's outputs may be composed. An exact zero is a point marker with no arrow. Physical field, 3D, and analytic curve outputs are excluded.
- vector_scale: {vector:vector_id, factor, origin:point_id|[x,y]}. Output one vector scaled by a finite dimensionless factor (negative reverses direction, zero gives a zero marker), placed at origin. No inferred display scaling.
- vector_projection: {vector:vector_id, onto:nonzero_vector_id, origin:point_id|[x,y]}. Output one vector equal to dot(vector,onto)/dot(onto,onto) times onto, at origin. A perpendicular input yields a certified zero marker. Do not supply a projected endpoint.
- constant_acceleration_trajectory: {initialPosition:[x,y], initialVelocity:[vx,vy], acceleration:[ax,ay], tMin,tMax,samples?:3..513,units?:{length,time}}. Output one polyline from p(t)=p0+v0*t+0.5*a*t^2 on a finite ordered time domain; the initial state is at t=0. Inputs are explicit 2D components, with compatible declared units if source quantities carry units. Never infer gravity or acceleration. A stationary trajectory is an exact point marker.
- trajectory_state: {trajectory:constant_acceleration_trajectory_id, time, kind:"position"|"velocity"|"acceleration"|"state", timeScale?}. Time lies in the trajectory domain. Position outputs one point. Velocity/acceleration output one vector; state outputs [position,velocity,acceleration]. Vector forms require positive timeScale: display displacements are v*timeScale and a*timeScale^2 in trajectory length units. Zero vectors are point markers. Reuse the derived state for incidence proofs; never guess tangent endpoints.
- curve_anchor: {curve:sampled_curve_id, at}. Output one point evaluated exactly at x/t/theta on the referenced function/parametric/polar curve, including domain endpoints. Use this point for incidence proofs rather than guessed coordinates. Analytic motion, harmonic waves/superpositions and PV processes are also supported with their declared parameter units.
- curve_secant: {curve:sampled_curve_id, first, second, span?}. Output one line through the two evaluated curve anchors at distinct in-domain parameters. Coincident anchors fail closed. Optional positive span must cover the anchor chord in its coordinate scale; scaled wave/PV spans are dimensionless display lengths. Default is the chord length.
- curve_derivative: {curve:sampled_curve_id, at, parameterScale}. Output one vector at the exact curve point, with components parameterScale times the analytic derivative. Positive explicit parameterScale controls display displacement. Exact zero derivative yields a point marker; nondifferentiable or unsupported derivatives fail closed. The engine differentiates the source expression; never supply a guessed slope.
- impedance: {kind:"resistor"|"inductor"|"capacitor", value, unit:"ohm"|"H"|"F", frequency, frequencyUnit:"Hz"|"rad/s", displayScale, origin?:point_id|[x,y]}. Output one complex-plane vector with engine-computed Z: R, i*omega*L, or -i/(omega*C). Hz is converted deterministically to omega=2*pi*f. Frequency and displayScale are positive; R/L are nonnegative, C is positive. SI source units must match explicit declarations. Zero impedance is a point marker, not an arrow. Diagram length is scaled display geometry, not physical impedance.
- impedance_combine: {sources:[impedance_id,...], mode:"series"|"parallel", displayScale, origin?:point_id|[x,y]}. Output one vector with summed series impedance or inverse summed parallel admittance. 1..32 sources must have exactly the same normalized frequency. Singular cases fail closed. The component topology must be drawn separately with ordinary circuit symbols and verified connections.
- phasor_response: {voltage:{real,imaginary}, voltageUnit:"V", convention:"rms", impedance:impedance_id, voltageScale,currentScale, origin?:point_id|[x,y]}. Output [voltage,current] vectors derived by I=V/Z. Scales are explicit positive display factors; zero phasors are point markers. Metadata derives RMS complex power V*conj(I); undefined power factor is null. Labels are engine-derived or matching Z/V/I symbols; never provide a contradictory phase or magnitude label.
- harmonic_wave: {amplitude,waveNumber,angularFrequency,time,xMin,xMax}. Full shape: {amplitude,waveNumber,angularFrequency,phase,phaseUnit:"rad",time,xMin,xMax,samples?,origin?:point_id|[x,y],xScale?:1,yScale?:1,units?:{position,time,amplitude}}. Output one polyline of y=A*sin(k*x-omega*time+phase) from explicitly supplied physical parameters, with positive display scales. Signed A,k,omega are allowed. Samples are bounded and must provide at least 32 points per spatial cycle; never draw an undersampled oscillation. Preserve physical quantities separately from scaled offsets.
- wave_superposition: {waves:[wave_id,...],samples?}. Output one polyline with the exact sum of 1..16 compatible verified waves. Domain, time, origin, display scales, and source units must match; flattened harmonics and dependency depth are bounded. No inferred phase or amplitude. A certified zero is a flat baseline, not an invented oscillation.
- wave_sample: {wave:wave_id,x}. Output one analytically evaluated point at the physical in-domain x. Its label comes from the engine's physical wave value, including when the curve uses display scales. Use its exact parameter for incidence proofs.
- gaussian_image: {kind,objectDistance,focalLength,objectHeight}. Full shape: {kind:"lens"|"mirror",center:point_id|[x,y],axis:line_id|[dx,dy],objectDistance,focalLength,objectHeight,displayScale,lengthUnit?}. Output [objectBase,objectTip,imageBase,imageTip] as four points using signed Cartesian distances. Lens: v=f*u/(u+f), m=v/u; mirror: v=f*u/(u-f), m=-v/u. Height is signed; displayScale is explicit positive. Source lengths must use a common unit. Infinity or numerically ambiguous cases fail closed. Reuse the anchors for verified segments/rays and draw the optical element with lens_section or spherical_surface; these anchors never invent a surface or ray path.
- optical_focus: {kind:"lens"|"mirror",center:point_id|[x,y],axis:line_id|[dx,dy],focalLength,displayScale,lengthUnit?}. Lens outputs two focus points at signed distances [-f,+f] in that order; mirror outputs one at f. Preserve the supplied axis direction. Numeric labels and quantity annotations must match computed physical distances, independently of display scale.
- polytropic_process: {pressureStart,volumeStart,volumeEnd,exponent}. Full shape: {pressureStart,volumeStart,volumeEnd,exponent,pressureUnit:"Pa"|"kPa"|"bar",volumeUnit:"m^3"|"L"|"cm^3",origin?:[x,y],pressureScale,volumeScale,samples?}. Output one P-V path obeying P*V^n=constant with explicit n; n=0 is isobaric, n=1 is isothermal, a gas exponent is used only when supplied. Positive P/V and explicit positive display scales are required. Compression and expansion retain source direction. The engine computes signed work in joules and keeps it separate from diagram area; never infer heat or temperature.
- isochoric_process: {volume,pressureStart,pressureEnd}. Full shape: {volume,pressureStart,pressureEnd,pressureUnit:"Pa"|"kPa"|"bar",volumeUnit:"m^3"|"L"|"cm^3",origin?:[x,y],pressureScale,volumeScale,samples?}. Output one constant-volume P-V path with engine-certified zero work. Positive physical states and distinct endpoint pressures are required. Never substitute a guessed closed cycle.
- process_state: {process:process_id,at:0..1}. Output one analytically computed state point on a verified process. Its physical P/V and unit conversions stay in metadata and its numeric labels are engine-owned. Source quantity annotations must match the computed state or work, not a display coordinate.
- histogram: {bins:[{lower,upper,frequency},...], heightMode:"frequency"|"density", origin?:point_id, xScale?:1, yScale?:1}. Output one polyline containing closed bars. 1..128 ascending contiguous bins; each width positive, frequency nonnegative. Unequal widths require density=f/width so area represents frequency. Scales are positive display scales; retain source values in quantities. Zero bins have zero height. Never invent observations.
- frequency_polygon: {bins:[{lower,upper,frequency},...], heightMode:"frequency"|"density", origin?:point_id, xScale?:1, yScale?:1}. Output one polyline joining exact class midpoints at frequency or density height, using 2..128 ascending contiguous bins with positive widths and nonnegative frequencies. Unequal widths allow explicit frequency or density height. No invented zero-frequency closing classes.
- cumulative_frequency: {bins:[{lower,upper,frequency},...], direction:"less_than"|"greater_than", origin?:point_id, xScale?:1, yScale?:1}. Output one polyline from exact boundary cumulative sums, including the zero/total endpoint. Same finite contiguous bin rules. Do not supply cumulative counts independently of the source frequencies.
- permutation_cycles: {items:[unique_short_name,...1..8],mapping:[zero_based_image_index,...],origin?:point_id|[x,y],displayScale:positive}. Output n node points in item order then n directed branch polylines in source order. Supply an explicit bijection; cycles/inverse/parity/factorial counts are computed exactly. Graph distances, angles and areas have no combinatorial meaning; no circuit topology assertions. Default node IDs, unlabelled edges; verified named invariant claims only.
- subset_lattice: {items:[unique_short_name,...0..4],selectionRank?:integer_0_to_n,origin?:point_id|[x,y],displayScale:positive}. Output 2^n node points in increasing bitmask order then n*2^(n-1) directed cover-edge polylines in source-mask/added-item order; n=0 has one node/no edges. Exact subset/rank/binomial counts; no independence or metric claims. Default short subset names; engine checks explicit named count claims.
- elastic_profile: {youngModulus,strainMin,strainMax}. Full shape: {model:"linear_elastic",youngModulus,modulusUnit:"Pa"|"kPa"|"MPa"|"GPa",strainMin,strainMax,origin?:[x,y],strainScale,stressScale,stressUnit?:"Pa"|"kPa"|"MPa"|"GPa",samples?}. Output one exact stress-strain curve sigma=E*epsilon under the explicit linear law. E>0; signed dimensionless increasing strain domain; no inferred material or plastic limit. Physical SI values are independent of display scales.
- elastic_state: {profile:elastic_profile_id,strain,area?,areaUnit?:"m^2"|"cm^2"|"mm^2",length?,lengthUnit?:"m"|"cm"|"mm"|"km",uniformBar?:true}. Output one exact curve point. Optional dimensions require paired explicit units and uniformBar:true; supplying length requires strain>-1. Compute signed stress, F=sigma*A with area, extension=epsilon*L with length, U=E*epsilon^2*A*L/2 with both. Default symbolic label; explicit numeric/unit claims verified.
- flux_process: {B,A,t}. Full shape: {model:"uniform_affine",B0:[x,y,z],fieldRate:[x,y,z],areaVector:[x,y,z],areaRate:[x,y,z],turns,tMin,tMax,units:{field:"T"|"mT",area:"m^2"|"cm^2",time:"s"|"ms"},fluxUnit?:"Wb"|"mWb",origin?:[x,y],timeScale?,fluxScale?,samples?}. Output one exact flux-linkage time curve Phi=N*B(t) dot A(t),with affine B/area laws and explicit rates per source time. Turns integer1..1e6; area remains nonzero throughout the domain. Physical SI coefficients/emf are independent of display scales. No inferred loop shape,normal,current or resistance.
- induction_state: {process:flux_process_id,time,emfAt?:[x,y]}. Outputs [flux point,emf label anchor] at source time. Phi and emf=-dPhi/dt retain SI authority; only flux point has curve incidence. Defaults Phi(t)/emf(t); explicit numeric/unit claims engine-checked.
- rotational_motion: {radius,angle,omega}. Full shape: {radius,angle,angleUnit:"rad",angularVelocity,angularAcceleration,units:{length:"m"|"cm"|"mm"|"km",time:"s"|"ms"},angularVelocityUnit:"rad/s"|"rad/ms",angularAccelerationUnit:"rad/s^2"|"rad/ms^2",origin?:[x,y],displayScale:positive}. Output one source-defined circular position point with physical radius/rates and normalized display metadata. Radius positive,angular rates match declared source time basis; no inferred mass or inertia.
- rotational_state: {motion:rotational_motion_id,kind:"velocity"|"acceleration"|"components",displayLength:positive}. Outputs one velocity/total-acceleration vector,or [tangential acceleration vector,centripetal acceleration vector] for components; certified zero vectors are point markers. v=omega*J*r,a_t=alpha*J*r,a_c=-omega^2*r. Arrow lengths are independent displays; show parallel resultants in separate explicit scales/views. Default symbols,verified numeric SI claims only.
- planar_torque: {leverArm:[rx,ry],force:[Fx,Fy],lengthUnit:"m"|"cm"|"mm"|"km",forceUnit:"N",origin?:[x,y],displayLength:positive}. Output one signed page-normal torque glyph tau=r cross F,or a point for certified zero. Physical N*m values are source-derived,never measured from the glyph.
- set_partition: {sets,intersections}. Full shape: {sets:[{name,count},...2_or_3],intersections:[{sets:[name,...],count},...],universeCount?,origin?:point_id|[x,y],displayScale:positive,rotationRadians?}. Outputs n circles then label anchors for masks1..2^n-1,then outside mask0 only if universeCount supplied. Supply every inclusive intersection subset of size>=2 exactly once. Integer nonnegative counts undergo exact inclusion-exclusion; impossible negative exclusive counts reject. Circles are nonmetric membership layouts; size/area never encodes cardinality. Unknown outside remains unclaimed. Default labels are set/region identifiers; explicit correct count claims are verified.
- set_select: {partition,expression}. Full shape: {partition:set_partition_output_id,expression:{set:name}|{union:[AST,...]}|{intersection:[AST,...]}|{difference:[AST,AST]}|{complement:AST},at?:point_id|[x,y]}. Output one aggregate count label anchor, not a filled set or member dot. Structured Boolean algebra selects verified exclusive atoms and sums their counts; complement requires explicit universeCount. No independence or unknown outside inference; default symbolic n(expr), numeric claims engine-checked.
- harmonic_motion: {A,omega,t}. Full shape: {amplitude,equilibrium,angularFrequency,phase,phaseUnit:"rad",tMin,tMax,lengthUnit:"m"|"cm"|"mm"|"km",timeUnit:"s"|"ms",frequencyUnit:"rad/s"|"rad/ms",quantity:"position"|"velocity"|"acceleration",origin?:[x,y],timeScale:positive,ordinateScale:positive,samples?}. Output one exact q(t),v(t),or a(t) graph from q=q0+A*cos(omega*t+phase). A>=0,omega>0,tMin<tMax; explicit source units, bounded anti-alias sampling, analytic derivatives. Zero amplitude is a constant time graph. No inferred mass/spring law. Defaults show the source law/observable; numerical result claims require verification.
- harmonic_state: {motion:harmonic_motion_id,time}. Output one analytic point in the verified source-time domain, with physical q/v/a SI metadata and exact incidence. Display ordinates never become physical measurements.
- gravitational_field: {sources,at,G,displayLength}. Full shape: {sources:[{position:point_id|[x,y],mass},...],at:point_id|[x,y],G,units:{mass:"kg"|"g"|"mg",length:"m"|"cm"|"mm"|"km",G:"m^3/(kg*s^2)"},displayLength:positive,origin?:point_id|[x,y]}. Output one vector g=-G*sum(m*r/|r|^3),or a point for certified zero. Source masses nonnegative, G explicit positive, singular observation points rejected. SI field and potential stay separate from normalized display geometry; no invented planet masses or universal constants. Default g label, verified numeric claims only.
- gravitational_force: {field:gravitational_field_id,testMass,massUnit:"kg"|"g"|"mg",displayLength?:positive,origin?:point_id|[x,y]}. Output one force vector F=m*g,or a point for explicitly zero test mass/field. Field reference retains source/SI metadata, mass nonnegative and explicitly declared. Default F label; physical N values never derive from drawn length.
- complex_point: {real,imaginary,origin?:point_id|[x,y],displayScale:positive}. Output one complex point with dimensionless source values; the engine owns magnitude/argument and numerical labels. Display coordinates never become complex components.
- complex_transform: {source:complex_point_id,multiplier:{real,imaginary},addend:{real,imaginary},origin?:point_id|[x,y],displayScale:positive}. Output one point from exact complex multiplication and addition m*z+b. Source points or roots must retain verified complex metadata; uncertifiable cancellation fails closed.
- complex_roots: {source:complex_point_id,degree:integer_2_to_12,origin?:point_id|[x,y],displayScale:positive}. Outputs degree point anchors in increasing k order with theta=(arg(z)+2*pi*k)/degree, arg(z) in (-pi,pi]. The source must be nonzero. All roots retain computed complex metadata and compose with transforms.
- magnetic_force: {charge,velocity,magneticField,displayLength}. Full shape: {charge,velocity:[vx,vy,vz],magneticField:[Bx,By,Bz],units:{charge:"C",velocity:"m/s",magneticField:"T"},origin?:point_id|[x,y],displayLength:positive}. Output one vector from q*(v cross B), a point for certified zero, or an engine-owned normal glyph (out-of-page dot/in-to-page cross). Mixed planar plus normal force is unsupported and fails closed. Labels are physical N values, independent of displayLength.
- magnetic_components: {force:magnetic_force_id,displayLength?:positive}. Outputs [Fx vector,Fy vector,Fz vector]; zero components are point markers and pure page-normal components use the verified glyph. No physical values may be inferred from drawn lengths.
- hydrostatic_profile: {p0,rho,g,depth}. Full shape: {surfacePressure,density,gravity,depthMin,depthMax,pressureUnit:"Pa"|"kPa"|"bar",densityUnit:"kg/m^3"|"g/cm^3"|"kg/L",gravityUnit:"m/s^2"|"cm/s^2",depthUnit:"m"|"cm"|"mm"|"km",origin?:[x,y],depthScale:positive,pressureScale:positive,samples?:17}. Output one exact sampled profile p=p0+rho*g*d. Density/gravity positive, pressure/depth nonnegative, depthMax>depthMin. Physical inputs and units must be explicit. Display scales cannot change physical pressure or gradient.
- hydrostatic_state: {profile:hydrostatic_profile_id,depth}. Output one analytically computed pressure point in the verified source-depth domain, retaining physical pressure/depth and exact incidence metadata. Numerical claims are engine-checked.
- buoyancy: {density,gravity,displacedVolume}. Full shape: {density,gravity,displacedVolume,densityUnit:"kg/m^3"|"g/cm^3"|"kg/L",gravityUnit:"m/s^2"|"cm/s^2",volumeUnit:"m^3"|"L"|"cm^3",origin?:[x,y],displayLength?:positive,displayScale?:positive}. Output one upward force vector F=rho*g*V or a point for explicitly zero displaced volume. Supply exactly one display length or scale; density/gravity positive and volume nonnegative. No inferred submerged volume, density, or gravity.
- probability_tree: {nodes:[{id,outcome,parent?,probability?},...], origin?:point_id, levelGap?:2, leafGap?:1}. One root omits parent/probability; every other node names its parent and explicitly supplied conditional probability in [0,1]. Outgoing siblings must sum to 1. No inferred complements or independence. Caps: 31 nodes, 12 leaves, depth 5. Outputs [N points in input order,N-1 polylines for nonroot nodes in input order,L labels in DFS leaf order]. Labels are engine-derived source outcomes, conditional probabilities, and joint leaf products; omit entity.label unless it matches the computed value. Never guess node coordinates or joint probabilities.
- electric_field: {charges:[{position:point_id,charge},...], at:point_id, mode:"schematic"|"si", k, displayLength, lengthUnit?,chargeUnit?}. Compute the Coulomb superposition at an explicitly supplied observation point. Schematic requires k=1 and gives normalized direction without SI claims. SI requires explicit positive k in N*m^2/C^2 and common declared position/charge units; the engine converts to SI. Output one vector, or a point marker for a certified zero field. displayLength is a positive display length, never field magnitude. Labels are engine-derived; omit entity.label. Singular or unverifiable cancellation cases fail closed. Never invent charges or assume a generic dipole.
- field_components: {field:electric_field_id}. Output two vector entities [x_component,y_component] from the same computed field and display scale; zero components are point markers. Engine-derived labels retain physical values and units. Do not compute components from the drawn arrow's length or attach guessed numerical labels.
- tangent_line/normal_line: {curve: sampled_curve_id, at, span?}. curve may be a function_curve, parametric_curve, polar_curve, motion trajectory, harmonic wave/superposition or PV process. at uses the source parameter (x, t, theta or normalized PV parameter) and must be strictly inside its declared domain. The engine derives the line; never send a slope or endpoints.
- representative_slice: {upper: function_curve_id, lower: function_curve_id, atX, method?:"strip"|"disk"|"washer", axisY?:0}. Requires upper(atX) > lower(atX).
- solid_of_revolution: {profile: function_curve_id, axisY?:0, xMin?, xMax?, samples?}. Draws the profile, its mirror, and circular end caps about y=axisY. The function must stay on one side of the axis and may meet it only at domain endpoints.
- solid_projection: {kind:"cylinder"|"cone"|"frustum"|"sphere"|"hemisphere",center:point_id,radius,height?,topRadius?,innerRadius?,axis?:"vertical"|"horizontal"}. Lengths positive. Cylinder/cone/frustum require height; frustum requires topRadius!=radius. Only cylinder permits innerRadius<radius. Sphere/hemisphere omit height/topRadius. center is the base center except for sphere. Output polyline, role "solid projection".
- solid_projection: {kind:"polyhedron",center,base,height}. Full shape: {kind:"polyhedron",center:point_id,base:{kind:"rectangle",length,width}|{kind:"regular_polygon",sides:3..32,side}|{kind:"polygon",vertices:[[x,z],...]},height,topScale?:0..1}. Source-defined convex base; positive perpendicular height. topScale=1 prism,0 pyramid,0..1 frustum. Regularity must be given. Engine isometric projection: never infer 3D metrics from 2D. Output polyline, role "polyhedral solid".
- solid_cross_section: {solid:solid_projection_id,at:0..1,plane?:"transverse"}. at strictly inside (0,1). Derives a closed section, including the inner hole or tapered base. Output polyline, role "solid cross section".
- space_frame: {origin:point_id, scale?:positive_number, axisLength?:positive_number}. Places a shared isometric 3D frame at a 2D origin and draws the XYZ axes. Later space_point, space_line, and plane constructions must reference this frame id. Output one polyline entity.
- space_point: {frame:space_frame_id, x, y, z}. Projects a world (x,y,z) point through the frame. Output one point. Use typed space operators to preserve world distances and frame identity; generic 2D producers cannot consume these points. space_line/plane may reuse it as a 3D anchor.
- space_line: {frame:space_frame_id, point:space_point_id|[x,y,z], direction:[dx,dy,dz], tMin?:number, tMax?:number}. Draws the parametric line r = point + t direction on tMin<t<tMax (defaults -1.5 to 1.5). Direction must be nonzero. Output one line entity.
- plane: {frame,a,b,c}. Full shape: {frame:space_frame_id, a, b, c, d?:number, span?:positive_number} or {frame, point:space_point_id|[x,y,z], u:[ux,uy,uz], v:[vx,vy,vz], uSpan?:positive_number, vSpan?:positive_number}. Renders a parallelogram patch of the plane ax+by+cz=d (or the span of u,v at point). The normal or the spanning pair must be nonzero/independent. Output one polygon entity.
- space_project: {frame:space_frame_id, point:space_point_id, onto:space_line_or_plane_id}. Output one point computed by orthogonal projection in 3D. All operands must share the frame. Reuse the derived point for a perpendicular connector; never compute the foot from its 2D screen projection.
- space_closest_points: {frame:space_frame_id, first:space_line_id, second:space_line_id}. Output exactly two points, first on first line then on second, computed as the nearest pair of nonparallel infinite lines. Parallel/coincident ambiguity fails closed. Use space_segment between the outputs for skew-line distance.
- space_intersection: {frame:space_frame_id, first:space_line_or_plane_id, second:space_line_or_plane_id, tMin?,tMax?}. A line/plane pair outputs one point. Two planes output one line and require finite ordered tMin,tMax, measured as world distance along the derived unit direction. Unsupported line/line, parallel, and coincident cases fail closed.
- space_segment: {frame:space_frame_id, a:space_point_id, b:space_point_id}. Output one segment retaining true3D endpoint distance. All points use the same frame. Zero-length or invisible projected connectors fail closed. Use this for derived3D lengths rather than measuring the2D sketch.
- wavefront_family: {origin:point_id, direction:path_id|[dx,dy], shape:"plane"|"circular", count:1..12, spacing:positive_number, span:positive_number}. Derives fronts perpendicular to direction; plane is parallel and circular is point-source. For Huygens, derive rays with reflect_at/refract_at and use those ray IDs for direction; never guess front segments.
- aperture: {center,orientation,length,slitCount}. Full shape: {center:point_id, orientation:"vertical"|"horizontal", length:positive_number, slitCount:1..4, slitWidth:positive_number, slitSeparation:positive_number}. Generates an opaque finite screen with exact open slit gaps. Output one aperture or polyline entity. Use one slit for diffraction and two for Young interference.
- screen_pattern: {start,end,pattern,count,spacing}. Full shape: {start:point_id, end:point_id, pattern:"interference"|"diffraction"|"resolution", count:odd_integer_3_to_21, spacing:positive_number, centralWidth:positive_number}. Generates a compact screen pattern. Output one screen_pattern or polyline entity. Use normalized display spacing when physical scales differ greatly; keep the authoritative physical value in quantities and a dimension/label, and never create guessed fringe points on top of this derived pattern.
- transverse_field: {start:point_id, end:point_id, amplitude:positive_number, cycles:integer_1_to_12, orientationDeg:number}. Generates a propagation axis, a sampled transverse field, and a polarization direction mark without raw paths. Output one transverse_field or polyline entity.
- polarizer: {center:point_id, radius:positive_number, axisAngleDeg:number}. Generates a circular polarizer/analyzer symbol and its transmission axis. Output one polarizer or polyline entity.
- optical_train: {axis, objective, eyepiece, focus, raySpan?, beamHalfHeight?}. For an afocal instrument, outputs [incoming_upper, incoming_lower, internal_upper, internal_lower, outgoing_upper, outgoing_lower]. Derives shared-focus and parallel paths; never guess these rays.
- spherical_surface: {vertex,axis,halfHeight}. Full shape: {vertex: point_id, axis: line_or_segment_id, halfHeight: positive_number, center?: point_id, signedRadius?: nonzero_number, kind?:"convex"|"concave"|"plano"}. Cartesian sign convention: light along +axis; positive radius is convex to the incident light. Output one arc (or a plane segment when the radius is infinite). Use this for any spherical interface, mirror face, or single refracting surface. Never imitate a curve with a straight line.
- lens_section: {center,axis,radius1,radius2,halfHeight}. Full shape: {center: point_id, axis: line_or_segment_id, radius1: nonzero_number, radius2: nonzero_number, halfHeight: positive_number, thickness?: positive_number}. Closed thin-lens outline from two signed Cartesian radii (biconvex: radius1>0, radius2<0; biconcave: the opposite pair; a very large radius is plano). Output one polygon. Use this whenever the figure must show a convex or concave lens, not a line.
- velocity_triangle: {vf,vb}. Gives [frame,body,resultant]. headingDeg is the signed angle from the frame velocity to the body velocity. Units are m/s, km/h, cm/s, or dimensionless unit. Zero vectors are points. Display length is not physical speed.
- collinear_velocity_pair: {vf,speed}. Gives [current,boat,downstream,upstream]. Downstream is frame plus body; upstream is frame minus body. The body speed is along the frame, not a second heading.
- crossing_strategies: {v}. Gives six vectors: across current, boat, resultant, then shortest-time current, boat, resultant. Fails closed unless boat speed exceeds current speed. Do not invent a straight-across heading.
- parallel_guides: {gap}. Gives two parallel segments. separation and halfLength are display lengths, not a physical width.
- kirchhoff_network: {nodes,branches}. Gives n node points, then b branch polylines, then b current vectors. Wires omit resistance and emf. A supplied multi-loop graph must not be redrawn as a series chain. Currents are solved.
- free_body: {F}. Gives the body point, then one vector per supplied force. Do not invent a normal, friction, or weight. equilibrium requires a zero sum. mass and acceleration must satisfy sum F = ma.
- coupled_bodies: {link,bodies}. Gives [body1,body2,tension1,tension2,accel1,accel2]. stringPull is the direction the link pulls each body. A string rejects compression. External forces include weight; gravity is not inferred.
- vertical_circle: {R,v,angle}. Gives [circle,mass,radius,weight,constraint]. angleDeg is from the downward vertical. Supply exactly one of speed or speedAtBottom. A slack string or inside track fails closed.
- mechanical_energy_pair: {states}. Gives [level1,state1,v1,level2,state2,v2]. At least one speed is required. A missing speed is computed. Both speeds must satisfy energy plus supplied work. Do not infer work.
- current_element_field: {shape,I}. Gives one field for finite_wire, infinite_wire, arc, or loop_axis. Wire coordinates are metres, not display coordinates. Page-normal except loop_axis. Singular points fail closed. mu0 must be explicit.
- conductor_force: {I,L,B}. Gives I(L cross B) as a vector, a zero point, or a page-normal glyph. Mixed planar and normal force fails closed. Display length is not newtons.
- parallel_wire_force: {I1,I2,d}. Gives [wire1,wire2,force1,force2]. Force is per unit length. Same-sign currents attract. Display separation is not the physical separation.
- magnetic_dipole_field: {m,at}. Gives one planar field from the dipole law. The observation point cannot be the dipole. mu0 must be explicit.
- solenoid_field: {n,I}. Gives one axial field. region exterior is a certified zero point for an ideal infinite solenoid. Do not infer turn density.
- relative_velocity: {vA,vB,units,displayScale}. Full shape: {velocityA,velocityB,units:{velocity:"m/s"|"km/h"|"cm/s"|"unit"},origin?,displayScale}. Gives [vA,vB,vA-vB]. Both velocities share one frame and unit. Display length is not speed.
- motion_graph: {quantity,points,timeScale,ordinateScale}. Full shape: {quantity:"position"|"velocity",points:[{t,value},...],origin?,timeScale,ordinateScale}. Gives one polyline through supplied increasing times. Do not invent samples.
- uniform_circular_motion: {radius,speed,displayScale,vectorScale}. Full shape: {radius,speed,angleDeg?,origin?,displayScale,vectorScale,units:{length:"m",speed:"m/s"}}. Gives [particle,circle,radius,tangent velocity,centripetal acceleration]. Acceleration is v^2/R toward the center.
- projectile_trajectory: {speed,launchAngleDeg,gravity,displayScale}. Full shape: {speed,launchAngleDeg,gravity,inclineAngleDeg?,initialHeight?,direction?:"up"|"down",origin?,displayScale,samples?,units:{speed:"m/s",gravity:"m/s^2",length:"m"}}. Gives [trajectory,launch velocity]. inclineAngleDeg 0 is level ground. Fails if the path never meets the landing line.
- work_interval: {force,displacement,displayScale}. Full shape: {force:[Fx,Fy],displacement:[dx,dy],origin?,displayScale,units:{force:"N",length:"m"}}. Gives [force,displacement]. Work is the source dot product, not the drawn lengths.
- spring_energy: {stiffness,extension,displayScale}. Full shape: {stiffness,extension,origin?,displayScale,units:{stiffness:"N/m",length:"m"}}. Gives [spring coil,mass]. Energy is k x^2 / 2. A zero extension fails closed.
- potential_curve: {samples,xScale,energyScale}. Full shape: {samples:[{x,energy},...],origin?,xScale,energyScale}. Gives one U(x) polyline. Samples must increase in x. Do not invent an equilibrium.
- collision: {mass1,mass2,velocity1,velocity2,restitution,displayScale}. Full shape: {mass1,mass2,velocity1,velocity2,restitution,axis?,origin?,displayScale,units:{mass:"kg",speed:"m/s"}}. Gives [u1,u2,v1,v2]. Restitution is 0 to 1. Scalars are along the impact axis, default +x. The rear velocity must exceed the front velocity.
- loop_torque: {current,area,magneticField,displayLength}. Full shape: {current,area:[Ax,Ay,Az],magneticField:[Bx,By,Bz],origin?,displayLength,units:{current:"A",area:"m^2",field:"T"}}. Gives one torque from I(A cross B), a zero point, or a page-normal glyph. Mixed planar and normal torque fails closed.
- galvanometer: {current,turns,area,field,springConstant,displayScale}. Full shape: {current,turns,area,field,springConstant,origin?,displayScale,units:{current:"A",area:"m^2",field:"T",spring:"N m/rad"}}. Gives [coil,needle]. Deflection is N I A B / k in a radial field and must stay within a right angle of the zero.
- bar_magnet: {moment,displayScale}. Full shape: {moment:[mx,my],origin?,displayScale,units:{moment:"A m^2"}}. Gives [bar, four dipole field lines]. Field lines follow r proportional to sin^2 of the polar angle about the moment axis.
- metre_bridge: {known,wireLength,displayLength}. Full shape: {knownResistance,unknownResistance?,balanceFromLeft?,wireLength,origin?,displayLength,units:{resistance:"ohm",length:"m"|"cm"}}. Gives [wire,jockey,left gap,right gap]. Unknown is in the right gap. X/R=(L-l)/l. A supplied pair must agree.
- potentiometer: {driverEmf,cellEmf,wireLength,displayLength}. Full shape: {driverEmf,cellEmf,wireLength,balanceLength?,origin?,displayLength,units:{emf:"V",length:"m"|"cm"}}. Gives [wire,jockey]. l/L=cell/driver. No null point when the cell exceeds the driver.
- incline_friction: {mass,gravity,angleDeg,mu,motion}. Full shape: {mass,gravity,angleDeg,mu,motion:"rest"|"down"|"up",origin?,displayScale,forceScale,accelScale,units:{mass:"kg",gravity:"m/s^2"}}. Gives [incline,body,weight,normal,friction,acceleration]. Rest requires tan(angle)<=mu. Downhill slide requires a nonnegative acceleration.
- cyclotron: {charge,mass,field,speed,displayScale}. Full shape: {charge,mass,field,speed,origin?,displayScale,units:{charge:"C",mass:"kg",field:"T",speed:"m/s"}}. Gives [orbit,left dee,right dee,velocity,field]. Radius is m v/(|q| B). The dee gap is display-only.
Every required visible entity must be the output of exactly one construction unless it is a pure group. Logical layout coordinates may arrange a topology but must not imply measured distance or angle. When the scene cannot be faithfully expressed with these operators, select text_only.`;

// Conditional and multi-output contracts must survive compaction as complete
// statements; their arity cannot be inferred from the first prose sentence.
const COMPACT_OUTPUT_CONTRACTS: Readonly<Record<string, string>> = {
  complex_point: "Output 1 point.",
  complex_transform: "Output 1 point.",
  harmonic_motion: "Output 1 polyline.",
  hydrostatic_profile: "Output 1 polyline.",
  flux_process: "Output 1 polyline.",
  elastic_profile: "Output 1 polyline.",
  rotational_motion: "Output 1 point.",
  buoyancy: "Output 1 vector; zero:point. Require exactly one of displayLength/displayScale.",
  elastic_state: "Output 1 point. Dimensions require paired units and uniformBar:true; length requires strain>-1.",
  curve_derivative: "Output 1 vector; zero:point.",
  impedance: "Output 1 vector; zero:point.",
  impedance_combine: "Output 1 vector; zero:point.",
  planar_torque: "Output 1 polyline page-normal glyph; zero:point.",
  gravitational_field: "Output 1 vector; zero:point.",
  gravitational_force: "Output 1 vector; zero:point.",
  magnetic_force: "Output 1 vector; zero:point; page-normal:dot/cross.",
  permutation_cycles: "Outputs n node points in item order, then n directed polylines in source-index order.",
  subset_lattice: "Outputs 2^n points in bitmask order, then n*2^(n-1) directed polylines by source mask/added item; n=0: 1 point,0 edges.",
  induction_state: "Outputs [flux point,emf label anchor]; only flux point has curve incidence.",
  rotational_state: 'Outputs kind="velocity"/"acceleration": 1 vector; kind="components": [tangential acceleration vector,centripetal acceleration vector]; zero vectors are points.',
  set_partition: "Outputs n circles, labels mask1..2^n-1 in numeric mask order, then outside mask0 label iff universeCount is supplied.",
  complex_roots: "Outputs degree points in increasing root index k=0..degree-1.",
  magnetic_components: "Outputs [Fx vector,Fy vector,Fz vector]; zero components are points and normal components use a dot/cross glyph.",
  circle_intersections: 'Outputs mode="two": 2 points; mode="tangent": 1 point.',
  circle_tangency_points: "Outputs 2 contact points, positive then negative centre-to-external cross product.",
  triangle_from_sides: "Outputs [A point,B point,C point,outline polygon].",
  triangle_from_sas: "Outputs [A point,B point,C point,outline polygon].",
  triangle_from_asa: "Outputs [A point,B point,C point,outline polygon].",
  trajectory_state: 'Outputs kind="position": 1 point; "velocity"/"acceleration": 1 vector (zero -> point); "state": [position point,velocity vector,acceleration vector]. Vector forms require positive timeScale.',
  optical_focus: "Outputs lens: [focus(-f),focus(+f)] points; mirror: [focus(f)] point.",
  space_intersection: "Outputs line/plane: 1 point; plane/plane: 1 line with explicit tMin<tMax.",
  space_closest_points: "Outputs [point on first line,point on second line].",
  probability_tree: "Outputs [N node points in input order,N-1 branch polylines in nonroot input order,L leaf labels in DFS order].",
  phasor_response: "Outputs [voltage vector,current vector]; zero phasors are point markers.",
  field_components: "Outputs [x_component vector,y_component vector]; zero components are point markers.",
  gaussian_image: "Outputs [objectBase point,objectTip point,imageBase point,imageTip point].",
  conic_asymptotes: "Outputs 1 polyline with 2 separate asymptote paths.",
  vector_components: "Outputs [x_component,y_component] without basis; [parallel_component,perpendicular_component] with basis.",
  optical_train: "Outputs [incoming_upper,incoming_lower,internal_upper,internal_lower,outgoing_upper,outgoing_lower] rays.",
  relative_velocity: "Outputs [vA,vB,vA-vB].",
  motion_graph: "Output 1 polyline.",
  uniform_circular_motion: "Outputs [particle,circle,radius,velocity,acceleration].",
  projectile_trajectory: "Outputs [trajectory,launch velocity].",
  work_interval: "Outputs [force,displacement].",
  spring_energy: "Outputs [spring,mass].",
  potential_curve: "Output 1 polyline.",
  collision: "Outputs [u1,u2,v1,v2].",
  loop_torque: "Output 1 glyph; zero:point.",
  galvanometer: "Outputs [coil,needle].",
  bar_magnet: "Outputs [bar,4 field lines].",
  metre_bridge: "Outputs [wire,jockey,left gap,right gap].",
  potentiometer: "Outputs [wire,jockey].",
  incline_friction: "Outputs [incline,body,weight,normal,friction,acceleration].",
  cyclotron: "Outputs [orbit,left dee,right dee,velocity,field].",
};

export function selectConstructionInputContracts(operators: readonly string[], detailedOperators?: readonly string[]): string {
  const selected = new Set(operators);
  const detailed = detailedOperators === undefined ? undefined : new Set(detailedOperators);
  const hasCompactOperators = detailed !== undefined && operators.some((operator) => !detailed.has(operator));
  const lines = SCENE_CONSTRUCTION_INPUT_CONTRACTS.split("\n");
  const output: string[] = [];
  let includeCurrent = true;
  let usedCompactTypes = false;
  for (const line of lines) {
    if (!line.startsWith("- ")) {
      if ((includeCurrent || line.startsWith("Every required visible entity")) && !(hasCompactOperators && line.startsWith("Every required visible entity"))) output.push(line);
      continue;
    }
    const descriptor = line.slice(2).split(":", 1)[0]!.trim();
    const names = descriptor === "A surface_contact hit point and a normal_at output may be implicit construction helpers when they are consumed by later operators and do not need a visible mark. Visible outputs such as the incident vector still require a declared entity."
      ? ["surface_contact", "normal_at"]
      : descriptor.startsWith("normal_at ")
        ? ["normal_at"]
        : descriptor.split("/").map((name) => name.trim());
    includeCurrent = names.some((name) => selected.has(name));
    if (includeCurrent) {
      // Repairs retain every available input shape, with full explanations
      // for the candidate's actual operators. This bounds catalog growth
      // without dropping operators or weakening the authority contract.
      if (detailed && !names.some((name) => detailed.has(name))) {
        usedCompactTypes = true;
        const sentences = line.split(". ");
        const shape = sentences[0]!
          .replace(/\b([a-z_]+)_id\b/g, "@$1")
          .replace(/@line_or_segment_or_vector\b/g, "@path")
          .replace(/@line_or_segment\b/g, "@path")
          .replace(/@line_or_circle_or_arc\b/g, "@surface")
          .replace(/\binteger_(\d+)_to_(\d+|n)\b/g, "int$1..$2")
          .replace(/\bodd_integer_(\d+)_to_(\d+)\b/g, "odd$1..$2")
          .replace(/\bpositive_number\b/g, "positive")
          .replace(/\bnonzero_number\b/g, "nonzero")
          .replace(/:\s+/g, ":")
          .replace(/,\s+/g, ",")
          .replace(/^(- [^:]+):\s*/, "$1: ");
        const outputs = sentences.find((sentence) => sentence.startsWith("Output ") || sentence.startsWith("Outputs "));
        const explicitOutput = names.map((name) => COMPACT_OUTPUT_CONTRACTS[name]).find((contract) => contract !== undefined);
        const outputContract = explicitOutput ?? (outputs?.includes("[")
          ? outputs.slice(0, outputs.lastIndexOf("]") + 1)
          : outputs?.match(/^Outputs? (?:exactly )?(?:one|two|three|four) (?:complex-plane )?[a-z_]+/i)?.[0] ?? outputs);
        output.push(outputContract && outputs !== shape ? `${shape}. ${outputContract}` : shape);
      } else output.push(line);
    }
  }
  return (usedCompactTypes ? "Compact types: @name=entity ID; @path=line/segment/vector; @surface=line/circle/arc; positive/nonzero=finite scalars; int/oddA..B=bounded integer.\n" : "") + output.join("\n");
}
