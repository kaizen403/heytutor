import type { DrawCommandType } from './drawingProtocol';
import type { TutorSegment } from './drawingProtocol';

export interface SegmentAlignmentResult {
  aligned: boolean;
  reason?: string;
}

const HARD_MISMATCHES: Array<{
  keywords: string[];
  incompatible: DrawCommandType[];
  label: string;
}> = [
  {
    keywords: ['circle', 'radius', 'circumference'],
    incompatible: ['DRAW_LINE', 'DRAW_RECT', 'DRAW_CUBE', 'DRAW_CUBOID'],
    label: 'circle',
  },
  {
    keywords: ['line', 'segment', 'hypotenuse', 'perpendicular'],
    incompatible: ['DRAW_CIRCLE', 'DRAW_CUBE', 'DRAW_CUBOID'],
    label: 'line',
  },
  {
    keywords: ['rectangle', 'rect'],
    incompatible: ['DRAW_CIRCLE', 'DRAW_LINE', 'DRAW_CUBE'],
    label: 'rectangle',
  },
  {
    keywords: ['cube'],
    incompatible: ['DRAW_CIRCLE', 'DRAW_LINE', 'DRAW_RECT', 'DRAW_CUBOID'],
    label: 'cube',
  },
  {
    keywords: ['cuboid', 'prism'],
    incompatible: ['DRAW_CIRCLE', 'DRAW_LINE', 'DRAW_CUBE'],
    label: 'cuboid',
  },
];

function hasHardMismatch(narration: string, commandType: DrawCommandType): string | null {
  for (const rule of HARD_MISMATCHES) {
    const mentionsConcept = rule.keywords.some((keyword) => narration.includes(keyword));
    if (mentionsConcept && rule.incompatible.includes(commandType)) {
      return `narration mentions ${rule.label} but command is ${commandType}`;
    }
  }

  return null;
}

export function checkSegmentAlignment(segment: TutorSegment): SegmentAlignmentResult {
  if (!segment.command) {
    return { aligned: true };
  }

  const narration = segment.narration.toLowerCase();
  const cmd = segment.command;

  if (cmd.type === 'WRITE' || cmd.type === 'LABEL') {
    return { aligned: true };
  }

  if (cmd.type === 'DRAW_LINE' && narration.includes('radius')) {
    return { aligned: true };
  }

  if (cmd.type === 'DRAW_CIRCLE' && narration.includes('circle')) {
    return { aligned: true };
  }

  const mismatch = hasHardMismatch(narration, cmd.type);
  if (mismatch) {
    return { aligned: false, reason: mismatch };
  }

  return { aligned: true };
}

export function filterAlignedSegments(segments: TutorSegment[]): TutorSegment[] {
  return segments.filter((segment) => {
    const result = checkSegmentAlignment(segment);
    if (!result.aligned) {
      console.warn('[alignment]', result.reason, segment.narration.slice(0, 80));
      return segment.command === null;
    }
    return true;
  });
}
