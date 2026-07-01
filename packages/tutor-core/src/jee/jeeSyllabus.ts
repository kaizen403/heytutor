export type JeeSubject = "math" | "physics" | "chemistry";

export interface JeeTopic {
  subject: JeeSubject;
  unit: string;
  title: string;
  keywords: string[];
  /** What to draw first and how (diagram zone x 500-900 when applicable). */
  drawProtocol: string;
  /** Key board formulas — use unicode symbols, not spelled-out greek words. */
  boardFormulas: string[];
}

export const JEE_SYLLABUS_TOPICS: JeeTopic[] = [
  // ─── MATHEMATICS ───────────────────────────────────────────────────────────
  {
    subject: "math",
    unit: "algebra",
    title: "sets, relations, and functions",
    keywords: ["set", "relation", "function", "domain", "range", "bijection", "injection", "surjection"],
    drawProtocol: "draw a venn diagram with two overlapping [DRAW_RECT] regions or label sets A and B; mark domain on a number line with [DRAW_LINE] and label intervals.",
    boardFormulas: ["A ∪ B", "A ∩ B", "f: A → B", "fog", "f^-1"],
  },
  {
    subject: "math",
    unit: "algebra",
    title: "complex numbers and quadratic equations",
    keywords: ["complex", "imaginary", "quadratic", "roots", "discriminant", "argand", "modulus", "conjugate"],
    drawProtocol: "draw argand plane axes with [DRAW_LINE]; plot z = a + ib as a point; draw modulus as [DRAW_LINE] from origin; label real and imaginary parts.",
    boardFormulas: ["z = a + ib", "|z| = √(a^2+b^2)", "arg(z)", "z* = a - ib", "Δ = b^2 - 4ac", "x = (-b ± √Δ)/(2a)"],
  },
  {
    subject: "math",
    unit: "algebra",
    title: "matrices and determinants",
    keywords: ["matrix", "determinant", "inverse", "cramers", "adjoint", "rank"],
    drawProtocol: "write the matrix as a [WRITE:...] grid; highlight a row or column with [UNDERLINE] when expanding; use [CIRCLE_AROUND] on the pivot element.",
    boardFormulas: ["|A|", "A^-1 = adj(A)/|A|", "AX = B → X = A^-1B", "Cramer's rule"],
  },
  {
    subject: "math",
    unit: "algebra",
    title: "permutations and combinations",
    keywords: ["permutation", "combination", "factorial", "npr", "ncr", "circular permutation"],
    drawProtocol: "draw slots or positions with [DRAW_RECT] boxes; label arrangements; use [LABEL] on each position when counting.",
    boardFormulas: ["nPr = n!/(n-r)!", "nCr = n!/((n-r)!r!)", "nCr = nC(n-r)", "n! = n(n-1)...1"],
  },
  {
    subject: "math",
    unit: "algebra",
    title: "binomial theorem",
    keywords: ["binomial", "pascal", "general term", "middle term", "coefficient"],
    drawProtocol: "sketch pascal triangle rows with [WRITE:...] aligned; circle the general term coefficient with [CIRCLE_AROUND].",
    boardFormulas: ["(a+b)^n = Σ C(n,r)a^(n-r)b^r", "T_(r+1) = C(n,r)a^(n-r)b^r", "C(n,r) = C(n-1,r-1)+C(n-1,r)"],
  },
  {
    subject: "math",
    unit: "algebra",
    title: "sequences and series",
    keywords: ["ap", "gp", "hp", "arithmetic progression", "geometric progression", "sum to n", "sum to infinity"],
    drawProtocol: "draw equally spaced terms on a number line with [DRAW_LINE]; label first term a and common difference d or ratio r.",
    boardFormulas: ["a_n = a+(n-1)d", "S_n = n/2(2a+(n-1)d)", "a_n = ar^(n-1)", "S_n = a(1-r^n)/(1-r)", "S_∞ = a/(1-r)"],
  },
  {
    subject: "math",
    unit: "calculus",
    title: "limits and continuity",
    keywords: ["limit", "continuity", "lhopital", "indeterminate", "left hand limit", "right hand limit"],
    drawProtocol: "draw axes and sketch the curve near the point; mark the hole or jump with [LABEL] at x = a; draw open/closed point.",
    boardFormulas: ["lim_(x→a) f(x)", "0/0, ∞/∞", "lim (sin x)/x = 1", "f continuous at a ⟺ lim f(x) = f(a)"],
  },
  {
    subject: "math",
    unit: "calculus",
    title: "differentiation and applications",
    keywords: ["derivative", "differentiation", "chain rule", "product rule", "quotient rule", "maxima", "minima", "tangent", "normal"],
    drawProtocol: "draw curve with [DRAW_LINE] segments; draw tangent at a point with [DRAW_LINE]; label slope m = dy/dx; mark maxima/minima.",
    boardFormulas: ["dy/dx", "d/dx(x^n) = nx^(n-1)", "(uv)' = u'v+uv'", "d/dx(f(g)) = f'(g)g'", "m_tan = dy/dx|_(x=a)"],
  },
  {
    subject: "math",
    unit: "calculus",
    title: "integration and applications",
    keywords: ["integration", "integral", "definite integral", "area under curve", "substitution", "by parts"],
    drawProtocol: "shade area under curve with [HIGHLIGHT]; draw vertical strips; label limits a and b on the x-axis.",
    boardFormulas: ["∫f(x)dx", "∫_a^b f(x)dx", "∫u dv = uv - ∫v du", "Area = ∫_a^b y dx"],
  },
  {
    subject: "math",
    unit: "calculus",
    title: "differential equations",
    keywords: ["differential equation", "order", "degree", "variable separable", "homogeneous", "linear de"],
    drawProtocol: "write the DE on the left; draw slope field sketch with short [DRAW_LINE] segments if explaining direction field.",
    boardFormulas: ["dy/dx = f(x,y)", "dy/dx + Py = Q", "IF = e^∫P dx", "y = CF + PI"],
  },
  {
    subject: "math",
    unit: "coordinate geometry",
    title: "straight lines",
    keywords: ["straight line", "slope", "intercept", "distance formula", "section formula", "angle between lines"],
    drawProtocol: "draw x and y axes with [DRAW_LINE]; plot the line; label slope m and intercepts; mark angle θ between two lines.",
    boardFormulas: ["y = mx + c", "m = (y2-y1)/(x2-x1)", "d = |Ax+By+C|/√(A^2+B^2)", "tan θ = |(m1-m2)/(1+m1m2)|"],
  },
  {
    subject: "math",
    unit: "coordinate geometry",
    title: "circles",
    keywords: ["circle", "radius", "diameter", "chord", "tangent to circle", "normal to circle"],
    drawProtocol: "draw [DRAW_CIRCLE:cx,cy,r] in diagram zone; label center (h,k), radius r, point P on circle; draw tangent as [DRAW_LINE] perpendicular to radius.",
    boardFormulas: ["(x-h)^2+(y-k)^2 = r^2", "x^2+y^2+2gx+2fy+c = 0", "T: xx1+yy1 = r^2", "d(center,line) = r"],
  },
  {
    subject: "math",
    unit: "coordinate geometry",
    title: "parabola",
    keywords: ["parabola", "focus", "directrix", "latus rectum", "vertex"],
    drawProtocol: "draw axes; sketch parabola with [DRAW_LINE] segments; label vertex V, focus F, directrix L; mark standard form opening.",
    boardFormulas: ["y^2 = 4ax", "x^2 = 4ay", "PS = PM", "LR = 4a", "V = (0,0) or (h,k)"],
  },
  {
    subject: "math",
    unit: "coordinate geometry",
    title: "ellipse",
    keywords: ["ellipse", "eccentricity", "foci", "major axis", "minor axis", "latus rectum"],
    drawProtocol: "draw ellipse as [DRAW_CIRCLE] stretched visually with [DRAW_LINE] major/minor axes; label foci F1, F2, semi-axes a and b.",
    boardFormulas: ["x^2/a^2 + y^2/b^2 = 1", "b^2 = a^2(1-e^2)", "e = c/a", "PF1+PF2 = 2a", "LR = 2b^2/a"],
  },
  {
    subject: "math",
    unit: "coordinate geometry",
    title: "hyperbola",
    keywords: ["hyperbola", "asymptote", "rectangular hyperbola", "conjugate axis", "transverse axis"],
    drawProtocol: "draw axes; sketch both branches with [DRAW_LINE]; draw asymptotes as dashed [DRAW_LINE]; label vertices and foci.",
    boardFormulas: ["x^2/a^2 - y^2/b^2 = 1", "xy = c^2", "e > 1", "asymptotes y = ±(b/a)x", "|PF1-PF2| = 2a"],
  },
  {
    subject: "math",
    unit: "3d geometry",
    title: "three-dimensional geometry",
    keywords: ["3d", "direction cosines", "direction ratios", "plane", "line in 3d", "distance point plane", "angle between planes"],
    drawProtocol: "draw 3D axes with three [DRAW_LINE] from origin; label î, ĵ, k̂; sketch plane or line; project onto coordinate planes.",
    boardFormulas: ["l^2+m^2+n^2 = 1", "ax+by+cz+d = 0", "r = a+λb", "d = |ax1+by1+cz1+d|/√(a^2+b^2+c^2)"],
  },
  {
    subject: "math",
    unit: "vectors",
    title: "vector algebra",
    keywords: ["vector", "dot product", "cross product", "scalar triple product", "projection"],
    drawProtocol: "draw vectors as [DRAW_LINE] arrows from origin or tail-to-head; label θ between vectors; show parallelogram for cross product.",
    boardFormulas: ["|a| = √(a1^2+a2^2+a3^2)", "a·b = |a||b|cos θ", "a×b = |a||b|sin θ n̂", "a·b = a1b1+a2b2+a3b3"],
  },
  {
    subject: "math",
    unit: "trigonometry",
    title: "trigonometric functions and identities",
    keywords: ["trigonometry", "sin", "cos", "tan", "identity", "inverse trig", "unit circle"],
    drawProtocol: "draw unit circle with [DRAW_CIRCLE]; mark angle θ; draw [DRAW_LINE] for sin (vertical) and cos (horizontal); label quadrants.",
    boardFormulas: ["sin^2θ+cos^2θ = 1", "sin(A±B)", "cos(A±B)", "sin2θ = 2sinθcosθ", "sin^-1 x + cos^-1 x = π/2"],
  },
  {
    subject: "math",
    unit: "probability",
    title: "probability and statistics",
    keywords: ["probability", "conditional probability", "bayes", "mean", "variance", "binomial distribution"],
    drawProtocol: "draw sample space tree or venn diagram; label events A, B; write probability formulas on the left.",
    boardFormulas: ["P(A∪B) = P(A)+P(B)-P(A∩B)", "P(A|B) = P(A∩B)/P(B)", "E(X) = ΣxP(x)", "Var(X) = E(X^2)-[E(X)]^2", "P(X=r) = C(n,r)p^r(1-p)^(n-r)"],
  },

  // ─── PHYSICS ───────────────────────────────────────────────────────────────
  {
    subject: "physics",
    unit: "mechanics",
    title: "kinematics",
    keywords: ["kinematics", "displacement", "velocity", "acceleration", "suvat", "projectile", "relative velocity"],
    drawProtocol: "draw axes or path with [DRAW_LINE]; mark initial/final positions; for projectile draw parabolic path; label u, v, a, θ, range R, max height H.",
    boardFormulas: ["v = u + at", "s = ut + ½at^2", "v^2 = u^2 + 2as", "R = u^2sin2θ/g", "H = u^2sin^2θ/(2g)"],
  },
  {
    subject: "physics",
    unit: "mechanics",
    title: "laws of motion and free-body diagrams",
    keywords: ["newton", "free body", "fbd", "friction", "normal", "incline", "tension", "second law"],
    drawProtocol: "diagram-explain-solve FBD: surface [DRAW_RECT], block, every force as [DRAW_LINE] with [LABEL]; incline as angled [DRAW_LINE]; label mg, N, f, F_applied.",
    boardFormulas: ["F_net = ma", "f = μN", "N = mg cos θ", "mg sin θ", "T - mg = ma"],
  },
  {
    subject: "physics",
    unit: "mechanics",
    title: "work, energy, and power",
    keywords: ["work", "kinetic energy", "potential energy", "conservation of energy", "power", "work energy theorem"],
    drawProtocol: "draw object at two heights on diagram; label initial/final PE and KE with [LABEL]; use [ARROW] to show energy transfer.",
    boardFormulas: ["W = F·s cos θ", "KE = ½mv^2", "PE = mgh", "W = ΔKE", "P = W/t = F·v"],
  },
  {
    subject: "physics",
    unit: "mechanics",
    title: "center of mass and momentum",
    keywords: ["center of mass", "momentum", "collision", "impulse", "elastic", "inelastic", "rocket"],
    drawProtocol: "draw two masses before and after collision; mark COM; label p before and p after with [ARROW] momentum vectors.",
    boardFormulas: ["p = mv", "J = FΔt = Δp", "m1u1+m2u2 = m1v1+m2v2", "x_cm = Σmx/Σm", "v = (m1u1+m2u2)/(m1+m2) inelastic"],
  },
  {
    subject: "physics",
    unit: "mechanics",
    title: "rotation and circular motion",
    keywords: ["rotation", "torque", "angular velocity", "moment of inertia", "rolling", "bead on hoop", "cm of rotation"],
    drawProtocol: "draw [DRAW_CIRCLE] path or rotating body; mark axis; draw radius to point; label θ, ω, τ; for hoop/bead use downward reference [DRAW_LINE] and bead position.",
    boardFormulas: ["τ = Iα", "L = Iω", "KE_rot = ½Iω^2", "v = rω", "a_c = v^2/r = ω^2r", "I_hoop = MR^2", "I_disc = ½MR^2"],
  },
  {
    subject: "physics",
    unit: "mechanics",
    title: "gravitation",
    keywords: ["gravitation", "kepler", "orbital", "escape velocity", "satellite", "g variation"],
    drawProtocol: "draw planet as [DRAW_CIRCLE]; draw orbit; label R, r, satellite; draw force [DRAW_LINE] toward center.",
    boardFormulas: ["F = GMm/r^2", "g = GM/R^2", "v_orb = √(GM/r)", "v_esc = √(2GM/R)", "T^2 ∝ r^3"],
  },
  {
    subject: "physics",
    unit: "mechanics",
    title: "properties of matter and fluids",
    keywords: ["elasticity", "stress", "strain", "young modulus", "fluid", "bernoulli", "viscosity", "surface tension"],
    drawProtocol: "draw wire/block under load for stress-strain; for fluid draw pipe with [DRAW_RECT] and flow [ARROW]; label pressure P1, P2.",
    boardFormulas: ["stress = F/A", "strain = ΔL/L", "Y = stress/strain", "P + ½ρv^2 + ρgh = const", "F = ηA(dv/dy)"],
  },
  {
    subject: "physics",
    unit: "thermal",
    title: "thermodynamics and kinetic theory",
    keywords: ["thermodynamics", "heat", "first law", "second law", "carnot", "kinetic theory", "ideal gas"],
    drawProtocol: "draw PV diagram with [DRAW_LINE] cycle; label isothermal, adiabatic paths; for gas draw container [DRAW_RECT] with molecules as dots.",
    boardFormulas: ["ΔU = Q - W", "PV = nRT", "W = ∫PdV", "η_Carnot = 1 - T2/T1", "KE_avg = (3/2)kT", "C_p - C_v = R"],
  },
  {
    subject: "physics",
    unit: "waves",
    title: "oscillations and waves",
    keywords: ["shm", "simple harmonic", "pendulum", "spring", "wave", "doppler", "standing wave", "beats"],
    drawProtocol: "draw sinusoidal wave with [DRAW_LINE]; label λ, A, nodes/antinodes; for SHM draw mass on spring [DRAW_LINE] with equilibrium marked.",
    boardFormulas: ["x = A sin(ωt+φ)", "ω = √(k/m)", "T = 2π√(l/g)", "v = fλ", "f' = f(v±v_o)/(v∓v_s)"],
  },
  {
    subject: "physics",
    unit: "electrostatics",
    title: "electrostatics and capacitance",
    keywords: ["coulomb", "electric field", "gauss", "potential", "dipole", "capacitor", "dielectric"],
    drawProtocol: "draw charges as [LABEL]+ and -; draw field lines as [DRAW_LINE] from + to -; for capacitor two parallel [DRAW_LINE] plates labeled Q, V, C.",
    boardFormulas: ["F = kq1q2/r^2", "E = F/q", "V = kq/r", "E = -dV/dr", "C = Q/V", "C = εA/d", "U = ½CV^2"],
  },
  {
    subject: "physics",
    unit: "current electricity",
    title: "current electricity",
    keywords: ["ohm", "resistance", "kirchhoff", "wheatstone", "meter bridge", "potentiometer", "internal resistance"],
    drawProtocol: "draw circuit with [DRAW_LINE] wires connecting components; label R, ε, r, I; mark junctions for KCL.",
    boardFormulas: ["V = IR", "R = ρl/A", "P = I^2R = VI", "ΣI = 0", "ΣV = 0", "1/R_eq = 1/R1+1/R2", "ε = I(R+r)"],
  },
  {
    subject: "physics",
    unit: "magnetism",
    title: "magnetism and electromagnetic induction",
    keywords: ["magnetic field", "biot savart", "ampere", "faraday", "lenz", "inductance", "ac circuit", "transformer"],
    drawProtocol: "draw wire with current I; draw B-field loops or [ARROW] direction; for solenoid draw coil; label Φ, ε_induced.",
    boardFormulas: ["F = qvB sin θ", "B_wire = μ0I/(2πr)", "Φ = BA cos θ", "ε = -dΦ/dt", "ε = -L(dI/dt)", "V_s/V_p = N_s/N_p"],
  },
  {
    subject: "physics",
    unit: "optics",
    title: "ray optics and optical instruments",
    keywords: ["lens", "mirror", "refraction", "snell", "magnification", "telescope", "microscope", "prism"],
    drawProtocol: "draw principal axis [DRAW_LINE]; draw lens/mirror shape; trace 2-3 rays with [DRAW_LINE]; label F, 2F, u, v, h, h'.",
    boardFormulas: ["1/f = 1/v - 1/u", "m = -v/u = h'/h", "n1 sin i = n2 sin r", "P = 1/f", "m_microscope = -(L/f_o)(D/f_e)"],
  },
  {
    subject: "physics",
    unit: "modern physics",
    title: "modern physics",
    keywords: ["photoelectric", "de broglie", "bohr", "radioactivity", "nuclear", "binding energy", "photon"],
    drawProtocol: "draw energy level diagram with horizontal [DRAW_LINE] levels; label n=1,2,3; for photoelectric draw photon [ARROW] hitting metal surface.",
    boardFormulas: ["E = hf", "KE_max = hf - φ", "λ = h/p", "E_n = -13.6/n^2 eV", "ΔE = hf", "E_b = Δmc^2", "N = N0 e^(-λt)"],
  },

  // ─── CHEMISTRY ─────────────────────────────────────────────────────────────
  {
    subject: "chemistry",
    unit: "physical",
    title: "mole concept and stoichiometry",
    keywords: ["mole", "stoichiometry", "molarity", "molality", "mole fraction", "empirical formula", "limiting reagent"],
    drawProtocol: "write balanced equation on left; draw mole ratio diagram with [ARROW] between reactants and products; label n, M, m.",
    boardFormulas: ["n = m/M", "M = n/V", "X_A = n_A/n_total", "m = nM", "η = actual/theoretical × 100%"],
  },
  {
    subject: "chemistry",
    unit: "physical",
    title: "atomic structure",
    keywords: ["bohr", "quantum number", "orbital", "aufbau", "hund", "pauli", "de broglie", "heisenberg"],
    drawProtocol: "draw energy level diagram; sketch s, p, d orbital shapes as [DRAW_CIRCLE] or lobes with [DRAW_LINE]; label n, l, m, ms.",
    boardFormulas: ["E_n = -13.6Z^2/n^2 eV", "λ = h/mv", "ΔxΔp ≥ h/4π", "2n^2 electrons per shell", "l = 0..n-1"],
  },
  {
    subject: "chemistry",
    unit: "physical",
    title: "chemical bonding and molecular structure",
    keywords: ["covalent", "ionic", "hybridization", "vsepr", "molecular orbital", "bond order", "dipole"],
    drawProtocol: "draw lewis structure with [LABEL] on atoms; show bond pairs as [DRAW_LINE]; label geometry (tetrahedral, linear, etc.).",
    boardFormulas: ["BO = (Nb-Na)/2", "μ = q×d", "sp, sp2, sp3, dsp2", "F = kq1q2/r^2 ionic", "lone pair-bond pair repulsion"],
  },
  {
    subject: "chemistry",
    unit: "physical",
    title: "states of matter and gaseous state",
    keywords: ["ideal gas", "van der waals", "kinetic theory", "rms speed", "gas law", "partial pressure"],
    drawProtocol: "draw PV graph with [DRAW_LINE]; label isotherms; draw container with molecule motion arrows.",
    boardFormulas: ["PV = nRT", "(P+a/V^2)(V-b) = RT", "v_rms = √(3RT/M)", "P_total = ΣP_i", "KE_avg = (3/2)RT"],
  },
  {
    subject: "chemistry",
    unit: "physical",
    title: "chemical thermodynamics",
    keywords: ["enthalpy", "entropy", "gibbs", "hess law", "spontaneity", "born haber"],
    drawProtocol: "draw enthalpy cycle with [ARROW] between states; label ΔH, ΔS, ΔG on each step.",
    boardFormulas: ["ΔG = ΔH - TΔS", "ΔG° = -RT ln K", "ΔH = ΣΔH_f(products)-ΣΔH_f(reactants)", "ΔS_univ > 0 spontaneous"],
  },
  {
    subject: "chemistry",
    unit: "physical",
    title: "chemical and ionic equilibrium",
    keywords: ["equilibrium", "le chatelier", "kp kc", "acid base", "ph", "buffer", "solubility product", "hydrolysis"],
    drawProtocol: "write reversible reaction with [ARROW] both ways; label K_c or K_p; for pH draw scale with [DRAW_LINE] 0-14.",
    boardFormulas: ["K_c = [C]^c[D]^d/[A]^a[B]^b", "K_p = K_c(RT)^Δn", "pH = -log[H+]", "pKa + pKb = 14", "K_sp = [A]^a[B]^b", "pH = pKa + log([salt]/[acid])"],
  },
  {
    subject: "chemistry",
    unit: "physical",
    title: "electrochemistry",
    keywords: ["galvanic cell", "electrolysis", "nernst", "faraday", "conductivity", "fuel cell"],
    drawProtocol: "draw two electrodes [DRAW_RECT] in solution; label anode, cathode, salt bridge; show electron flow with [ARROW].",
    boardFormulas: ["E_cell = E_cathode - E_anode", "E = E° - (RT/nF)ln Q", "ΔG = -nFE", "Q = It", "m = (MIt)/(nF)"],
  },
  {
    subject: "chemistry",
    unit: "physical",
    title: "chemical kinetics",
    keywords: ["rate law", "order", "half life", "arrhenius", "activation energy", "catalyst"],
    drawProtocol: "draw concentration vs time graph with [DRAW_LINE]; label slope = rate; draw arrhenius ln k vs 1/T line.",
    boardFormulas: ["rate = k[A]^m[B]^n", "t_½ = 0.693/k (1st order)", "k = Ae^(-Ea/RT)", "rate = k[A]^0 (zero order)"],
  },
  {
    subject: "chemistry",
    unit: "physical",
    title: "solutions and colligative properties",
    keywords: ["raoult", "henry", "colligative", "osmotic pressure", "ebullioscopy", "cryoscopy", "vant hoff"],
    drawProtocol: "draw solvent/solution containers; label vapor pressure lowering; show semipermeable membrane for osmosis.",
    boardFormulas: ["P = P°X", "ΔT_b = K_b m", "ΔT_f = K_f m", "π = MRT", "P = iMRT", "i = observed/calculated"],
  },
  {
    subject: "chemistry",
    unit: "inorganic",
    title: "periodic table and periodicity",
    keywords: ["periodic table", "ionization enthalpy", "electron affinity", "electronegativity", "atomic radius", "trend"],
    drawProtocol: "sketch periodic table outline with [DRAW_RECT] grid; [HIGHLIGHT] group/period being discussed; label trend arrows.",
    boardFormulas: ["Z_eff = Z - σ", "IE1 < IE2 < IE3", "EN increases across period", "radius decreases across period"],
  },
  {
    subject: "chemistry",
    unit: "inorganic",
    title: "s-block and p-block elements",
    keywords: ["alkali", "alkaline earth", "boron", "carbon", "nitrogen", "oxygen", "halogen", "noble gas", "anomalous"],
    drawProtocol: "draw element box with electronic config [WRITE:...]; show typical compound with [LABEL] formula on board.",
    boardFormulas: ["NaOH, Na2CO3", "CaO, CaCO3", "NH3, HNO3", "H2SO4", "HX, HOX", "SiO2, silicones"],
  },
  {
    subject: "chemistry",
    unit: "inorganic",
    title: "d-block, f-block, and coordination compounds",
    keywords: ["transition metal", "lanthanoid", "coordination compound", "cft", "vbt", "isomerism", "spectrochemical"],
    drawProtocol: "draw octahedral complex with central metal [LABEL]M and ligands [DRAW_LINE]; show cis/trans or fac/mer; label CN, oxidation state.",
    boardFormulas: ["[Co(NH3)6]^3+", "Δ_o = 10Dq", "CFSE", "μ = √[n(n+2)] BM", "strong field: low spin"],
  },
  {
    subject: "chemistry",
    unit: "organic",
    title: "organic fundamentals and hydrocarbons",
    keywords: ["iupac", "isomerism", "inductive", "resonance", "hyperconjugation", "alkane", "alkene", "alkyne", "benzene"],
    drawProtocol: "draw carbon chain with [DRAW_LINE] bonds; label R groups; for benzene draw hexagon with [DRAW_LINE]; show resonance structures.",
    boardFormulas: ["R-X + Mg → R-MgX", "R-CH=CH2 + HX → Markovnikov", "Ar + E+ → σ-complex", "SN1, SN2, E1, E2"],
  },
  {
    subject: "chemistry",
    unit: "organic",
    title: "functional groups and named reactions",
    keywords: ["alcohol", "aldehyde", "ketone", "carboxylic acid", "amine", "grignard", "aldol", "cannizzaro", "esterification"],
    drawProtocol: "draw functional group structure with [LABEL] on carbonyl, OH, NH2; show curved [ARROW] mechanism arrows for electron flow.",
    boardFormulas: ["R-CHO + R'MgX → R-CH(OH)R'", "2R-CHO → Aldol", "R-CHO (no α-H) → Cannizzaro", "R-COOH + ROH → ester", "R-NH2 + HNO2 → diazonium"],
  },
  {
    subject: "chemistry",
    unit: "organic",
    title: "biomolecules and polymers",
    keywords: ["carbohydrate", "protein", "amino acid", "dna", "polymer", "peptide bond", "glucose", "sucrose"],
    drawProtocol: "draw monomer units linked with [DRAW_LINE]; label peptide or glycosidic bond; show α-helix or β-sheet sketch for proteins.",
    boardFormulas: ["(C6H10O5)n", "peptide: -CO-NH-", "20 amino acids", "sucrose = glucose + fructose", "addition vs condensation polymer"],
  },
];

export function findJeeTopicsByKeyword(question: string): JeeTopic[] {
  const normalized = question.toLowerCase();
  return JEE_SYLLABUS_TOPICS.filter((topic) =>
    topic.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
  );
}

export function buildJeePromptSection(): string {
  const lines: string[] = [
    "iit-jee syllabus guidance (NCERT class 11-12, JEE Main & Advanced):",
    "when the student's question matches a topic below, use that topic's drawing protocol and board formulas.",
    "always draw the diagram or graph in the diagram zone (x 500-900, y 160-500) before writing algebra on the left (x 90-400).",
    "use greek unicode symbols on the board (θ, μ, ω, π, λ, Δ) — never spell them as english words.",
    "",
  ];

  const subjects: JeeSubject[] = ["math", "physics", "chemistry"];
  const subjectTitles: Record<JeeSubject, string> = {
    math: "MATHEMATICS",
    physics: "PHYSICS",
    chemistry: "CHEMISTRY",
  };

  for (const subject of subjects) {
    lines.push(subjectTitles[subject] + ":");
    let currentUnit = "";
    for (const topic of JEE_SYLLABUS_TOPICS.filter((t) => t.subject === subject)) {
      if (topic.unit !== currentUnit) {
        currentUnit = topic.unit;
        lines.push(`  [${currentUnit}]`);
      }
      const formulas = topic.boardFormulas.slice(0, 5).join("; ");
      lines.push(`  - ${topic.title}: draw — ${topic.drawProtocol} | formulas — ${formulas}`);
    }
    lines.push("");
  }

  lines.push(
    "jee efficiency rules:",
    "- match the closest topic above before improvising a lesson structure.",
    "- every formula on the board must be spoken in the same step (say it as you write it).",
    "- for multi-step derivations, build the diagram completely first, then solve on the left.",
    "- for organic mechanisms, draw the structure first, then add curved-arrow steps one at a time.",
    "- for circuits, draw the complete circuit before applying kirchhoff or ohm's law.",
    "- for coordinate geometry conics, draw the curve and label focus/directrix/vertices before writing the equation.",
  );

  return lines.join("\n");
}
