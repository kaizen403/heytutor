# Final local Fireworks circuit measurement — 18 October 2026

This is a failed, budget-interrupted measurement, not chapter certification.
The user separately approved a $2 cap. No earlier budget was reused.

## Frozen questions and oracles

| Synthetic case | Independent expected result |
| --- | --- |
| 15 V source, series 2/3/5 ohm resistors, series ammeter, voltmeter across 5 ohm | 10 ohm total; 1.5 A; 7.5 V |
| 24 V source, 4 ohm series with parallel (6+6) and 12 ohm paths | 10 ohm total; 2.4 A supply; 1.2 A per branch |
| 12 V source with parallel 8/24 ohm, shared switch and ammeter | Closed: 6 ohm, 2 A total, 1.5/0.5 A branches; open: 0 A |

## Execution and limits

Local production build, synthetic Auth.js session and local Postgres; Kimi K3
Fast; strict planner arm; concurrency 1; conservative pre-dispatch cost cap.
No TTS, browser playback, persistence, production writes or deployments.
The gateway visual-need key was absent and the service reported `missing_key`;
this does not establish parity with that production assessment.

The stock runner's Azure-only preflight rejected Fireworks before any calls.
An ignored local copy changed provider/model preflight and import paths only;
original pipeline and cost accounting remained intact. Its returned-model
allowlist was Kimi K3 Fast and the existing standard Kimi K3 fallback. This is
not a permanent change to the lab runner.

Only the first case reached planning. Its turn plan and deterministic solver
produced the correct numeric answers. Four completed scene candidates failed:
missing solved quantities, invalid loop/degree/path-count assertions, coincident
distinct terminals, broken loops and self-loop wires. One initial candidate also
placed a voltmeter over a resistor. None was admitted. The planning deadline
elapsed; the next teaching request could not fit its worst-case reservation and
was denied before dispatch. Cases 2 and 3 were not run. There is no admitted
paid-run diagram to visually certify and no teaching/audio result.

The captured capabilities also revealed an engine defect: component inventory
size was incorrectly treated as proof of a two-loop graph. For this one-source
series circuit it instructed the model to draw both sources and a shared branch.
That deterministic inference is addressed separately in this change; the model
was not rerun after that fix, and the failure cannot be attributed solely to it.

## Accounting

- Token-priced recorded usage: **$0.354952**.
- Four unmetered attempts retain **$0.820324** conservative allowance.
- Total accounted against the cap: **$1.175276**, below **$2.00**.
- The allowance is not measured spend; provider billing was not reconciled.
- No further paid calls were made. The local server and task-started database
  container were stopped afterward.

Ignored evidence: `.context/circuit-incident-2026-10-18/paid/`, frozen
`questions.txt` and `oracles.json`. All inputs here are agent-authored synthetic
questions. Production text and identifiers are absent from this work log.

**No accepted-topic counts changed.** Free geometry and repair regressions prove
bounded implementation behavior; they do not turn this measurement into a pass
or establish that arbitrary circuit questions will always draw correctly.
