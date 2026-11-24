import { normalizeTutorQuestion } from "@heytutor/tutor-core";

// OCR text has no immutable attachment identity. Remember known photo origin
// across composer remounts and queued turns so native text-source selection
// declines it. Bound memory for long-running student sessions.
const photoQuestions = new Set<string>();
export function markPhotoQuestion(question: string): void {
  const key = normalizeTutorQuestion(question);
  photoQuestions.delete(key);
  photoQuestions.add(key);
  while (photoQuestions.size > 128)
    photoQuestions.delete(photoQuestions.values().next().value!);
}
export function isPhotoQuestion(question: string): boolean {
  return photoQuestions.has(normalizeTutorQuestion(question));
}
