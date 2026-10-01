import { useCallback, useRef, type RefObject } from 'react'
import { anchorToTextRect, type VerifiedDiagram } from '@heytutor/drawing'
import type { InkPace } from '@heytutor/tutor-core'
import type { WhiteboardHandle } from '@heytutor/whiteboard'
import { useBoardLayout } from '../../../../tutor/features/tutor-session/hooks/useBoardLayout'
import { useCommandExecution } from '../../../../tutor/features/tutor-session/hooks/useCommandExecution'
import { registerBoardAnchor } from '../../../../tutor/features/tutor-session/lib/board/boardLayout'
import type { TurnTelemetry } from '../../../../tutor/lib/obs/turnTelemetry'

/** The hero is a recorded lesson, executed by the shipping tutor's conductor. */
export function useHeroInk(whiteboardRef: RefObject<WhiteboardHandle | null>) {
  const cancelRef = useRef(false)
  const fbdPhaseStartedRef = useRef(false)
  const fbdPhaseMarkedRef = useRef(false)
  const liveQuestionRef = useRef('')
  const activeVerifiedDiagramRef = useRef<VerifiedDiagram | null>(null)
  const turnTelemetryRef = useRef<TurnTelemetry | null>(null)
  const speedRef = useRef(1)
  const inkPaceRef = useRef<InkPace>('follow')
  const adaptiveFactorRef = useRef(1)
  const layout = useBoardLayout({ whiteboardRef, cancelRef, fbdPhaseStartedRef, liveQuestionRef, viewportMode: 'fixed' })
  const cancellableDelay = useCallback(async (duration: number) => {
    const started = performance.now()
    while (!cancelRef.current && performance.now() - started < duration) {
      await new Promise<void>((resolve) => setTimeout(resolve, 16))
    }
  }, [])
  const raceWithCancel = useCallback(async <T,>(promise: Promise<T>): Promise<T | undefined> => {
    const result = await promise
    return cancelRef.current ? undefined : result
  }, [])
  const { executeCommand } = useCommandExecution({
    whiteboardRef, cancelRef, speedRef, fbdPhaseMarkedRef, fbdPhaseStartedRef,
    activeVerifiedDiagramRef, turnTelemetryRef, inkPaceRef, adaptiveFactorRef,
    cancellableDelay, raceWithCancel, ...layout,
  })
  const { resetBoardLayout, boardLayoutRef } = layout
  const reset = useCallback((diagram: VerifiedDiagram) => {
    cancelRef.current = false
    fbdPhaseMarkedRef.current = false
    fbdPhaseStartedRef.current = false
    activeVerifiedDiagramRef.current = diagram
    resetBoardLayout(false, true)
    for (const anchor of diagram.anchors) registerBoardAnchor(boardLayoutRef.current, anchorToTextRect(anchor))
  }, [resetBoardLayout, boardLayoutRef])
  return { executeCommand, reset, cancelRef }
}
