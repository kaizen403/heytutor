import {
  DRAW_COMMAND_TYPES,
  parseDrawingTag,
  parseDrawCommandFromTag,
  type TutorSegment,
} from './drawingProtocol';

const MAX_TAG_BUFFER_LENGTH = 256;

type ParserState = 'NARRATION' | 'TAG_BUFFER';

export interface IncrementalTagParserOptions {
  onSegmentReady?: (segment: TutorSegment) => void;
}

export class IncrementalTagParser {
  private state: ParserState = 'NARRATION';
  private narrationBuffer = '';
  private tagBuffer = '';
  private charPosition = 0;
  onSegmentReady?: (segment: TutorSegment) => void;

  constructor(options: IncrementalTagParserOptions = {}) {
    this.onSegmentReady = options.onSegmentReady;
  }

  push(chunk: string): void {
    for (const char of chunk) {
      this.processChar(char);
    }
  }

  flush(): void {
    if (this.state === 'TAG_BUFFER') {
      this.narrationBuffer += this.tagBuffer;
      this.tagBuffer = '';
      this.state = 'NARRATION';
    }

    this.emitTrailingNarration();
  }

  private processChar(char: string): void {
    if (this.state === 'NARRATION') {
      if (char === '[') {
        this.tagBuffer = '[';
        this.state = 'TAG_BUFFER';
        return;
      }

      this.narrationBuffer += char;
      this.charPosition += 1;
      return;
    }

    this.tagBuffer += char;

    if (char === ']') {
      this.tryEmitCompleteTag();
      return;
    }

    if (this.tagBuffer.length > MAX_TAG_BUFFER_LENGTH || !this.couldBeTagPrefix()) {
      this.narrationBuffer += this.tagBuffer;
      this.charPosition += this.tagBuffer.length;
      this.tagBuffer = '';
      this.state = 'NARRATION';
    }
  }

  private couldBeTagPrefix(): boolean {
    const inner = this.tagBuffer.slice(1);
    const upperInner = inner.toUpperCase();

    if (inner.length === 0) {
      return true;
    }

    if ('DRAW:'.startsWith(upperInner) || upperInner.startsWith('DRAW:')) {
      return true;
    }

    if ('DRAW,'.startsWith(upperInner) || upperInner.startsWith('DRAW,')) {
      return true;
    }

    if (/^(LABEL|WRITE|DIMENSION),/i.test(inner) || 'LABEL,'.startsWith(upperInner) || 'WRITE,'.startsWith(upperInner) || 'DIMENSION,'.startsWith(upperInner)) {
      return true;
    }

    if (
      'DRAW_DOT'.startsWith(upperInner) ||
      'DRAW_POINT'.startsWith(upperInner) ||
      upperInner.startsWith('DRAW_DOT') ||
      upperInner.startsWith('DRAW_POINT')
    ) {
      return true;
    }

    for (const name of DRAW_COMMAND_TYPES) {
      if (name.startsWith(upperInner)) {
        return true;
      }

      if (upperInner.startsWith(name)) {
        const nextChar = upperInner[name.length];
        return nextChar === undefined || nextChar === ':';
      }
    }

    return false;
  }

  private tryEmitCompleteTag(): void {
    const parsedTag = parseDrawingTag(this.tagBuffer);

    if (!parsedTag) {
      this.narrationBuffer += this.tagBuffer;
      this.charPosition += this.tagBuffer.length;
      this.tagBuffer = '';
      this.state = 'NARRATION';
      return;
    }

    const narration = this.narrationBuffer.trim();
    const command = parseDrawCommandFromTag(
      parsedTag.type,
      parsedTag.rawParams,
      this.charPosition,
      narration,
    );

    if (!narration) {
      this.emitSegment({
        narration: "",
        command,
        commands: [command],
      });
      this.charPosition += this.tagBuffer.length;
      this.narrationBuffer = "";
      this.tagBuffer = "";
      this.state = "NARRATION";
      return;
    }

    this.emitSegment({
      narration,
      command,
      commands: [command],
    });

    this.charPosition += this.tagBuffer.length;
    this.narrationBuffer = '';
    this.tagBuffer = '';
    this.state = 'NARRATION';
  }

  private emitTrailingNarration(): void {
    const narration = this.narrationBuffer.trim();

    if (narration.length > 0) {
      this.emitSegment({ narration, command: null });
    }

    this.narrationBuffer = "";
  }

  private emitSegment(segment: TutorSegment): void {
    if (!segment.narration && !segment.command) {
      return;
    }

    this.onSegmentReady?.(segment);
  }
}
