/** A resolved fallback promise is not proof that the student heard anything. */
export async function requireSpeechStart(
  speech: Promise<void>,
  hasStarted: () => boolean,
): Promise<void> {
  await speech;
  if (!hasStarted()) {
    throw new Error("The voice could not start. Please try the lesson again.");
  }
}
