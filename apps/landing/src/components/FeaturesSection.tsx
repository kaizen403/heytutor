import type { ReactNode } from 'react'
import { Check, Download, Play, ScrollText } from 'lucide-react'

/* The tutor's dark-studio palette (same tokens as the real dashboard) */
const TUTOR = {
  bg: '#0B0B0C',
  panel: '#151517',
  raised: '#1E1E21',
  border: '#2E2E33',
  line: 'rgba(242, 242, 244, 0.08)',
  ink: '#F2F2F4',
  soft: '#A6A6AE',
  faint: '#717177',
  accent: '#C9C9D2',
  cta: '#6E6E76',
  navy: '#1B2A4A',
  bubble: 'rgba(22, 27, 34, 0.94)',
  replay: '#5FA4F9',
} as const

const CAVEAT = "'Caveat', cursive"

function TutorPanel({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-full flex-1 flex-col gap-2.5 rounded-xl p-3"
      style={{ background: TUTOR.bg, border: `1px solid ${TUTOR.border}` }}
    >
      {children}
    </div>
  )
}

function PanelLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] font-medium" style={{ color: TUTOR.soft }}>
      {children}
    </div>
  )
}

function TeachingChip() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-medium"
      style={{ background: 'rgba(201, 201, 210, 0.12)', color: TUTOR.accent }}
    >
      <span className="h-1 w-1 rounded-full" style={{ background: TUTOR.accent }} />
      teaching…
    </span>
  )
}

function PhotoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ color: TUTOR.soft, flexShrink: 0 }} aria-hidden>
      <rect x="3.5" y="6" width="17" height="13" rx="2.25" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="8.5" cy="10.25" r="1.35" fill="currentColor" />
      <path d="M7 17.5l4.2-4.4a1.2 1.2 0 0 1 1.7 0L17.5 17.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MicIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ color: TUTOR.soft, flexShrink: 0 }} aria-hidden>
      <rect x="9" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.75" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

function MiniDoubtInput({ placeholder }: { placeholder: string }) {
  return (
    <div
      className="mt-auto flex items-center gap-1.5 rounded-full px-2 py-1.5"
      style={{ background: TUTOR.panel, border: `1px solid ${TUTOR.border}` }}
    >
      <PhotoIcon />
      <span className="flex-1 truncate text-left italic" style={{ fontSize: 9.5, color: TUTOR.faint }}>
        {placeholder}
      </span>
      <MicIcon />
      <span
        className="shrink-0 rounded-full px-2.5 py-1"
        style={{ background: TUTOR.cta, color: '#FFFFFF', fontSize: 9.5, fontWeight: 500 }}
      >
        Ask Doubt
      </span>
    </div>
  )
}

function MarkerCursor({ style }: { style: React.CSSProperties }) {
  return (
    <svg width="10" height="25" viewBox="-8 -36 16 40" style={style} aria-hidden>
      <path d="M 0 0 L -2.8 -5 L 2.8 -5 Z" fill={TUTOR.navy} />
      <rect x="-3.9" y="-7" width="7.8" height="2.2" rx="0.5" fill="#B8B8B8" />
      <rect x="-3.6" y="-11" width="7.2" height="4" rx="0.6" fill="#C62828" />
      <rect x="-3.6" y="-28" width="7.2" height="17" rx="1.2" fill="#1A1A1A" stroke="#0A0A0A" strokeWidth="0.7" />
      <rect x="-3.9" y="-33" width="7.8" height="5" rx="2" fill="#111111" />
    </svg>
  )
}

/* ── Card 1: the live whiteboard lesson ─────────────────────────────── */

function LiveLessonMock() {
  return (
    <TutorPanel>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[-0.01em]" style={{ color: TUTOR.ink, textTransform: 'capitalize' }}>
          Volume of cuboid
        </span>
        <TeachingChip />
      </div>

      {/* mini whiteboard frame + cream surface */}
      <div
        className="relative flex-1 rounded-[10px]"
        style={{
          background: 'linear-gradient(145deg, #1E1E21 0%, #19191C 40%, #151517 100%)',
          boxShadow: '0 12px 28px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(240, 246, 252, 0.07)',
        }}
      >
        <div
          className="absolute overflow-hidden rounded-[4px]"
          style={{
            inset: 8,
            background: 'linear-gradient(180deg, #FFFFFF 0%, #F6F8FA 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.05)',
          }}
        >
          {/* handwritten working */}
          <div style={{ position: 'absolute', left: 12, top: 10, fontFamily: CAVEAT, color: TUTOR.navy, fontSize: 14, fontWeight: 500, lineHeight: 1.35 }}>
            <div>V = l × w × h</div>
            <div>V = 10 × 8 × 6</div>
            <div>V = 480</div>
          </div>

          {/* cuboid diagram */}
          <svg width="120" height="86" viewBox="0 0 140 100" fill="none" style={{ position: 'absolute', right: 10, top: 16 }} aria-hidden>
            <path d="M 20 35 L 95 35 L 95 80 L 20 80 Z" stroke={TUTOR.navy} strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M 20 35 L 45 15 L 120 15 L 95 35 Z" stroke={TUTOR.navy} strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M 95 35 L 120 15 L 120 60 L 95 80 Z" stroke={TUTOR.navy} strokeWidth="2.2" strokeLinejoin="round" />
            <text x="57" y="74" fill={TUTOR.navy} fontSize="11" fontFamily={CAVEAT} textAnchor="middle">l</text>
            <text x="110" y="27" fill={TUTOR.navy} fontSize="11" fontFamily={CAVEAT} textAnchor="middle">w</text>
            <text x="112" y="55" fill={TUTOR.navy} fontSize="11" fontFamily={CAVEAT} textAnchor="middle">h</text>
          </svg>

          <MarkerCursor
            style={{ position: 'absolute', left: 52, top: 40, transform: 'rotate(-35deg)', transformOrigin: '5px 22.5px' }}
          />

          {/* narration bubble */}
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              background: TUTOR.bubble,
              border: '1px solid rgba(240, 246, 252, 0.1)',
              borderRadius: 8,
              padding: '6px 10px',
              maxWidth: '92%',
            }}
          >
            <p className="text-center" style={{ fontSize: 9, fontWeight: 500, color: TUTOR.ink, lineHeight: 1.4, margin: 0, whiteSpace: 'nowrap' }}>
              length times width times height
            </p>
          </div>
        </div>
      </div>

      <MiniDoubtInput placeholder="Ask a doubt…" />
    </TutorPanel>
  )
}

/* ── Card 2: doubts mid-lesson ──────────────────────────────────────── */

const DOUBT_CHAT = [
  { from: 'student' as const, text: 'wait, why is the midpoint at 4.5 V?' },
  { from: 'tutor' as const, text: 'the two 4.7 kΩ resistors split the 9 V equally, watch the board.' },
  { from: 'student' as const, text: 'got it. and if the resistors aren’t equal?' },
  { from: 'tutor' as const, text: 'then the voltage splits by resistance ratio. let me show you.' },
]

function DoubtBubble({ from, text }: { from: 'student' | 'tutor'; text: string }) {
  const isStudent = from === 'student'
  return (
    <div className={`flex ${isStudent ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[86%] rounded-2xl px-3 py-2 text-left"
        style={{
          background: isStudent ? TUTOR.raised : TUTOR.panel,
          border: `1px solid ${isStudent ? TUTOR.border : TUTOR.line}`,
        }}
      >
        <p style={{ margin: 0, fontSize: 10, lineHeight: 1.45, color: TUTOR.ink }}>{text}</p>
        {!isStudent && (
          <p className="mt-1 flex items-center gap-1" style={{ margin: '4px 0 0', fontSize: 8, color: TUTOR.soft }}>
            <span className="inline-block h-1 w-1 rounded-full" style={{ background: TUTOR.accent }} />
            answering on the board
          </p>
        )}
      </div>
    </div>
  )
}

function DoubtChatMock() {
  return (
    <TutorPanel>
      <div className="flex items-center justify-between">
        <PanelLabel>Doubt chat</PanelLabel>
        <TeachingChip />
      </div>

      <div className="flex flex-1 flex-col gap-2">
        {DOUBT_CHAT.map((message) => (
          <DoubtBubble key={message.text} {...message} />
        ))}
      </div>

      <MiniDoubtInput placeholder="Ask a doubt or question…" />
    </TutorPanel>
  )
}

/* ── Card 3: notes / PDF intake + replay / transcript / downloads ───── */

const ATTACHMENTS = [
  { name: 'chapter-4-notes.pdf', meta: 'PDF · 6 pages read' },
  { name: 'IMG_2401.jpg', meta: 'Photo · question read in 1.2s' },
] as const

function AttachmentRow({ name, meta }: { name: string; meta: string }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg p-2.5"
      style={{ background: TUTOR.panel, border: `1px solid ${TUTOR.line}` }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
        style={{ background: TUTOR.raised, border: `1px solid ${TUTOR.border}` }}
      >
        <PhotoIcon />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate" style={{ margin: 0, fontSize: 10, fontWeight: 500, color: TUTOR.ink }}>
          {name}
        </p>
        <p style={{ margin: '1px 0 0', fontSize: 8.5, color: TUTOR.soft }}>{meta}</p>
      </div>
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
        style={{ background: 'rgba(201, 201, 210, 0.15)' }}
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} style={{ color: TUTOR.accent }} />
      </span>
    </div>
  )
}

function ToolPill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5"
      style={{ background: TUTOR.raised, border: `1px solid ${TUTOR.border}` }}
    >
      {icon}
      <span style={{ fontSize: 9, fontWeight: 500, color: TUTOR.soft }}>{label}</span>
    </div>
  )
}

function LectureToolsMock() {
  return (
    <TutorPanel>
      <PanelLabel>From your notes</PanelLabel>

      <div className="flex flex-col gap-2">
        {ATTACHMENTS.map((file) => (
          <AttachmentRow key={file.name} {...file} />
        ))}
      </div>

      <div className="mt-1">
        <PanelLabel>Replay &amp; keep</PanelLabel>
      </div>

      {/* replay scrubber */}
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
          style={{ background: 'rgba(240, 246, 252, 0.1)' }}
        >
          <Play className="h-2.5 w-2.5" style={{ color: TUTOR.ink, fill: TUTOR.ink }} />
        </span>
        <div className="relative h-1 flex-1 rounded-full" style={{ background: 'rgba(240, 246, 252, 0.12)' }}>
          <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: '42%', background: TUTOR.replay }} />
          <div
            className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
            style={{ left: '42%', background: '#FFFFFF', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }}
          />
        </div>
        <span style={{ fontSize: 8.5, color: TUTOR.soft, fontVariantNumeric: 'tabular-nums' }}>1:32 / 3:40</span>
      </div>

      <div className="mt-auto flex gap-1.5">
        <ToolPill icon={<ScrollText className="h-3 w-3" style={{ color: TUTOR.soft }} />} label="Transcript" />
        <ToolPill icon={<Download className="h-3 w-3" style={{ color: TUTOR.accent }} />} label="Download notes" />
      </div>
    </TutorPanel>
  )
}

/* ── Section ────────────────────────────────────────────────────────── */

const FEATURES = [
  {
    mock: LiveLessonMock,
    title: 'Watch it teach live on the whiteboard.',
    description:
      'Diagrams, notes, and voice stay in sync stroke by stroke, out loud. Pause, resume, or stop the lesson anytime.',
    highlighted: true,
  },
  {
    mock: DoubtChatMock,
    title: 'Ask doubts the moment they hit.',
    description:
      'Interrupt mid-lesson, ask a follow-up, or paste a photo of a question, and the tutor answers and picks right back up.',
    highlighted: false,
  },
  {
    mock: LectureToolsMock,
    title: 'Chat through the whole lecture. Keep the notes.',
    description:
      'Teach straight from your photos and PDFs, replay any lesson at your pace, read the transcript, and download the notes.',
    highlighted: false,
  },
] as const

function FeatureCard({
  mock: Mock,
  title,
  description,
  highlighted,
}: {
  mock: () => ReactNode
  title: string
  description: string
  highlighted?: boolean
}) {
  return (
    <article
      className={`flex flex-col rounded-[20px] bg-white p-5 sm:p-6 ${
        highlighted ? 'border-2 border-neutral-900' : 'border border-neutral-200'
      }`}
    >
      <div className="relative mb-6 flex min-h-[280px] flex-col sm:min-h-[300px]">
        <Mock />
      </div>

      <h3 className="text-left text-lg font-semibold leading-snug text-neutral-900 sm:text-xl">
        {title}
      </h3>
      <p className="mt-2 text-left text-sm font-normal leading-relaxed text-neutral-500 sm:text-[15px]">
        {description}
      </p>
    </article>
  )
}

export default function FeaturesSection() {
  return (
    <section
      id="features"
      className="landing-section-inset landing-section-rule relative z-20 -mt-px border-t border-black/[0.08] bg-brand-section pb-20 pt-28 sm:pb-24 sm:pt-36 lg:pb-28 lg:pt-40"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[32px] font-medium leading-[1.1] tracking-[-0.02em] text-neutral-900 sm:text-[40px]">
            Put your whole textbook to work
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base font-normal leading-relaxed text-neutral-500 sm:text-lg">
            Accelute turns every question, follow-up, and concept into a live whiteboard lesson.
          </p>
        </div>

        <div className="mt-14 grid gap-6 lg:mt-16 lg:grid-cols-3 lg:gap-7">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </div>
    </section>
  )
}
