import { useEffect, useRef, useState } from 'react'
import {
  AnimatePresence,
  LazyMotion,
  animate,
  domAnimation,
  m,
  useReducedMotion,
  type AnimationPlaybackControls,
} from 'motion/react'
import Reveal from '../Reveal'
import DitherHalo from '../dither/DitherHalo'
import PixelSparkle from '../dither/PixelSparkle'
import PixelGlyph, { type PixelGlyphName } from './PixelGlyph'
import DashboardStage, { type StageFocus } from './DashboardStage'
import SketchWallpaper from '../sketch/SketchWallpaper'
import type { BeatId } from './useUseCaseDemo'

interface UseCase {
  id: string
  title: string
  body: string
  glyph: PixelGlyphName
  /** Which scripted beat the dashboard performs. */
  beat: BeatId
  /** Which part of the dashboard that beat is framed on. */
  focus: StageFocus
}

const EASE_OUT = [0.22, 1, 0.36, 1] as const

/** How long each use case holds the stage before the rail moves on. */
const DWELL_S = 7

const USE_CASES: UseCase[] = [
  {
    id: 'draw',
    title: 'Ask, And Watch It Drawn',
    body: 'Type the question and the tutor takes it from there — planning the scene, laying down the axes, then drawing the circuits stroke by stroke while it talks you through each one.',
    glyph: 'burst',
    beat: 'ask',
    focus: { origin: [0.56, 0.62], scale: 1.08 },
  },
  {
    id: 'annotate',
    title: 'Marked Up Like A Teacher',
    body: 'The diagram does not arrive finished. Values, congruence ticks, braces and the boxed answer go on the way a teacher marks a board — each one drawn from the figure’s own geometry.',
    glyph: 'frame',
    beat: 'annotate',
    focus: { origin: [0.62, 0.42], scale: 1.7 },
  },
  {
    id: 'doubt',
    title: 'Interrupt With A Doubt',
    body: 'Cut in mid-stroke and ask. The lesson stops, the board clears, and your doubt gets its own answer with the interrupted question carried along as context.',
    glyph: 'interrupt',
    beat: 'doubt',
    focus: { origin: [0.58, 0.94], scale: 1.75 },
  },
  {
    id: 'replay',
    title: 'Replay The Whole Lesson',
    body: 'Every lesson stays on its own board. Press replay and the strokes lay themselves down again, at half speed or triple, narration and all.',
    glyph: 'rewind',
    beat: 'replay',
    focus: { origin: [0.87, 0.055], scale: 2.1 },
  },
  {
    id: 'notes',
    title: 'Take The Notes With You',
    body: 'The working on the board is the notes. Download the whole lesson as a PDF — diagrams, steps and answers — and revise from it later without the tutor.',
    glyph: 'notes',
    beat: 'notes',
    focus: { origin: [0.94, 0.055], scale: 2.1 },
  },
]

export default function UseCasesSection() {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  // Latches true the first time the section is on screen and never goes back,
  // so the board starts drawing when someone can actually watch it.
  const [seen, setSeen] = useState(false)
  const reduced = useReducedMotion() ?? false
  const sectionRef = useRef<HTMLElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)
  const controls = useRef<AnimationPlaybackControls | null>(null)

  // The rail only advances while the section is actually on screen — otherwise
  // you arrive having already missed two or three of the four.
  useEffect(() => {
    const node = sectionRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting)
        setPaused(!visible)
        if (visible) setSeen(true)
      },
      { threshold: 0.25 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // The dwell timer *is* the progress bar: one scroll-free transform animation
  // whose completion hands the stage to the next use case.
  useEffect(() => {
    if (reduced || !barRef.current) return
    let cancelled = false
    const playback = animate(
      barRef.current,
      { scaleX: [0, 1] },
      {
        duration: DWELL_S,
        ease: 'linear',
        onComplete: () => {
          if (!cancelled) setActive((current) => (current + 1) % USE_CASES.length)
        },
      },
    )
    controls.current = playback
    return () => {
      cancelled = true
      playback.stop()
      controls.current = null
    }
  }, [active, reduced])

  useEffect(() => {
    const playback = controls.current
    if (!playback) return
    if (paused) playback.pause()
    else playback.play()
  }, [paused, active])

  const current = USE_CASES[active]!

  return (
    <LazyMotion features={domAnimation} strict>
      <section
        ref={sectionRef}
        id="use-cases"
        /* Full-bleed and background-free; the tone comes from <band-steel>,
           masked away at both ends so the section has no edge to show. */
        className="relative overflow-hidden px-5 pb-16 pt-32 sm:px-8 sm:pb-32 sm:pt-36 lg:px-10 lg:pb-36 lg:pt-44"
      >
        <div aria-hidden className="band-steel pointer-events-none absolute inset-0" />
        {/* Notebook margin: faint sketched formulas in the bare navy around
            the rail and stage, above the band wash and below the content. */}
        <SketchWallpaper variant="use-cases" className="z-[1]" />
        {/* Halftone bloom behind the heading, dissolving outward */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-[0.22]"
          style={{
            WebkitMaskImage: 'radial-gradient(58% 62% at 50% 34%, #000 0%, transparent 78%)',
            maskImage: 'radial-gradient(58% 62% at 50% 34%, #000 0%, transparent 78%)',
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
              From the first question to the last revision — Accelute draws it, marks it up,
              answers the doubt, and hands you the notes.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-8 lg:mt-16 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-12">
            {/* ── The rail ── */}
            <Reveal variant="left" className="lg:pt-2">
              <ul onMouseLeave={() => setPaused(false)}>
                {USE_CASES.map((useCase, index) => {
                  const isActive = index === active
                  return (
                    <li key={useCase.id} className="border-b border-[rgba(202,229,241,0.13)]">
                      <button
                        type="button"
                        onClick={() => setActive(index)}
                        onMouseEnter={() => setPaused(true)}
                        aria-expanded={isActive}
                        aria-controls={`use-case-${useCase.id}`}
                        className="group flex w-full items-center gap-4 py-5 text-left"
                      >
                        <span
                          className={`flex-1 font-heading text-xl leading-tight tracking-[-0.015em] transition-colors duration-300 sm:text-[26px] ${
                            isActive ? 'text-frost' : 'text-frost/45 group-hover:text-frost/75'
                          }`}
                        >
                          {useCase.title}
                        </span>
                        <PixelGlyph
                          name={useCase.glyph}
                          className={`h-4 w-4 shrink-0 transition-colors duration-300 ${
                            isActive ? 'text-sky-500' : 'text-frost/25 group-hover:text-sky-500/60'
                          }`}
                        />
                      </button>

                      <AnimatePresence initial={false}>
                        {isActive ? (
                          <m.div
                            id={`use-case-${useCase.id}`}
                            key="body"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{
                              height: { duration: 0.42, ease: EASE_OUT },
                              opacity: { duration: 0.28, ease: 'linear' },
                            }}
                            className="overflow-hidden"
                          >
                            <p className="pb-5 pr-6 text-sm leading-relaxed text-brand-muted-dark">
                              {useCase.body}
                            </p>
                            <div className="mb-5 h-px w-full overflow-hidden bg-white/[0.07]">
                              <span
                                ref={barRef}
                                className="block h-full w-full origin-left bg-gradient-to-r from-sky-600 to-sky-400"
                                style={{ transform: reduced ? 'scaleX(1)' : 'scaleX(0)' }}
                              />
                            </div>
                          </m.div>
                        ) : null}
                      </AnimatePresence>
                    </li>
                  )
                })}
              </ul>
            </Reveal>

            {/* ── The stage ── */}
            <Reveal variant="right" delay={120}>
              <div
                className="metal-frame relative overflow-hidden rounded-[22px] p-2 sm:p-2.5"
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
              >
                {/* Light travelling the bezel, so the hardware is never static. */}
                <span className="metal-sheen" aria-hidden />

                {/* Halftone grounding in the corners, well off the screen. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-40"
                  style={{
                    backgroundImage: 'radial-gradient(rgba(202,229,241,0.18) 1px, transparent 1px)',
                    backgroundSize: '9px 9px',
                    WebkitMaskImage: 'radial-gradient(74% 68% at 50% 50%, transparent 52%, #000 100%)',
                    maskImage: 'radial-gradient(74% 68% at 50% 50%, transparent 52%, #000 100%)',
                  }}
                />

                {/* Sparkle sits behind the screen and is held off its centre, so
                    it lights the rim rather than the board. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-[0.42]"
                  style={{
                    WebkitMaskImage: 'radial-gradient(72% 66% at 50% 48%, transparent 46%, #000 100%)',
                    maskImage: 'radial-gradient(72% 66% at 50% 48%, transparent 46%, #000 100%)',
                  }}
                >
                  <PixelSparkle density={3.5} period={5.5} />
                </div>

                <div className="relative aspect-[4/3] w-full sm:aspect-[16/10]">
                  <DashboardStage
                    beat={current.beat}
                    focus={current.focus}
                    paused={paused}
                    active={seen}
                  />
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </LazyMotion>
  )
}
