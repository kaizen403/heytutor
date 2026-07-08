import { Pencil } from 'lucide-react'

const CHROME = '#111827'
const CHROME_SOFT = '#1F2937'
const ACCENT = '#2563EB'
const ACCENT_LIGHT = '#5FA4F9'
const ON_DARK = '#F8F9FA'
const BOARD_BG = '#EDF3FD'
const BOARD_STROKE = '#37546D'

export default function DashboardMockup() {
  return (
    <div
      className="overflow-hidden rounded-t-2xl text-left shadow-[0_-20px_80px_rgba(37,99,235,0.18)]"
      style={{ background: CHROME, border: '1px solid rgba(37,99,235,0.15)' }}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ background: CHROME, borderBottom: '1px solid rgba(37,99,235,0.12)' }}
      >
        <div className="flex gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F56]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FFBD2E]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#27C93F]" />
        </div>
        <div className="mx-auto flex items-center gap-1.5 rounded-md px-6 py-1" style={{ background: CHROME_SOFT }}>
          <span className="text-[10px]" style={{ color: ACCENT_LIGHT }}>accelute.ai</span>
        </div>
        <div style={{ width: 48 }} />
      </div>

      {/* Body */}
      <div className="flex" style={{ height: '440px' }}>
        {/* Sidebar */}
        <div
          className="flex w-[20%] flex-col px-3 py-3.5"
          style={{ background: CHROME, borderRight: '1px solid rgba(37,99,235,0.1)' }}
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded" style={{ background: ACCENT }}>
              <Pencil className="h-3 w-3 text-white" />
            </div>
            <span className="text-[11px] font-semibold" style={{ color: ON_DARK }}>Accelute</span>
          </div>

          <div className="mb-3">
            <div className="mb-1.5 text-[8px] font-medium uppercase tracking-wider" style={{ color: `${ACCENT_LIGHT}80` }}>Boards</div>
            <div className="flex flex-col gap-1.5">
              {['Volume of cuboid', 'Pythagorean theorem', 'Area of rectangle'].map((t, i) => (
                <div
                  key={t}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5"
                  style={{
                    background: i === 0 ? 'rgba(37,99,235,0.12)' : 'transparent',
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: i === 0 ? ACCENT : 'rgba(95,164,249,0.35)' }}
                  />
                  <span
                    className="text-[9px]"
                    style={{ color: i === 0 ? ON_DARK : 'rgba(95,164,249,0.65)' }}
                  >
                    {t}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-auto">
            <div
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2"
              style={{ background: 'rgba(37,99,235,0.08)' }}
            >
              <span className="text-[9px]" style={{ color: ACCENT_LIGHT }}>New board</span>
            </div>
          </div>
        </div>

        {/* Main content: whiteboard */}
        <div className="flex flex-1 flex-col">
          {/* Status bar */}
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: '1px solid rgba(37,99,235,0.08)' }}
          >
            <span className="text-[11px] font-medium" style={{ color: ON_DARK }}>Volume of cuboid</span>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: ACCENT_LIGHT }} />
              <span className="text-[10px]" style={{ color: ACCENT_LIGHT }}>teaching…</span>
            </div>
          </div>

          {/* Whiteboard canvas */}
          <div className="relative flex-1 p-3">
            <div
              className="relative h-full w-full overflow-hidden rounded-lg"
              style={{
                background: BOARD_BG,
                border: `5px solid ${BOARD_STROKE}`,
                borderRadius: '8px',
                boxShadow: 'inset 0 2px 6px rgba(37,99,235,0.08)',
              }}
            >
              {/* Corner grips */}
              {[
                { top: 0, left: 0, r: '8px 0 0 0' },
                { top: 0, right: 0, r: '0 8px 0 0' },
                { bottom: 0, left: 0, r: '0 0 0 8px' },
                { bottom: 0, right: 0, r: '0 0 8px 0' },
              ].map((c, i) => (
                <div
                  key={i}
                  className="absolute h-4 w-4"
                  style={{
                    ...c,
                    background: 'rgba(37,99,235,0.15)',
                    borderRadius: c.r,
                  }}
                />
              ))}

              {/* Drawn shapes: cuboid (isometric) */}
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 600 350" fill="none">
                <path
                  d="M 150 130 L 300 130 L 300 220 L 150 220 Z"
                  stroke={BOARD_STROKE}
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path
                  d="M 150 130 L 200 90 L 350 90 L 300 130 Z"
                  stroke={BOARD_STROKE}
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path
                  d="M 300 130 L 350 90 L 350 180 L 300 220 Z"
                  stroke={BOARD_STROKE}
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <text x="210" y="180" fill={BOARD_STROKE} fontSize="13" fontFamily="cursive">l</text>
                <text x="310" y="105" fill={BOARD_STROKE} fontSize="13" fontFamily="cursive">w</text>
                <text x="330" y="160" fill={BOARD_STROKE} fontSize="13" fontFamily="cursive">h</text>
                <text x="170" y="270" fill={BOARD_STROKE} fontSize="18" fontFamily="cursive" fontWeight="500">
                  V = l × w × h
                </text>
                <text x="170" y="300" fill={BOARD_STROKE} fontSize="14" fontFamily="cursive" opacity="0.6">
                  = 10 × 8 × 6 = 480
                </text>
              </svg>

              {/* Chalk cursor */}
              <div
                className="absolute"
                style={{
                  left: '42%',
                  top: '52%',
                  width: 0,
                  height: 0,
                }}
              >
                <div
                  style={{
                    width: 7,
                    height: 27,
                    background: ACCENT,
                    borderRadius: '3px 3px 5px 5px',
                    transform: 'rotate(-35deg)',
                    transformOrigin: 'top center',
                    boxShadow: '0 0 8px rgba(37,99,235,0.35)',
                    marginLeft: -3.5,
                  }}
                />
              </div>

              {/* Narration bubble */}
              <div
                className="absolute left-1/2 top-3 -translate-x-1/2 rounded-lg px-4 py-2"
                style={{
                  background: 'rgba(17,24,39,0.92)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(37,99,235,0.25)',
                }}
              >
                <span className="text-[11px] font-medium" style={{ color: ON_DARK }}>
                  the volume of a cuboid is length times width times height
                </span>
              </div>
            </div>
          </div>

          {/* Input bar */}
          <div className="px-4 pb-3">
            <div
              className="flex items-center gap-2 rounded-full px-4 py-2"
              style={{
                background: 'rgba(31,41,55,0.92)',
                border: '1px solid rgba(37,99,235,0.2)',
              }}
            >
              <Pencil className="h-3.5 w-3.5 shrink-0" style={{ color: ACCENT_LIGHT }} />
              <span className="text-[10px]" style={{ color: 'rgba(95,164,249,0.6)' }}>Ask anything…</span>
              <div className="ml-auto">
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full"
                  style={{ background: ACCENT }}
                >
                  <span className="text-[9px] font-bold text-white">Ask</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
