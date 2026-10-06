export * from "./types";
export * from "./capability/capabilityManifest";
export * from "./document/validation";
export * from "./document/namedPoints";
export * from "./compile/compiler";
export * from "./compile/matrixSourceBinding";
export * from "./compile/annotationMarks";
export * from "./compile/sceneAnnotations";
export * from "./contracts/contractsV3";
export * from "./ir/coordinateDistanceSource";
export * from "./ir/pointLineSource";
export * from "./ir/pointLineProgram";
export * from "./ir/matrixLiteralSource";
export * from "./ir/matrixProductSourceAuthority";
export * from "./ir/sectionFormulaSource";
export * from "./topology/topology";
export * from "./labels/labelEngine";
export * from "./math/expression";
export * from "./ir/problemIR";
export * from "./ir/circuitNetwork";
export * from "./ir/solver";
export * from "./ir/remoteSolver";
export * from "./ir/solverAuthority";
export * from "./ir/statedCircuitAuthority";
export * from "./physics/opticalConjugateSource";
export * from "./ir/opticalConjugateProgram";
export * from "./ir/circleSourceProgram";
export * from "./ir/circleSourceAuthority";
export * from "./ir/circleCallerAuthority";
export * from "./ir/statedCircuitProblemBinding";
export * from "./ir/sceneSourceAuthority";
export * from "./ir/sourceQuantityAuthority";
export * from "./physics/opticsLaws";
export * from "./physics/bohrTransitionAuthority";
export * from "./physics/bohrOrbitAuthority";
export * from "./physics/elasticModulusAuthority";
export * from "./physics/planarInterfaceAuthority";
export * from "./physics/relativeMotionSource";
export * from "./physics/motionPlanAgreement";
export * from "./physics/riverCrossingSource";
export * from "./physics/uniformCircularSource";
export * from "./physics/uniformCircularAuthority";
export * from "./physics/uniformCircularCallerAuthority";
export * from "./physics/uniformCircularSourceBinding";
export * from "./physics/uniformCircularSourceIR";
export * from "./archetypes";
export * from "./synthesize/familyClassification";
export * from "./synthesize/sceneDemand";
export * from "./synthesize/visualObligations";
export * from "./synthesize/familyScene";
export * from "./synthesize/sourceMensuration";
export * from "./synthesize/relativeMotionScene";
export * from "./synthesize/uniformCircularFamily";
export * from "./synthesize/conceptSchematic";
export * from "./synthesize/dsaFamilies";
export * from "./chemistry";

// DSA code lessons: algorithm traces are the ground truth for the figure.
// The catalog picks a family, the simulator produces real frames, and
// traceToScene compiles each frame with assertions that can actually fail.
export * from "./dsa/trace/types";
export * from "./dsa/algorithmCatalog";
export * from "./dsa/detectAlgorithm";
export * from "./dsa/exampleSlots";
export * from "./dsa/traceToScene";
export * from "./dsa/familyTeaching";

export { constantAccelerationSourceProgram } from "./archetypes/generators/constantAcceleration";
export * from "./ir/ladderSourceProgram";
export * from "./ir/rightTriangleSource";

export * from "./ir/staticContactTriangle";

export * from "./ir/staticContactTriangleAuthority";

export * from "./math/finitePolynomialExpansion";
export * from "./ir/finiteBinomialProgram";
export * from "./compile/binomialExpansionGeometry";
export * from "./contracts/finiteBinomialContract";

export * from "./compile/indexedProgressionGeometry";
export * from "./math/finiteProgressionSource";
export * from "./ir/finiteProgressionSourceProgram";
export * from "./contracts/finiteProgressionContract";

export * from "./ir/finiteBinomialPlanAuthority";
export * from "./ir/measurementSourceAuthority";

export * from "./ir/measurementQuestionPlanAuthority";

export { snapshotMathSourceData } from "./compile/mathSourceData";

export { relativeMotionCallerIssues } from "./physics/relativeMotionCallerAuthority";
