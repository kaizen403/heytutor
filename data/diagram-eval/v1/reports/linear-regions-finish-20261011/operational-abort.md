# Final amended replacement: operational abort

Source/runtime `689338462ae3` and the original 212-example library stayed frozen. Final registration SHA256 `83705d87db5744000e2aba2ac975cc0fb256b3416d3c070194f1b98784e68491`.

The first saved row completed at 2026-10-11T17:31:11.506110Z. The request lease was consumed before owned server/client cleanup. Subsequent settlement waiting received several stable Azure samples, ending at 17:34:31.589946Z before a `metric_read_failed` / `ValueError` watcher event. At 17:36:10.994997Z the controller emitted terminal `Metrics unreadable, stale or mismatched`; the available abort record does not distinguish all three alternatives. The watcher recovered at 17:36:24.485564Z. No subsequent paid request started.

The controller preserved its registered fail-closed budget behavior. Its previous control tests exercised missing/stable observations and invalid data, but they did not make an intermittent external Azure Monitor failure harmless. Later recovered samples were used only for final spend settlement. No control or runtime source was edited after this paid failure, and no further paid replacement was attempted.

The final eight-observation settlement is $15.520774 cumulative Azure token estimate, including $0.063714 after the prior $15.457060 floor. This is below the $20 cap and is not an invoice. Original response estimates overlap with Azure and are not summed. Native agent billing is unavailable. All owned processes/ports were verified stopped/free.

The incomplete one-row replacement and original 15-row prefix are excluded from all visual grades. The fixed seven-cell secondary report has 200 outcomes, 120 newly generated complete outcomes and 80 reused historical MAIN outcomes. Development candidate repeat 2 and its paired deltas/pass remain null; ready and PR eligibility are false. Quality was still sealed when this operational note was written.

A future independently registered measurement should exercise transient metric errors and stale samples during actual between-row settlement, while forbidding dispatch until financial provenance is fresh. That is a future control design recommendation, not an amendment or retry of this failed protocol.
