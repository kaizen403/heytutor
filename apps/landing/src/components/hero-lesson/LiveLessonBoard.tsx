import { memo } from 'react'
import { Whiteboard, type CursorState, type WhiteboardHandle } from '@heytutor/whiteboard'
import { PenSpinner } from '@heytutor/whiteboard/pen-spinner'
import type { LessonSnapshot } from './lessonScript'

const INK = '#F2F2F4'

const CANVAS_W = 1200
const CANVAS_H = 700
const SURFACE_W = 956
const SURFACE_H = 556
const BOARD_SCALE = Math.min(SURFACE_W / CANVAS_W, SURFACE_H / CANVAS_H)

/* The machined bezel — .wb-frame from apps/tutor/app/globals.css, verbatim:
   bevelled side walls over a brushed face with the base ledge cut in as a hard
   stop, and the contact shadow as pure box-shadow so layout is untouched. */
const FRAME_STYLE = {
  background:
    'linear-gradient(90deg, rgba(255,255,255,0.07) 0, transparent 18px, transparent calc(100% - 18px), rgba(0,0,0,0.3) 100%), linear-gradient(180deg, #43434C 0, #33333A 5px, #26262C 38%, #1C1C21 calc(100% - 9px), #0D0D10 calc(100% - 9px), #08080A 100%)',
  boxShadow:
    '0 0 0 1px #050506, inset 0 1px 0 rgba(255,255,255,0.16), inset 1px 0 0 rgba(255,255,255,0.05), inset -1px 0 0 rgba(0,0,0,0.5), inset 0 -1px 0 rgba(0,0,0,0.7), 0 28px 64px -32px rgba(3,11,18,0.62)',
} as const

function LiveLessonBoard({
  snapshot,
  boardRef,
  cursorState,
}: {
  snapshot: LessonSnapshot
  boardRef: (handle: WhiteboardHandle | null) => void
  cursorState: CursorState
}) {
  const { bubble } = snapshot

  return (
    <div style={{ position: 'relative', width: 988, height: 588, margin: '10px auto 0', borderRadius: 14, ...FRAME_STYLE }}>
      <style>{`@keyframes wb-bubble-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes wb-progress-sweep { 0% { left: -40%; } 100% { left: 100%; } }`}</style>

      {/* recess the writing surface drops into (.wb-frame ::before) */}
      <div
        style={{
          position: 'absolute',
          inset: 11,
          borderRadius: 7,
          pointerEvents: 'none',
          zIndex: 0,
          boxShadow:
            'inset 0 3px 7px rgba(0, 0, 0, 0.55), inset 0 -1px 0 rgba(255, 255, 255, 0.05), inset 0 0 0 1px rgba(0, 0, 0, 0.55)',
        }}
      />

      {/* surface (.wb-surface) */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          right: 16,
          bottom: 16,
          borderRadius: 5,
          background: 'linear-gradient(180deg, #FFFFFF 0%, #F4F7FA 100%)',
          boxShadow:
            'inset 0 0 0 1px rgba(0, 0, 0, 0.07), inset 0 2px 3px rgba(0, 0, 0, 0.07), inset 0 -1px 0 rgba(255, 255, 255, 0.9)',
          overflow: 'hidden',
        }}
      >
        {/* The real whiteboard renderer (1200×700 canvas, scaled like SessionBoardCanvas) */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: CANVAS_W * BOARD_SCALE,
            height: CANVAS_H * BOARD_SCALE,
          }}
        >
          <div
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              transform: `scale(${BOARD_SCALE})`,
              transformOrigin: 'top left',
            }}
          >
            <Whiteboard
              ref={boardRef}
              width={CANVAS_W}
              height={CANVAS_H}
              cursorState={cursorState}
              inkColor="#1B2A4A"
            />
          </div>
        </div>

        {/* Thinking overlay (ThinkingOverlay) — only while the turn is submitting */}
        {snapshot.phase === 'submit' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 3,
              background:
                'linear-gradient(180deg, rgba(11,11,12,0.72) 0%, rgba(21,21,23,0.88) 100%)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
            }}
          >
            {/* progress strip across the top (.wb-progress-bar) */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, overflow: 'hidden' }}>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '-40%',
                  height: '100%',
                  width: '40%',
                  background:
                    'linear-gradient(90deg, transparent 0%, rgba(201, 201, 210, 0.55) 50%, transparent 100%)',
                  animation: 'wb-progress-sweep 1.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                height: '100%',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
              }}
            >
              <PenSpinner size={56} ink="#C9C9D2" label="thinking about how to teach this…" />
              <p style={{ margin: 0, fontSize: 14.4, color: '#C9C9D2', fontWeight: 500 }}>
                thinking about how to teach this…
              </p>
            </div>
          </div>
        )}

        {/* Narration bubble (ResponseBubble) */}
        {bubble && (
          <div
            style={{
              position: 'absolute',
              bottom: 20,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(21, 21, 23, 0.94)',
              color: INK,
              borderRadius: 12,
              boxShadow: '0 10px 30px -8px rgba(0, 0, 0, 0.55)',
              border: '1px solid rgba(242, 242, 244, 0.08)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              padding: '12px 24px',
              maxWidth: 'calc(100% - 2rem)',
              zIndex: 2,
            }}
          >
            <p
              key={bubble}
              style={{
                margin: 0,
                textAlign: 'center',
                fontSize: 16,
                fontWeight: 500,
                lineHeight: 1.5,
                color: INK,
                whiteSpace: 'nowrap',
                animation: 'wb-bubble-fade 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
              }}
            >
              {bubble}
            </p>
          </div>
        )}
      </div>

      {/* specular sweep across the bezel top, plus the inner hairline (.wb-frame ::after) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 14,
          pointerEvents: 'none',
          zIndex: 1,
          background:
            'linear-gradient(104deg, transparent 12%, rgba(255,255,255,0.05) 28%, rgba(255,255,255,0.09) 34%, transparent 48%)',
          boxShadow: 'inset 0 0 0 1px rgba(240, 246, 252, 0.045)',
        }}
      />
    </div>
  )
}

/* The board holds a live Konva stage. Its driver re-renders on a clock — the
   hero's lesson snapshot, or a use-case demo's typing caret — and none of that
   concerns the renderer, which only cares about the bubble, the thinking
   overlay, and the cursor. Left unmemoised the stage re-renders with every
   tick and the ink stops advancing. */
export default memo(LiveLessonBoard, (prev, next) =>
  prev.snapshot.bubble === next.snapshot.bubble &&
  prev.snapshot.phase === next.snapshot.phase &&
  prev.cursorState === next.cursorState &&
  prev.boardRef === next.boardRef,
)
