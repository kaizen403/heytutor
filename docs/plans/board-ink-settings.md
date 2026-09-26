# Board ink controls

## Goal

Let students choose marker and pencil color and thickness in board settings. Make ordinary handwritten work rows slightly smaller by default.

## Design

- Keep the existing marker color setting and palette. Add a separate pencil color from the same palette and independent thickness scales.
- Preserve the old pencil tint for accounts that have not chosen a pencil color by initializing it from their marker color.
- Apply choices to new marks, the visible instruments, replay boards, and exports. Existing marks keep their recorded appearance.
- Change the shared work-row type scale, leaving scene geometry under scene-engine authority.

## Tasks

1. Persist and validate new settings in the account row, API mapper, and local cache. Verify defaults and legacy data.
2. Apply independent ink styles to the whiteboard and pass settings through all board instances. Verify drawn paths and scene line cleanup.
3. Add accessible color and thickness controls to the lesson drawer and account board settings. Check narrow layouts.
4. Reduce default work-row sizes and run drawing, whiteboard, tutor, lint, and build checks.

## Risk

Scene line cleanup currently identifies pencil strokes by a fixed width. It must identify eligible scene paths without depending on the student's thickness choice.
