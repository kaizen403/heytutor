import { inductionAcAdmissions } from "./agent7-induction-ac";
import { registerModelAdmission } from "./admission";

// Packet-owned contracts already carry exact roles, categorical source
// phrases, optional groups, conditional closed/open requirements, and scalar
// evaluators. This module is intentionally registration-only: it does not
// classify prose or select a physical model.
for (const admission of inductionAcAdmissions) registerModelAdmission(admission);
