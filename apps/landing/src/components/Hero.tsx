import { useRef, useState, type FormEvent } from 'react'
import { ArrowUp, Play, Volume2, VolumeX } from 'lucide-react'
import Navbar from './Navbar'
import ChalkComet from './ChalkComet'
import { TUTOR_APP_HREF, tutorQuestionHref } from '../lib/tutorAppHref'

const BG_IMAGE = 'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260611_133301_d5f2a94a-b22e-4e4a-a6b6-eacdddf1f5b0.png&w=1280&q=85'
const GRASS_IMAGE = 'https://res.cloudinary.com/dy5er7kv5/image/upload/q_auto/f_auto/v1781191264/grass_eam204.png'

function HeroLessonVideo() {
  const [reduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const videoRef = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    const next = !muted
    video.muted = next
    if (!next && video.paused) void video.play().catch(() => {})
    setMuted(next)
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        border: '1px solid rgba(0, 0, 0, 0.6)',
        boxShadow: '0 -20px 80px rgba(0, 0, 0, 0.45)',
      }}
    >
      <style>{`@keyframes hero-unmute-pulse { 0% { box-shadow: 0 0 0 0 rgba(22, 27, 34, 0.45); } 100% { box-shadow: 0 0 0 10px rgba(22, 27, 34, 0); } }`}</style>
      {reduced ? (
        <img
          src="/hero/lesson-poster.jpg"
          alt="Accelute tutor teaching a kinematics lesson on a whiteboard"
          className="block h-auto w-full"
        />
      ) : (
        <>
          <video
            ref={videoRef}
            className="block h-auto w-full"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster="/hero/lesson-poster.jpg"
            role="img"
            aria-label="Accelute tutor teaching a kinematics lesson on a whiteboard"
          >
            <source src="/hero/lesson-loop.webm" type="video/webm" />
            <source src="/hero/lesson-loop.mp4" type="video/mp4" />
          </video>
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Play lesson voice' : 'Mute lesson voice'}
            title={muted ? 'Play with sound' : 'Mute'}
            className="absolute bottom-3 right-3 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-white transition-transform hover:scale-105 sm:bottom-4 sm:right-4"
            style={{
              background: 'rgba(22, 27, 34, 0.85)',
              border: '1px solid rgba(240, 246, 252, 0.16)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              animation: muted ? 'hero-unmute-pulse 1.8s ease-out infinite' : undefined,
            }}
          >
            {muted ? <VolumeX size={15} aria-hidden /> : <Volume2 size={15} aria-hidden />}
          </button>
        </>
      )}
    </div>
  )
}

export default function Hero() {
  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const question = new FormData(event.currentTarget).get('question')
    if (typeof question !== 'string' || !question.trim()) return
    window.location.assign(tutorQuestionHref(question))
  }

  return (
    <div
      className="relative flex min-h-[100svh] flex-col overflow-x-clip bg-cover bg-center"
      style={{ backgroundImage: `url(${BG_IMAGE})` }}
    >
      <Navbar />

      <ChalkComet className="absolute inset-0 z-[5] pointer-events-none overflow-hidden" />

      <div className="flex-1 min-h-4 shrink-0 sm:min-h-8" />

      <div className="relative z-20 flex flex-col items-center px-5 text-center sm:px-8 lg:px-10">
        <h1 className="type-h1 text-brand-fg">
          <span className="block animate-fade-up">Learn every subject</span>
          <span className="block animate-fade-up [animation-delay:100ms]">
            the way <span className="text-brand-primary">teachers</span> actually teach it.
          </span>
        </h1>

        <form
          className="animate-fade-up mt-6 w-full max-w-xl sm:mt-7"
          style={{ animationDelay: '220ms' }}
          onSubmit={submitQuestion}
        >
          <div className="flex items-center gap-3 rounded-full bg-white py-1.5 pl-5 pr-1.5 shadow-lg shadow-black/10 ring-1 ring-brand-border">
            <input
              type="text"
              name="question"
              required
              maxLength={1000}
              placeholder="e.g. explain photosynthesis step by step"
              className="flex-1 bg-transparent py-2.5 text-sm text-brand-fg-soft outline-none placeholder:text-brand-muted sm:text-base"
            />
            <button
              type="submit"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-cta text-white transition-transform hover:scale-105 active:scale-95 sm:h-11 sm:w-11"
              aria-label="Submit"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </div>
        </form>

        <p
          className="animate-fade-up mt-5 max-w-lg text-sm leading-relaxed text-brand-muted-dark sm:mt-6 sm:text-base lg:text-lg"
          style={{ animationDelay: '340ms' }}
        >
          Type a question. Watch an AI tutor draw diagrams,
          write notes, and talk you through every step,
          stroke by stroke, out loud.
        </p>

        <div
          className="animate-fade-up mt-6 flex flex-wrap items-center justify-center gap-3 sm:mt-7"
          style={{ animationDelay: '460ms' }}
        >
          <a
            href={TUTOR_APP_HREF}
            className="flex items-center gap-2 rounded-full bg-brand-cta px-6 py-3 text-sm font-medium text-white transition-all hover:bg-brand-fg-soft hover:shadow-lg"
          >
            <Play className="h-4 w-4" />
            Try it free
          </a>
          <a
            href="#how-it-works"
            className="rounded-full px-6 py-3 text-sm font-medium text-brand-fg-soft ring-1 ring-brand-border transition-colors hover:bg-black/5"
          >
            See how it works
          </a>
        </div>
      </div>

      <div data-comet-lane className="h-[132px] w-full shrink-0 sm:h-[150px] lg:h-[168px]" />

      <div className="animate-hero-rise relative z-30 mx-auto w-[94%] max-w-5xl shrink-0 -mb-10 sm:w-[90%] sm:-mb-20 lg:w-[86%] lg:-mb-32"
        style={{ animationDelay: '620ms' }}
      >
        <HeroLessonVideo />
      </div>

      {/* Grass overlay */}
      <img
        src={GRASS_IMAGE}
        alt=""
        className="hero-grass-blend pointer-events-none absolute bottom-0 left-0 z-10 w-full select-none"
      />

      {/* Soft edge only where grass meets the next section */}
      <div
        aria-hidden
        className="hero-edge-blend pointer-events-none absolute inset-x-0 bottom-0 z-[11] h-6 sm:h-8"
      />
    </div>
  )
}
