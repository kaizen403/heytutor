# Independent orbit/interface numeric prerequisite review — HEY-83

HEY-83 reviewed the frozen submitted modules and independently reran their gates plus direct public-seam controls. These are bounded numeric prerequisites only; no real source cohort, scene integration, S3, topic, live, persistence or saved-replay acceptance follows. No submission/shared code was edited by the reviewer.

## Orbit scalar snapshot

HEY-85 isolated worktree source `physics/bohrOrbitAuthority.ts` SHA256 `77e95be2c8b033ea5edc9b22f78a696a5c6274e02a5785c91680c946b2eb0801`; gate `verify-bohr-orbit-authority-hey85.ts` SHA256 `86d32e261abcc9e2513a26d18da3c2daf286a52df96e761fbe2c597ceb3a3165`. Independent rerun exited 0: **640 level/Z tuples, 10,240 unit/calibration inputs, 143,486 core checks**, then **257 prelisted synthetic tuples, 4,112 inputs, 57,568 checks**, seed 20261003. This is not an exam cohort.

Code review confirms own required model/electron/Z/n/source-scale/unit/convention fields, distinct radius/speed calibration conventions, positive normal finite source/canonical outputs, ordered scaling n²/Z or n² and Z/n or 1/n, frozen scalar output and the approved 0.1c bound on supplied, implied-ion ground and selected canonical speed. High n cannot hide an unsupported ground speed.

Independent direct probe uses He+ Z=2/n=3: hydrogen-reference radius 0.0529 nm and speed 2180 km/s give radius **0.23805 nm / 2.3805e-10 m** and speed **4.36e6/3 m/s**; actual-ion ground radius 0.02645 nm and speed 4360 km/s agree. Equivalent m/m-per-second source units agree. Missing radius convention, wrong-case units and a Z=10/n=64 ground-speed input that would hide excessive implied speed reject. No new numeric defect was demonstrated within this scaling contract. This does not prove a complete orbit/energy/momentum model or caller source calibration.

## Planar interface snapshot

HEY-89 isolated packet source `/Users/kaizen/.capy/work/HEY-89/packet-01/packages/scene-engine/src/physics/planarInterfaceAuthority.ts` SHA256 `88f65397ade4711651a9a65d27e46161596395c27b55835e4fdc7752e39aead2`; owned gate SHA256 `244f03a85d5533e3a4f785ba18786b235dbc5bb21e75d1fcfd4d232211f9e99a`. Independent gate rerun exited 0: **5,386 checks and 257 prelisted synthetic holdouts**. Four CH10a associations are partial prerequisites, not four completed topics.

Source review confirms a single declared coordinate frame, explicit ordered/distinct media and indices, own data descriptors copied into a null-prototype record, explicit finite own vector components, declared 64-epsilon unit tolerance, propagated branch error, no normal/index swapping, and named critical/grazing/numerical declines. Output vectors are detached frozen copies; no intensity/Fresnel/visibility claims are made.

Direct independent controls confirm nBefore=1/nAfter=1.5 with incident (0.6,0.8), normal (0,1): transmitted (0.4,sqrt(0.84)), reflected (0.6,-0.8). Reverse propagation recovers (-0.6,-0.8). A dense-to-rare 0.8 tangential component yields TIR with null transmission. Wrong signed normal rejects as incompatible approach, an exact critical example declines as unresolved, accessor fields are rejected without executing their getter, sparse vector input rejects, mutation of an output vector fails, and subsequent mutation of the input does not alter captured provenance.

## Evidence/disposition

Direct combined probe: `/Users/kaizen/.capy/work/diagram-topic-matrix/audits/orbit-interface-public-review.mts`, with adjacent JSON/log; invocation from actual main using `pnpm --filter @heytutor/scene-engine exec tsx <probe>` exited 0. No new public-seam numeric defect was demonstrated in either declared bounded contract. HEY-88 may review/copy those frozen snapshots serially, but caller source ownership, usable scene registration, source/render/cohort completeness and lifecycle remain separate integration gates.
