export interface PersistableTurnMetadata {
  question?: string;
  rawResponse?: string;
  visualStatus?: string | null;
  sceneArtifacts?: unknown;
}

export function isTurnMetadataPersistable(metadata: PersistableTurnMetadata): boolean {
  if (!metadata.question?.trim()) return false;
  if (metadata.rawResponse?.trim()) return true;
  return metadata.visualStatus === "retry_required" && metadata.sceneArtifacts != null;
}
