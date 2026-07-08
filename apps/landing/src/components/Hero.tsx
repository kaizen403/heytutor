import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Play } from 'lucide-react'
import Navbar from './Navbar'
import DashboardMockup from './DashboardMockup'

const DESIGN_WIDTH = 896
const BG_IMAGE = 'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260611_133301_d5f2a94a-b22e-4e4a-a6b6-eacdddf1f5b0.png&w=1280&q=85'
const GRASS_IMAGE = 'https://res.cloudinary.com/dy5er7kv5/image/upload/q_auto/f_auto/v1781191264/grass_eam204.png'

function ScaledDashboard() {
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [innerHeight, setInnerHeight] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    const inner = innerRef.current
    if (!container || !inner) return

    const update = () => {
      const containerWidth = container.offsetWidth
      const newScale = containerWidth / DESIGN_WIDTH
      setScale(newScale)
      setInnerHeight(inner.offsetHeight)
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(container)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="w-full" style={{ height: innerHeight * scale }}>
      <div
        ref={innerRef}
        style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: `${DESIGN_WIDTH}px` }}
      >
        <DashboardMockup />
      </div>
    </div>
  )
}

export default function Hero() {
  return (
    <div
      className="relative flex min-h-[100svh] flex-col overflow-hidden bg-cover bg-center"
      style={{ backgroundImage: `url(${BG_IMAGE})` }}
    >
      <Navbar />

      <div className="flex-1 min-h-8 shrink-0 sm:min-h-12 lg:min-h-16" />

      <div className="relative z-20 flex flex-col items-center px-5 text-center sm:px-8 lg:px-10">
        <h1 className="font-heading text-[40px] font-medium leading-[1.05] tracking-[-0.03em] text-brand-fg min-[400px]:text-[44px] sm:text-6xl lg:text-7xl xl:text-[80px]">
          <span className="block animate-fade-up">Learn every subject</span>
          <span className="block animate-fade-up [animation-delay:100ms]">
            the way <span className="text-brand-primary">teachers</span> actually teach it.
          </span>
        </h1>

        <form
          className="animate-fade-up mt-6 w-full max-w-xl sm:mt-7"
          style={{ animationDelay: '220ms' }}
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-3 rounded-full bg-white py-1.5 pl-5 pr-1.5 shadow-lg shadow-black/10 ring-1 ring-brand-border">
            <input
              type="text"
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
            href="/app"
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

      <div className="flex-1 min-h-10 shrink-0 sm:min-h-12 lg:min-h-16" />

      <div className="animate-hero-rise relative z-0 mx-auto w-[92%] max-w-4xl shrink-0 -mb-10 sm:w-[84%] sm:-mb-20 lg:w-[72%] lg:-mb-32"
        style={{ animationDelay: '620ms' }}
      >
        <ScaledDashboard />
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
