/**
 * While a lecture is encoding, the download control stays a progress button.
 * Cancel is an affordance, not the default press: hover (mouse) or a second
 * tap (touch) reveals it, then the next press actually stops the export.
 */

export function lectureExportCancelRevealedOnEnter(pointerType: string): boolean {
  return pointerType === "mouse";
}

export function lectureExportCancelPressAction(
  revealed: boolean,
): "reveal" | "cancel" {
  return revealed ? "cancel" : "reveal";
}
