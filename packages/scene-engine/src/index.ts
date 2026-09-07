export * from "./types";
export * from "./capability/capabilityManifest";
export * from "./document/validation";
export * from "./document/namedPoints";
export * from "./compile/compiler";
export * from "./compile/annotationMarks";
export * from "./compile/sceneAnnotations";
export * from "./contracts/contractsV3";
export * from "./topology/topology";
export * from "./labels/labelEngine";
export * from "./math/expression";
export * from "./ir/problemIR";
export * from "./ir/solver";
export * from "./ir/remoteSolver";
export * from "./ir/solverAuthority";
export * from "./physics/opticsLaws";
export * from "./archetypes";
export * from "./synthesize/familyClassification";
export * from "./synthesize/sceneDemand";
export * from "./synthesize/familyScene";
export * from "./synthesize/dsaFamilies";

// DSA code lessons: algorithm traces are the ground truth for the figure.
// The catalog picks a family, the simulator produces real frames, and
// traceToScene compiles each frame with assertions that can actually fail.
export * from "./dsa/trace/types";
export * from "./dsa/algorithmCatalog";
export * from "./dsa/detectAlgorithm";
export * from "./dsa/exampleSlots";
export * from "./dsa/traceToScene";
export * from "./dsa/familyTeaching";
