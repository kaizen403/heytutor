/**
 * Is this stem chemistry at all? The physics family tables were written for
 * physics and misfire on chemistry words: "emf of the cell" drew a resistor
 * chain, "hydrogen atom" a Bohr ladder for an orbital question, "isothermal"
 * a P-V rectangle for a Gibbs energy stem. The family layer asks this first,
 * and a chemistry stem may only receive a chemistry figure (or none).
 *
 * The vocabulary here is the documented oracle, the same status as the
 * physics tables in familyClassification. It decides the SUBJECT, never the
 * figure: which chemistry figure is the router's job, and each family's own
 * cue set carries its vetoes.
 */
import { formulaTokens, complexTokens, normalizeChemistryText, parseFormula } from "./formula";

const CHEMISTRY_STRONG =
  /(?:\borbitals?\b(?! (?:velocity|speed|period|motion|radius|angular|plane))|\bnodal plane|\bradial nodes?|\bangular nodes?|\bsolvents?\b|\bdissolved\b|\bmetalloid|\bbasicity\b|\bacidity\b|\bamines\b|\benol\b|\bantibiotic|\banalgesic|\bantiseptic|\bantacid|\bproducts? [A-Z]\b|\breaction scheme|\batomic number\b|\bhydrogen atoms\b|\belectrons? (?:for which|with quantum|in (?:the )?(?:orbital|subshell|valence))|\bwater[- ]gas|\bn\s*=\s*\d\s*,\s*l\s*=|\bisoelectronic|\badsorption|\bfreundlich|\blangmuir|\bcolloid|\bmicelle|\b(?:an|the|its|sulphide|sulfide|oxide|carbonate) ores?\b|\bgalena|\bbauxite|\bhaematite|\bmalachite|\bcalamine|\bon reaction with\b|\bon treatment with\b|\breacts? with\b|\b\d-(?:methyl|ethyl|propyl|chloro|bromo|iodo|fluoro|hydroxy|amino|nitro|oxo)|\b(?:meth|eth|prop|but|pent|hex|hept|oct|non|dec)(?:ane|ene|yne|anol|anal|anone|anoic|anamine|yl)\b|\boxidation of\b|\breduction of\b|\bcarbonyls?\b|\bmetal (?:atoms?|ions?|carbonyls?|hydrides?|oxides?)|\bhydrides?\b|\boxides?\b|\b(?:mono|di|tri|tetra|penta|hexa)?(?:halide|chloride|fluoride|bromide|iodide|hydride|oxide)s?\b|\bchlorides?\b|\bsulphates?\b|\bsulfates?\b|\bnitrates?\b|\bcarbonates?\b|\bhydroxides?\b|\bgroup \d{1,2} elements?\b|\bequilibri(?:um|a)\b (?:constant|mixture|in (?:physical|chemical))|\bchemical equilibrium|\bdynamic equilibrium|\bequilibria\b|\b(?:chemical|redox|reversible|irreversible|exothermic|endothermic|first[- ]order|zero[- ]order|second[- ]order|elementary|substitution|addition|elimination|combustion|neutrali[sz]ation|precipitation|equilibrium|given|following|above|overall|forward|backward|cell) reactions?\b|\breactions?\b (?:rate|mechanism|proceeds|quotient|coordinate|intermediate|is (?:first|zero|second)[- ]order|between|of .{1,30}\bwith\b|takes? place|occurs)|\bfor the reaction\b|\bin the reaction\b|\brate of (?:the |a )?reaction\b|\bdecompos|\bconcentration of\b|\br\s*=\s*k\b|\bmole?s?\b|\bmolar(?:ity)?\b|molality|\bmolecul(?!es of (?:a |an |the )?(?:gas|ideal)|ar (?:speed|velocity|motion))|\bcompounds?\b(?! microscope| pendulum| lens| interest)|\breagent\b|\bhybridi[sz]|\bligand|coordination (?:number|compound|entity)|\bcomplex(?:es)?\b(?! number| plane| conjugate| root| variable| function| cube)|\belectrode\b|\belectrolysis|\belectrolyt|\boxidation (?:state|number)\b|\bredox\b|\bcovalent\b|\bionic\b|\bisomer|\balkane|\balkene|\balkyne|\bbenzene|\bphenol|\baniline|\baldehyde|\bketone|\bcarboxylic|\bester\b|\bamine\b|\bamide\b|\bpolymer|\btitrat|\bp[hH]\b|\bpka\b|\bpkb\b|\bbuffer\b|solubility product|\bksp\b|\bkc\b|\bkp\b|equilibrium constant|rate (?:constant|law)|\border of (?:the )?reaction|half[- ]life of (?:the )?(?:reaction|a first)|first order reaction|\bcatalyst|\bperiodic table|\bperiodicity|electronegativ|ionisation (?:enthalpy|energy)|ionization (?:enthalpy|energy)|electron gain|atomic radi|\bvalen|\blone pairs?\b|\bbond (?:order|angle|pair|length|enthalpy|energy)|\bsigma (?:bonds?|and pi)|\bpi bonds?|molecular orbital|\bparamagnetic|\bdiamagnetic|crystal field|\bcfse\b|\bspin only|unpaired electron|electronic configuration|electron configuration|\bquantum numbers?\b|\bunit cell\b|\bfcc\b|\bbcc\b|\bccp\b|\bhcp\b|\blattice\b|packing (?:efficiency|fraction)|\bvoid\b|\braoult|colligative|vapour pressure|vapor pressure|osmotic|van.?t hoff|\benthalpy|\bentropy\b|gibbs|\bspontaneous (?:reaction|process|at|when|below|above|only)|non-?spontaneous|\bhess|born[- ]haber|ellingham|\baqueous\b|\bprecipitat|\bsalt bridge|galvanic|daniell|nernst|\bcell potential|electrode potential|kohlrausch|(?<!thermal )(?<!electrical )(?<!resistivity and )(?<!ivity and )conductivity|\bacids?\b|(?:weak|strong|conjugate|lewis|bronsted|arrhenius) base\b|\bsalts?\b|\boxidi[sz]|\breduc(?:es|ing|tion) (?:of|agent)|\bcombustion|\bstoichiometr|limiting reagent|empirical formula|molecular formula|\biupac|major product|\bnucleophil|\belectrophil|\bcarbocation|\bsn1\b|\bsn2\b|\bgrignard|\bozonolysis|\bmarkovnikov|\bwurtz|\bfriedel|\bcannizzaro|\baldol|\bkmno4|\bk2cr2o7|\blewis|resonance struct|formal charge|\bvsepr|\bshape of (?:the )?(?:molecule|ion)|\bgeometry of|\bglucose|\bfructose|\bamino acid|\bpeptide|\bprotein|\bcarbohydrate|\bdna\b|\brna\b|\bvitamin|\bp-block|\bd-block|\bf-block|\btransition (?:metal|element)|\blanthan(?:ide|oid|um)|\bactin(?:ide|oid|ium)|\bnoble gas|\bhalogen|\balkali|\b(?:iron|copper|aluminium|zinc|silver|gold|lead|tin|sulphide|oxide|carbonate|bauxite|haematite|hematite) ores?\b|\bores? (?:of|is|are|contain)\b|\bmetallurg|\broasting|\bcalcination|\bleaching|\bfroth)/i;

const PHYSICS_STRONG =
  /(?:\belectric (?:field|dipole|flux|potential|charge)|\bpoint charges?\b|\bgauss|\bequipotential|\bcoulomb|\bpermittivity|\bcapacitance|\bpotential difference|\bcharge density|\bconducting (?:sphere|shell|wire|rod|plate)|\bspherical shell|\bdielectric|\bmagnetic (?:field|flux|dipole moment)|\belectromagnetic|\binduced (?:emf|current)|\bcurrent (?:carrying|of|in the)|\bdrift velocity|\bcircuit|\bwavelength of (?:light|the light)|\bfrequency of|\bwave(?:length|front)?s?\b(?! ?function)|\bamplitude|\bhertz|\bcm\b|\bkinetic energy of (?:the )?(?:body|block|particle|ball)|\bparticle of mass|\bblock of mass|\bbody of mass|\bvelocity\b|\bacceleration\b|\bprojectile|\bnewton'?s? (?:law|second)|\bmomentum\b|\bfriction|\bpulley|\bincline|\btorque|moment of inertia|\blens\b|\bmirror\b|\bprism\b|\brefractive index|\bsignificant figures?\b|\bleast count\b|\b(?:absolute|relative|percentage) error\b|\bvernier\b|\bscrew gauge\b|\bresistivity\b|\bconductors?\b|\bdrift\b|\bdiffraction|\binterference|\bpolari[sz]|\bresistor|\bresistance of\b|\bcapacitor|\binductor|\bkirchhoff|\bwheatstone|\bgalvanometer|\bammeter|\bvoltmeter|\bsolenoid|\bmagnetic field\b|\bbiot|\bampere'?s? law|\bfaraday'?s? law|\btransformer|\bprojectile|\bsimple harmonic|\bpendulum|\bstanding wave|\bdoppler|\bsound wave|\bsatellite|\bkepler|\bescape velocity|\bgravitational|\bstress\b|\bstrain\b|young'?s modulus|\bbernoulli|\bviscosity|\b(?:dia|para|ferro)magnetic (?:substance|material|sample|specimen)|\bmagnetism\b|\bsusceptibility|\bhysteresis|\bcarnot|\bisothermal|\badiabatic|\bisobaric|\bisochoric|\bcyclic process|\bwork done (?:by|on) the gas|\brms speed|\bmean free path|\bdegrees? of freedom|\bkinetic theory|\bideal gas equation|\bmolar specific heat|\bindicator diagram|\bp-v diagram|\bwork done by the gas|\bphotoelectric|\bde broglie|\bnuclear (?:fission|fusion)|\bbinding energy|\bradioactiv|\bdecay constant|\bhalf[- ]life of (?:the )?(?:sample|nucleus|radioactive)|\blogic gate|\bnand\b|\bnor gate|\bzener|\bdiode|\btransistor|\bsemiconductor|\bkg\b|\bm\/s\b|\bms\^?-1\b|\bnewton\b|\bjoule\b|\btesla\b|\bweber\b|\bohm\b|\bhenry\b)/i;

/** Formula-shaped evidence: a real multi-element formula or a coordination entity. */
function formulaEvidence(text: string): number {
  // Two distinct elements, a charge, or a coordination bracket. A lone
  // element with a subscript is not evidence: an OCR'd square root reads as
  // "V10" and a physics stem names O2 and H2 as gases.
  const tokens = formulaTokens(text).filter((token) => {
    if (token.length < 3) return false;
    const parsed = parseFormula(token);
    if (!parsed) return false;
    return parsed.atoms.length >= 2 || parsed.charge !== 0 || /[[\]]/.test(token);
  });
  return tokens.length + 2 * complexTokens(text).length;
}

/**
 * Chemistry when the stem carries chemistry vocabulary or formulas and is not
 * dominated by physics apparatus. Ties go to chemistry only when a formula is
 * present, since "energy", "cell" and "current" belong to both subjects.
 */
export function isChemistryStem(question: string): boolean {
  const text = normalizeChemistryText(question);
  const words = countMatches(text, CHEMISTRY_STRONG);
  const formulas = formulaEvidence(text);
  const complexes = complexTokens(text).length;
  // One formula alone is not a subject: OCR turns "N/C" into "NC-" and "√10"
  // into "V10", and a physics stem names the gas it compresses.
  if (words === 0 && complexes === 0 && formulas < 2) return false;
  const chemistry = words + formulas;
  const physics = countMatches(text, PHYSICS_STRONG);
  if (physics === 0) return true;
  if (chemistry > physics) return true;
  return chemistry === physics && formulas > 0;
}

function countMatches(text: string, pattern: RegExp): number {
  return matchesOf(text, pattern).length;
}

function matchesOf(text: string, pattern: RegExp): string[] {
  const global = new RegExp(pattern.source, "gi");
  return text.match(global) ?? [];
}

/** The words the subject decision rested on, for gates and debugging. */
export function chemistryEvidence(question: string): { chemistry: string[]; physics: string[]; formulas: string[] } {
  const text = normalizeChemistryText(question);
  return {
    chemistry: matchesOf(text, CHEMISTRY_STRONG),
    physics: matchesOf(text, PHYSICS_STRONG),
    formulas: formulaTokens(text).filter((token) => token.length >= 3),
  };
}

/**
 * Atomic-structure stems that physics's energy-level family already draws
 * correctly (a Bohr ladder with a transition). Chemistry keeps that figure.
 */
export function isAtomicTransitionStem(question: string): boolean {
  const text = normalizeChemistryText(question);
  return /(?:\bbohr\b|hydrogen[- ]like|\btransition\b.{0,60}\bn\s*=|\bn\s*=\s*\d.{0,60}\btransition|balmer|lyman|paschen|brackett|pfund|spectral (?:line|series)|\bwavelength of (?:the )?(?:light|radiation|photon)|ionisation energy of (?:hydrogen|he\+|li2\+)|rydberg)/i.test(text)
    && !/(?:electronic configuration|electron configuration|orbital diagram|unpaired|magnetic moment|quantum numbers?|nodal|radial node|angular node)/i.test(text);
}

/**
 * Gas-process stems whose figure is the physics P-V plot in either subject:
 * chemistry's thermodynamics unit asks for work in an isothermal reversible
 * expansion with the same picture physics draws for it.
 */
export function isGasProcessStem(question: string): boolean {
  const text = normalizeChemistryText(question);
  return /(?:\bisothermal|\badiabatic|\bisobaric|\bisochoric|\bp-v\b|\bpv\b|\bcyclic process|\bindicator diagram|reversibl[ey] (?:expan|compress)|(?:expan|compress)(?:ds|sion|ded)? (?:isothermally|adiabatically|reversibly))/i.test(text);
}
