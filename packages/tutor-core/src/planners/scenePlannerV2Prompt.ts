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
): string {
  const operators = context.constructionOperators === undefined
    ? DEFAULT_SCENE_CONSTRUCTION_OPERATORS
    : context.constructionOperators.filter(isPlannerVisibleSceneConstructionOperator);
  const proofPredicates = context.proofPredicates === undefined
    ? DEFAULT_SCENE_PROOF_PREDICATES
    : context.proofPredicates.filter(isPlannerVisibleSceneProofPredicate);
  const operatorContracts = selectConstructionInputContracts(operators);
  const conversation = context.conversationContext?.trim()
    ? `\nCONVERSATION CONTEXT\n${context.conversationContext.trim()}\n`
    : "";
  const capabilityGuidance = context.planningGuidance?.length
    ? `\nSELECTED VISUAL INVARIANTS\n${context.planningGuidance.map((item) => `- ${item}`).join("\n")}\n`
    : "";

  return `${SCENE_DOCUMENT_PLANNER_PROMPT}

AVAILABLE CONSTRUCTION OPERATORS
${operators.map((operator) => `- ${operator}`).join("\n")}

OPERATOR INPUT CONTRACTS
${operatorContracts}

AVAILABLE PROOF PREDICATES
${proofPredicates.join(", ")}
${capabilityGuidance}
${conversation}
QUESTION
${question}

Return the complete ${SCENE_DOCUMENT_VERSION} JSON object now.`;
}

export const SCENE_DOCUMENT_PLANNER_PROMPT = `Plan one compact scene-document/v2 JSON object. Emit complete JSON only: no pixels, drawing tags, prose, raw paths, or topic templates.

REQUIRED SHAPE
Include schemaVersion, visualDecision, source, quantities, entities, constructions, relations, assertions, annotations, requiredEntityIds, revealGroups, and teachingTimeline. Use relations:[].
Entity: {id,kind,role?,label?}. Construction: {id,operator,inputs,outputs}. Assertion: {id,predicate,entities,expected,severity}. Annotation: {id,kind,targetIds,text?,placementIntent?,quantityId?}. kind is label, callout, or caption. Captions are one honest line under the figure, not 16-character diagram labels.

VISUAL DECISION
- Use scene when geometry, topology, apparatus, graphs, regions, bodies, vectors, rays, fields, forces, or spatial relations help explain the submitted question.
- Use text_only only when no supported operator can express a meaningful visual. A text_only document has empty scene arrays.
- The initial scene is the problem setup, not a solved answer sheet. Reveal the complete structural setup before calculation.

AUTHORITY AND ACCURACY
- The submitted question and AUTHORITATIVE TURN PLAN are fixed evidence. Copy only plan quantities with identical id, value, and unit. Do not invent measurements, components, topology, signs, or assumptions.
- Do not place derived scalar answers in the initial scene. Show a derived spatial target only at its exact plan-backed position, distance, angle, or ratio.
- Use world coordinates for metric or directional claims. Use small dimensionless layout coordinates only for nonmetric topology/composition; never label an arbitrary display size as physical.
- Every reference must resolve. Every required visible entity has exactly one producer. Build dependencies before consumers. Reuse one entity for one semantic object; duplicate geometry and duplicate terminal pairs are fatal.
- Use the matching deterministic operator for derived curves, regions, solids, intersections, transforms, normals, reflections, and refractions. Never imitate them with guessed geometry.
- Function-bounded regions use function_curve plus function_region; other derived calculus and solid constructions use their named operators.
- Quantities are authority data, not layout scratch space. Put ungiven display sizes directly in construction inputs as compact dimensionless literals, without physical units or labels.

STRUCTURE AND PROOFS
- A construction has one output, except vector_components and surface_contact which have two, reflect_at/refract_at have three ordered outputs [incident_ray, normal, outgoing_ray], and optical_train has six ordered ray outputs. A symbol outputs one component.
- Physical vectors and angle-bearing paths use world-coordinate points and prove their named relation. Use on [point,path] for passage and converges [path1,path2,target] for convergence.
- When source geometry is fixed, reflection/refraction chains are surface_contact -> normal_at -> reflect_direction/refract_direction. When the problem instead gives an incidence angle at a known contact, prefer one atomic reflect_at/refract_at construction. Never use both representations for the same ray.
- A symbol owns its two distinct point terminals. Every resistor, cell, battery, capacitor, inductor, lamp, meter, diode, switch, or other supported circuit component must be produced by symbol; never use connect or segment as a visual substitute for a component. Series components share consecutive terminals; parallel components share the same terminal pair. Prove topology with path, sameTerminalPair, pathCount, connected, and degree.
- A named side, edge, branch, or component of a closed loop must use the loop's actual shared terminal point IDs. Never place a duplicate segment near or on top of another side and call it connected. Cardinal route language is literal: an entity described as “up/down through” is vertical and “left/right through” is horizontal.
- Construct a closed N-edge route as shared points p0...p(N-1), with each member using p(i) to p(i+1 mod N). If a member meets another path at an interior location, split that path at the same point ID. Geometric overlap, crossing, an on assertion, or equal coordinates with different IDs does not prove route connectivity. A symbol is already its route edge; never duplicate it with a segment.
- Page-normal directions are not in-plane arrows. Use vector direction [0,0,-1] for into-page/into-screen and [0,0,1] for out-of-page/out-of-screen; the runtime deterministically renders these as cross/dot markers.
- Keep disconnected or compared views in disjoint reveal groups. A direct connector across a component is allowed only for an explicitly stated short or bypass.
- Predicate order is on [point,path], between [middle,end1,end2], same_side [point,point,origin], and connected [entity,...]. between/equal_length are geometric predicates, not value or topology predicates.
- requiredEntityIds checks existence; do not add exists assertions. Emit at most six useful semantic assertions. All assertion entities and timeline targets must exist.

ANNOTATION AND TEACHING
- Labels are compact identifiers or values, at most 16 characters. Put explanatory properties in narration.
- Attach annotations to the entity they describe. Do not create geometry just to position text, and do not label generated helpers, wire terminals, or unnamed junctions.
- Annotation kinds: label, callout, narration, enclose, highlight, trace, badge, spin, equal_tick, equal_arc, parallel_mark, hatch, brace, endpoint, loop, sense, drop, ghost, extend, frame, polarity, slope_triangle. Optional style: {count:1|2|3, pointStyle:"filled"|"open"|"cross"|"square", transient:boolean}. The engine compiles paths from targetIds; never emit CIRCLE_AROUND or coordinates.
- enclose circles a target; highlight shades a region; equal_tick/equal_arc/parallel_mark mark congruence; hatch shades a surface; brace spans a length; endpoint restyles a point; loop follows a closed route; sense marks current/path direction; drop drops an ordinate to an axis; ghost is a dashed clone; extend continues a path; frame is a local n-t or x-y pair; polarity is +/- at terminals; slope_triangle is rise/run on a graph.
- Include only question-grounded objects. Prefer one reveal group; add another only for a genuinely separate or staged view.
- revealGroups.entityIds contains entity IDs only. Timeline actions reveal, focus, or annotate existing IDs only.

ALLOWED KINDS
Entities: point, segment, ray, line, circle, arc, rectangle, polygon, polyline, vector, axes, object, component, connector, label, dimension, angle_mark, right_angle_mark, tick_mark, sign_badge, wavefront_family, aperture, screen_pattern, transverse_field, polarizer, group.
Predicates: ${DEFAULT_SCENE_PROOF_PREDICATES.join(", ")}.
equal_angle compares two angles using four path IDs. angle_between checks two path IDs against expected:{value,unit:"degree"|"radian"}. function_value uses entities:[curve_id], expected:{x,y}. root uses entities:[curve_id], expected:x or {x}.`;

export const SCENE_CONSTRUCTION_INPUT_CONTRACTS = `Use these exact input keys. Entity references are stable ID strings. Numeric inputs may be numbers or quantity IDs.
- point: {x, y, coordinateSpace:"world"|"layout"}. World coordinates preserve physical distances, angles, and directions; exact givens stay exact, while an unstated vector length may use a normalized local frame. Layout coordinates are small dimensionless integers used only to arrange topology with no metric or directional claim.
- segment/connect: {start: point_id, end: point_id}.
- vector: {start: point_id, end: point_id, direction?: vector_id|[dx,dy]|[dx,dy,dz], length?:positive_number}. When direction is present, direction defines orientation; a distinct start/end defines display length, otherwise length or a normalized unit length is used. A pure [0,0,-1] or [0,0,1] direction is the only correct representation for into-page or out-of-page respectively.
- ray/line: {start: point_id, end: point_id} or {start: point_id, direction: [dx,dy]}.
- circle: {center: point_id, radius}.
- arc: {center: point_id, radius, startAngle, endAngle, angleUnit: "degrees"|"radians"}.
- rectangle: {center: point_id, width, height}.
- polygon/polyline: {points: [point_id,...]}.
- axes: {xMin, xMax, yMin, yMax}.
- midpoint: {a: point_id, b: point_id}.
- intersection: {first: line_or_segment_id, second: line_or_segment_id}.
- surface_intersection: {origin: point_id, surface: line_or_circle_or_arc_id, direction?:vector_id|[dx,dy], through?:point_id, parallelTo?:path_id, which?:"nearest_forward"|"farthest_forward"}. Supply exactly one of direction, through, or parallelTo; prefer through/parallelTo when the relationship is known.
- surface_contact: same inputs as surface_intersection and exactly two fresh outputs [hit_point_id, incident_vector_id]. origin must be a distinct off-surface point; through must differ from origin. Use this instead of surface_intersection for visible reflection/refraction paths, and never reuse an ID already produced by another construction.
- A surface_contact hit point and a normal_at output may be implicit construction helpers when they are consumed by later operators and do not need a visible mark. Visible outputs such as the incident vector still require a declared entity.
- normal_at: {point: point_id, surface: line_or_circle_or_arc_id}.
- normal_at outputs solver-only geometry. It is used by reflection/refraction but is not drawn; construct a separate visible normal only when the question explicitly asks for one.
- normal_at still has exactly one stable output helper ID even when that helper is not declared as a visible entity or added to a reveal group. Never emit outputs:[] for normal_at.
- project: {point: point_id, line: line_or_segment_id}.
- translate: {point: point_id, vector: vector_id|[dx,dy]}.
- rotate: {point: point_id, center: point_id, angle, angleUnit}.
- reflect_point: {point: point_id, line: line_or_segment_id}.
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
- symbol: {symbol:"resistor"|"battery"|"cell"|"capacitor"|"inductor"|"lamp"|"galvanometer"|"ammeter"|"voltmeter"|"ac_source"|"diode"|"zener"|"switch", start: point_id, end: point_id}. The symbol itself connects those terminals. Use connect only between two point IDs for an additional ordinary wire.
- label: {target: entity_id, text}. The target may be a point or rendered geometry. The output must be one label entity whose compact entity.label matches text. Use this only for a symbol or value that needs a precise constructed anchor; ordinary object labels still belong on their owner entity or in annotations.
- function_curve: {expression, variable?:"x", xMin, xMax, samples?}. Expressions support numeric literals, x, pi, e, explicit + - * / ^, parentheses, and sin/cos/tan/asin/acos/atan/sqrt/abs/exp/log/ln. Multiplication must be explicit. samples defaults to 65 and, when supplied, must be an odd integer from 17 to 161. Use only a domain where the function stays finite and continuous; never bridge an asymptote.
- function_region: {upper: function_curve_id, lower: function_curve_id, xMin?, xMax?, samples?}. Deterministically samples both function curves over their shared domain and closes the boundary with the upper curve in reverse order. Use this for every region whose boundary is defined by functions.
- constraint_region: {constraints: [{expression, relation:"le"|"ge"}, ...], xMin, xMax, yMin, yMax, samples?}. The feasible set where every constraint holds, with expression F(x,y) in the implicit_curve language and relation le meaning F<=0, ge meaning F>=0. Use it for a region stated as inequalities (a circle cut by a line, a quadrant clip, a parabola inside a circle) with 1 to 6 constraints. The compiler fails closed on an empty set, a set that splits into pieces, or a column with two separate feasible runs; do not try to bridge those.
- parametric_curve: {xExpression, yExpression, parameter?:"t", tMin, tMax, samples?}. Both expressions use t and the same safe expression language as function_curve. The finite continuous parameter domain and odd sample count are mandatory.
- polar_curve: {radiusExpression, parameter?:"theta", thetaMin, thetaMax, samples?}. Angles are radians. radiusExpression uses theta and the same safe expression language as function_curve.
- implicit_curve: {expression, xMin, xMax, yMin, yMax, xSamples?, ySamples?}. expression is F(x,y), with the visible contour defined by F(x,y)=0. It uses the safe function_curve expression language plus y. xSamples and ySamples default to 65 and must each be integers from 17 to 161. Bounds must be finite and ordered. The compiler fails closed on discontinuities, unresolved multiple edge crossings, empty contours, or excessive contour complexity; narrow the domain or increase the grid instead of inventing a trace.
- tangent_line/normal_line: {curve: sampled_curve_id, at, span?}. curve may be a function_curve, parametric_curve, or polar_curve. at is x, t, or theta respectively and must be strictly inside its declared domain. The engine derives the line; never send a slope or endpoints.
- representative_slice: {upper: function_curve_id, lower: function_curve_id, atX, method?:"strip"|"disk"|"washer", axisY?:0}. Requires upper(atX) > lower(atX).
- solid_of_revolution: {profile: function_curve_id, axisY?:0, xMin?, xMax?, samples?}. Draws the profile, its mirror, and circular end caps about y=axisY. The function must stay on one side of the axis and may meet it only at domain endpoints.
- solid_projection: {kind:"cylinder"|"cone"|"frustum"|"sphere"|"hemisphere", center:point_id, radius:positive_number, height?:positive_number, topRadius?:positive_number, axis?:"vertical"|"horizontal"}. Cylinder, cone, and frustum require height. Frustum alone requires topRadius, which must differ from radius. Sphere and hemisphere derive their axial span from radius and must omit height and topRadius. center is the base center for cylinder/cone/frustum/hemisphere and the geometric center for sphere. Output one polyline entity with role "solid projection".
- solid_cross_section: {solid:solid_projection_id, at:number, plane?:"transverse"}. at is a normalized axial position strictly between 0 and 1. The derived section is closed, finite, and contained by the referenced solid. Output one polyline entity with role "solid cross section".
- space_frame: {origin:point_id, scale?:positive_number, axisLength?:positive_number}. Places a shared isometric 3D frame at a 2D origin and draws the XYZ axes. Later space_point, space_line, and plane constructions must reference this frame id. Output one polyline entity.
- space_point: {frame:space_frame_id, x, y, z}. Projects a world (x,y,z) point through the frame. Output one point. Later 2D operators may use that point id; space_line/plane may reuse it as a 3D anchor.
- space_line: {frame:space_frame_id, point:space_point_id|[x,y,z], direction:[dx,dy,dz], tMin?:number, tMax?:number}. Draws the parametric line r = point + t direction on tMin<t<tMax (defaults -1.5 to 1.5). Direction must be nonzero. Output one line entity.
- plane: {frame:space_frame_id, a, b, c, d?:number, span?:positive_number} or {frame, point:space_point_id|[x,y,z], u:[ux,uy,uz], v:[vx,vy,vz], uSpan?:positive_number, vSpan?:positive_number}. Renders a parallelogram patch of the plane ax+by+cz=d (or the span of u,v at point). The normal or the spanning pair must be nonzero/independent. Output one polygon entity.
- wavefront_family: {origin:point_id, direction:path_id|[dx,dy], shape:"plane"|"circular", count:1..12, spacing:positive_number, span:positive_number}. Derives fronts perpendicular to direction; plane is parallel and circular is point-source. For Huygens, derive rays with reflect_at/refract_at and use those ray IDs for direction; never guess front segments.
- aperture: {center:point_id, orientation:"vertical"|"horizontal", length:positive_number, slitCount:1..4, slitWidth:positive_number, slitSeparation:positive_number}. Generates an opaque finite screen with exact open slit gaps. Output one aperture or polyline entity. Use one slit for diffraction and two for Young interference.
- screen_pattern: {start:point_id, end:point_id, pattern:"interference"|"diffraction"|"resolution", count:odd_integer_3_to_21, spacing:positive_number, centralWidth:positive_number}. Generates a compact screen pattern. Output one screen_pattern or polyline entity. Use normalized display spacing when physical scales differ greatly; keep the authoritative physical value in quantities and a dimension/label, and never create guessed fringe points on top of this derived pattern.
- transverse_field: {start:point_id, end:point_id, amplitude:positive_number, cycles:integer_1_to_12, orientationDeg:number}. Generates a propagation axis, a sampled transverse field, and a polarization direction mark without raw paths. Output one transverse_field or polyline entity.
- polarizer: {center:point_id, radius:positive_number, axisAngleDeg:number}. Generates a circular polarizer/analyzer symbol and its transmission axis. Output one polarizer or polyline entity.
- optical_train: {axis, objective, eyepiece, focus, raySpan?, beamHalfHeight?}. For an afocal instrument, outputs [incoming_upper, incoming_lower, internal_upper, internal_lower, outgoing_upper, outgoing_lower]. Derives shared-focus and parallel paths; never guess these rays.
- spherical_surface: {vertex: point_id, axis: line_or_segment_id, halfHeight: positive_number, center?: point_id, signedRadius?: nonzero_number, kind?:"convex"|"concave"|"plano"}. Cartesian sign convention: light along +axis; positive radius is convex to the incident light. Output one arc (or a plane segment when the radius is infinite). Use this for any spherical interface, mirror face, or single refracting surface. Never imitate a curve with a straight line.
- lens_section: {center: point_id, axis: line_or_segment_id, radius1: nonzero_number, radius2: nonzero_number, halfHeight: positive_number, thickness?: positive_number}. Closed thin-lens outline from two signed Cartesian radii (biconvex: radius1>0, radius2<0; biconcave: the opposite pair; a very large radius is plano). Output one polygon. Use this whenever the figure must show a convex or concave lens, not a line.
Every required visible entity must be the output of exactly one construction unless it is a pure group. Logical layout coordinates may arrange a topology but must not imply measured distance or angle. When the scene cannot be faithfully expressed with these operators, select text_only.`;

export function selectConstructionInputContracts(operators: readonly string[]): string {
  const selected = new Set(operators);
  const lines = SCENE_CONSTRUCTION_INPUT_CONTRACTS.split("\n");
  const output: string[] = [];
  let includeCurrent = true;
  for (const line of lines) {
    if (!line.startsWith("- ")) {
      if (includeCurrent || line.startsWith("Every required visible entity")) output.push(line);
      continue;
    }
    const descriptor = line.slice(2).split(":", 1)[0]!.trim();
    const names = descriptor === "A surface_contact hit point and a normal_at output may be implicit construction helpers when they are consumed by later operators and do not need a visible mark. Visible outputs such as the incident vector still require a declared entity."
      ? ["surface_contact", "normal_at"]
      : descriptor.startsWith("normal_at ")
        ? ["normal_at"]
        : descriptor.split("/").map((name) => name.trim());
    includeCurrent = names.some((name) => selected.has(name));
    if (includeCurrent) output.push(line);
  }
  return output.join("\n");
}
