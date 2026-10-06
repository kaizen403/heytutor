import { snapshotMathSourceData } from "../compile/mathSourceData";
import { SUVAT_SOURCE_MODEL, suvatDocumentIssues } from "../ir/suvatCallerAuthority";
import type { CompileOptions, SceneDocument, SceneIssue } from "../types";

/** Claims from saved scenes require external originals, never cached proof. */
export function suvatSourceContractIssues(raw:unknown,authority?:CompileOptions["sourceAuthority"]):SceneIssue[]{
  const source=raw&&typeof raw==="object"?Object.getOwnPropertyDescriptor(raw,"source")?.value:undefined;
  const claim=source&&typeof source==="object"?Object.getOwnPropertyDescriptor(source,"sourceModel")?.value:undefined;
  if(claim!==SUVAT_SOURCE_MODEL)return [];
  try{
    const captured=snapshotMathSourceData({document:raw,authority});
    if(!captured.authority)return [{code:"suvat_missing_caller_authority",severity:"fatal",path:"sourceAuthority",message:"Source-proved SUVAT claims need the external original question, Plan and full ProblemIR"}];
    return suvatDocumentIssues(captured.document as SceneDocument,captured.authority.question,captured.authority.problemIR,captured.authority.turnPlan);
  }catch(error){return [{code:"suvat_non_data_source",severity:"fatal",path:"sourceAuthority",message:error instanceof Error?error.message:"Invalid source data"}];}
}
