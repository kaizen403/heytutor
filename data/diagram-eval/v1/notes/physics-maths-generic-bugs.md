# Generic diagram bugs found during Physics evaluation

## Refraction angle mark can compile but render the supplementary angle

- Reproduction question: `Light enters glass at 35 degrees from air with refractive index 1.6. Find the refraction angle and show the incident and refracted rays.`
- Inputs: `theta_i = 35 degree`, `n_2 = 1.6`, law `snell_law`, using the `interface` and `ray_path` families.
- Result on engine commit `ed197b9a`: `validateSceneDocument` succeeds and `compileSceneDocument` reports no fatal issue. The scene labels the refracted angle `r=21°`, but `primitive_angle_r` has arc endpoints spanning `158.99279945820592°` rather than the acute refracted angle.
- Presentation path: `apps/tutor/features/tutor-session/lib/scene/verifiedScenePresentation.ts` forwards the compiled arc start and end angles unchanged to the board `DRAW_ARC` command.
- Impact: a structurally accepted scene can place a quantitatively wrong angle mark on the board.
- Evaluation-set workaround: no refraction exemplar is exported until the generic arc-orientation bug is fixed and independently requalified.

## Optical-train rays can bend in free space and the presenter drops the bend

- Reproduction question: `Draw the ray diagram of a compound microscope with its objective, intermediate image, eyepiece, and final emerging rays.`
- Result on engine commit `79f21124`: the validated `optical_train` scene contains multi-point rays whose incoming segments do not originate at the object and whose internal segments bend at the intermediate image in free space before returning to their original side.
- Presentation path: `apps/tutor/features/tutor-session/lib/scene/verifiedScenePresentation.ts` converts a compiled `ray` from its first and last points, dropping the middle point that expressed the bend.
- Impact: validation and compilation can accept a physically incorrect microscope ray construction, while presentation changes that construction again instead of preserving it.
- Evaluation-set workaround: the microscope exemplar was removed. No optical-instrument exemplar is exported until both ray construction and multi-point presentation are fixed and independently requalified.

## Small-angle pendulum synthesis invents a 25-degree amplitude

- Reproduction question: `A simple pendulum makes small-angle oscillations. Show the pivot, string, bob, vertical equilibrium line, and a displaced position used to discuss its period.`
- Result on engine commit `79f21124`: the validated pendulum scene and narration metadata introduce a `25°` displacement even though the question supplies no amplitude and asks for the small-angle model.
- Impact: an accepted scene adds an unsupported, non-small numerical condition to a qualitative question.
- Evaluation-set workaround: the pendulum exemplar was removed until the family uses a source-supplied angle or a symbolic small displacement.

## Screw-gauge labels and parts can be spatially disconnected

- Reproduction question: `Draw a labelled diagram of a screw gauge with pitch 1 mm and 50 circular scale divisions.`
- Result on engine commit `ab46da7a`: validation and compilation succeed, but the rendered `ratchet` label lies entirely inside the thimble instead of the ratchet, without a leader. The sleeve and thimble are also separated by about 57 rendered pixels despite no exploded-view qualification.
- Impact: a structurally accepted apparatus scene misidentifies one part and presents a disconnected mechanism.
- Evaluation-set workaround: the screw-gauge candidate was removed; the independently qualified vernier-calliper scene supplies the apparatus exemplar instead.
