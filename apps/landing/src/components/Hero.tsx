import { Play } from 'lucide-react'
import Navbar from './Navbar'
import PenPlotter from './pen/PenPlotter'
import HeroPixelDecor from './pixel/HeroPixelDecor'
import DitherWave from './dither/DitherWave'
import Button from './ui/Button'
import BackedByYC from './BackedByYC'
import SketchWallpaper from './sketch/SketchWallpaper'
import { CAL_BOOKING_HREF } from '../lib/calHref'

export default function Hero() {
  return (
    <div className="fx-aurora relative flex min-h-[100svh] flex-col overflow-x-clip">
      {/* Notebook margin: faint sketched formulas in the hero's bare corners
          and margins — above the aurora, below the pen's ink and the pixel
          decor, and well clear of the headline and the graph lane. */}
      <SketchWallpaper variant="hero" mode="bold" className="z-[2]" />
      {/* Ambient light, hung from the top of the page */}
      <div
        aria-hidden
        className="animate-aurora pointer-events-none absolute left-1/2 top-[-22%] z-[1] h-[520px] w-[min(1100px,140vw)] -translate-x-1/2 rounded-full bg-[rgba(89,175,212,0.22)] blur-[120px]"
      />
      <div
        aria-hidden
        className="animate-aurora pointer-events-none absolute left-[-14%] top-[2%] z-[1] h-[420px] w-[520px] rounded-full bg-[rgba(95,164,249,0.18)] blur-[110px] [animation-delay:-7s]"
      />
      <div
        aria-hidden
        className="animate-aurora pointer-events-none absolute right-[-12%] top-[-8%] z-[1] h-[380px] w-[460px] rounded-full bg-[rgba(89,175,212,0.14)] blur-[100px] [animation-delay:-12s]"
      />

      <Navbar />

      {/* A pen flies in from off-screen left, draws the axes, labels them,
          writes v = u + at and the acceleration curve, then leaves frame to
          the right — all one continuous stroke path. */}
      <PenPlotter className="absolute inset-0 z-[5] pointer-events-none overflow-hidden" />

      {/* A student's desk, scattered through the empty outer thirds. */}
      <HeroPixelDecor className="absolute inset-0 z-[4]" />

      <div className="min-h-4 flex-[0.35] shrink-0 sm:min-h-8" />

      <div className="relative z-20 flex flex-col items-center px-5 text-center sm:px-8 lg:px-10">
        <BackedByYC className="animate-fade-down mb-6 sm:mb-7" />
        <h1 className="type-h1 type-h1--hero text-frost">
          <span className="block animate-fade-up">An AI that teaches every subject</span>
          <span className="block animate-fade-up [animation-delay:100ms]">
            the way <span className="text-ice">teachers</span> actually teach it.
          </span>
        </h1>

        <div
          className="animate-fade-up mt-7 flex flex-wrap items-center justify-center gap-3 sm:mt-8"
          style={{ animationDelay: '220ms' }}
        >
          <Button
            href={CAL_BOOKING_HREF}
            size="lg"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Play className="h-4 w-4" />
            Try it free
          </Button>
          <Button href="#lesson" variant="ghost" size="lg">
            See how it works
          </Button>
        </div>
      </div>

      {/* PenPlotter measures this box and lays the whole scene out inside it.
          It grows on tall viewports; the graph anchors to its bottom edge. */}
      <div
        data-pen-stage
        className="w-full flex-1 shrink-0 basis-[150px] sm:basis-[170px] lg:basis-[190px]"
      />

      {/* The pixel sea. It sits below the graph lane with a little clear water
          between the crests and the drawn x-axis, and fuses solid at the hero's
          foot; <DitherBand> in App.tsx then melts that ice into the next
          section so the two grounds don't meet on a line. */}
      <div className="relative w-full shrink-0 basis-[220px] sm:basis-[240px] lg:basis-[280px]">
        {/* Light the water-line: the dots rise out of a soft sky bloom. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-40 bottom-0 z-[1] bg-[radial-gradient(72%_58%_at_50%_62%,rgba(89,175,212,0.20)_0%,rgba(89,175,212,0.06)_48%,transparent_74%)]"
        />
        <DitherWave
          className="pointer-events-none absolute inset-x-0 -top-6 bottom-0 z-[2]"
          surface={112}
          foot={64}
          edgeLift={30}
          edgeFalloff={260}
          dim="#3E8FB4"
          bright="#7FC4E2"
          mid="#59AFD4"
        />
      </div>
    </div>
  )
}
