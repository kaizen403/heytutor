import { Suspense, lazy, useRef, type RefObject } from 'react'
import Reveal from './Reveal'
import DitherColumn from './dither/DitherColumn'
import SafariChrome from './lesson-showcase/SafariChrome'
import { useNearViewport } from '../lib/useNearViewport'

/* ═══════════════════════════════════════════════════════════════════════════
   The lesson showcase — the product, running in a Safari window.

   A dark app UI dropped straight onto the page reads as a hole punched in it;
   inside a browser window it reads as software, which is what it is. Built to
   Safari's real proportions: 12px window radius, traffic lights inline in a
   unified toolbar, a separate tab bar, and the mute control living where
   Safari actually puts it — as the speaker glyph on the tab playing audio.
   The shadow is a macOS key-window stack (tight contact + wide ambient), which
   is what makes a floating window read as floating.
   ═══════════════════════════════════════════════════════════════════════════ */

/* The whiteboard renderer and the lesson voice are the heaviest things on the
   page, and none of it is on the first screen, so the live window is its own
   chunk, fetched once the section is within reach. */
const LiveLessonWindow = lazy(() => import('./lesson-showcase/LiveLessonWindow'))

/** How far ahead of the viewport the live window starts loading. */
const PRELOAD_MARGIN = '150% 0px'

const noop = () => {}

/** The window before the live board arrives: the real chrome over a body the
    exact shape of the mockup (1016×762 cropped on phones, 1280×762 above),
    so nothing moves when it swaps in. */
function WindowPlaceholder() {
  return (
    <>
      <SafariChrome sound="loading" onToggle={noop} />
      <div className="aspect-[1016/762] bg-[#0B0B0C] sm:aspect-[1280/762]" />
    </>
  )
}

function LessonWindow({ visibilityRootRef }: { visibilityRootRef: RefObject<HTMLElement | null> }) {
  const near = useNearViewport(visibilityRootRef, PRELOAD_MARGIN)
  if (!near) return <WindowPlaceholder />
  return (
    <Suspense fallback={<WindowPlaceholder />}>
      <LiveLessonWindow visibilityRootRef={visibilityRootRef} />
    </Suspense>
  )
}

/** A floating macOS Safari window: 12px radius, key-window shadow stack. */
function SafariWindow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative overflow-hidden rounded-[9px] sm:rounded-[12px]"
      style={{
        background: '#1E1E20',
        boxShadow: [
          // Hairline edge, then the light rim macOS draws along a window's top.
          '0 0 0 0.5px rgba(0,0,0,0.55)',
          'inset 0 0 0 0.5px rgba(255,255,255,0.10)',
          // Contact shade through to a wide ambient pool — the graduated
          // falloff is what reads as "floating" rather than "pasted on".
          '0 8px 18px rgba(3,11,18,0.30)',
          '0 26px 44px rgba(3,11,18,0.30)',
          '0 60px 90px rgba(3,11,18,0.28)',
          '0 110px 140px rgba(3,11,18,0.20)',
        ].join(', '),
      }}
    >
      {children}
    </div>
  )
}

/** A stable product frame. The demo never zooms or crops while visitors scroll. */
function LiftedBoard() {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref}>
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-24 -bottom-28 top-4 rounded-[100px] bg-[radial-gradient(56%_54%_at_50%_58%,rgba(89,175,212,0.32)_0%,transparent_72%)] blur-[56px]"
          style={{ opacity: 0.72 }}
        />
        <SafariWindow>
          <LessonWindow visibilityRootRef={ref} />
        </SafariWindow>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-full h-20 rounded-[40px]"
          style={{
            background:
              'linear-gradient(180deg, rgba(89,175,212,0.18) 0%, rgba(89,175,212,0.05) 34%, transparent 78%)',
            filter: 'blur(16px)',
            opacity: 0.7,
          }}
        />
      </div>
    </div>
  )
}

export default function LessonShowcase() {
  return (
    <section
      id="lesson"
      /* No background of its own: the shared navy field in App.tsx runs straight
         through the hero and backers strip. The small overlap blends the lesson
         into the bottom of the backers section without an edge. */
      className="relative -mt-8 overflow-hidden px-5 pb-20 pt-16 sm:px-8 sm:pb-24 sm:pt-20 lg:px-10 lg:pb-28"
    >
      <div aria-hidden className="band-lift pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-36 bg-gradient-to-b from-[#06121C] to-transparent"
      />
      <div
        aria-hidden
        className="fx-grid-fine pointer-events-none absolute inset-0 opacity-70"
        style={{
          WebkitMaskImage: 'radial-gradient(70% 55% at 50% 46%, #000 0%, transparent 78%)',
          maskImage: 'radial-gradient(70% 55% at 50% 46%, #000 0%, transparent 78%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(46%_100%_at_50%_0%,rgba(127,196,226,0.16)_0%,transparent_70%)]"
        style={{
          WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, transparent 18%, #000 48%)',
          maskImage: 'linear-gradient(180deg, transparent 0%, transparent 18%, #000 48%)',
        }}
      />

      {/* The window is capped at 62rem inside a 72rem column, so on wide screens
          there is bare navy either side of it. These fill it with the same
          pixel field as the hero's sea, drifting slowly enough to sit beside a
          playing video without competing with it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 hidden w-[16%] opacity-[0.5] xl:block"
        style={{
          WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 26%, #000 74%, transparent 100%)',
          maskImage: 'linear-gradient(180deg, transparent 0%, #000 26%, #000 74%, transparent 100%)',
        }}
      >
        <DitherColumn side="left" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[16%] opacity-[0.5] xl:block"
        style={{
          WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 26%, #000 74%, transparent 100%)',
          maskImage: 'linear-gradient(180deg, transparent 0%, #000 26%, #000 74%, transparent 100%)',
        }}
      >
        <DitherColumn side="right" speed={1.7} />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="pill-eyebrow type-accent-s inline-flex items-center gap-2 rounded-full px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
            A real lesson
          </span>
          <h2 className="type-h2 mt-5 text-frost">
            Watch it happen <span className="text-ice">on the whiteboard</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base font-normal leading-relaxed text-brand-muted-dark sm:text-lg">
            Diagrams drawn stroke by stroke, notes written as the AI tutor talks it through. Unmute
            to hear the lesson in time with the ink.
          </p>
        </Reveal>

        <div className="mx-auto mt-12 max-w-[62rem] sm:mt-14">
          <LiftedBoard />
        </div>
      </div>
    </section>
  )
}
