import type { SceneIssue } from "@heytutor/scene-engine";

// Verbatim class declaration from 0dd2ff0a9350f184e13d8119825a2abe20a5fcdd:
// apps/tutor/features/tutor-session/lib/scene/neutralPanelPresentation.ts.
// Error-contract fixture only; no chemistry producer or permission is mocked.
export class NeutralPanelPresentationDeclined extends Error {
  readonly code = "neutral_panel_declined";
  constructor(readonly issues: readonly SceneIssue[]) {
    super(issues.map(issue => issue.message).join("; "));
    this.name = "NeutralPanelPresentationDeclined";
  }
}
