/** Scoped, reusable mechanics contracts. Physical source programs select this
 * language; chapter names and example fixtures never select a construction. */
const COMMON = `Mechanics: follow verified ProblemIR steps/owners/axes; physical inputs are source quantities or typed {reference,symbol}, not guessed answers. source.mechanicsBindings:[{outputId,requestId,stepId,ownerId,axisId?,sourceOwners?}] identifies the corresponding source-program step; bindings are selectors, never proof. Engine carries the original source program for save/replay revalidation. Units:{mass:"kg"|"g",length:"m"|"cm"|"mm",time:"s"|"ms"}; kinematics omits mass. displayScale/displayLength are glyph sizes, not SI measurements.
source.mechanicsBoundaryBindings:[{outputId,modelOutputId,requestId,stepId,ownerId,axisId?,componentOwnerId?,projection:"point"|"circle"|"rod"|"axis"}] binds visible generic source points/boundaries/axes to models. Point projections use actual source COM/pose/reference/component positions; axial/radial-only glyph origins supply no physical point. Preserve source dimensions, positions, orientation, units and engine displayScale/origin; a correct hidden model cannot justify a different drawn body. A dimensionless wheel glyph without a source radius supplies no measured radius or spatial-state authority.
source.mechanicsPlotBindings:[{outputId,axesId,modelOutputId,requestId,stepId,ownerId,axisId?,observable:"theta"|"inertia"|"torque",xUnit,yUnit}] binds direct source-law curves or complete torque intervals to actual axes/units/domain. Keep the original AST and every piecewise interval; matching endpoints never proves a curve. Derivative curves require an independent exact lineage proof.
Quantity properties supplement their point/body identity. labelMode is for labels only; append has one target,literal text,no quantityId. Use quantity-bound callouts for property values without labelMode; retain C/P/A/B on the geometric owners.
spin annotations use only an existing signed angular symbol: omega/alpha/theta/delta_theta/tau/L/J_L (Greek aliases allowed). Each arrow follows its own computed claim, never final omega for displacement/torque/alpha. A scalar alpha owner cannot borrow omega; unavailable or uncertain sign declines. Numeric values belong in matching quantity-bound labels/callouts.
Vec:[x,y] or {magnitude,direction:"positive_x"|"negative_x"|"positive_y"|"negative_y"}. Frame:"inertial_xy" (x right,y up,z out) or "incline_xy",basis:{inclineAngle,angleUnit:"rad"|"deg"} (x downhill,y outward). gravity:Vec OR gravityMagnitude+gravityDirection:"lab_down"; engine projects g into the declared frame.
Physical point:Vec OR {kind:"midpoint",endpoints:[Point,Point]} OR {kind:"center_of_mass",reference:verified_mass_model_id}. Support direction:Vec OR {angle,angleUnit} OR {kind:"toward",from:Point,to:Point}; derive midpoints/COM/cable directions from source endpoints, never quote computed coordinates as givens.
3D direction:[dx,dy,dz] OR "positive_x"|"negative_x"|"positive_y"|"negative_y"|"positive_z"|"negative_z" OR {kind:"principal_plane",plane:"xy"|"xz"|"yz",angle,angleUnit}; the angle runs from the first positive basis axis toward the second. Preserve source angle/plane instead of inventing direction components.
bodyGeometry:{shape:"circular"|"rod"|"ring"|"disc"|"cylinder"|"sphere"|"spherical_shell",radius?,length?,direction?:Direction3D,center?:Point,endpoints?:[Point,Point]}; source geometry can exist without invented mass/inertia/velocity. Finite cylinders retain their length/shape; a circle alone is not a finite cylinder projection.
source angularLaw:{expression:original bounded AST with x=time,at,timeUnit:"s"|"ms",angleUnit:"rad"|"deg"}; engine differentiates theta/omega/alpha. Preserve source functions, units, signs and absolute error bounds.`;

interface Contract { shape: string; output: string; details: string }
const CONTRACTS: Readonly<Record<string, Contract>> = {
  mass_moments: {
    shape: '{mode?:"axial"|"central_axial",components:[{mass,center?:Point,shape:"point"|"rod"|"ring"|"disc"|"cylinder"|"sphere"|"spherical_shell",direction?:Direction3D,endpoints?:[Point,Point],length?,radius?,count?,operation?:"add"|"remove"}],axis:{point?:Point,direction?:Direction3D,id?,centralId?},units:{mass,length},origin?,displayScale}',
    output: "Output 1 model point: full distribution COM; axial radial-only M/I/k, no invented COM/tensor.",
    details: "1..16 positive components. Full mode requires source centres and actual axis point/direction. Rod endpoints derive centre/length/direction; do not invent those as givens. mode:\"axial\" permits only point components with source mass,radius,count?:integer1..32 and axis:{id}; it determines M/I/k, never COM or x/y/z inertias. mode:\"central_axial\" requires exactly one uniform ring/disc/cylinder/sphere/spherical_shell with source M/R and axis:{id}; central symmetry gives I/I_CM/k without inventing cylinder height, COM pose or transverse inertia. Removal requires contained compatible support and sufficient local density; use existing density integrals. The stated full axis point/direction determines I; an axis ID supplies no geometry.",
  },
  mass_property: {
    shape: '{distribution:mass_moments_id,kind:"mass"|"inertia"|"central_inertia"|"gyration_radius"|"inertia_x"|"inertia_y"|"inertia_z"|"perpendicular_axis_sum",origin?}',
    output: "Output 1 scalar point; zero:point; never an arrow.",
    details: "I uses the source axis, I_CM its parallel COM axis, k=sqrt(I/M). Radial-only axial mode supports mass/inertia/gyration_radius only; central_axial also supports central_inertia. Perpendicular-axis sum requires xy-planarity. Retain absolute density-integral error; an interval reaching zero cannot prove a nonzero sign.",
  },
  rigid_body_motion: {
    shape: '{mode?:"dynamics"|"kinematic"|"translation"|"particle"|"wrench"|"equilibrium",frame,basis?,units,origin?,displayScale?,mass?,masses?,particles?,hypotheses?,position?,bodyGeometry?,circularContact?,velocity?,initialVelocity?,initialAtRest?,atRest?,time?,angularVelocity?,angularLaw?,acceleration?,angularAcceleration?,inertia?,referencePoint?,externalForce?,externalForces?,gravity?,gravityMagnitude?,gravityDirection?,derivation?,forces?,couples?,supports?,equilibriumMode?,axisId?}',
    output: "Output 1 source model point. Translation: mass OR masses OR particles; no I/pose/omega.",
    details: `Dynamics requires mass,I_COM,position or circularContact,velocity,angularVelocity or source angularLaw,referencePoint; source a/alpha optional. Source atRest:true replaces velocity/angularVelocity exclusively. circularContact:{radius,regime?:"no_slip",surface:{point:Vec,tangent:Vec|{angle,angleUnit},stationary?:true,velocity?:Vec}} derives COM pose; a no_slip constraint requires the original premise plus independent encoded-input agreement, never tolerance-only zero snapping.
Kinematic mode: position or circularContact,velocity,angularVelocity or angularLaw,a/alpha optional; units:{length,time},displayScale; forbid mass/inertia/referencePoint/derivation. Source atRest replaces V/omega; fixedReference:true derives stationary reference V/a only from an explicit source-fixed premise.
Particle mode: mass,position,velocity,referencePoint; source point-mass definition gives only orbital L=r cross p and translational energy. No inertia/omega/alpha inputs or spin/IC claims.
Translation mode: mass OR masses:[m] OR particles:[{id?,mass,velocity?,atRest?}],hypotheses:{closedSystem:true,constantMass:true,internalActionReaction:true,isolated?,zeroExternalImpulse?,constantExternalForce?}; velocity or (initialVelocity OR initialAtRest:true)+time optional; externalForce:Vec OR externalForces:[Vec],gravity/projection optional. Rest premises require source rest wording. No spatial/angular selectors.
Wrench mode: forces:[{id?,point:Point,force:Vec OR weight:{mass,gravity OR gravityMagnitude+gravityDirection}}],couples?:[signed tau],referencePoint:Point,axisId?. No mass/inertia/pose/velocity/omega or direct net-force answer.
Equilibrium mode: wrench fields+supports:[{id,point:Point,kind:"pin"|"contact"|"cable",direction?}],hypotheses:{atRest:true,fixedSupports:true},equilibriumMode:"dynamics"|"feasibility". One to three independent reaction unknowns; contacts cannot pull, cables cannot push. Feasibility exposes required reactions/admissibility, never fabricated actual reactions. No mass/inertia/kinematics model fields.
derivation:{kind:"forces",forces:[{point,force:Vec OR weight:{mass,gravity OR gravityMagnitude/gravityDirection}}],couples?,internalPairs?,gravity/projection?} OR {kind:"equilibrium",mode?:"dynamics"|"feasibility",forces,couples?,gravity/projection?,supports:[{id,point,kind:"pin"|"contact"|"cable",direction?}]} OR {kind:"sticking_collision",bodies:[{mode?:"rigid"|"particle",mass,position,velocity,inertia?,angularVelocity?}],constraint:{kind:"free"|"pivoted",point?}}. Rigid pre-bodies require source I/spin; particle pre-bodies forbid invented I/spin. Collision derives endpoint M/I/COM/V/omega; supplied values must agree. Signed pins allowed; contacts cannot pull/cables cannot push. Feasibility retains required reactions without actual balanced acceleration.`,
  },
  rigid_body_state: {
    shape: '{motion:verified_model_id,kind,offset?:Vec,pointDefinition?,frameVelocity?:Vec,displayLength?,origin?,supportId?,forceId?,about?:Point,particleId?}',
    output: "Output 1; scalar/zero:point; nonzero:vector. Select only an upstream-supported quantity.",
    details: `kind:"momentum"|"angular_momentum"|"kinetic_energy"|"translation_energy"|"rotation_energy"|"angular_position"|"angular_velocity"|"angular_acceleration"|"rotation_angle"|"point_position"|"point_velocity"|"point_acceleration"|"instantaneous_center"|"instantaneous_center_finite"|"instantaneous_center_unique"|"net_force"|"net_torque"|"applied_force"|"support_reaction"|"required_support_reaction_x"|"required_support_reaction_y"|"equilibrium_admissible"|"friction_force"|"normal_force"|"required_friction"|"minimum_friction_coefficient"|"rolling_admissible"|"contact_slip"|"transition_time"|"pivot_impulse"|"com_velocity"|"com_acceleration"|"rim_speed"|"tangential_acceleration"|"normal_acceleration"|"total_acceleration".
offset OR pointDefinition:{kind:"circular",radius?,landmark:"center"|"top"|"bottom"|"left"|"right"|"contact"|"opposite_contact"} OR {kind:"circular",radius,angle,angleUnit}. Contact landmarks require verified circularContact/rolling surface. frameVelocity gives the source Galilean subtraction. Wrench net_torque may select about:Point; applied_force requires forceId, support_reaction requires supportId, each retaining its source application point. Axial rim selectors require source rimRadius. Scalar states forbid offsets/arrow lengths. Vectors require displayLength and retain source application points. Rest/translation has no unique finite IC coordinate; statuses: rest finite1/unique0, translation finite0/unique0, omega nonzero finite1/unique1.`,
  },
  rolling_contact: {
    shape: '{motion:dynamic_rigid_body_motion_id,radius,surface:{point:Vec,tangent:Vec|{angle,angleUnit},velocity:Vec,acceleration?:Vec},regime:"no_slip"|"sliding",mode?:"dynamics"|"feasibility",frictionCoefficient,externalForce?:Vec,gravity?:Vec,gravityMagnitude?,gravityDirection?:"lab_down",externalTorque,time?:number|"transition"}',
    output: "Output 1 contact-motion COM point. Feasibility: actual f/a/alpha unavailable; required friction/mu/admissible only.",
    details: "Engine derives normal/friction/contact slip/acceleration and first zero-slip transition. No-slip must satisfy signed contact velocity, normal contact and worst-case static capacity. Sliding friction opposes contact slip; unsupported continuation or uncertain phase declines. Insufficient mu is a supported feasibility result, never a false no-slip solution.",
  },
  angular_impulse: {
    shape: '{segments:[{start,end,torque}],axisId,initialAngularMomentum?,initialState?,kind?:"impulse"|"final_angular_momentum",units:{mass,length,time},origin?}',
    output: "Output 1 signed scalar point; zero:point.",
    details: "1..64 ordered nonoverlapping source intervals. initialAngularMomentum OR initialState, never both; prior state must retain a verified same-axis axial L claim/error bound. Sum signed tau*dt, never absolute area.",
  },
  axial_rotation: {
    shape: '{mode:"constant_inertia"|"redistribution"|"coaxial_locking"|"angle_law"|"inertia_law",axisId,frame:"fixed_inertial_axis",units:{mass,length,time},origin?,hypotheses,inertia?,angularVelocity?,initialAngularMomentum?,initialAtRest?,rimRadius?,torque?,couples?,time?,finalInertia?,angularImpulse?,rotors?,angularLaw?,inertiaLaw?}',
    output: "Output 1 axial model point; scalar/zero:point. No M/COM/pose or full-vector L invention.",
    details: `Initial state in constant_inertia/redistribution/inertia_law: exactly one angularVelocity OR initialAngularMomentum OR initialAtRest:true from the source. Never invent initial omega when only L or rest is stated. Optional rimRadius derives scalar rim_speed/a_t/a_n/a_total without inventing rotor M/COM/pose.
constant_inertia:{inertia,initial state,torque OR couples:[signed torques],time,hypotheses:{fixedAxis:true,constantInertia:true}}.
redistribution:{inertia,initial state,finalInertia,angularImpulse,hypotheses:{fixedAxis:true,rigidEndpoints:true}}.
coaxial_locking:{rotors:[{inertia,angularVelocity,axisId}],angularImpulse:0,hypotheses:{fixedAxis:true,coaxial:true,rigidEndpoints:true,zeroExternalAngularImpulse:true}}; no unique initial omega when rotors differ.
angle_law:{angularLaw,hypotheses:{fixedAxis:true}}; no I/mass needed.
inertia_law:{inertiaLaw:{expression,initialAt,at,timeUnit,inertiaUnit},initial state,torque OR couples,hypotheses:{fixedAxis:true,axialAngularMomentum:true}}; prove I positive over the whole interval, derive alpha=(tau-omega*I')/I, no angle change without integration.
Claims when defined: I/I_final,omega_initial/omega,alpha,theta from source law,delta_theta constant-only,tau from the source torque,L_initial/L (axial component),K_initial/K_r,J_L,K_loss locking-only. Preserve source axis and explicit hypotheses.`,
  },
};

/** Full mode-specific clauses must also survive combined-family compaction. */
export function selectMechanicsSceneContracts(operators: readonly string[], detailedOperators?: readonly string[]): string {
  const selected = operators.filter(operator => Object.hasOwn(CONTRACTS, operator));
  if (!selected.length) return "";
  const detailed = detailedOperators === undefined ? undefined : new Set(detailedOperators);
  return COMMON + "\n" + selected.map(operator => {
    const contract = CONTRACTS[operator]!;
    // Conditional fields are executable contract, not optional explanatory
    // prose. Retain them in compact mode; shorten only the basic invariants.
    const neededModes = ["mass_moments", "mass_property", "rigid_body_motion", "rigid_body_state", "axial_rotation"].includes(operator);
    return `- ${operator}: ${contract.shape}. ${contract.output}${detailed === undefined || detailed.has(operator) || neededModes ? "\n" + contract.details : ""}`;
  }).join("\n");
}
