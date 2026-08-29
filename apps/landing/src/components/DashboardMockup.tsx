import { useRef, type RefObject } from 'react'
import { Download, RotateCcw, Settings } from 'lucide-react'
import Brand from './Brand'
import LiveLessonBoard from './hero-lesson/LiveLessonBoard'
import { useLessonSimulation, type SoundState } from './hero-lesson/useLessonSimulation'
import { LESSON_TITLE, QUESTION_TEXT, type LessonSnapshot } from './hero-lesson/lessonScript'
import { PenSpinner } from '@heytutor/whiteboard/pen-spinner'
import type { CursorState, WhiteboardHandle } from '@heytutor/whiteboard'

/**
 * Everything the chrome needs to render a frame. It is exactly what
 * `useLessonSimulation` returns plus the question being asked, so the hero can
 * hand its own simulation straight in and a scripted demo can pose the very
 * same UI without the two sharing a clock.
 */
export interface DashboardDrive {
  question: string
  snapshot: LessonSnapshot
  sound: SoundState
  toggleSound: () => void
  boardRef: (handle: WhiteboardHandle | null) => void
  cursorState: CursorState
  /** Header control to show as pressed — the demo uses this for replay/notes. */
  pressed?: 'replay' | 'download' | null
}

/* Graphite palette — the shipping tutor's tokens (apps/tutor/app/globals.css
   :root + the components' inline values). The mockup is a miniature of the
   real session page, so every value below is the tutor's, not a restyle. */
const SHELL_BG = '#0B0B0C'
const LINE = 'rgba(242, 242, 244, 0.08)'
const INK = '#F2F2F4'
const INK_SOFT = '#A6A6AE'
const INK_FAINT = '#717177'
/** Sidebar board previews use their own faint (BoardHistory's --ink-faint). */
const PREVIEW_INK = '#7A7A82'
const ACCENT = '#C9C9D2'
const ACTIVE_FILL = 'rgba(201, 201, 210, 0.07)'
const PAUSE_FILL = 'rgba(201, 201, 210, 0.15)'
const RING = 'rgba(201, 201, 210, 0.22)'
const ON_ACCENT = '#0B0B0C'
const PAPER = '#151517'
const RAISED = '#1E1E21'
const BORDER = '#2E2E33'
const CTA = '#6E6E76'
const SUBMIT_INACTIVE_BG = 'rgba(240, 246, 252, 0.06)'
const SUBMIT_INACTIVE_TEXT = 'rgba(139, 148, 158, 0.7)'
const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

const BOARDS = [
  { title: LESSON_TITLE, preview: 'v = u + at = 10 m/s', active: true },
  { title: 'Volume of cuboid', preview: 'V = l × w × h …', active: false },
  { title: 'Pythagorean theorem', preview: 'a² + b² = c² …', active: false },
]

function DashboardChrome({
  rootRef,
  drive,
}: {
  rootRef: RefObject<HTMLDivElement | null>
  drive: DashboardDrive
}) {
  const { snapshot, boardRef, cursorState, question, pressed } = drive

  const typed = question.slice(0, snapshot.typedCount)
  const teaching = snapshot.teaching
  /** Live chrome (header spinner, Stop pill) — the tutor's `phase !== idle`. */
  const live = teaching || snapshot.phase === 'submit'
  /** No lesson on the board yet — replay/download stay dimmed (canReplay=false). */
  const noLesson = snapshot.phase === 'typing' || snapshot.phase === 'submit'

  return (
    <div
      ref={rootRef}
      className="overflow-hidden rounded-2xl text-left"
      style={{
        width: 1280,
        background: SHELL_BG,
        border: '1px solid rgba(0, 0, 0, 0.6)',
        boxShadow: '0 -20px 80px rgba(3, 11, 18, 0.45)',
        fontFamily: FONT,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <style>{`@keyframes hero-caret-blink { 0%, 45% { opacity: 1; } 50%, 100% { opacity: 0; } }`}</style>

      <div className="flex">
        {/* ── Left sidebar (BoardHistory) ── */}
        <aside
          style={{
            width: 264,
            flexShrink: 0,
            background: SHELL_BG,
            borderRight: `1px solid ${LINE}`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header: brand + icon buttons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '18px 16px 14px',
            }}
          >
            <Brand size="sm" />
            <div style={{ display: 'flex', gap: 2.4 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8.8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK_SOFT }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </div>
              <div style={{ width: 32, height: 32, borderRadius: 8.8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK_SOFT }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M9 3v18" />
                </svg>
              </div>
            </div>
          </div>

          {/* New board */}
          <div style={{ padding: '0 16px 13.6px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: 8.8,
                borderRadius: 13.6,
                border: `1px solid ${RING}`,
                background: 'linear-gradient(180deg, #262629 0%, #1A1A1D 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.28)',
                color: INK,
                fontSize: 14,
                fontWeight: 400,
                lineHeight: 1.4,
              }}
            >
              <span
                style={{
                  width: 24.8,
                  height: 24.8,
                  borderRadius: 7.2,
                  background: '#F2F2F4',
                  color: ON_ACCENT,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
                aria-hidden
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              New board
            </div>
          </div>

          {/* Section label */}
          <div
            style={{
              padding: '2.4px 16.8px 8.8px',
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: 0,
              lineHeight: 1.3,
              color: INK_SOFT,
              userSelect: 'none',
            }}
          >
            Recent boards
          </div>

          {/* Board list */}
          <div style={{ flex: 1, padding: '0 8px 14px' }}>
            {BOARDS.map((b) => (
              <div
                key={b.title}
                style={{
                  position: 'relative',
                  marginBottom: 2,
                  borderRadius: 12.8,
                  border: `1px solid ${b.active ? LINE : 'transparent'}`,
                  background: b.active ? ACTIVE_FILL : 'transparent',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3.2,
                    padding: '12.8px 8.8px',
                    borderRadius: 12.8,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6.4, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 400,
                        letterSpacing: 0,
                        lineHeight: 1.35,
                        color: INK,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {b.title}
                    </span>
                    {/* The board being taught spins a pen in the list (busyBoardId). */}
                    {b.active && teaching && (
                      <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', color: ACCENT }}>
                        <PenSpinner size={15} ink={ACCENT} trail={false} />
                      </span>
                    )}
                  </span>
                  {/* The active board shows no preview line (real behavior). */}
                  {!b.active && (
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 400,
                        letterSpacing: '-0.005em',
                        lineHeight: 1.4,
                        color: PREVIEW_INK,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {b.preview}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Footer: credits + profile */}
          <div
            style={{
              flexShrink: 0,
              borderTop: `1px solid ${LINE}`,
              padding: '14px 16px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ color: INK_SOFT, fontSize: 13, letterSpacing: '-0.005em' }}>Credits</span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9999,
                border: `1px solid ${LINE}`,
                background: PAPER,
                color: INK_SOFT,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
              </svg>
            </div>
          </div>
        </aside>

        {/* ── Main column ── */}
        <div style={{ flex: 1, minWidth: 0, padding: '14px 14px 16px', display: 'flex', flexDirection: 'column' }}>
          {/* Header (SessionHeader) */}
          <header
            style={{
              borderRadius: 16,
              border: `1px solid ${LINE}`,
              background: 'rgba(21, 21, 23, 0.90)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              padding: '10px 16px',
              boxShadow: '0 8px 30px -18px rgba(0, 0, 0, 0.55)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    color: INK,
                    textTransform: 'capitalize',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {LESSON_TITLE}
                </span>
                {/* Live status: the tutor's PenSpinner replaces the old pulse chip. */}
                {live && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
                    <PenSpinner
                      size={17}
                      ink={ACCENT}
                      trail={false}
                      label={snapshot.chip === 'teaching' ? 'teaching…' : 'thinking…'}
                    />
                  </span>
                )}
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: INK_SOFT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {live ? 'Lesson in progress on the whiteboard' : 'Whiteboard session'}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {/* Ask pill (notes toggle) */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 9999,
                  border: `1px solid ${BORDER}`,
                  background: RAISED,
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                  color: ACCENT,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
                  <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
                </svg>
                <span style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>Ask</span>
              </div>

              {/* Replay pill (LessonActions) */}
              <div
                aria-label="Replay lecture"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 9999,
                  border: `1px solid ${pressed === 'replay' ? 'rgba(201, 201, 210, 0.45)' : BORDER}`,
                  background: pressed === 'replay' ? BORDER : RAISED,
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                  color: ACCENT,
                  opacity: noLesson ? 0.4 : 1,
                  transform: pressed === 'replay' ? 'scale(0.92)' : 'scale(1)',
                  transition: 'transform 140ms ease, opacity 200ms ease, background-color 200ms ease',
                }}
              >
                <RotateCcw size={14} aria-hidden />
                <span style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>Replay</span>
              </div>

              {/* Download notes pill (LessonActions) */}
              <div
                aria-label="Download notes"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 32,
                  padding: '0 12px',
                  borderRadius: 9999,
                  border: `1px solid ${pressed === 'download' ? 'rgba(201, 201, 210, 0.45)' : BORDER}`,
                  background: pressed === 'download' ? BORDER : RAISED,
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                  color: INK_SOFT,
                  opacity: noLesson ? 0.4 : 1,
                  transform: pressed === 'download' ? 'scale(0.92)' : 'scale(1)',
                  transition: 'transform 140ms ease, opacity 200ms ease, background-color 200ms ease',
                }}
              >
                <Download size={14} aria-hidden />
                <span style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>Download notes</span>
              </div>

              {live && (
                <>
                  <div style={{ width: 1, height: 24, background: BORDER }} aria-hidden />
                  <div
                    style={{
                      borderRadius: 9999,
                      border: `1px solid ${BORDER}`,
                      background: RAISED,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 500,
                      color: INK_SOFT,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Stop
                  </div>
                </>
              )}
            </div>
          </header>

          {/* Board frame */}
          <div style={{ position: 'relative' }}>
            <LiveLessonBoard snapshot={snapshot} boardRef={boardRef} cursorState={cursorState} />
          </div>

          {/* Input bar (InputBar) */}
          <div style={{ width: '100%', maxWidth: 768, margin: '12px auto 0' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 52,
                background: PAPER,
                border: `1px solid ${BORDER}`,
                borderRadius: 9999,
                boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.45)',
                padding: '8px 10px',
              }}
            >
              {/* Photo */}
              <div style={{ width: 36, height: 36, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK_SOFT, flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="3.5" y="6" width="17" height="13" rx="2.25" stroke="currentColor" strokeWidth="1.75" />
                  <circle cx="8.5" cy="10.25" r="1.35" fill="currentColor" />
                  <path d="M7 17.5l4.2-4.4a1.2 1.2 0 0 1 1.7 0L17.5 17.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {/* Text input — the question types itself live */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '6px 8px',
                  fontSize: 15,
                  color: INK,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {typed ? (
                  <>
                    {typed}
                    <span
                      style={{
                        display: 'inline-block',
                        width: 1.5,
                        height: 15,
                        marginLeft: 1,
                        verticalAlign: '-2px',
                        background: INK,
                        animation: 'hero-caret-blink 1s step-end infinite',
                      }}
                    />
                  </>
                ) : (
                  <span style={{ color: INK_FAINT, fontStyle: 'italic' }}>
                    {teaching ? 'Ask a doubt about this lesson' : 'Ask a question or paste a photo'}
                  </span>
                )}
              </div>

              {/* Mic */}
              <div style={{ width: 36, height: 36, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK_SOFT, flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.75" />
                  <path d="M5 10a7 7 0 0 0 14 0M12 17v3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </div>

              {teaching ? (
                <>
                  {/* Pause teaching (live control) */}
                  <div aria-label="Pause teaching" style={{ width: 36, height: 36, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: PAUSE_FILL, color: INK, flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  </div>
                  {/* Cancel teaching (live control) */}
                  <div aria-label="Cancel teaching" style={{ width: 36, height: 36, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: SUBMIT_INACTIVE_BG, color: INK_SOFT, flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </div>
                  <div aria-label="Board settings" style={{ width: 36, height: 36, borderRadius: 9999, border: `1px solid ${BORDER}`, background: RAISED, color: INK_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Settings size={16} strokeWidth={1.75} aria-hidden />
                  </div>
                  <div style={{ borderRadius: 9999, padding: '8px 16px', fontSize: 14, fontWeight: 500, background: CTA, color: '#FFFFFF', flexShrink: 0 }}>
                    Ask Doubt
                  </div>
                </>
              ) : (
                <>
                  <div aria-label="Board settings" style={{ width: 36, height: 36, borderRadius: 9999, border: `1px solid ${BORDER}`, background: RAISED, color: INK_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Settings size={16} strokeWidth={1.75} aria-hidden />
                  </div>
                  <div
                    aria-label="Send question"
                    style={{
                      borderRadius: 9999,
                      padding: '8px 16px',
                      fontSize: 14,
                      fontWeight: 500,
                      flexShrink: 0,
                      background: typed ? CTA : SUBMIT_INACTIVE_BG,
                      color: typed ? '#FFFFFF' : SUBMIT_INACTIVE_TEXT,
                      transform: snapshot.phase === 'submit' ? 'scale(0.88)' : 'scale(1)',
                      transition: 'transform 120ms ease',
                    }}
                  >
                    Ask
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The hero and /record.html: the mockup runs its own lesson on its own clock. */
function SelfDrivenDashboard() {
  const rootRef = useRef<HTMLDivElement>(null)
  const simulation = useLessonSimulation(rootRef)
  return (
    <DashboardChrome
      rootRef={rootRef}
      drive={{ ...simulation, question: QUESTION_TEXT }}
    />
  )
}

/**
 * Pass `drive` to pose the dashboard from outside; omit it and the mockup runs
 * itself exactly as before. The two paths are separate components so neither
 * calls a hook conditionally.
 */
export default function DashboardMockup({ drive }: { drive?: DashboardDrive }) {
  const drivenRef = useRef<HTMLDivElement>(null)
  return drive ? (
    <DashboardChrome rootRef={drivenRef} drive={drive} />
  ) : (
    <SelfDrivenDashboard />
  )
}
