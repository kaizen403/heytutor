import { type ReactNode } from 'react'

const C = {
  section: '#F2F3F7',
  card: '#FFFFFF',
  surface: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  soft: '#737373',
  positive: '#2563EB',
  warn: '#B45309',
  alert: '#DC2626',
  alertBg: '#FCA5A5',
  chart: '#37546D',
} as const

function BentoCard({
  title,
  description,
  children,
  className = '',
}: {
  title: string
  description: string
  children: ReactNode
  className?: string
}) {
  return (
    <article className={`flex flex-col rounded-[20px] p-6 sm:p-8 ${className}`} style={{ background: C.card }}>
      <h3 className="max-w-md text-lg font-semibold leading-snug text-neutral-900 sm:text-xl">{title}</h3>
      <p className="mt-2 max-w-md text-sm font-normal leading-relaxed text-neutral-500">{description}</p>
      <div className="mt-6 flex-1">{children}</div>
    </article>
  )
}

type CellState = 'active' | 'light' | 'alert'

const PRACTICE_ROWS: { name: string; cells: CellState[] }[] = [
  { name: 'Projectile motion', cells: ['active', 'active', 'active', 'active', 'active', 'light', 'alert', 'alert'] },
  { name: 'Chain rule', cells: ['active', 'active', 'active', 'active', 'light', 'light', 'light', 'light'] },
  { name: 'Factoring quadratics', cells: ['active', 'active', 'active', 'active', 'active', 'active', 'active', 'active'] },
  { name: 'Circle theorems', cells: ['active', 'active', 'active', 'light', 'light', 'alert', 'alert', 'alert'] },
  { name: 'Free body diagrams', cells: ['active', 'active', 'active', 'active', 'active', 'active', 'light', 'light'] },
]

function cellColor(state: CellState) {
  if (state === 'active') return '#404040'
  if (state === 'light') return '#D4D4D4'
  return C.alertBg
}

function GapGridMock() {
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 sm:p-5" style={{ background: C.surface }}>
      <div className="space-y-3">
        {PRACTICE_ROWS.map((row) => (
          <div key={row.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:gap-4">
            <span className="truncate text-[11px] font-normal text-neutral-600 sm:text-xs">{row.name}</span>
            <div className="flex gap-1">
              {row.cells.map((cell, i) => (
                <span
                  key={i}
                  className="h-2.5 w-2.5 rounded-[3px] sm:h-3 sm:w-3"
                  style={{ background: cellColor(cell) }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div
        className="absolute bottom-4 left-4 right-4 rounded-xl px-3.5 py-3 sm:left-auto sm:right-5 sm:top-1/2 sm:bottom-auto sm:w-[220px] sm:-translate-y-1/2"
        style={{ background: C.text }}
      >
        <p className="text-[11px] font-normal leading-snug text-neutral-100">
          Practice down 38% on projectile motion
        </p>
        <span
          className="mt-2 inline-block rounded px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide"
          style={{ background: 'rgba(196, 112, 112, 0.25)', color: '#FCA5A5' }}
        >
          Gap signal
        </span>
      </div>
    </div>
  )
}

function DoubtMock() {
  return (
    <div className="rounded-2xl p-4" style={{ background: C.surface }}>
      <div className="mb-3 flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-semibold text-white"
          style={{ background: C.chart }}
        >
          A
        </span>
        <span className="text-[11px] font-medium text-neutral-700">Board follow-up</span>
      </div>
      <div className="rounded-xl px-3 py-2.5" style={{ background: '#F2F3F7' }}>
        <p className="text-[10px] font-medium text-neutral-500">You · just now</p>
        <p className="mt-1 text-[11px] font-normal leading-relaxed text-neutral-800">
          Why did we multiply both sides in step 3? I lost the jump from the diagram.
        </p>
      </div>
      <p className="mt-3 text-[10px] font-normal leading-relaxed text-neutral-500">
        Accelute picks up on the same board. No need to re-explain from scratch.
      </p>
    </div>
  )
}

const TOPIC_PROGRESS = [
  { topic: 'Geometry', detail: 'Volume of cuboid', pct: '100% solid', tone: 'positive' as const },
  { topic: 'Algebra', detail: 'Quadratic factoring', pct: '72% progress', tone: 'warn' as const },
  { topic: 'Physics', detail: 'Projectile motion', pct: '38% review', tone: 'alert' as const },
  { topic: 'Calculus', detail: 'Chain rule', pct: '14% started', tone: 'soft' as const },
]

function pillStyle(tone: (typeof TOPIC_PROGRESS)[number]['tone']) {
  if (tone === 'positive') return { bg: 'rgba(63, 107, 85, 0.12)', color: C.positive }
  if (tone === 'warn') return { bg: 'rgba(180, 83, 9, 0.1)', color: C.warn }
  if (tone === 'alert') return { bg: 'rgba(158, 64, 64, 0.1)', color: C.alert }
  return { bg: 'rgba(0, 0, 0, 0.05)', color: C.soft }
}

function SyllabusMock() {
  return (
    <div className="rounded-2xl p-3 sm:p-4" style={{ background: C.surface }}>
      <div className="divide-y divide-neutral-100">
        {TOPIC_PROGRESS.map((item) => {
          const pill = pillStyle(item.tone)
          return (
            <div key={item.topic} className="flex items-start justify-between gap-3 py-3 first:pt-1 last:pb-1">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-neutral-900">{item.topic}</p>
                <p className="mt-0.5 text-[10px] font-normal text-neutral-500">{item.detail}</p>
              </div>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium"
                style={{ background: pill.bg, color: pill.color }}
              >
                {item.pct}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const CHART_BARS = [92, 78, 65, 52, 44, 38, 32, 28, 24, 20, 18, 16]

function SyllabusChartMock() {
  return (
    <div className="relative rounded-2xl px-4 pb-8 pt-4 sm:px-6 sm:pb-10" style={{ background: C.surface }}>
      <div className="flex h-36 items-end gap-1.5 sm:h-44 sm:gap-2">
        {CHART_BARS.map((height, i) => (
          <div
            key={i}
            className="min-w-0 flex-1 rounded-t-sm"
            style={{ height: `${height}%`, background: C.chart, opacity: 0.85 - i * 0.04 }}
          />
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-14 left-[38%] top-4 border-l border-dashed border-neutral-300 sm:bottom-16" />

      <div className="mt-4 flex justify-between text-[9px] font-medium uppercase tracking-wide text-neutral-400 sm:text-[10px]">
        <span>Your last session</span>
        <span>The rest of the syllabus</span>
      </div>

      <div
        className="absolute left-1/2 top-6 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 sm:top-8"
        style={{ background: C.surface, border: '1px solid rgba(0, 0, 0, 0.08)' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.positive }} />
        <span className="whitespace-nowrap text-[10px] font-medium text-neutral-700 sm:text-[11px]">
          +8 topics ready beyond your last lesson
        </span>
      </div>
    </div>
  )
}

export default function BentoSection() {
  return (
    <section
      id="how-it-works"
      className="landing-section-inset landing-section-rule px-5 py-20 sm:px-8 sm:py-24 lg:px-10 lg:pb-28 lg:pt-28"
      style={{ background: C.section }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[32px] font-medium leading-[1.1] tracking-[-0.02em] text-neutral-900 sm:text-[40px]">
            Treat every topic like it deserves a teacher
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base font-normal leading-relaxed text-neutral-500 sm:text-lg">
            Accelute keeps sight of what you have covered, what needs a follow-up, and what is still waiting on the board.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 lg:mt-14 lg:grid-cols-3 lg:gap-5">
          <BentoCard
            className="lg:col-span-2"
            title="Catch gaps before the exam"
            description="See which topics stopped getting practice, while there is still time to draw through them again."
          >
            <GapGridMock />
          </BentoCard>

          <BentoCard
            title="Ask follow-ups on the same board"
            description="Pause, doubt, and pick up exactly where the last stroke left off."
          >
            <DoubtMock />
          </BentoCard>

          <BentoCard
            title="See what clicked and what is stuck"
            description="Every lesson leaves a trail: mastered steps, half-finished proofs, and topics that need one more pass."
          >
            <SyllabusMock />
          </BentoCard>

          <BentoCard
            className="lg:col-span-2"
            title="Grow across the whole syllabus, not one problem at a time"
            description="Most tutors stop after the question you asked. Accelute keeps building the map around it."
          >
            <SyllabusChartMock />
          </BentoCard>
        </div>
      </div>
    </section>
  )
}
