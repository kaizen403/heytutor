import {
  ChevronLeft, ChevronRight, Copy, Lock, PanelLeft, Plus, RotateCw, Share, Volume2, VolumeX, X,
} from 'lucide-react'
import Logo from '../Logo'
import metadata from '../hero-lesson/lessonMetadata.json'
import type { SoundState } from '../hero-lesson/useHeroVideo'

const LESSON_TITLE = metadata.title

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

/** Safari's unified toolbar and tab bar. Kept out of the lazy lesson chunk so
    the window frame paints with the page, before the live board arrives. */
export default function SafariChrome({ sound, onToggle }: { sound: SoundState; onToggle: () => void }) {
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
        @keyframes lsn-listen-pulse {
          0%,100% { box-shadow: 0 10px 30px -8px rgba(0,0,0,0.55), 0 0 0 0 rgba(89,175,212,0.35); }
          50% { box-shadow: 0 10px 30px -8px rgba(0,0,0,0.55), 0 0 0 6px rgba(89,175,212,0.0); }
        }
        .lsn-listen { animation: lsn-listen-pulse 2.4s ease-in-out infinite }
        @media (prefers-reduced-motion: reduce) {
          .lsn-audio-hint, .lsn-listen { animation: none }
        }
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
          <span className="truncate">Accelute: {LESSON_TITLE}</span>
          {/* Safari puts the audio control on the tab itself. */}
          {showSpeaker && (
            <button
              type="button"
              data-sound-toggle
              onClick={onToggle}
              aria-label={muted ? 'Play lesson voice' : 'Mute lesson voice'}
              title={muted ? 'Play with sound' : 'Mute'}
              className={`ml-auto flex h-8 w-8 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-[4px] transition-colors hover:bg-white/10 sm:h-6 sm:w-6 sm:rounded-[5px] ${
                muted ? 'text-sky-400 lsn-audio-hint' : 'text-[#C9C9CE]'
              }`}
            >
              {muted ? <VolumeX size={13} aria-hidden /> : <Volume2 size={13} aria-hidden />}
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
