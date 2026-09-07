/**
 * Build admin syllabus probes for Physics units from classified bank text
 * when a clean English item exists; otherwise a short canonical stem from
 * the topic label. Never keys runtime diagrams on question id.
 *
 * Usage: tsx packages/scene-engine/scripts/verify/generate-physics-unit-probes.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inferSceneCapabilities } from "../../../tutor-core/src/planners/sceneCapabilities.ts";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene.ts";

interface TaxonomyTopic {
  topic_id: string;
  label: string;
}

interface TaxonomyUnit {
  unit_id: string;
  unit_number: number;
  name: string;
  topics: TaxonomyTopic[];
}

interface BankQuestion {
  question_id: string;
  text?: string;
}

interface SyllabusAssignment {
  question_id: string;
  status: string;
  subject?: string | null;
  primary_unit_id?: string | null;
  primary_topic_id?: string | null;
}

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const TARGET_UNITS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const NON_ASCII_HEAVY = /[^\x00-\x7F]/g;

function isGarbledOcr(text: string): boolean {
  if ((text.match(/\$/g) ?? []).length >= 6) return true;
  return /(?:Ho\$|\{bE|·¤|ÅtkZ|AmnH\$mo|Xem©E|feat ser arafea|ItemCode:|Topic Name:Physics)/i.test(text);
}

function isEnglishEnough(text: string): boolean {
  if (isGarbledOcr(text)) return false;
  if (text.length < 40 || text.length > 900) return false;
  const nonAscii = text.match(NON_ASCII_HEAVY)?.length ?? 0;
  return nonAscii / text.length < 0.2;
}

/**
 * The drawing cue appended to an authored stem.
 *
 * This is a first-match cascade, so order is the whole design. It used to run
 * broad branches early, and the cue it produced then became the only apparatus
 * wording in the stem, which is what the scene engine's family regexes read. A
 * 342-probe sweep traced wrong figures straight back to here: "Draw Mean free
 * path ... Draw the named process on a P-V diagram", "Draw AC generator ... Draw
 * the circuit with named resistors and the source", and "Draw Nuclear fission
 * ... Show the n = 1 and n = 2 energy levels".
 *
 * Two rules now hold. Specific branches come before broad ones, so an AC
 * generator reaches the coils branch rather than the resistor branch. And a
 * topic no branch actually describes gets no cue at all: an invented apparatus
 * sentence is worse than a bare "Draw <topic>", because the engine believes it.
 */
function topicCue(label: string): string {
  const topic = label.toLowerCase();

  // -- Optics ---------------------------------------------------------------
  if (/(?:lens|mirror|focal|magnification|optical power)/.test(topic)) {
    return " Show the principal axis and the named rays.";
  }
  if (/(?:prism|refract|total internal|optical fibr|apparent depth|plane surface)/.test(topic)) {
    return " Show the interface and the incident and refracted rays.";
  }
  if (/(?:microscope|telescope)/.test(topic)) {
    return " Show the objective, the eyepiece, and the optical axis.";
  }
  if (/(?:slit|interference|diffraction|fringe|huygens|wavefront)/.test(topic)) {
    return " Show the named slits or wavefronts and the screen.";
  }
  if (/(?:polari|brewster|malus)/.test(topic)) {
    return " Show the polarizer and the transmission axis.";
  }

  // -- Waves and oscillation ------------------------------------------------
  if (/(?:beats|doppler|progressive wave|travelling wave|traveling wave|standing wave|superposition of waves|reflection of waves|intensity and amplitude|organ pipe|resonance)/.test(topic)) {
    return " Sketch the travelling wave named by the topic.";
  }
  // An LC oscillation is electrical. Sending it to the spring-block cue is what
  // made a lesson teach the whole circuit off the mechanical analogy, with the
  // marker on a block and a wall.
  if (/(?:\blc\b|electrical|circuit|damped current)/.test(topic)) {
    return "";
  }
  if (/(?:periodic motion|oscillation|spring|pendulum)/.test(topic)) {
    return " Draw a spring-block oscillator and mark the amplitude.";
  }

  // -- Electromagnetism -----------------------------------------------------
  // Before the circuit branch: an AC generator is a coil turning in a field,
  // and it used to be asked for as a resistor network because "ac generator"
  // sat inside the circuit alternation.
  if (/(?:transformer|motional emf|faraday|electromagnetic induction|lenz|self.?induct|mutual induct|eddy current|ac generator|dynamo)/.test(topic)) {
    return " Show the coils or the rod-and-rails setup named by the topic.";
  }
  // Semiconductor devices get their own stems in `authoredStem`, so a cue here
  // would only fight them.
  if (/(?:transistor|diode|zener|rectifier|logic gate|integrated circuit|\bic\b|amplifier|oscillator circuit)/.test(topic)) {
    return "";
  }
  if (/(?:wheatstone|met(?:er|re)\s*bridge|kirchhoff|galvanometer|potentiometer|post office)/.test(topic)) {
    return " Show the circuit symbols and labelled terminals.";
  }
  if (/(?:ohm|drift velocity|resistivity|electrical resistance|resistance from|electrical energy|joule|combination of cells|current density|mobility|temperature dependence of resistance|electric current|series and parallel)/.test(topic)) {
    return " Draw the circuit with named resistors and the source.";
  }
  if (/(?:electric charge|conservation of charge|coulomb|electric dipole|electric field|equipotential|electric flux|gauss|electric potential|potential energy of a system of charges|conductors and insulators|sharing of charge|capacitor|capacitance|dielectric|multiple charges|superposition principle|continuous charge distribution)/.test(topic)) {
    return " Show the named charges and the electric field.";
  }
  if (/(?:solenoid|toroid|biot|amp[eè]re|lorentz|magnetic dipole|current loop|ferromagnetic|paramagnetic|diamagnetic|magnetic moment|revolving charge|magnetic field|bar magnet|cyclotron|helical|magnetic element|earth'?s magnetic)/.test(topic)) {
    return " Show the current-carrying wire and the magnetic field.";
  }
  if (/(?:electromagnetic wave|displacement current|electromagnetic spectrum)/.test(topic)) {
    return " Show the E and B vectors and the propagation direction.";
  }

  // -- Mechanics ------------------------------------------------------------
  // "rolling friction" is a friction topic, not a hinged rod, and it used to
  // match this branch through the bare word "rolling".
  if (/rolling friction/.test(topic)) return "";
  if (/(?:angular momentum|rigid body|rotational motion|moment of a force|axes theorem|instantaneous axis|combined translational|equilibrium of rigid|moments? of inertia|hinge|torque|rolling)/.test(topic)) {
    return " A uniform rod is hinged at one end. Draw the rod, the hinge, and the named forces.";
  }
  if (/(?:satellite|kepler|gravitat|acceleration due to gravity|weightlessness|orbital velocity|escape velocity)/.test(topic)) {
    return " Show the orbit and the gravitational field.";
  }

  // -- Fluids, surfaces, elasticity and heat --------------------------------
  // Each of these used to land on one canned tanks-and-pipe document.
  if (/(?:surface tension|surface energy|angle of contact|capillary|excess pressure|drops and bubbles|meniscus)/.test(topic)) {
    return " Show the liquid surface, the contact angle, and the named height or radius.";
  }
  if (/(?:young'?s modulus|bulk modulus|modulus of rigidity|poisson|elastic behaviour|stress.?strain|hooke)/.test(topic)) {
    return " Sketch the stress-strain graph and mark the named limits.";
  }
  if (/(?:thermal expansion|calorimetry|specific heat capacity|latent heat|change of state|heat transfer|conduction|convection|radiation|stefan|newton'?s law of cooling|thermometry)/.test(topic)) {
    return " Sketch the temperature graph named by the topic and label both axes.";
  }
  if (/(?:hydraulic|venturi|bernoulli|piston|buoyancy|archimedes|viscosity|fluid column|equation of continuity|continuity of (?:the )?(?:fluid|flow)|terminal velocity|critical velocity|reynolds|streamline|turbulent|fluid pressure|pascal|stokes)/.test(topic)) {
    return " Draw the connected fluid and the named free surface or pipe.";
  }

  // -- Thermodynamics and kinetic theory ------------------------------------
  // Only a genuine process gets a P-V diagram, and only a genuine distribution
  // gets the Maxwell curve. Offering both to every topic is what displaced the
  // named subject in eleven lectures of one sweep.
  if (/(?:isothermal|adiabatic|isobaric|isochoric|p-v diagram|carnot|refrigerator|heat pump|first law of thermodynamics|thermodynamic process|reversible|work done in process|compressing a gas|internal energy|mayer|\bcp, cv\b)/.test(topic)) {
    return " Draw the named process on a P-V diagram.";
  }
  if (/(?:maxwell|rms speed|most probable speed|speed distribution|distribution of speeds)/.test(topic)) {
    return " Sketch the Maxwell speed curve and mark the named speeds.";
  }

  // -- Modern physics -------------------------------------------------------
  if (/(?:photoelectric|stopping potential|work function)/.test(topic)) {
    return " Sketch the photoelectric graph named by the topic and label both axes.";
  }
  if (/(?:de broglie|matter.?wave|davisson|dual nature)/.test(topic)) {
    return " Show the matter-wave along a line.";
  }
  if (/(?:bohr|hydrogen spectrum|spectral series|energy level)/.test(topic)) {
    return " Show the n = 1 and n = 2 energy levels.";
  }
  if (/(?:rutherford|alpha.?particle scattering)/.test(topic)) {
    return " Show the incident path, the nucleus, and the scattering angle.";
  }
  if (/(?:binding energy)/.test(topic)) {
    return " Sketch the binding energy per nucleon curve against mass number.";
  }
  // Fission, fusion, Q value and nuclear composition have no honest figure in
  // the engine today, and the level diagram they used to be offered is a
  // hydrogen picture.
  if (/(?:nuclear fission|nuclear fusion|q value|composition|radioactiv|half.?life|decay)/.test(topic)) {
    return "";
  }

  // -- Practical physics ----------------------------------------------------
  if (/(?:vernier|screw gauge|least count|measured)/.test(topic)) {
    return " Mark the named measured length.";
  }

  return "";
}

function authoredStem(unitNumber: number, label: string, difficulty: (typeof DIFFICULTIES)[number]): string {
  void unitNumber;
  const cue = topicCue(label);
  if (/(?:i-v|i–v|v-i characteristic|characteristic curve|transistor characteristics)/i.test(label)) {
    if (difficulty === "easy") return `Plot the I-V characteristic for ${label} on labelled axes.`;
    if (difficulty === "medium") return `Sketch the characteristic curve for ${label} and mark forward and reverse regions.`;
    return `Draw ${label} as a plot of current against voltage and label the axes.`;
  }
  if (/(?:energy band|n-type|p-type|intrinsic|semiconductors?)/i.test(label) && !/(?:junction|rectifier|zener|i-v)/i.test(label)) {
    const extra = difficulty === "hard" ? " and any donor or acceptor levels" : "";
    return `Draw the energy band diagram for ${label}. Show valence and conduction bands${extra}.`;
  }
  if (/(?:p-n junction|depletion|solar cell|photodiode)/i.test(label) && !/(?:rectifier|zener|regulator)/i.test(label)) {
    return `Draw a labelled diagram of ${label}. Show the p-side, n-side, and depletion region.`;
  }
  if (difficulty === "easy") return `Draw a labelled diagram for ${label}.${cue}`;
  if (difficulty === "medium") return `Draw the standard setup for ${label} and label the named quantities.${cue}`;
  return `Draw ${label} and mark any named directions, levels, or components on the figure.${cue}`;
}

function compilesScene(text: string): boolean {
  const capabilities = inferSceneCapabilities(text);
  const synthesized = synthesizeFamilyScene({ question: text, families: capabilities.families })
    ?? synthesizeLastResortScene({ question: text, families: capabilities.families });
  return Boolean(
    synthesized
    && synthesized.document.visualDecision.mode === "scene"
    && synthesized.renderScene.primitives.length > 0,
  );
}

function explicitVisual(text: string): boolean {
  return /\b(?:draw|diagram|illustrat(?:e|ion)|sketch|construct|plot|graph|locate|mark|show)\b/i.test(text);
}

function preferCompiling(candidates: string[]): string[] {
  return candidates.filter(compilesScene);
}

function pickThree(candidates: string[], unitNumber: number, label: string): [string, string, string] {
  const seen = new Set<string>();
  const unique = preferCompiling(
    [...new Set(candidates.map((text) => text.trim()).filter(Boolean))]
      .filter(explicitVisual)
      .filter((text) => {
        const key = text.slice(0, 160).replace(/\s+/g, " ").toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
  );
  return [
    unique[0] ?? authoredStem(unitNumber, label, "easy"),
    unique[1] ?? authoredStem(unitNumber, label, "medium"),
    unique[2] ?? authoredStem(unitNumber, label, "hard"),
  ];
}

function main(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const taxonomy = JSON.parse(
    readFileSync(resolve(repoRoot, "data/question-bank/syllabus-taxonomy.json"), "utf8"),
  ) as { subjects: Array<{ subject_id: string; units: TaxonomyUnit[] }> };
  const physics = taxonomy.subjects.find((subject) => subject.subject_id === "physics");
  if (!physics) throw new Error("taxonomy is missing physics");

  const questionsPath = resolve(repoRoot, "data/question-bank/build/questions.all.jsonl");
  const syllabusPath = resolve(repoRoot, "data/question-bank/build/question-syllabus.jsonl");
  const byTopic = new Map<string, string[]>();
  if (existsSync(questionsPath) && existsSync(syllabusPath)) {
    const assignmentById = new Map<string, SyllabusAssignment>();
    for (const line of readFileSync(syllabusPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const assignment = JSON.parse(line) as SyllabusAssignment;
      assignmentById.set(assignment.question_id, assignment);
    }
    for (const line of readFileSync(questionsPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const question = JSON.parse(line) as BankQuestion;
      const assignment = assignmentById.get(question.question_id);
      if (!assignment || assignment.status !== "classified") continue;
      if (!(assignment.primary_unit_id ?? "").startsWith("physics|") && assignment.subject !== "Physics") continue;
      const topicId = assignment.primary_topic_id;
      const text = question.text ?? "";
      if (!topicId || !isEnglishEnough(text)) continue;
      const bucket = byTopic.get(topicId) ?? [];
      bucket.push(text.replace(/\s+/g, " ").trim());
      byTopic.set(topicId, bucket);
    }
  }

  const probesDir = resolve(repoRoot, "data/syllabus-probes");
  for (const unitNumber of TARGET_UNITS) {
    const unit = physics.units.find((row) => row.unit_number === unitNumber);
    if (!unit) throw new Error(`taxonomy is missing physics|${unitNumber}`);
    const questions = unit.topics.flatMap((topic) => {
      const [easy, medium, hard] = pickThree(byTopic.get(topic.topic_id) ?? [], unitNumber, topic.label);
      return (["easy", "medium", "hard"] as const).map((difficulty, index) => {
        const question = [easy, medium, hard][index]!;
        const authored = authoredStem(unitNumber, topic.label, difficulty);
        return {
          id: `${topic.topic_id}|${difficulty}`,
          topicId: topic.topic_id,
          difficulty,
          question,
          notes: question === authored
            ? "authored canonical stem from the topic label"
            : "bank-sourced compiling English item for this topic",
        };
      });
    });
    const payload = {
      schemaVersion: "syllabus-probes/v1",
      unitId: unit.unit_id,
      questions,
    };
    const outPath = resolve(probesDir, `physics-unit-${unitNumber}.json`);
    writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`wrote ${outPath} (${questions.length} probes, ${unit.topics.length} topics)`);
  }
}

main();
