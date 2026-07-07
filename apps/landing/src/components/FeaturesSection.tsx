import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Check } from 'lucide-react'

const MOCK = {
  bg: '#FAFAF9',
  surface: '#FFFFFF',
  border: 'rgba(0, 0, 0, 0.08)',
  borderSoft: 'rgba(0, 0, 0, 0.06)',
  text: '#171717',
  textMuted: '#525252',
  textSoft: '#737373',
  accent: '#659287',
  accentDark: '#4F7468',
  bubble: '#262626',
  mint: '#FAFAF9',
  positive: '#3F6B55',
  alert: '#9E4040',
} as const

function MockShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-full flex-col rounded-xl p-4"
      style={{
        background: MOCK.bg,
        border: `1px solid ${MOCK.border}`,
      }}
    >
      {children}
    </div>
  )
}

const CHAT_STEPS = [
  {
    title: 'Drawing cuboid',
    tag: 'Geometry',
    detail: 'Label l, w, h on each edge',
  },
  {
    title: 'Writing formula',
    tag: 'Mensuration',
    detail: 'V = l × w × h, then substitute',
  },
] as const

const CHAT_PHASES = [
  { key: 'typing', ms: 1000 },
  { key: 'question', ms: 500 },
  { key: 'step1', ms: 650 },
  { key: 'step2', ms: 650 },
  { key: 'summary', ms: 500 },
  { key: 'hold', ms: 3200 },
] as const

type ChatPhase = (typeof CHAT_PHASES)[number]['key']

function phaseIndex(phase: ChatPhase) {
  return CHAT_PHASES.findIndex((item) => item.key === phase)
}

function TypingIndicator() {
  return (
    <div className="mb-3 flex justify-end">
      <div
        className="flex items-center gap-1 rounded-2xl px-3 py-2.5"
        style={{ background: 'rgba(0, 0, 0, 0.06)' }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="chat-typing-dot h-1.5 w-1.5 rounded-full"
            style={{
              background: MOCK.textSoft,
              animationDelay: `${i * 0.12}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function ChatStepRow({
  title,
  tag,
  detail,
  animate,
}: {
  title: string
  tag: string
  detail: string
  animate: boolean
}) {
  return (
    <div className={`flex items-start gap-2 ${animate ? 'chat-enter-up' : ''}`}>
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} style={{ color: MOCK.positive }} />
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[9px] font-medium uppercase tracking-wide" style={{ color: MOCK.textMuted }}>
            {title}
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide"
            style={{ background: 'rgba(0, 0, 0, 0.05)', color: MOCK.textSoft }}
          >
            {tag}
          </span>
        </div>
        <p className="mt-0.5 text-[10px] font-normal" style={{ color: MOCK.textMuted }}>
          {detail}
        </p>
      </div>
    </div>
  )
}

function chatVisibleStepCount(phase: ChatPhase) {
  const index = phaseIndex(phase)
  if (index < phaseIndex('step1')) return 0
  if (index < phaseIndex('step2')) return 1
  return 2
}

function ChatMock() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [phase, setPhase] = useState<ChatPhase>('typing')
  const [cycleKey, setCycleKey] = useState(0)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduceMotion(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const node = rootRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      { threshold: 0.35 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!active || reduceMotion) {
      setPhase('typing')
      return
    }

    let index = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    const tick = () => {
      if (cancelled) return

      const current = CHAT_PHASES[index]
      setPhase(current.key)

      timer = setTimeout(() => {
        if (cancelled) return
        index = (index + 1) % CHAT_PHASES.length
        if (index === 0) setCycleKey((k) => k + 1)
        tick()
      }, current.ms)
    }

    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [active, reduceMotion])

  if (reduceMotion) {
    return (
      <div ref={rootRef}>
        <MockShell>
          <div className="mb-3 text-[11px] font-medium tracking-normal" style={{ color: MOCK.textMuted }}>
            Chat
          </div>
          <div className="mb-3 flex justify-end">
            <div
              className="max-w-[92%] rounded-2xl px-3.5 py-2.5 text-left"
              style={{ background: MOCK.bubble }}
            >
              <p className="text-[11px] font-normal leading-snug" style={{ color: MOCK.mint }}>
                How do I find the volume of a cuboid step by step?
              </p>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2.5 text-left">
            {CHAT_STEPS.map((step) => (
              <ChatStepRow key={step.title} {...step} animate={false} />
            ))}
            <p className="mt-1 text-[10px] font-normal leading-relaxed" style={{ color: MOCK.textMuted }}>
              Watch it drawn stroke by stroke, with voice narration in sync.
            </p>
          </div>
          <div
            className="mt-3 flex items-center gap-2 rounded-full px-3 py-2"
            style={{ background: MOCK.surface, border: `1px solid ${MOCK.borderSoft}` }}
          >
            <span className="flex-1 text-[10px] font-normal" style={{ color: MOCK.textSoft }}>
              Ask about any topic…
            </span>
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full"
              style={{ background: MOCK.bubble, color: MOCK.mint }}
            >
              <ArrowUp className="h-3 w-3" />
            </span>
          </div>
        </MockShell>
      </div>
    )
  }

  const index = phaseIndex(phase)
  const showTyping = phase === 'typing'
  const showQuestion = index >= phaseIndex('question')
  const visibleStepCount = chatVisibleStepCount(phase)
  const showSummary = index >= phaseIndex('summary')

  return (
    <div ref={rootRef}>
      <MockShell>
        <div className="mb-3 text-[11px] font-medium tracking-normal" style={{ color: MOCK.textMuted }}>
          Chat
        </div>

        <div key={cycleKey}>
          {showTyping && <TypingIndicator />}

          {showQuestion && (
            <div className={`mb-3 flex justify-end ${phase === 'question' ? 'chat-enter-right' : ''}`}>
              <div
                className="max-w-[92%] rounded-2xl px-3.5 py-2.5 text-left"
                style={{ background: MOCK.bubble }}
              >
                <p className="text-[11px] font-normal leading-snug" style={{ color: MOCK.mint }}>
                  How do I find the volume of a cuboid step by step?
                </p>
              </div>
            </div>
          )}

          <div className="flex min-h-[108px] flex-1 flex-col gap-2.5 text-left">
            {CHAT_STEPS.slice(0, visibleStepCount).map((step, stepIndex) => (
              <ChatStepRow
                key={step.title}
                {...step}
                animate={phase === (stepIndex === 0 ? 'step1' : 'step2')}
              />
            ))}

            {showSummary && (
              <p
                className={`mt-1 text-[10px] font-normal leading-relaxed ${phase === 'summary' ? 'chat-enter-up' : ''}`}
                style={{ color: MOCK.textMuted }}
              >
                Watch it drawn stroke by stroke, with voice narration in sync.
              </p>
            )}
          </div>
        </div>

        <div
          className="mt-3 flex items-center gap-2 rounded-full px-3 py-2"
          style={{ background: MOCK.surface, border: `1px solid ${MOCK.borderSoft}` }}
        >
          <span className="flex-1 text-[10px] font-normal" style={{ color: MOCK.textSoft }}>
            Ask about any topic…
          </span>
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full"
            style={{ background: MOCK.bubble, color: MOCK.mint }}
          >
            <ArrowUp className="h-3 w-3" />
          </span>
        </div>
      </MockShell>
    </div>
  )
}

const LESSON_CHECKLIST = [
  { label: 'Topic', value: 'Projectile motion' },
  { label: 'Diagram', value: 'Parabola and launch angle' },
  { label: 'Steps', value: 'Range formula derived' },
  { label: 'Voice', value: 'Narration synced to drawing' },
] as const

const TEMPLATE_PHASES = [
  { key: 'template', ms: 550 },
  { key: 'link', ms: 450 },
  { key: 'check0', ms: 500 },
  { key: 'check1', ms: 500 },
  { key: 'check2', ms: 500 },
  { key: 'check3', ms: 500 },
  { key: 'footer', ms: 550 },
  { key: 'hold', ms: 2800 },
] as const

type TemplatePhase = (typeof TEMPLATE_PHASES)[number]['key'] | 'idle'

function templatePhaseIndex(phase: TemplatePhase) {
  if (phase === 'idle') return -1
  return TEMPLATE_PHASES.findIndex((item) => item.key === phase)
}

function LessonCheckIcon({ animate }: { animate: boolean }) {
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${animate ? 'chat-enter-up' : ''}`}
      style={{ background: MOCK.positive }}
    >
      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
    </span>
  )
}

function TemplatesMock() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [phase, setPhase] = useState<TemplatePhase>('idle')

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduceMotion(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const node = rootRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      { threshold: 0.35 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!active || reduceMotion) return

    let index = 0
    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      const current = TEMPLATE_PHASES[index]
      setPhase(current.key)

      timer = setTimeout(() => {
        index = (index + 1) % TEMPLATE_PHASES.length
        if (index === 0) setPhase('idle')
        tick()
      }, current.ms)
    }

    tick()
    return () => clearTimeout(timer)
  }, [active, reduceMotion])

  const index = templatePhaseIndex(phase)
  const showTemplate = reduceMotion || index >= templatePhaseIndex('template')
  const showLink = reduceMotion || index >= templatePhaseIndex('link')
  const visibleChecks = reduceMotion
    ? LESSON_CHECKLIST.length
    : Math.max(0, index - templatePhaseIndex('check0') + 1)
  const showFooter = reduceMotion || index >= templatePhaseIndex('footer')

  return (
    <div ref={rootRef} className="h-full">
      <div
        className="flex h-full flex-col rounded-2xl p-4"
        style={{ background: '#EEEDEB' }}
      >
        <div className="text-[11px] font-medium" style={{ color: MOCK.textMuted }}>
          Lessons
        </div>

        <div className="mb-2 mt-3 text-[9px] font-medium uppercase tracking-wide" style={{ color: MOCK.textSoft }}>
          Templates
        </div>

        {showTemplate && (
          <div
            className={`rounded-xl px-3 py-2.5 ${phase === 'template' ? 'chat-enter-up' : ''}`}
            style={{ background: MOCK.surface, border: `1px solid ${MOCK.borderSoft}` }}
          >
            <p className="text-[11px] font-medium" style={{ color: MOCK.text }}>
              Projectile motion
            </p>
            <p className="mt-0.5 text-[10px] font-normal" style={{ color: MOCK.textMuted }}>
              Diagram the parabola and derive range
            </p>
          </div>
        )}

        {showLink && (
          <p
            className={`mt-2 text-[10px] font-medium ${phase === 'link' ? 'chat-enter-up' : ''}`}
            style={{ color: MOCK.textMuted }}
          >
            + Describe your own topic
          </p>
        )}

        <div
          className="mt-auto space-y-2.5 pt-4"
          style={{ borderTop: showTemplate ? `1px solid ${MOCK.borderSoft}` : undefined }}
        >
          {LESSON_CHECKLIST.slice(0, Math.min(visibleChecks, LESSON_CHECKLIST.length)).map((item, itemIndex) => (
            <div
              key={item.label}
              className={`flex items-start gap-2 ${
                !reduceMotion && phase === (`check${itemIndex}` as TemplatePhase) ? 'chat-enter-up' : ''
              }`}
            >
              <LessonCheckIcon animate={!reduceMotion && phase === (`check${itemIndex}` as TemplatePhase)} />
              <div className="min-w-0">
                <p className="text-[9px] font-medium uppercase tracking-wide" style={{ color: MOCK.textSoft }}>
                  {item.label}
                </p>
                <p className="text-[10px] font-normal" style={{ color: MOCK.textMuted }}>
                  {item.value}
                </p>
              </div>
            </div>
          ))}

          {showFooter && (
            <div
              className={`flex items-start justify-between gap-2 pt-2 ${phase === 'footer' ? 'chat-enter-up' : ''}`}
              style={{ borderTop: visibleChecks > 0 ? `1px solid ${MOCK.borderSoft}` : undefined }}
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium" style={{ color: MOCK.text }}>
                    Pythagorean proof
                  </span>
                  <span className="text-[8px] font-medium uppercase tracking-wide" style={{ color: MOCK.textSoft }}>
                    Ready
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] font-normal" style={{ color: MOCK.textMuted }}>
                  Right triangle lesson queued
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SessionsMock() {
  const items = [
    {
      topic: 'Geometry',
      status: 'Lesson complete',
      detail: 'Volume of cuboid',
      tone: 'positive' as const,
      ago: '2d',
    },
    {
      topic: 'Algebra',
      status: 'Follow-up ready',
      detail: 'Quadratic by factoring',
      tone: 'positive' as const,
      ago: '1d',
    },
    {
      topic: 'Physics',
      status: 'Diagram drawn',
      detail: 'Free body on a ramp',
      tone: 'neutral' as const,
      ago: '3d',
    },
    {
      topic: 'Calculus',
      status: 'Needs review',
      detail: 'Chain rule step missed',
      tone: 'alert' as const,
      ago: '5d',
    },
  ]

  return (
    <MockShell>
      <div className="mb-3 text-[11px] font-medium" style={{ color: MOCK.textMuted }}>
        Boards
      </div>

      <div className="flex flex-1 flex-col gap-2.5">
        {items.map((item, index) => (
          <div
            key={item.detail}
            className="flex items-start justify-between gap-2 pb-2.5"
            style={{
              borderBottom: index < items.length - 1 ? `1px solid ${MOCK.borderSoft}` : undefined,
            }}
          >
            <div className="min-w-0 text-left">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[10px] font-medium" style={{ color: MOCK.text }}>
                  {item.topic}
                </span>
                <span
                  className="text-[10px] font-normal"
                  style={{
                    color:
                      item.tone === 'positive'
                        ? MOCK.positive
                        : item.tone === 'alert'
                          ? MOCK.alert
                          : MOCK.textMuted,
                  }}
                >
                  {item.status}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[10px] font-normal" style={{ color: MOCK.textMuted }}>
                {item.detail}
              </p>
            </div>
            <span className="shrink-0 text-[9px] font-normal" style={{ color: MOCK.textSoft }}>
              {item.ago}
            </span>
          </div>
        ))}
      </div>
    </MockShell>
  )
}

const FEATURES = [
  {
    mock: ChatMock,
    title: 'Ask anything about any subject.',
    description: 'Proofs, diagrams, timelines, and more are one question away.',
    highlighted: false,
  },
  {
    mock: TemplatesMock,
    title: 'Start from a lesson template.',
    description: 'Pick a topic or describe your own. Accelute plans the board and narration.',
    highlighted: true,
  },
  {
    mock: SessionsMock,
    title: 'See every concept drawn live.',
    description: 'Diagrams, notes, and voice stay in sync, stroke by stroke, out loud.',
    highlighted: false,
  },
] as const

function FeatureCard({
  mock: Mock,
  title,
  description,
  highlighted,
}: {
  mock: () => JSX.Element
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
      <div className="relative mb-6 min-h-[280px] sm:min-h-[300px]">
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
      className="landing-section-inset landing-section-rule relative z-20 -mt-px border-t border-neutral-900/[0.08] bg-[#F5F4F2] pb-20 pt-28 sm:pb-24 sm:pt-36 lg:pb-28 lg:pt-40"
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
