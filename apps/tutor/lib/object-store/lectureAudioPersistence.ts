import { isObjectStoreConfigured } from "./config";

/** Local mock lessons retain words and ink even when durable audio storage is absent. */
export function allowsMetadataOnlyLectureAudio(): boolean {
  return (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") &&
    !isObjectStoreConfigured();
}
