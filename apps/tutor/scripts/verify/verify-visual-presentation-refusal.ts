/** Error-boundary contract only: no chemistry producer, acceptance, transport,
 * save, API, model or figure claim. This exact class fixture is portable to CI;
 * the broad private candidate need not be fetched, loaded or imported. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SceneIssue } from "@heytutor/scene-engine";
import { isVisualPresentationRefusal } from "../../features/tutor-session/lib/scene/visualPresentationRefusal";
import { NeutralPanelPresentationDeclined as FrozenDecline } from "./fixtures/frozen-neutral-panel-decline";

// Verbatim declaration from 0dd2ff0a9350f184e13d8119825a2abe20a5fcdd:
// apps/tutor/features/tutor-session/lib/scene/neutralPanelPresentation.ts.
// Identical in the original frozen 26b4d56b consumer; only its dependency
// dispatcher changed. No producer or supplied proof is fabricated here.
const fixtureSource = readFileSync(new URL("./fixtures/frozen-neutral-panel-decline.ts", import.meta.url), "utf8");
const frozenDeclaration = fixtureSource.slice(fixtureSource.indexOf("export class NeutralPanelPresentationDeclined")).trimEnd();
const fixtureSha256 = "e97b9342b1faea5014ed18729f9ce3e1120225f9450614dacab986c78dc42e0f";
assert.equal(createHash("sha256").update(frozenDeclaration).digest("hex"), fixtureSha256);
const issue: SceneIssue = { code: "neutral_comparison_declined", message: "Synthetic source mismatch", severity: "fatal", path: "rawDocument" };
let checked = 0;
const check = (name: string, input: unknown, expected: boolean) => {
  assert.equal(isVisualPresentationRefusal(input), expected, name);
  checked++;
};
check("the exact frozen real Error class is a scoped visual refusal", new FrozenDecline([issue]), true);
check("empty typed issues are accepted without matching an error message", new FrozenDecline([]), true);
check("typed optional issue metadata remains valid", new FrozenDecline([{ ...issue,
  severity: "warning", entityIds: ["synthetic-entity"], expected: null, actual: {}, residual: 0,
}]), true);
const changedName = new FrozenDecline([issue]); changedName.name = "OtherName"; changedName.message = "OtherMessage";
check("the discriminant, not name or message, establishes the boundary", changedName, true);
check("a generic error with the same message is not swallowed", new Error(new FrozenDecline([issue]).message), false);
const sameName = new Error("neutral_panel_declined"); sameName.name = "NeutralPanelPresentationDeclined";
check("the name alone is not a typed refusal", sameName, false);
check("a plain structural object is not a real Error", { code: "neutral_panel_declined", issues: [issue] }, false);
for (const code of [undefined, null, "neutral_panel_declined_extra", "neutral_comparison_declined", "candidate_invalid"]) {
  check(`different or absent code ${String(code)} stays generic`, Object.assign(new Error("synthetic"), { code, issues: [issue] }), false);
}
for (const issues of [undefined, null, {}, "issues", [null], ["issue"], [{}], [{ ...issue, code: 3 }],
  [{ ...issue, message: null }], [{ ...issue, severity: "error" }], [{ ...issue, path: 3 }],
  [{ ...issue, entityIds: [3] }], [{ ...issue, residual: NaN }], new Array(1)]) {
  check("malformed issues never disguise a generic error", Object.assign(new Error("synthetic"), { code: "neutral_panel_declined", issues }), false);
}
let gettersRead = 0;
const accessorError = new Error("synthetic");
Object.defineProperty(accessorError, "code", { get: () => { gettersRead++; return "neutral_panel_declined"; } });
Object.defineProperty(accessorError, "issues", { value: [issue] });
check("recognition does not execute supplied accessors", accessorError, false);
const accessorIssue = { ...issue };
Object.defineProperty(accessorIssue, "message", { get: () => { gettersRead++; return "synthetic"; } });
check("issue accessors do not receive a typed grant", Object.assign(new Error("synthetic"), { code: "neutral_panel_declined", issues: [accessorIssue] }), false);
assert.equal(gettersRead, 0, "the pure predicate reads only data descriptors");
check("hostile descriptors are not an operational failure", new Proxy(new Error("synthetic"), {
  getOwnPropertyDescriptor() { throw new Error("synthetic descriptor failure"); },
}), false);
console.log(JSON.stringify({ gate: "visual-presentation-refusal/v1", scope: "typed error boundary only; no F2 acceptance", cases: checked, passed: checked, fixtureSha256 }));
