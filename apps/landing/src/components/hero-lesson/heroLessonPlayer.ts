/** A recorded, verified lesson driven by the live tutor's ink and speech clock. */
import { getSegmentCommands, type DrawCommand } from '@heytutor/drawing'
import type { CursorState, WhiteboardHandle } from '@heytutor/whiteboard'
import { drawSegmentInk, planSegmentInk } from '../../../../tutor/features/tutor-session/lib/turn/segmentInk'
import type { ExecuteCommandOptions } from '../../../../tutor/features/tutor-session/hooks/turn/types'
import { CLEAR_DURATION, HOLD_DURATION, HERO_SEGMENTS, VERIFIED_DIAGRAM, teachStart, type LessonTiming } from './lessonScript'

export interface HeroPlayerControls {
  getAudioPositionMs: () => number
  getMonotonicMs: () => number
  isPaused: () => boolean
  isCancelled: () => boolean
  setCursorState: (state: CursorState) => void
}
export interface HeroInk {
  executeCommand: (command: DrawCommand, options?: ExecuteCommandOptions) => Promise<void>
  reset: (diagram: typeof VERIFIED_DIAGRAM) => void
}
const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 16))

export async function runHeroLessonLoop(
  board: WhiteboardHandle,
  timing: LessonTiming,
  c: HeroPlayerControls,
  ink: HeroInk,
  segments = HERO_SEGMENTS,
): Promise<void> {
  const teachMs = teachStart() * 1000
  const totalMs = timing.total * 1000
  const loopMs = teachMs + totalMs + (HOLD_DURATION + CLEAR_DURATION) * 1000
  const ok = () => !c.isCancelled()
  while (ok()) {
    const loopStart = c.getMonotonicMs()
    const at = async (offsetMs: number) => {
      while (ok() && (c.isPaused() || c.getMonotonicMs() - loopStart < offsetMs)) await delay()
      return ok()
    }
    ink.reset(VERIFIED_DIAGRAM)
    c.setCursorState('thinking')
    if (!(await at(teachMs))) return
    c.setCursorState('speaking')
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]
      const startMs = timing.starts[index] * 1000
      const endMs = (timing.starts[index + 1] ?? timing.total) * 1000
      if (!(await at(teachMs + startMs))) return
      const commands = getSegmentCommands(segment)
      const segmentClock = () => Math.max(0, c.getAudioPositionMs() - startMs)
      await drawSegmentInk({
        plan: planSegmentInk({ commands, verifiedDiagramIntro: segment.verifiedDiagramIntro, hasNarration: Boolean(segment.narration) }),
        verifiedDiagramIntro: segment.verifiedDiagramIntro,
        clock: {
          narration: segment.narration,
          getTimings: () => segment.timings ?? null,
          totalSpeechMs: endMs - startMs,
          estimatedSpeechMs: endMs - startMs,
          getAudioPositionMs: segmentClock,
          getPlaybackRate: () => 1,
          isPaused: c.isPaused,
          nowMs: c.getMonotonicMs,
          isSpeechComplete: () => segmentClock() >= endMs - startMs,
        },
        getDiagram: () => VERIFIED_DIAGRAM,
        isCancelled: c.isCancelled,
        waitWhilePaused: async () => { while (ok() && c.isPaused()) await delay(); return ok() },
        execute: ink.executeCommand,
        commandOptions: () => ({ applyLayout: !segment.verifiedDiagramIntro, trustedDiagramGeometry: segment.verifiedDiagramIntro, isCancelled: c.isCancelled }),
      })
      if (!ok()) return
    }
    c.setCursorState('idle')
    if (!(await at(teachMs + totalMs + HOLD_DURATION * 1000))) return
    c.setCursorState('erasing')
    await board.clearBoard(900)
    if (!(await at(loopMs))) return
  }
}

export async function drawStaticLesson(board: WhiteboardHandle, ink: HeroInk): Promise<void> {
  ink.reset(VERIFIED_DIAGRAM)
  board.setCursorState('idle')
  for (const segment of HERO_SEGMENTS) {
    for (const command of getSegmentCommands(segment)) {
      await ink.executeCommand(command, { durationScale: 0, applyLayout: !segment.verifiedDiagramIntro, trustedDiagramGeometry: segment.verifiedDiagramIntro })
    }
  }
  board.setCursorState('idle')
}
