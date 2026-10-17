import { NextResponse } from "next/server";
import type { TurnSceneRejectionCode } from "@/lib/scene/turnScenePersistence";

export type SaveRejectionCode =
  | TurnSceneRejectionCode
  | "upload_headers_invalid" | "unauthorized" | "idempotency_key_invalid"
  | "board_not_found" | "multipart_invalid" | "metadata_missing"
  | "metadata_json_invalid" | "turn_fields_invalid" | "save_allowance_required"
  | "save_allowance_used" | "upload_parts_invalid" | "turn_not_persistable"
  | "scene_persistence_rejected" | "segment_fields_invalid"
  | "audio_format_mismatch" | "storage_admission_rejected" | "storage_commit_rejected"
  | "storage_verification_failed" | "storage_accounting_changed" | "turn_storage_limit_reached"
  | "turn_id_invalid" | "close_body_invalid" | "turn_not_found"
  | "trace_mismatch" | "trace_saved" | "checkpoint_rows_conflict"
  | "turn_segments_oversized" | "audio_segment_missing" | "turn_audio_oversized"
  | "turn_metadata_oversized" | "scene_resume_authority_mismatch";

type SaveCorrelation = {
  boardId?: string;
  turnId?: string;
  traceId?: string;
  entryPoint?: "legacy_post" | "checkpoint_put" | "checkpoint_close";
};

// Only exact application-owned invariant messages map to diagnostic codes.
// Never sanitize/truncate an arbitrary error into a log field: it can contain
// question text or other submitted data. Unknown invariants stay unclassified.
const FIELD_REASONS = new Map<string, string>([
  ["invalid metadata", "metadata_not_object"],
  ["seq must be a positive integer", "sequence_invalid"],
  ["status must be live or stopped", "close_status_invalid"],
  ["status must be live, stopped or complete", "status_invalid"],
  ["kind must be lesson, doubt or resume", "kind_invalid"],
  ["invalid ordering anchor", "ordering_anchor_invalid"],
  ["baseCount must be a non-negative integer", "base_count_invalid"],
  ["invalid or oversized turn fields", "turn_field_bounds"],
  ["resumeState must be an object", "resume_state_invalid"],
  ["resumeState exceeds its size limit", "resume_state_oversized"],
  ["appendSegments must be an array", "segments_not_array"],
  ["turn has too many segments", "segments_oversized"],
  ["each appended segment must be an object", "segment_not_object"],
  ["appended segment order indexes must continue from baseCount", "segment_order_invalid"],
  ["invalid or oversized segment fields", "segment_field_bounds"],
  ["invalid visualStatus", "visual_status_invalid"],
  ["invalid sceneEngineVersion", "scene_version_invalid"],
  ["question and rawResponse are required to create a checkpoint", "creation_fields_missing"],
  ["question is required", "question_missing"],
]);

function rejectionReason(code: SaveRejectionCode, error: string): string | undefined {
  if (code === "turn_fields_invalid") return FIELD_REASONS.get(error) ?? "unclassified";
  if (code === "storage_admission_rejected" || code === "storage_commit_rejected") {
    return error === "account storage quota exceeded" ? "account_storage_quota" : "unclassified";
  }
  return undefined;
}

/** Admission diagnostics are an allowlist, never the submitted error or body. */
export function rejectTurnSave(
  code: SaveRejectionCode,
  error: string,
  status: number,
  correlation: SaveCorrelation = {},
  responseFields: Record<string, unknown> = {},
) {
  const safeId = (value: string | undefined) => value &&
    /^(?:[0-9a-f]{16,32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value)
    ? value : undefined;
  const reason = rejectionReason(code, error);
  console.warn("[turn-save-rejected]", {
    event: "turn_save_rejected", code, status,
    ...(reason ? { reason } : {}),
    entryPoint: correlation.entryPoint ?? "legacy_post",
    boardId: safeId(correlation.boardId), turnId: safeId(correlation.turnId),
    traceId: safeId(correlation.traceId),
  });
  // Recovery fields (serverCount/turn receipt) remain response-only.
  return NextResponse.json({ ...responseFields, error, code }, { status });
}
