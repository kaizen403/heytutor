/** Editorial corrections for this public recording; verified geometry is untouched.
 * The unsigned u/v convention is retained, and signed magnification is explicit.
 */
import { getSegmentCommands, type TutorSegment } from '@heytutor/drawing';
export function reviewLandingLesson(segments: TutorSegment[]): TutorSegment[] {
  return segments.map((segment) => {
    const commands = getSegmentCommands(segment).map((command) => ({ ...command }));
    let narration = segment.narration;
    if (narration.includes('O is the object standing')) {
      narration = 'A is the foot of the upright object on the principal axis. L is the convex lens, and O marks its optical centre.';
      commands.splice(0, commands.length,
        { type: 'FOCUS', text: 'object', params: [], charPosition: 0, narrationBefore: narration, syncable: false },
        { type: 'FOCUS', text: 'lens', params: [], charPosition: 0, narrationBefore: narration, syncable: false },
        { type: 'FOCUS', text: 'O', params: [], charPosition: 0, narrationBefore: narration, syncable: false });
    }
    if (narration.includes('magnification m equals v over u')) {
      narration = 'For these positive distance magnitudes, signed magnification m equals minus v over u. The minus sign means the image is inverted.';
      for (const command of commands) if (command.type === 'WRITE') command.text = 'm = -v/u';
    }
    if (commands.some((command) => command.text === 'm = 15/30 = 1/2')) {
      narration = 'Substitute the distances. m equals minus fifteen over thirty, which is minus one half.';
      for (const command of commands) if (command.type === 'WRITE') command.text = 'm = -15/30 = -1/2';
    }
    if (commands.some((command) => command.text === 'h_i = m × h_o = (1/2)(3)')) {
      narration = 'The signed image height equals m times the object height. That is minus one half times three centimeters.';
      for (const command of commands) if (command.type === 'WRITE') command.text = 'h_i = m × h_o = (-1/2)(3)';
    }
    if (commands.some((command) => command.text === 'h_i = 1.5 cm')) {
      narration = 'The signed image height is minus one point five centimeters. The image is one point five centimeters tall and points downward.';
      for (const command of commands) if (command.type === 'WRITE') command.text = 'h_i = -1.5 cm';
    }
    if (narration.includes('it sits between F prime and the lens')) {
      narration = 'A prime marks the foot of the image. The image forms fifteen centimeters beyond the lens, between F prime and twice the focal length.';
    }
    if (narration.includes('m is positive but less than one')) {
      narration = 'The rays meet beyond the lens, so the image is real. Negative magnification means it is inverted. Its height is half the object height, so it is smaller.';
    }
    if (narration !== segment.narration) {
      for (const command of commands) command.narrationBefore = narration;
    }
    return { ...segment, narration, command: commands[0] ?? null, commands };
  });
}
