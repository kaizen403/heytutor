import { Download, RotateCcw, ScrollText, Settings } from 'lucide-react'

const SHELL_BG = '#0B0B0C'
const LINE = 'rgba(242, 242, 244, 0.08)'
const INK = '#F2F2F4'
const INK_SOFT = '#A6A6AE'
const INK_FAINT = '#7A7A82'
const ACCENT = '#C9C9D2'
const PAPER = '#151517'
const RAISED = '#1E1E21'
const BORDER = '#2E2E33'
const NAVY = '#1B2A4A'
const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const CAVEAT = "'Caveat', cursive"

const BOARDS = [
  { title: 'Volume of cuboid', preview: 'V = l × w × h = 480 cm³', active: true },
  { title: 'Pythagorean theorem', preview: 'a² + b² = c² …', active: false },
  { title: 'Area of rectangle', preview: 'A = l × w …', active: false },
]

export default function DashboardMockup() {
  return (
    <div
      className="overflow-hidden rounded-2xl text-left"
      style={{
        width: 896,
        background: SHELL_BG,
        border: '1px solid rgba(0, 0, 0, 0.6)',
        boxShadow: '0 -20px 80px rgba(0, 0, 0, 0.45)',
        fontFamily: FONT,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <style>{`@keyframes mockup-status-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(1.25); } } .mockup-input::placeholder { color: #717177; font-style: italic; }`}</style>

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
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8.8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: INK_SOFT,
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
              </div>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8.8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: INK_SOFT,
                }}
              >
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
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2.4,
                    padding: '11.2px 12px',
                    borderRadius: 11.2,
                  }}
                >
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
        <div style={{ flex: 1, minWidth: 0, padding: '12px 10px', display: 'flex', flexDirection: 'column' }}>
          {/* Header (SessionHeader) */}
          <header
            style={{
              borderRadius: 16,
              border: `1px solid ${LINE}`,
              background: 'rgba(21, 21, 23, 0.9)',
              padding: '10px 16px',
              boxShadow: '0 8px 30px -18px rgba(0, 0, 0, 0.55)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    color: INK,
                    textTransform: 'capitalize',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  Volume of cuboid
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    borderRadius: 9999,
                    background: 'rgba(201, 201, 210, 0.12)',
                    padding: '2px 8px',
                    fontSize: 11,
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
                  teaching…
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: INK_SOFT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Lesson in progress on the whiteboard
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {/* Replay (compact: icon-only, matches real app at this width; disabled mid-lesson) */}
              <div aria-label="Replay lecture" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 9999, border: `1px solid ${BORDER}`, background: RAISED, color: ACCENT, opacity: 0.4 }}>
                <RotateCcw size={14} aria-hidden />
              </div>
              {/* Transcript */}
              <div aria-label="Transcript" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 9999, border: `1px solid ${BORDER}`, background: RAISED, color: INK_SOFT, opacity: 0.4 }}>
                <ScrollText size={14} aria-hidden />
              </div>
              {/* Download notes */}
              <div aria-label="Download notes" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 9999, border: `1px solid ${BORDER}`, background: RAISED, color: INK_SOFT, opacity: 0.4 }}>
                <Download size={14} aria-hidden />
              </div>
              {/* Divider */}
              <div style={{ width: 1, height: 24, background: BORDER }} aria-hidden />
              {/* Settings */}
              <div style={{ width: 36, height: 36, borderRadius: 9999, border: `1px solid ${BORDER}`, background: RAISED, color: INK_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Settings size={16} strokeWidth={1.75} aria-hidden />
              </div>
              {/* Stop */}
              <div style={{ borderRadius: 9999, border: `1px solid ${BORDER}`, background: RAISED, padding: '6px 12px', fontSize: 12, fontWeight: 500, color: INK_SOFT, whiteSpace: 'nowrap' }}>
                Stop
              </div>
            </div>
          </header>

          {/* Board frame (.wb-frame) */}
          <div
            style={{
              position: 'relative',
              width: 580,
              height: 332,
              margin: '6px auto 0',
              borderRadius: 12,
              background:
                'linear-gradient(180deg, rgba(240, 246, 252, 0.06) 0%, transparent 18%, transparent 82%, rgba(0, 0, 0, 0.35) 100%), linear-gradient(145deg, #1E1E21 0%, #19191C 40%, #151517 100%)',
              boxShadow:
                '0 30px 70px -18px rgba(0, 0, 0, 0.55), 0 12px 28px -8px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(240, 246, 252, 0.08), inset 0 1px 0 rgba(240, 246, 252, 0.06), inset 0 -1px 0 rgba(0, 0, 0, 0.35)',
            }}
          >
            {/* ::before — inner vignette */}
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

            {/* Surface (.wb-surface) */}
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
              {/* Work area — Caveat handwriting (mirrors the real lesson flow) */}
              <div style={{ position: 'absolute', left: 28, top: 22, fontFamily: CAVEAT, color: NAVY, fontSize: 21, fontWeight: 500, lineHeight: 1.3 }}>
                <div>Given: l = 10, w = 8, h = 6</div>
                <div>V = l × w × h</div>
                <div>V = 10 × 8 × 6</div>
                <div>V = 480</div>
              </div>

              {/* Floating board settings gear (BoardSettingsButton) */}
              <div
                aria-label="Settings"
                style={{
                  position: 'absolute',
                  right: 12,
                  top: 12,
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(22, 27, 34, 0.75)',
                  backdropFilter: 'blur(4px)',
                  WebkitBackdropFilter: 'blur(4px)',
                  color: ACCENT,
                  opacity: 0.9,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </div>

              {/* Cuboid diagram (isometric, navy ink) */}
              <svg width="280" height="200" viewBox="0 0 280 200" fill="none" style={{ position: 'absolute', right: 20, top: 50 }}>
                <path d="M 40 60 L 190 60 L 190 150 L 40 150 Z" stroke={NAVY} strokeWidth="2.5" strokeLinejoin="round" />
                <path d="M 40 60 L 90 20 L 240 20 L 190 60 Z" stroke={NAVY} strokeWidth="2.5" strokeLinejoin="round" />
                <path d="M 190 60 L 240 20 L 240 110 L 190 150 Z" stroke={NAVY} strokeWidth="2.5" strokeLinejoin="round" />
                <text x="115" y="132" fill={NAVY} fontSize="22" fontFamily={CAVEAT} textAnchor="middle">l</text>
                <text x="215" y="44" fill={NAVY} fontSize="22" fontFamily={CAVEAT} textAnchor="middle">w</text>
                <text x="218" y="88" fill={NAVY} fontSize="22" fontFamily={CAVEAT} textAnchor="middle">h</text>
              </svg>

              {/* Marker cursor (VirtualCursor) */}
              <svg
                width="16"
                height="40"
                viewBox="-8 -36 16 40"
                style={{ position: 'absolute', left: 92, top: 88, transform: 'rotate(-35deg)', transformOrigin: '8px 36px' }}
                aria-hidden
              >
                <defs>
                  <filter id="mockup-marker-shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feDropShadow dx="0.8" dy="0.8" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.19" />
                  </filter>
                </defs>
                <circle cx="0" cy="0" r="4" fill={NAVY} opacity="0.12" />
                <path d="M 0 0 L -2.8 -5 L 2.8 -5 Z" fill={NAVY} stroke="#121B30" strokeWidth="0.4" />
                <rect x="-3.9" y="-7" width="7.8" height="2.2" rx="0.5" fill="#B8B8B8" stroke="#787878" strokeWidth="0.4" />
                <rect x="-3.6" y="-11" width="7.2" height="4" rx="0.6" fill="#C62828" stroke="#8E0000" strokeWidth="0.45" />
                <rect x="-2.8" y="-10.4" width="1.4" height="2.8" rx="0.4" fill="#EF5350" opacity="0.5" />
                <rect x="-3.6" y="-28" width="7.2" height="17" rx="1.2" fill="#1A1A1A" stroke="#0A0A0A" strokeWidth="0.7" filter="url(#mockup-marker-shadow)" />
                <rect x="-2.6" y="-27" width="2" height="15" rx="0.8" fill="#000000" opacity="0.3" />
                <rect x="-2.7" y="-27" width="1.5" height="15" rx="0.6" fill="#555555" opacity="0.5" />
                <rect x="-2.4" y="-22" width="4.8" height="1.4" rx="0.3" fill="#C62828" opacity="0.8" />
                <rect x="-3.9" y="-33" width="7.8" height="5" rx="2" fill="#111111" stroke="#0A0A0A" strokeWidth="0.7" />
                <rect x="3.2" y="-32" width="1.4" height="11" rx="0.6" fill="#555555" stroke="#0A0A0A" strokeWidth="0.35" />
              </svg>

              {/* Narration bubble (ResponseBubble) */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(22, 27, 34, 0.94)',
                  color: INK,
                  borderRadius: 10,
                  boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.45)',
                  border: '1px solid rgba(240, 246, 252, 0.1)',
                  backdropFilter: 'blur(8px)',
                  padding: '12px 16px',
                  maxWidth: 'calc(100% - 2rem)',
                }}
              >
                <p style={{ margin: 0, textAlign: 'center', fontSize: 14, fontWeight: 500, lineHeight: 1.5, color: INK, whiteSpace: 'nowrap' }}>
                  the volume of a cuboid is length times width times height
                </p>
              </div>
            </div>

            {/* ::after — outer ring */}
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

          {/* Input bar (InputBar) */}
          <div style={{ width: '100%', maxWidth: 560, margin: '10px auto 0' }}>
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

              {/* Text input */}
              <input
                readOnly
                placeholder="Ask a question or paste a photo"
                className="mockup-input"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'transparent',
                  border: 0,
                  outline: 'none',
                  padding: '6px 8px',
                  fontSize: 15,
                  color: INK,
                  fontFamily: 'inherit',
                }}
              />

              {/* Mic */}
              <div style={{ width: 36, height: 36, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK_SOFT, flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.75" />
                  <path d="M5 10a7 7 0 0 0 14 0M12 17v3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </div>

              {/* Pause teaching (live control) */}
              <div aria-label="Pause teaching" style={{ width: 36, height: 36, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(201, 201, 210, 0.15)', color: INK, flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              </div>

              {/* Cancel teaching (live control) */}
              <div aria-label="Cancel teaching" style={{ width: 36, height: 36, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(240, 246, 252, 0.06)', color: INK_SOFT, flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </div>

              {/* Submit */}
              <div style={{ borderRadius: 9999, padding: '8px 16px', fontSize: 14, fontWeight: 500, background: '#6E6E76', color: '#FFFFFF', flexShrink: 0 }}>
                Ask Doubt
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
