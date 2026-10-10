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
  console.warn("[turn-save-rejected]", {
    event: "turn_save_rejected", code, status,
    entryPoint: correlation.entryPoint ?? "legacy_post",
    boardId: safeId(correlation.boardId), turnId: safeId(correlation.turnId),
    traceId: safeId(correlation.traceId),
  });
  // Recovery fields (serverCount/turn receipt) remain response-only.
  return NextResponse.json({ ...responseFields, error, code }, { status });
}
