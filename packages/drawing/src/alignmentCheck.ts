import type { DrawCommandType } from './drawingProtocol';
import type { TutorSegment } from './drawingProtocol';
import { getSegmentCommands } from './drawingProtocol';

export interface SegmentAlignmentResult {
  aligned: boolean;
  reason?: string;
}

const ANNOTATION_TYPES: DrawCommandType[] = [
  'UNDERLINE',
  'CIRCLE_AROUND',
  'ARROW',
  'HIGHLIGHT',
  'SCRIBBLE',
];

const REVIEW_MODE_CUES = [
  'here',
  'this',
  'notice',
  'again',
  'underline',
  'circle',
  'arrow',
  'highlight',
  'emphasize',
  'remember',
  'look at',
  'that term',
  'that part',
  'this part',
  'this side',
  'variable',
  'unknown',
  'friction',
  'normal',
  'weight',
  'applied',
  'push',
  'pull',
  'opposes',
  'net force',
  'free body',
  'surface',
  'mg',
  'mu',
  'μ',
  'gravity',
  'tension',
  'upward',
  'downward',
  'horizontal',
  'vertical',
  'direction',
  'force',
  // jee math
  'slope',
  'tangent',
  'derivative',
  'integral',
  'focus',
  'directrix',
  'vertex',
  'eccentricity',
  'asymptote',
  'vector',
  'dot product',
  'cross product',
  'discriminant',
  // jee chemistry
  'equilibrium',
  'reaction',
  'oxidation',
  'reduction',
  'anode',
  'cathode',
  'electrode',
  'ligand',
  'hybridization',
  'functional group',
  'carbonyl',
  'mechanism',
  // jee optics & circuits
  'lens',
  'mirror',
  'focal',
  'ray',
  'circuit',
  'resistor',
  'capacitor',
  'inductor',
  'field line',
  'orbit',
  'energy level',
];

function isAnnotationCommand(type: DrawCommandType): boolean {
  return ANNOTATION_TYPES.includes(type);
}

function hasReviewModeCue(narration: string): boolean {
  return REVIEW_MODE_CUES.some((cue) => narration.includes(cue));
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
    keywords: ['parabola', 'ellipse', 'hyperbola', 'conic'],
    incompatible: ['DRAW_CUBE', 'DRAW_CUBOID'],
    label: 'conic section',
  },
  {
    keywords: ['projectile', 'trajectory', 'path'],
    incompatible: ['DRAW_CIRCLE', 'DRAW_CUBE', 'DRAW_CUBOID'],
    label: 'trajectory',
  },
  {
    keywords: ['circuit', 'resistor', 'capacitor', 'galvanic', 'wheatstone'],
    incompatible: ['DRAW_CIRCLE', 'DRAW_CUBE', 'DRAW_CUBOID'],
    label: 'circuit',
  },
  {
    keywords: ['lens', 'mirror', 'ray', 'refraction', 'optics'],
    incompatible: ['DRAW_CUBE', 'DRAW_CUBOID'],
    label: 'optics ray diagram',
  },
  {
    keywords: ['wave', 'wavelength', 'amplitude', 'sinusoidal'],
    incompatible: ['DRAW_CUBE', 'DRAW_CUBOID', 'DRAW_RECT'],
    label: 'wave',
  },
  {
    keywords: ['orbital', 'energy level', 'bohr', 'shell'],
    incompatible: ['DRAW_CUBE', 'DRAW_CUBOID'],
    label: 'energy level',
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
  const commands = getSegmentCommands(segment);
  if (commands.length === 0) {
    return { aligned: true };
  }

  const narration = segment.narration.toLowerCase();

  for (const cmd of commands) {
    if (cmd.type === 'WRITE' || cmd.type === 'LABEL') {
      continue;
    }

    if (isAnnotationCommand(cmd.type)) {
      if (hasReviewModeCue(narration)) {
        continue;
      }
      if (cmd.text && narration.includes(cmd.text.toLowerCase())) {
        continue;
      }
      return {
        aligned: false,
        reason: `annotation ${cmd.type} without review-mode cue in narration`,
      };
    }

    if (cmd.type === 'DRAW_LINE' && (narration.includes('radius') || narration.includes('force') || narration.includes('arrow'))) {
      continue;
    }

    if (cmd.type === 'DRAW_CIRCLE' && narration.includes('circle')) {
      continue;
    }

    const mismatch = hasHardMismatch(narration, cmd.type);
    if (mismatch) {
      return { aligned: false, reason: mismatch };
    }
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
