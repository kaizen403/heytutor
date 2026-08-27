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

function topicCue(label: string): string {
  const topic = label.toLowerCase();
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
  if (/(?:beats|doppler|progressive wave|travelling wave|traveling wave|superposition of waves|reflection of waves|intensity and amplitude)/.test(topic)) {
    return " Sketch the travelling wave named by the topic.";
  }
  if (/(?:periodic motion|oscillation|spring)/.test(topic)) {
    return " Draw a spring-block oscillator and mark the amplitude.";
  }
  if (/(?:wheatstone|metre|meter bridge|kirchhoff|galvanometer|potentiometer)/.test(topic)) {
    return " Show the circuit symbols and labelled terminals.";
  }
  if (/(?:ohm|drift velocity|resistivity|electrical resistance|electrical energy|joule|combination of cells|current density|mobility|alternating current|ac generator|eddy current|\blc oscillation|reactance|transistor|temperature dependence of resistance)/.test(topic)) {
    return " Draw the circuit with named resistors and the source.";
  }
  if (/(?:gauss|electric dipole|electric field|equipotential|electric flux|coulomb|electric charge|conservation of charge|multiple charges|electric potential|potential energy of a system of charges|conductors and insulators|sharing of charge)/.test(topic)) {
    return " Show the named charges and the electric field.";
  }
  if (/(?:solenoid|toroid|biot|ampere|lorentz|magnetic dipole|current loop|ferromagnetic|paramagnetic|diamagnetic|magnetic moment|revolving charge)/.test(topic)) {
    return " Show the current-carrying wire and the magnetic field.";
  }
  if (/(?:angular momentum|rigid body|rotational motion|moment of a force|axes theorem|instantaneous axis|combined translational|equilibrium of rigid|moments? of inertia|hinge|torque|rolling)/.test(topic)) {
    return " A uniform rod is hinged at one end. Draw the rod, the hinge, and the named forces.";
  }
  if (/(?:satellite|kepler|gravitat|acceleration due to gravity|weightlessness)/.test(topic)) {
    return " Show the orbit and the gravitational field.";
  }
  if (/(?:hydraulic|venturi|bernoulli|piston|buoyancy|archimedes|viscosity|thermal expansion|heat transfer|fluid column|continuity|latent heat|calorimetry|method of mixtures|resonance tube|terminal velocity|surface tension|capillary|drops and bubbles|reynolds|stefan|bulk modulus|modulus of rigidity|poisson|critical velocity|excess pressure|fluid pressure)/.test(topic)) {
    return " Draw the connected fluid and the named free surface or pipe.";
  }
  if (/(?:p-v|isothermal|adiabatic|carnot|thermodynamic|isobaric|isochoric|zeroth law|refrigerator|heat pump|internal energy|perfect gas|kinetic theory|rms speed|equipartition|maxwell|mayer|reversible|avogadro|mean free path|ideal gases|specific heat capacities of gases|compressing a gas)/.test(topic)) {
    return " Draw the named process on a P-V diagram or sketch the Maxwell speed curve.";
  }
  if (/(?:photoelectric|de broglie|matter[- ]wave|photon|davisson|dual nature)/.test(topic)) {
    return " Show the energy levels or the matter-wave along a line.";
  }
  if (/(?:bohr|rutherford|hydrogen spectrum|nucleus|q value|nuclear)/.test(topic)) {
    return " Show the n = 1 and n = 2 energy levels, or the scattering path if named.";
  }
  if (/(?:vernier|screw gauge|least count|measured)/.test(topic)) {
    return " Mark the named measured length.";
  }
  if (/(?:transformer|motional emf|faraday)/.test(topic)) {
    return " Show the coils or the rod-and-rails setup named by the topic.";
  }
  if (/(?:electromagnetic wave|displacement current)/.test(topic)) {
    return " Show the E and B vectors and the propagation direction.";
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
