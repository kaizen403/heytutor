# Independent DCP05 numeric/source audit — HEY-83

Audit date: 2026-10-02 UTC. HEY-88 is the sole implementation/integration owner. HEY-83 performed read-only gate/source/public-seam checks on `/Users/kaizen/heytutor`; only this uniquely owned receipt and external scratch evidence were written. No shared source, owner log, worker submission, ledger or counter was changed. This does not accept S1, a circuit source cohort, any topic, a scene or lifecycle behavior.

## Provenance and independent gate execution

The owner first reported source/gate hashes `72d925b88e7129117155b14dc746251cb0c3a1681feae4bd0637a0df1985d64d` / `2c05e919caacbcbdfa0ead67cf49dbdd17fec8f7371a849c3800b79b77b81082`. Source advanced serially during this review: the owner added own-field/prototype guards, source-grounded bound-voltage references and planner transport refinements. Those first hashes are historical, not this review's final artifact identities.

Independently ran `PATH=/opt/homebrew/bin:$PATH pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-dcp05-circuit-network.ts` from actual main. Exit 0; the 12 V / 6 ohm oracle and unbalanced/zero bridge, signed/current sources, wire/open, SI prefixes, reference/permutation, 9 source mutations and 40 synthetic series holdout cases passed. Atomic invalid case published zero values. Source/gate hashes at both ends of that run matched `3a0988401f5df5dd37c10fa42dfe4f549de2900d4cc794d2ecf00f781a8743b3` / `c4cb8c7018bb9d33d3fad94d7dd069c796090a7480281bddfb79a112ab2f5168`. No exam/source holdout, full network-domain exhaustiveness or lifecycle behavior is implied.

The independent public-seam probe used a later stable-during-probe checkpoint:

| File under packages/scene-engine | SHA256 |
| --- | --- |
| src/ir/circuitNetwork.ts | dc57ba32ea096d196c359af765ba87979880d87d7c6e6284b765007df25013cb |
| src/ir/problemIR.ts | de33a5dcf76cb97930be2d022c74196670d3a5b1556036ac92430eb788f5b03d |
| src/ir/solver.ts | 2567d04e8c494f3d6e162220302b024ce953a525a888f90026603c8a1f2e3a86 |
| scripts/verify/verify-dcp05-circuit-network.ts | 4526f892e8da015ef22871280ba3f27f131ffc766450355b859477f02c63b559 |

Scratch: `/Users/kaizen/.capy/work/diagram-topic-matrix/audits/dcp05-public-seam-review.mts`; adjacent JSON records the hashes, literal question, structural validation, values and proofs. Hashes are checked before and after the probe. The plain probe exited 0 with the false-certification evidence below. With `--assert-source-fail-closed`, it deliberately exited 1 at the source-binding assertion; output is retained in `dcp05-source-binding-red.log`. This is a deterministic red-capable regression, not an infrastructure failure.

## High finding — matching names does not bind the source connectivity relation

Literal question used by the probe:

> ideal DC. Nodes A B C. V(B)=0 V. S connects A to B. V(A)-V(B)=12 V. R connects A to C, not B. R=6 ohm. T connects C to B. T=6 ohm

R and T are series 6-ohm resistors across 12 V, so independently I_R=12/(6+6)=**1 A** and V_C=**6 V**. The source-correct typed topology produced those values.

The probe then changes only R's supplied network endpoint from C to B and the associated `connected` constraint's entity IDs from `[R,A,C]` to `[R,A,B]`. The exact source question, source span and quote **“R connects A to C, not B”** remain unchanged. At the checkpoint above:

- `validateProblemIR` returns `valid: true` with no issues, despite the wrong endpoint's explicit source contradiction.
- `LocalDeterministicSolverProvider.solve` returns `solved`, exact integer **2 A**, approximation 2, errorBound 0 and a verified `exact_network_kcl_kvl` proof with residual/tolerance 0.
- `validateSolverResult` independently recomputes the same wrong topology and returns `valid: true` with no issues. Forging the scalar to 99 A or replacing the proof method with `exact_arithmetic` correctly rejects.

The defect is source/topology binding, not arithmetic or numerical-result comparison. `validateDcNetwork` checks a connected constraint's entity IDs and concatenates its evidence quotes, then splits those quotes into tokens and requires the component and endpoint names to occur. The counterexample contains R, A and B, so it passes even though the quoted relation explicitly says the connection is to C, not B. Exact KCL/KVL and power conservation verify the supplied graph; they cannot make that graph source-correct.

Owner fix scope: require a positively bound supported connection relation and unambiguous entity-owner mapping, or honestly decline unsupported wording. Do not patch this with only a negation blacklist or more name-membership checks. The component's constitutive law supplies R=6 ohm but does not prove its endpoints. Add this wrong-graph case at the full ProblemIR→local-solver→result-validator seam and keep the correct graph/negative/source-span cases. Unsupported source language remains a visible limitation, not text-only success or accepted coverage.

## Disposition

The high finding, exact current hashes, red command and captured evidence were sent to HEY-88 before this receipt. The foundation remains **source-binding verification pending at this reviewed checkpoint**. The owner is refining files serially; a correction needs fresh stable hashes and rerun independent review, including planner transport at its final version. No obsolete hash is treated as the final submission.

Code review confirms bounded exact rational modified nodal arithmetic with explicit voltage/current-source orientation, positivity for resistance, zero/open laws, finite SI magnitude bounds, rank/incompatibility rejection, and exact KCL/signed-power substitution. That is useful deterministic numeric evidence, not complete DCP05 mechanics, full S1, scene-source authority, source-cohort completeness, readable labels, live reveal, saved-turn persistence or saved-turn replay.

## Remediation checkpoint — original membership counterexample closed

HEY-88 submitted source SHA256 `3beea820bc33c932779a7707fa00bc9a66ca9e3258a7641092909d494ac0d078` and gate SHA256 `9dc51fa7631f0fcb8b5f65b6b79e3135326b71ed271ce0a1c156513d0eda6afd`. HEY-83 read the changed connection checks and gate additions, checked both hashes before and after the dedicated gate, and independently reran it: exit 0; the reported numeric oracles, 9 mutations and 40 synthetic holdout cases still pass.

The validator no longer joins evidence quotes and checks token membership. Each cited connection quote must exactly match a supported positive relation for the component and both endpoints, allowing either endpoint order and a matching optional component-type prefix. Distinct physical nodes and distinct components cannot reuse the same source name. Whole composite connection quotes are explicitly unsupported and decline; they are not accepted, text-only, excluded or removed from a topic denominator.

Independent remediation probe: `/Users/kaizen/.capy/work/diagram-topic-matrix/audits/dcp05-remediation-public-seam-review.mts`, with adjacent JSON/log. This is separate from the preserved original failing probe and evidence. It checks source, ProblemIR, solver and gate hashes before/after execution. At this checkpoint:

- With the **same complete original question**, the positive `R connects A to C` witness taken from its actual clause and the correct typed graph give exact **1 A** and V_C=**6 V**, with valid IR and solved/result-valid status.
- The original wrong R=A-B graph with the whole “R connects A to C, not B” quote rejects as `source_topology_mismatch`; so does the wrong graph with the positive A-C witness. Both produce invalid IR, failed local status and **zero values/proofs**.
- A correct graph using the whole unsupported composite witness also declines, rather than receiving authority. This is a bounded witness-grammar limit; the positive source clause remains usable without altering or excluding the question.
- Duplicate node source names reject as `ambiguous_network_owner`. The old forged exact-2-A result rejects against the source-invalid wrong graph.

**The original name-membership false-certification case is remediated at this checkpoint.** A valid failed-result envelope does not represent a numeric authority; the result validator can correctly accept the format of a failed result with no values/proofs. This narrow remediation does not establish complete affirmative source-assertion binding, as the next independently reproduced case demonstrates.

## Remaining high source-context finding — a positive-looking fragment can belong to an explicitly false assertion

Using the same original question and unchanged physical series R/T network, append:

> The statement 'R connects A to B' is false

The probe cites only the exact contiguous fragment `R connects A to B` from that sentence as a `given` fact and supplies the wrong R=A-B graph/constraint. The earlier source still explicitly says actual R=A-C, not B; the appended sentence also explicitly calls the alternative false. However the fragment exactly matches the new connection grammar:

- ProblemIR is valid with no issues.
- The local solver returns **solved, exact 2 A**, errorBound 0, verified `exact_network_kcl_kvl`, residual/tolerance 0; the actual source series current remains **1 A**.
- Result validation returns valid with no issues.

This proves that exact positive-phrase matching is not affirmative assertion-level source extraction. A `given` tag plus an addressable substring does not make a proposition supplied as true by the question. The current boundary accepts this unsupported surrounding false-statement context instead of declining it.

The remediation probe's `--assert-affirmative-source-context` mode was independently executed and exited **1** at “A fragment explicitly described as false in the source cannot certify the wrong graph.” Output: `/Users/kaizen/.capy/work/diagram-topic-matrix/audits/dcp05-affirmative-source-context-red.log`. This is a deterministic red test, not an infrastructure failure. The original case's repair and this remaining case coexist at the same hashes.

The remaining finding and exact reproduction were sent to HEY-88 with a request to re-evaluate the source boundary rather than add another name/phrase/negation blacklist. Require a trusted bounded assertion-level extractor or a complete supported-clause witness that rejects unsupported quotation/discourse context. Alternatively keep this explicitly a pure supplied-network numeric module, with source-readiness blocked until that prerequisite is independently proved. This is not a request for a general English parser, and no numeric arithmetic defect is asserted.

**Overall source-binding readiness remains verification pending.** Original evidence is preserved, remediation is recorded, and the remaining assertion-context counterexample is visible. No S1, source cohort, topic, render, live, persistence or saved-replay acceptance follows from these checks.

## Final bounded assertion-grammar recheck — both reported counterexamples closed

The sole integrator replaced fragment trust with a completely consumed supported assertion document. Reviewed source SHA256 `379fa18f402e482c17dfeb58fff81c6837ad6dcb7a675e707c26085c2b05da8c`; original numeric gate remains `9dc51fa7631f0fcb8b5f65b6b79e3135326b71ed271ce0a1c156513d0eda6afd`. The parser records assertion spans and positive spans, reconciles the complete declared node set and every named connection/law, associates oriented laws with actual source components, and declines unsupported surrounding text. This is a bounded source language, not a general English parser or an accepted source cohort.

HEY-83 independently read the grammar/closure checks and ran both new gates with identical hashes before/after execution:

- `verify-dcp05-source-context.ts`, SHA256 `61817a8a31e8ab9a86b94aecb8f87be971ae105f4758c93c1c4867c1f0f726c5`: exit 0; correct source series **1 A**, V_C=**6 V**, **24 full-pipeline atomic negative contexts**.
- `packages/tutor-core/scripts/verify/verify-dcp05-network-source-context.ts`, SHA256 `b36b6d885ec60c0af0f5124207690e72ca96d80c17bf08db56c5f4024c84ed8a`: exit 0; positive **2 A** projection and **6 unsupported-context declines** through mocked planner transport. This is not live LLM/scene evidence.

The independent regression was copied to `dcp05-final-source-context-review.mts` with only its output destination changed, preserving all earlier probes/JSON/red logs. Its `--assert-affirmative-source-context` mode now exits **0** against source `379fa18f…`: the original literal positive-clause graph still yields 1 A/6 V; original wrong graph, wrong graph with positive witness, unsupported whole composite and duplicate node alias all yield invalid IR/failed/zero values/proofs; the formerly accepted false-quotation fragment now yields `unsupported_source_context`, invalid IR/failed/zero values/proofs. The forged old exact-2-A authority also rejects. Captured final JSON/log are adjacent to that new probe, outside the repository.

**Both reported source-topology/assertion-context findings are resolved at this exact bounded numeric/grammar snapshot.** The historical failures remain documented above. This does not accept full S1/contact mechanics, general source language, a frozen real cohort, shared scene/source bindings, live reveal, storage or saved replay. New gaps at other boundaries are separate findings rather than a reason to erase this remediation.
