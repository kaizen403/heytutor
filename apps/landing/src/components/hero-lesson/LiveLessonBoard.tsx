import { Whiteboard, type CursorState, type WhiteboardHandle } from '@heytutor/whiteboard'
import type { LessonSnapshot } from './lessonScript'

const INK = '#F2F2F4'

const CANVAS_W = 1200
const CANVAS_H = 700
const SURFACE_W = 956
const SURFACE_H = 556
const BOARD_SCALE = Math.min(SURFACE_W / CANVAS_W, SURFACE_H / CANVAS_H)

const FRAME_STYLE = {
  background:
    'linear-gradient(180deg, rgba(240, 246, 252, 0.06) 0%, transparent 18%, transparent 82%, rgba(0, 0, 0, 0.35) 100%), linear-gradient(145deg, #1E1E21 0%, #19191C 40%, #151517 100%)',
  boxShadow:
    '0 30px 70px -18px rgba(0, 0, 0, 0.55), 0 12px 28px -8px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(240, 246, 252, 0.08), inset 0 1px 0 rgba(240, 246, 252, 0.06), inset 0 -1px 0 rgba(0, 0, 0, 0.35)',
} as const

export default function LiveLessonBoard({
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
    <div style={{ position: 'relative', width: 988, height: 588, margin: '10px auto 0', borderRadius: 12, ...FRAME_STYLE }}>
      <style>{`@keyframes hero-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>

      {/* inner vignette (.wb-frame ::before) */}
      <div
        style={{
          position: 'absolute',
          inset: 10,
          borderRadius: 6,
          pointerEvents: 'none',
          zIndex: 0,
          boxShadow: 'inset 0 2px 6px rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(240, 246, 252, 0.04)',
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
          borderRadius: 4,
          background: 'linear-gradient(180deg, #FFFFFF 0%, #F6F8FA 100%)',
          boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.06), inset 0 1px 2px rgba(0, 0, 0, 0.04)',
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

        {/* Narration bubble (ResponseBubble) */}
        {bubble && (
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(22, 27, 34, 0.94)',
              color: INK,
              borderRadius: 10,
              boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.45)',
              border: '1px solid rgba(240, 246, 252, 0.1)',
              backdropFilter: 'blur(8px)',
              padding: '11px 18px',
              maxWidth: 'calc(100% - 2rem)',
              zIndex: 2,
            }}
          >
            <p
              key={bubble}
              style={{
                margin: 0,
                textAlign: 'center',
                fontSize: 15,
                fontWeight: 500,
                lineHeight: 1.5,
                color: INK,
                whiteSpace: 'nowrap',
                animation: 'hero-fade-in 0.35s ease-out both',
              }}
            >
              {bubble}
            </p>
          </div>
        )}
      </div>

      {/* outer ring (.wb-frame ::after) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 12,
          pointerEvents: 'none',
          zIndex: 1,
          boxShadow: 'inset 0 0 0 1px rgba(240, 246, 252, 0.04)',
        }}
      />
    </div>
  )
}
