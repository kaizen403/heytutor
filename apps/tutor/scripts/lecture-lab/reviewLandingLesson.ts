/** Editorial review for the selected public recording; geometry is untouched. */
import { getSegmentCommands, type TutorSegment } from '@heytutor/drawing';
export function reviewLandingLesson(segments: TutorSegment[]): TutorSegment[] {
  return segments.map((segment) => {
    const commands = getSegmentCommands(segment);
    let narration = segment.narration;
    if (segment.delivery === 'opening') {
      narration = "For surface area, we'll assume the standard right square pyramid: its apex is directly above the centre of the base.";
    }
    if (commands.some((command) => command.type === 'WRITE' && command.text === 'TSA = 96 cm^2')) {
      narration = 'Under that assumption, the total surface area equals 96 square centimeters.';
    }
    if (narration === segment.narration) return segment;
    const reviewed = commands.map((command) => ({ ...command, narrationBefore: narration }));
    return { ...segment, narration, command: reviewed[0] ?? null, commands: reviewed };
  });
}
