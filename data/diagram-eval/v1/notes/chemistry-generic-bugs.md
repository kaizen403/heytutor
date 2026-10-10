# Chemistry generic bugs

These are shared pipeline failures. They are not defects of one chemistry topic, and this branch does not edit the shared files that own them.

## Stored scene labels never reach the restored board

Recorded in `docs/plans/diagram-topic-matrix/work-logs/C-08-kinetics-20261006.md` on `kaizen403/d622635b-chem-diagram` (`dd7570f8`).

A controlled fixture saved kinetics turns whose stored `sceneDocument` contained the required labels and family `chem_kinetics`. The restored paper did not show those labels. Persistence keeps LABEL ink only when the reveal cue names it. The no-key mock does not name it, so the saved segments keep the mock handwriting and drop the figure labels. Replay can still return to an enabled Replay control, which does not prove the labels were drawn.

Example: collision board `7f58c7b1-c975-47f1-bebe-2f69c2a7776a` showed circles for A and B and a threshold label. The scene document also contained `not all react`, `schematic`, and `orient`, and those three were absent from the paper.

Later controlled-provider turns named the labels in the narration cue, and those particular strings then appeared. The underlying rule is still in the shared reveal path. A scene document that is correct in storage is not evidence that the student page drew it.

## `scene_quantity_unverified` rejects a real scene label

Same log. Arrhenius board `ecb4796b-f766-4c7c-8c26-02d12c786f6f` drew `Ea=79.5 kJ/mol`, `basis ln`, and `slope=-Ea/R`. `POST /turns` returned 400 `scene_quantity_unverified` for T2 against an empty mock plan, so the turn was not stored.

The check treats a quantity the scene computed as unverified when the supplied plan does not list it. A blank mock plan therefore blocks save of a figure whose numbers came from the engine. This is not fixed by changing the Arrhenius arithmetic.
