import {
  DRAW_COMMAND_TYPES,
  HEADER_ONLY_TEXT_TAG_EXACT,
  isCompleteDrawingTag,
  parseDrawingTag,
  parseDrawCommandFromTag,
  repairHeaderOnlyTextTags,
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
  /**
   * The stream opened `[WRITE]` (or LABEL / DIMENSION) with the body outside
   * the tag. The body runs to the end of the line and may contain "]", so the
   * usual terminators are suspended until the newline arrives.
   */
  private headerOnlyTextTag = false;
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
    if (this.headerOnlyTextTag) {
      this.closeHeaderOnlyTextTag();
    }

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

    if (this.headerOnlyTextTag) {
      if (char === '\n' || char === '\r') {
        this.closeHeaderOnlyTextTag(char);
        return;
      }
      this.tagBuffer += char;
      if (this.tagBuffer.length > MAX_TAG_BUFFER_LENGTH) {
        this.closeHeaderOnlyTextTag();
      }
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

    if (
      'STEP'.startsWith(upperInner) ||
      '/STEP'.startsWith(upperInner) ||
      upperInner.startsWith('STEP') ||
      upperInner.startsWith('/STEP')
    ) {
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

  /**
   * Close a `[WRITE]body,x,y` line.
   *
   * If the body ends in coordinates it becomes the row it was meant to be.
   * If it does not, the buffered text was never a row: the header is protocol
   * and is dropped rather than spoken, and everything after it goes back
   * through the parser, because a real tag can be sitting in there and
   * handing the whole buffer to the narration would read it out loud.
   */
  private closeHeaderOnlyTextTag(terminator = ''): void {
    const buffered = this.tagBuffer;
    const repaired = repairHeaderOnlyTextTags(buffered);
    const parsedTag = repaired === buffered ? null : parseDrawingTag(repaired.trim());
    this.tagBuffer = '';
    this.headerOnlyTextTag = false;
    this.state = 'NARRATION';

    if (parsedTag) {
      const narration = this.narrationBuffer.trim();
      const command = parseDrawCommandFromTag(
        parsedTag.type,
        parsedTag.rawParams,
        this.charPosition,
        narration,
      );
      this.emitSegment({ narration, command, commands: [command] });
      this.narrationBuffer = '';
      this.charPosition += buffered.length + terminator.length;
      return;
    }

    const headerLength = buffered.indexOf(']') + 1;
    this.charPosition += headerLength;
    for (const char of `${buffered.slice(headerLength)}${terminator}`) {
      this.processChar(char);
    }
  }

  private tryEmitCompleteTag(): void {
    const upperTag = this.tagBuffer.toUpperCase();
    if (upperTag === '[STEP]') {
      this.charPosition += this.tagBuffer.length;
      this.tagBuffer = '';
      this.state = 'NARRATION';
      return;
    }

    if (upperTag === '[/STEP]') {
      this.charPosition += this.tagBuffer.length;
      this.tagBuffer = '';
      this.state = 'NARRATION';
      this.emitTrailingNarration();
      return;
    }

    // `[WRITE]` closed after the name: the row text is outside the tag and
    // runs to the end of the line. Keep buffering it instead of emitting an
    // empty WRITE and speaking the coordinates.
    if (HEADER_ONLY_TEXT_TAG_EXACT.test(this.tagBuffer)) {
      this.headerOnlyTextTag = true;
      return;
    }

    // WRITE/LABEL text may itself contain closing brackets (for example an
    // evaluation bar). Keep buffering until the tag has its terminal x,y].
    if (!isCompleteDrawingTag(this.tagBuffer)) {
      return;
    }

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
