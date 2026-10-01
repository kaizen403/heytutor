import { useEffect, useRef, useState } from 'react'
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
} from 'motion/react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import Reveal from '../Reveal'
import DitherHalo from '../dither/DitherHalo'
import PixelSparkle from '../dither/PixelSparkle'
import PixelGlyph, { type PixelGlyphName } from './PixelGlyph'
import DashboardStage from './DashboardStage'
import SketchWallpaper from '../sketch/SketchWallpaper'
import { useUseCaseDemo } from './useUseCaseDemo'
import type { BeatId } from './demoTimeline'
import { DEMO_STEPS } from './demoCopy'

interface UseCase {
  id: string
  title: string
  body: string
  glyph: PixelGlyphName
  /** Which scripted beat the dashboard performs. */
  beat: BeatId
}

const USE_CASES: UseCase[] = [
  {
    id: 'draw',
    title: 'Ask, And Watch It Unfold',
    body: 'Type a question or share a photo of the problem. Accelute draws the figure, writes the working, and explains each step out loud, in time with the ink.',
    glyph: 'burst',
    beat: 'ask',
  },
  {
    id: 'annotate',
    title: 'Follow Every Step',
    body: 'See how the answer takes shape. The figure stays beside the working, so you can connect each equation to what it means as the tutor explains.',
    glyph: 'frame',
    beat: 'annotate',
  },
  {
    id: 'doubt',
    title: 'Circle It. Ask Your Doubt.',
    body: 'Click Ask Doubt, type your question, and circle the part you did not follow. The tutor understands the marked step and answers right on the same board. Then continue the lecture from where you paused.',
    glyph: 'interrupt',
    beat: 'doubt',
  },
  {
    id: 'replay',
    title: 'Revisit At Your Own Pace',
    body: 'Replay the board and voice together. Seek to the moment you need, jump between chapters, or change the speed until the explanation clicks.',
    glyph: 'rewind',
    beat: 'replay',
  },
  {
    id: 'notes',
    title: 'Take The Lesson With You',
    body: 'Keep the diagrams and worked steps as PDF notes, or download the narrated lecture as a video. Your explanation is ready to revisit whenever you want to revise.',
    glyph: 'notes',
    beat: 'notes',
  },
]

const EASE_OUT = [0.22, 1, 0.36, 1] as const

export default function UseCasesSection() {
  const [active, setActive] = useState(2)
  const [playing, setPlaying] = useState(true)
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  const [documentVisible, setDocumentVisible] = useState(() => !document.hidden)
  const [manual, setManual] = useState(false)
  const [run, setRun] = useState(0)
  const reduced = useReducedMotion() ?? false
  const stageRef = useRef<HTMLDivElement>(null)
  const current = USE_CASES[active]!
  const frame = useUseCaseDemo(
    current.beat,
    playing,
    visible && documentVisible,
    reduced,
    run,
    () => {
      if (!manual) setActive((index) => (index + 1) % USE_CASES.length)
    },
  )

  // Start when the screen itself is in view, not while only the heading shows.
  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(
          Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.65),
        )
      },
      { threshold: 0.65 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const update = () => setDocumentVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  const select = (index: number) => {
    setActive(index)
    setRun((value) => value + 1)
    setManual(true)
    setPlaying(true)
  }

  return (
    <LazyMotion features={domAnimation} strict>
      <section
        id="use-cases"
        /* Full-bleed and background-free; the tone comes from <band-steel>,
           masked away at both ends so the section has no edge to show. */
        className="relative overflow-hidden px-5 pb-16 pt-32 sm:px-8 sm:pb-32 sm:pt-36 lg:px-10 lg:pb-36 lg:pt-44"
      >
        <div
          aria-hidden
          className="band-steel pointer-events-none absolute inset-0"
        />
        {/* Notebook margin: faint sketched formulas in the bare navy around
            the rail and stage, above the band wash and below the content. */}
        <SketchWallpaper variant="use-cases" className="z-[1]" />
        {/* Halftone bloom behind the heading, dissolving outward */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-[0.22]"
          style={{
            WebkitMaskImage:
              'radial-gradient(58% 62% at 50% 34%, #000 0%, transparent 78%)',
            maskImage:
              'radial-gradient(58% 62% at 50% 34%, #000 0%, transparent 78%)',
          }}
        >
          <DitherHalo />
        </div>
        <div className="relative z-10 mx-auto max-w-6xl">
          <Reveal className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 text-sm text-brand-muted">
              <PixelGlyph name="burst" className="h-3.5 w-3.5 text-sky-500" />
              Use cases
            </p>
            <h2 className="type-h2 mt-4 text-frost">
              A Teacher For Every Part Of The{' '}
              <span className="font-hand text-ice">Lesson</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base font-normal leading-relaxed text-brand-muted-dark sm:text-lg">
              Watch it unfold. Circle what did not click. Come back until it
              does. A lesson that moves with you, from the first question to the
              last revision.
            </p>
          </Reveal>

          <div className="mt-14 grid grid-cols-1 gap-8 lg:mt-16 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-12">
            {/* ── The rail ── */}
            <Reveal variant="left" className="min-w-0 lg:pt-2">
              <ul aria-label="Choose a use-case demo">
                {USE_CASES.map((useCase, index) => {
                  const isActive = index === active
                  return (
                    <li
                      key={useCase.id}
                      className="border-b border-[rgba(202,229,241,0.13)]"
                    >
                      <button
                        type="button"
                        onClick={() => select(index)}
                        onFocus={() => setManual(true)}
                        aria-expanded={isActive}
                        aria-controls={`use-case-${useCase.id}`}
                        className="use-case-rail-button group flex w-full items-center gap-4 py-5 text-left"
                      >
                        <span
                          className={`flex-1 font-heading text-xl leading-tight tracking-[-0.015em] transition-colors duration-300 sm:text-[26px] ${
                            isActive
                              ? 'text-frost'
                              : 'text-frost/45 group-hover:text-frost/75'
                          }`}
                        >
                          {useCase.title}
                        </span>
                        <PixelGlyph
                          name={useCase.glyph}
                          className={`h-4 w-4 shrink-0 transition-colors duration-300 ${
                            isActive
                              ? 'text-sky-500'
                              : 'text-frost/25 group-hover:text-sky-500/60'
                          }`}
                        />
                      </button>
                      <AnimatePresence initial={false}>
                        {isActive && (
                          <m.div
                            id={`use-case-${useCase.id}`}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{
                              height: {
                                duration: reduced ? 0 : 0.42,
                                ease: EASE_OUT,
                              },
                              opacity: {
                                duration: reduced ? 0 : 0.28,
                                ease: 'linear',
                              },
                            }}
                            className="overflow-hidden"
                          >
                            <p className="pb-5 pr-6 text-sm leading-relaxed text-brand-muted-dark">
                              {useCase.body}
                            </p>
                            <div className="mb-5 h-px w-full overflow-hidden bg-white/[0.07]">
                              <span
                                className="block h-full w-full origin-left bg-gradient-to-r from-sky-600 to-sky-400"
                                style={{
                                  transform: `scaleX(${frame.progress})`,
                                }}
                              />
                            </div>
                          </m.div>
                        )}
                      </AnimatePresence>
                    </li>
                  )
                })}
              </ul>
            </Reveal>

            {/* ── The stage ── */}
            <Reveal variant="right" delay={120} className="min-w-0">
              <div
                ref={stageRef}
                id="use-case-stage"
                className="metal-frame relative overflow-hidden rounded-[22px] p-2 sm:p-2.5"
              >
                {/* Light travelling the bezel, so the hardware is never static. */}
                <span className="metal-sheen" aria-hidden />

                {/* Halftone grounding in the corners, well off the screen. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-40"
                  style={{
                    backgroundImage:
                      'radial-gradient(rgba(202,229,241,0.18) 1px, transparent 1px)',
                    backgroundSize: '9px 9px',
                    WebkitMaskImage:
                      'radial-gradient(74% 68% at 50% 50%, transparent 52%, #000 100%)',
                    maskImage:
                      'radial-gradient(74% 68% at 50% 50%, transparent 52%, #000 100%)',
                  }}
                />

                {/* Sparkle sits behind the screen and is held off its centre, so
                    it lights the rim rather than the board. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-[0.42]"
                  style={{
                    WebkitMaskImage:
                      'radial-gradient(72% 66% at 50% 48%, transparent 46%, #000 100%)',
                    maskImage:
                      'radial-gradient(72% 66% at 50% 48%, transparent 46%, #000 100%)',
                  }}
                >
                  <PixelSparkle density={3.5} period={5.5} />
                </div>

                <div className="relative w-full">
                  <DashboardStage frame={frame} />
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between gap-3 text-[11px] text-brand-muted-dark">
                <span className="font-accent uppercase tracking-[0.12em]">
                  Product walkthrough
                </span>
                {!reduced && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="use-case-control flex h-8 w-8 items-center justify-center rounded-full border border-white/10"
                      aria-label="Restart this demo"
                      onClick={() => {
                        setRun((value) => value + 1)
                        setPlaying(true)
                        setManual(true)
                      }}
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      type="button"
                      className="use-case-control flex h-8 w-8 items-center justify-center rounded-full border border-white/10"
                      aria-label={playing ? 'Pause demo' : 'Play demo'}
                      onClick={() => setPlaying((value) => !value)}
                    >
                      {playing ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                  </div>
                )}
              </div>
              <ol
                className="mt-3 grid grid-cols-4 gap-2"
                aria-label="Walkthrough steps"
              >
                {DEMO_STEPS[current.beat].map((label, index) => (
                  <li
                    key={label}
                    aria-current={index === frame.step ? 'step' : undefined}
                    className={`border-t pt-2 text-[10px] leading-relaxed transition-colors sm:text-[11px] ${index <= frame.step ? 'border-sky-500/60 text-frost' : 'border-white/10 text-brand-muted'}`}
                  >
                    <span className="mr-1 font-accent text-sky-500">
                      0{index + 1}
                    </span>
                    {label}
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </div>
      </section>
    </LazyMotion>
  )
}
