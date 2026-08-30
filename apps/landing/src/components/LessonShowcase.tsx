import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, Copy, Lock, PanelLeft, Plus, RotateCw, Share, Volume2, VolumeX, X,
} from 'lucide-react'
import Reveal from './Reveal'
import DitherColumn from './dither/DitherColumn'
import Logo from './Logo'
import DashboardMockup from './DashboardMockup'
import { LESSON_TITLE, QUESTION_TEXT } from './hero-lesson/lessonScript'
import { useLessonSimulation, type SoundState } from './hero-lesson/useLessonSimulation'
import { slice, useScrollProgress } from '../lib/useScrollProgress'

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

const CAPTIONS = [
  { k: 'Draws while it talks', v: 'Every stroke lands in time with the narration.' },
  { k: 'Interrupt any time', v: 'Ask a doubt and it answers on the same board.' },
  { k: 'Keep the whole thing', v: 'Replay the lesson or take the notes with you.' },
]

/* macOS window-control colours, with the highlight the real ones carry. */
const LIGHTS = [
  { fill: '#FF5F57', ring: '#E0443E' },
  { fill: '#FEBC2E', ring: '#DEA123' },
  { fill: '#28C840', ring: '#1AAB29' },
]

function TrafficLights() {
  return (
    <span className="flex shrink-0 items-center gap-[5px] sm:gap-[8px]" aria-hidden>
      {LIGHTS.map((l) => (
        <span
          key={l.fill}
          className="block h-2 w-2 rounded-full sm:h-3 sm:w-3"
          style={{
            background: `radial-gradient(circle at 32% 26%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 58%), ${l.fill}`,
            boxShadow: `inset 0 0 0 0.5px ${l.ring}`,
          }}
        />
      ))}
    </span>
  )
}

const ToolIcon = ({ children }: { children: React.ReactNode }) => (
  <span className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[#9A9AA0]">
    {children}
  </span>
)

function SafariChrome({ sound, onToggle }: { sound: SoundState; onToggle: () => void }) {
  const muted = sound !== 'on'
  const showSpeaker = sound === 'off' || sound === 'on'
  return (
    <div className="select-none">
      {/* Scoped so this does not touch the shared stylesheet. Breathes the tab's
          speaker glyph just enough to be found, without a ring that Safari
          would never draw. */}
      <style>{`
        @keyframes lsn-audio-hint { 0%,100% { opacity: 0.55 } 50% { opacity: 1 } }
        .lsn-audio-hint { animation: lsn-audio-hint 2.4s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) { .lsn-audio-hint { animation: none } }
      `}</style>

      {/* Unified toolbar: window controls inline, address field centred. */}
      <div
        className="flex h-[34px] items-center gap-1.5 px-2 sm:h-[46px] sm:gap-2 sm:px-3.5"
        style={{
          background: 'linear-gradient(180deg,#3B3B3D 0%,#333335 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.09)',
        }}
      >
        <TrafficLights />
        <span className="ml-1.5 hidden items-center gap-0.5 sm:flex">
          <ToolIcon><PanelLeft size={14} /></ToolIcon>
          <ToolIcon><ChevronLeft size={15} /></ToolIcon>
          <ToolIcon><ChevronRight size={15} /></ToolIcon>
        </span>

        <span
          className="mx-auto flex h-[21px] w-[46%] min-w-[108px] items-center justify-center gap-1 rounded-[5px] px-2 text-[8.5px] text-[#D8D8DC] sm:h-[28px] sm:w-[40%] sm:min-w-[190px] sm:gap-1.5 sm:rounded-[7px] sm:px-3 sm:text-[12px]"
          style={{ background: 'rgba(255,255,255,0.11)', boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.07)' }}
        >
          <Lock size={10} className="shrink-0 text-[#9C9C9E]" aria-hidden />
          <span className="truncate">accelute.co</span>
          <RotateCw size={10} className="ml-auto hidden shrink-0 text-[#9C9C9E] sm:block" aria-hidden />
        </span>

        <span className="hidden items-center gap-0.5 sm:flex">
          <ToolIcon><Share size={14} /></ToolIcon>
          <ToolIcon><Plus size={15} /></ToolIcon>
          <ToolIcon><Copy size={13} /></ToolIcon>
        </span>
      </div>

      {/* Tab bar — the lesson is the active tab. */}
      <div
        className="flex h-[26px] items-stretch gap-px px-1 sm:h-[36px] sm:px-1.5"
        style={{
          background: '#2A2A2C',
          boxShadow: 'inset 0 1px 0 rgba(0,0,0,0.35), inset 0 -1px 0 rgba(0,0,0,0.4)',
        }}
      >
        <span
          className="my-[3px] flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-2 text-[8.5px] text-[#E8E8EA] sm:my-[4px] sm:gap-2 sm:rounded-[7px] sm:px-2.5 sm:text-[11.5px] sm:max-w-[360px]"
          style={{ background: '#3C3C3E', boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.07)' }}
        >
          {/* The product's real brand mark, not a letter tile. */}
          <Logo className="h-[13px] w-[13px] shrink-0 text-[#F0F5F7]" />
          <span className="truncate">Accelute — {LESSON_TITLE}</span>
          {/* Safari puts the audio control on the tab itself. */}
          {showSpeaker && (
            <button
              type="button"
              data-sound-toggle
              onClick={onToggle}
              aria-label={muted ? 'Play lesson voice' : 'Mute lesson voice'}
              title={muted ? 'Play with sound' : 'Mute'}
              className={`ml-auto flex h-[13px] w-[13px] shrink-0 cursor-pointer items-center justify-center rounded-[3px] transition-colors hover:bg-white/10 sm:h-[17px] sm:w-[17px] sm:rounded-[4px] ${
                muted ? 'text-sky-400 lsn-audio-hint' : 'text-[#C9C9CE]'
              }`}
            >
              {muted ? <VolumeX size={11} aria-hidden /> : <Volume2 size={11} aria-hidden />}
            </button>
          )}
          <span aria-hidden className="flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] text-[#9C9C9E] sm:h-[17px] sm:w-[17px] sm:rounded-[4px]">
            <X size={11} />
          </span>
        </span>
        <span
          className="my-[4px] hidden min-w-0 flex-1 items-center gap-2 rounded-[7px] px-2.5 text-[11.5px] text-[#9C9C9E] sm:flex sm:max-w-[220px]"
        >
          <span aria-hidden className="h-[13px] w-[13px] shrink-0 rounded-[3px] bg-[#4A4A4C]" />
          <span className="truncate">Pythagorean theorem</span>
        </span>
        <span aria-hidden className="ml-1 hidden w-6 shrink-0 items-center justify-center text-[#9C9C9E] sm:flex">
          <Plus size={13} />
        </span>
      </div>
    </div>
  )
}

/* The mockup's design size; the window body scales it to fit, exactly like
   DashboardStage does for the use-cases section. */
const DESIGN_W = 1280
const DESIGN_H = 762
/* The mockup's sidebar is 264px of the design width. Below the sm breakpoint
   the window frames only the main column — the same thing the shipping product
   does with its sidebar on a phone — so the board stays the subject instead of
   shrinking the whole desktop UI into a thumbnail. */
const SIDEBAR_W = 264
const MOBILE_MQ = '(max-width: 639px)'

/**
 * The live, self-driving mockup inside the Safari window — the same
 * DashboardMockup /record.html renders, running its own lesson on its own
 * clock. The simulation observes the window body, so the lesson pauses itself
 * when the window scrolls offscreen (and reduced-motion users get the
 * completed board with sound 'unavailable' — no poster branch needed).
 */
function LiveLessonWindow() {
  const bodyRef = useRef<HTMLDivElement>(null)
  const { snapshot, sound, toggleSound, boardRef, cursorState } = useLessonSimulation(bodyRef)
  const [view, setView] = useState({ fit: 0, cropSidebar: false })

  useEffect(() => {
    const node = bodyRef.current
    if (!node) return
    const mobile = window.matchMedia(MOBILE_MQ)
    const measure = () => {
      const crop = mobile.matches
      setView({ fit: node.clientWidth / (crop ? DESIGN_W - SIDEBAR_W : DESIGN_W), cropSidebar: crop })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    mobile.addEventListener('change', measure)
    return () => {
      observer.disconnect()
      mobile.removeEventListener('change', measure)
    }
  }, [])

  const { fit, cropSidebar } = view

  return (
    <>
      <SafariChrome sound={sound} onToggle={toggleSound} />
      <div ref={bodyRef} className="overflow-hidden" style={{ height: DESIGN_H * fit }}>
        <div
          className="origin-top-left"
          style={{
            width: DESIGN_W,
            height: DESIGN_H,
            transform: `translateX(${cropSidebar ? -SIDEBAR_W * fit : 0}px) scale(${fit})`,
          }}
        >
          <DashboardMockup
            drive={{ question: QUESTION_TEXT, snapshot, sound, toggleSound, boardRef, cursorState }}
          />
        </div>
      </div>
    </>
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

/**
 * The window unfolds on scroll: it arrives tilted back and slightly oversized,
 * rotates flat as it reaches the middle of the screen, then eases back out.
 * Scroll-driven rather than a one-shot entrance, so it stays alive the whole
 * way past.
 */
function LiftedBoard() {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)
  const p = useScrollProgress(ref)

  /* Unfold values traced from the canonical implementation of this effect:
     · LINEAR, not eased — the measured rotateX deltas across the window are
       flat (~3deg per 60px of scroll), and an ease reads as a slow-down.
     · The scale SHRINKS. Rotating back foreshortens the card, so it has to
       start oversized to hold a constant apparent size; growing while it
       flattens is what makes an unfold lurch.
     · Origin is the card's centre, not its top edge.
     · The card itself does not travel — translateY belongs to the copy above. */
  const rise = slice(p, 0.1, 0.42) // ≈ one viewport-third of scroll
  const settle = slice(p, 0.68, 0.99)

  const tilt = 18 * (1 - rise) - 3 * settle
  const scale = 1.045 - 0.045 * rise - 0.02 * settle
  const lift = Math.max(0, rise - 0.55 * settle)

  return (
    <div ref={ref} style={{ perspective: '1000px', perspectiveOrigin: '50% 50%' }}>
      <div
        className="relative will-change-transform"
        style={{
          transform: `rotateX(${tilt.toFixed(2)}deg) scale(${(scale * (hover ? 1.008 : 1)).toFixed(4)})`,
          transformOrigin: '50% 50%',
          transition: 'transform 300ms cubic-bezier(0.22,1,0.36,1)',
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {/* Depth cues are painted once and only faded — never re-blurred. A blur
            radius animating per scroll tick would repaint the playing video
            underneath every frame; opacity stays on the compositor. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-24 -bottom-28 top-4 rounded-[100px] bg-[radial-gradient(56%_54%_at_50%_58%,rgba(89,175,212,0.32)_0%,transparent_72%)] blur-[56px]"
          style={{ opacity: lift * (hover ? 1 : 0.82), transition: 'opacity 320ms ease' }}
        />
        <SafariWindow>
          <LiveLessonWindow />
        </SafariWindow>
        {/* Floor: a reflected sheen under the laptop, not a mirrored video. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-full h-20 rounded-[40px]"
          style={{
            background:
              'linear-gradient(180deg, rgba(89,175,212,0.18) 0%, rgba(89,175,212,0.05) 34%, transparent 78%)',
            filter: 'blur(16px)',
            opacity: lift,
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
         through from the hero. Pulled up over the sea's last navy so the two
         boxes never meet on an edge. */
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
            Diagrams drawn stroke by stroke, notes written as the tutor talks it through. Hit the
            speaker on the tab to hear the lesson.
          </p>
        </Reveal>

        <div className="mx-auto mt-12 max-w-[62rem] sm:mt-14">
          <LiftedBoard />
        </div>

        {/* The list is the observer, so its items stagger on one IO rather
            than the wrapper revealing and the row landing all at once. */}
        <Reveal
          group
          as="ul"
          delay={140}
          className="glass rim-sky mx-auto mt-14 grid max-w-4xl overflow-hidden rounded-2xl sm:mt-16 sm:grid-cols-3"
        >
          {CAPTIONS.map((c, i) => (
            <li
              key={c.k}
              className={`px-5 py-5 sm:px-6 ${
                i > 0 ? 'border-t border-[rgba(202,229,241,0.10)] sm:border-l sm:border-t-0' : ''
              }`}
            >
              <p className="type-accent-xs text-sky-300">{c.k}</p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-brand-muted-dark">{c.v}</p>
            </li>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
