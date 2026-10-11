# Regions compatibility with current main

Regions PR #156 remains ready for review. Current main `0fb7f0b5` was merged locally into `feat/linear-regions-review` at `bd0e6d34`, without rebase or force push. Its sole compiler conflict preserves main’s planned 3D line extents and the regions claim validation; neither authority boundary is discarded.

A free replay builds the frozen measured `2c81544f` and the merged branch independently, then compiles all 60 unchanged original-source region documents. All 60 source documents and all 60 renderScene outcomes are identical (including both unsupported outcomes). The complete case hashes are in `data/diagram-eval/v1/reports/linear-regions-repair-20261012/main-update-region-replay.json`. This is source-native document/render equivalence, not replay of original production scheduling or new image grading. Root opened no images.

Scene-engine build and typecheck, full `verify:linear`, space-view’s 31 gates, 3D/Argand verification, and tutor’s 73+53 region-contract checks pass after the merge. This compatibility work adds zero provider calls. The measured source and complete repair-run grades remain frozen, and new-job Azure spend remains $5.864639 estimated ($6.038058 uncached ceiling), against $20. No PR merge or production change. Accepted topic counts unchanged.
