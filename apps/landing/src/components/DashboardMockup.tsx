import { useRef } from 'react'
import { ArrowUp, Download, RotateCcw, ScrollText, Settings, Volume2, VolumeX } from 'lucide-react'
import LiveLessonBoard from './hero-lesson/LiveLessonBoard'
import { useLessonSimulation } from './hero-lesson/useLessonSimulation'
import { LESSON_TITLE, QUESTION_TEXT } from './hero-lesson/lessonScript'

const SHELL_BG = '#0B0B0C'
const LINE = 'rgba(242, 242, 244, 0.08)'
const INK = '#F2F2F4'
const INK_SOFT = '#A6A6AE'
const INK_FAINT = '#7A7A82'
const ACCENT = '#C9C9D2'
const PAPER = '#151517'
const RAISED = '#1E1E21'
const BORDER = '#2E2E33'
const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

const BOARDS = [
  { title: LESSON_TITLE, preview: 'v = u + at = 10 m/s', active: true },
  { title: 'Volume of cuboid', preview: 'V = l × w × h …', active: false },
  { title: 'Pythagorean theorem', preview: 'a² + b² = c² …', active: false },
]

export default function DashboardMockup({ recording = false }: { recording?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { snapshot, sound, toggleSound, boardRef, cursorState } = useLessonSimulation(rootRef)

  const typed = QUESTION_TEXT.slice(0, snapshot.typedCount)
  const teaching = snapshot.teaching

  return (
    <div
      ref={rootRef}
      className="overflow-hidden rounded-2xl text-left"
      style={{
        width: 1280,
        background: SHELL_BG,
        border: '1px solid rgba(0, 0, 0, 0.6)',
        boxShadow: '0 -20px 80px rgba(0, 0, 0, 0.45)',
        fontFamily: FONT,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <style>{`@keyframes mockup-status-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(1.25); } }
@keyframes hero-caret-blink { 0%, 45% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes hero-sound-pulse { 0% { box-shadow: 0 0 0 0 rgba(201, 201, 210, 0.35); } 100% { box-shadow: 0 0 0 12px rgba(201, 201, 210, 0); } }
.mockup-input::placeholder { color: #717177; font-style: italic; }`}</style>

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
            <span
              style={{
                fontSize: 17,
                fontWeight: 600,
                letterSpacing: '-0.015em',
                lineHeight: 1.2,
                color: ACCENT,
                userSelect: 'none',
              }}
            >
              Accelute
            </span>
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
                gap: 8.8,
                width: '100%',
                padding: '11.2px 13.6px',
                borderRadius: 11.2,
                border: `1px solid ${LINE}`,
                background: PAPER,
                color: INK,
                fontSize: 14.4,
                fontWeight: 500,
                lineHeight: 1.4,
                letterSpacing: '-0.005em',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: ACCENT, flexShrink: 0 }} aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              New board
            </div>
          </div>

          {/* Section label */}
          <div
            style={{
              padding: '4px 16.8px 8px',
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: INK_SOFT,
              userSelect: 'none',
            }}
          >
            Recent boards
          </div>

          {/* Board list */}
          <div style={{ flex: 1, padding: '0 10.4px 14px' }}>
            {BOARDS.map((b) => (
              <div
                key={b.title}
                style={{
                  position: 'relative',
                  marginBottom: 4,
                  borderRadius: 11.2,
                  background: b.active ? 'rgba(201, 201, 210, 0.08)' : 'transparent',
                }}
              >
                {b.active && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 3,
                      height: 18.4,
                      borderRadius: '0 9999px 9999px 0',
                      background: ACCENT,
                      opacity: 0.9,
                    }}
                  />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2.4, padding: '11.2px 12px', borderRadius: 11.2 }}>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      letterSpacing: '-0.01em',
                      lineHeight: 1.35,
                      color: b.active ? ACCENT : INK,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {b.title}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 400,
                      letterSpacing: '-0.005em',
                      lineHeight: 1.4,
                      color: INK_FAINT,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {b.preview}
                  </span>
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
              background: 'rgba(21, 21, 23, 0.9)',
              padding: '12px 18px',
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
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    borderRadius: 9999,
                    background: 'rgba(201, 201, 210, 0.12)',
                    padding: '2px 9px',
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: ACCENT,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 9999,
                      background: ACCENT,
                      animation: 'mockup-status-pulse 1.5s ease-in-out infinite',
                    }}
                  />
                  {snapshot.chip === 'teaching' ? 'teaching…' : 'thinking…'}
                </span>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 12.5, color: INK_SOFT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {snapshot.chip === 'teaching' ? 'Lesson in progress on the whiteboard' : 'Working on your question'}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <div aria-label="Replay lecture" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9999, border: `1px solid ${BORDER}`, background: RAISED, color: ACCENT, opacity: 0.4 }}>
                <RotateCcw size={15} aria-hidden />
              </div>
              <div aria-label="Transcript" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9999, border: `1px solid ${BORDER}`, background: RAISED, color: INK_SOFT, opacity: 0.4 }}>
                <ScrollText size={15} aria-hidden />
              </div>
              <div aria-label="Download notes" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 9999, border: `1px solid ${BORDER}`, background: RAISED, color: INK_SOFT, opacity: 0.4 }}>
                <Download size={15} aria-hidden />
              </div>
              <div style={{ width: 1, height: 24, background: BORDER }} aria-hidden />
              <div style={{ width: 38, height: 38, borderRadius: 9999, border: `1px solid ${BORDER}`, background: RAISED, color: INK_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Settings size={16} strokeWidth={1.75} aria-hidden />
              </div>
              <div style={{ borderRadius: 9999, border: `1px solid ${BORDER}`, background: RAISED, padding: '7px 14px', fontSize: 12.5, fontWeight: 500, color: INK_SOFT, whiteSpace: 'nowrap' }}>
                Stop
              </div>
            </div>
          </header>

          {/* Board frame + sound toggle */}
          <div style={{ position: 'relative' }}>
            <LiveLessonBoard snapshot={snapshot} boardRef={boardRef} cursorState={cursorState} />
            {!recording && (sound === 'off' || sound === 'on') && (
              <button
                type="button"
                onClick={toggleSound}
                aria-label={sound === 'on' ? 'Mute lesson voice' : 'Play lesson voice'}
                title={sound === 'on' ? 'Mute' : 'Play with sound'}
                style={{
                  position: 'absolute',
                  right: 28,
                  bottom: 28,
                  zIndex: 5,
                  width: 40,
                  height: 40,
                  borderRadius: 9999,
                  border: '1px solid rgba(240, 246, 252, 0.16)',
                  background: 'rgba(22, 27, 34, 0.85)',
                  color: INK,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  backdropFilter: 'blur(4px)',
                  WebkitBackdropFilter: 'blur(4px)',
                  animation: sound === 'off' ? 'hero-sound-pulse 1.8s ease-out infinite' : undefined,
                }}
              >
                {sound === 'on' ? <Volume2 size={17} aria-hidden /> : <VolumeX size={17} aria-hidden />}
              </button>
            )}
          </div>

          {/* Input bar (InputBar) */}
          <div style={{ width: '100%', maxWidth: 660, margin: '12px auto 0' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minHeight: 56,
                background: PAPER,
                border: `1px solid ${BORDER}`,
                borderRadius: 9999,
                boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.45)',
                padding: '8px 10px',
              }}
            >
              {/* Photo */}
              <div style={{ width: 38, height: 38, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK_SOFT, flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="3.5" y="6" width="17" height="13" rx="2.25" stroke="currentColor" strokeWidth="1.75" />
                  <circle cx="8.5" cy="10.25" r="1.35" fill="currentColor" />
                  <path d="M7 17.5l4.2-4.4a1.2 1.2 0 0 1 1.7 0L17.5 17.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              {/* Text input — the question types itself live */}
              <div
                className="mockup-input"
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
                        background: ACCENT,
                        animation: 'hero-caret-blink 1s step-end infinite',
                      }}
                    />
                  </>
                ) : (
                  <span style={{ color: '#717177', fontStyle: 'italic' }}>Ask a question or paste a photo</span>
                )}
              </div>

              {/* Mic */}
              <div style={{ width: 38, height: 38, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK_SOFT, flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.75" />
                  <path d="M5 10a7 7 0 0 0 14 0M12 17v3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </div>

              {teaching ? (
                <>
                  {/* Pause teaching (live control) */}
                  <div aria-label="Pause teaching" style={{ width: 38, height: 38, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(201, 201, 210, 0.15)', color: INK, flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <rect x="6" y="4" width="4" height="16" rx="1" />
                      <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                  </div>
                  {/* Cancel teaching (live control) */}
                  <div aria-label="Cancel teaching" style={{ width: 38, height: 38, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(240, 246, 252, 0.06)', color: INK_SOFT, flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </div>
                  <div style={{ borderRadius: 9999, padding: '9px 18px', fontSize: 14, fontWeight: 500, background: '#6E6E76', color: '#FFFFFF', flexShrink: 0 }}>
                    Ask Doubt
                  </div>
                </>
              ) : (
                <div
                  aria-label="Send question"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    background: typed ? '#6E6E76' : 'rgba(201, 201, 210, 0.1)',
                    color: typed ? '#FFFFFF' : INK_SOFT,
                    transform: snapshot.phase === 'submit' ? 'scale(0.88)' : 'scale(1)',
                    transition: 'transform 120ms ease',
                  }}
                >
                  <ArrowUp size={18} aria-hidden />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
