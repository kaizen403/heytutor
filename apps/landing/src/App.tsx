import { Suspense, lazy, useRef, type RefObject } from 'react'
import { useNearViewport } from './lib/useNearViewport'
import Hero from './components/Hero'
import DitherBand from './components/dither/DitherBand'
import DitherHalo from './components/dither/DitherHalo'
import FaqSection from './components/FaqSection'
import LessonShowcase from './components/LessonShowcase'
import BackedBySection from './components/BackedBySection'
import PricingSection from './components/PricingSection'
import Footer from './components/Footer'
import SeoHead from './components/SeoHead'

/* Split at the section boundary: this keeps Motion and the whole 1280px
   DashboardMockup (Konva included) out of the entry chunk. The import only
   starts once the slot is within reach, so a phone that never scrolls that
   far never downloads it. */
const UseCasesSection = lazy(() => import('./components/use-cases/UseCasesSection'))

/** Holds the `use-cases` anchor so nav links still land before the section
    loads, and reserves its height so nothing shifts when it arrives. */
function UseCasesPlaceholder({ slotRef }: { slotRef?: RefObject<HTMLDivElement | null> }) {
  return <div ref={slotRef} id="use-cases" className="min-h-[760px]" aria-hidden />
}

function DeferredUseCases() {
  const slot = useRef<HTMLDivElement>(null)
  const near = useNearViewport(slot, '50% 0px')
  if (!near) return <UseCasesPlaceholder slotRef={slot} />
  return (
    <Suspense fallback={<UseCasesPlaceholder />}>
      <UseCasesSection />
    </Suspense>
  )
}

function App() {
  return (
    <div className="relative min-h-screen bg-ink-950 text-frost">
      <SeoHead path="/" />
      {/* Hero, the lesson section and the backers strip share one navy field.
          The hero's pixel sea melts into it on its own, and nothing draws its
          own background across the seam, so there is no element boundary
          left for a hairline to show up on. */}
      <div className="fx-grain relative bg-ink-950">
        <Hero />
        <LessonShowcase />
        <BackedBySection />
      </div>
      {/* Separation between the lesson and the use cases. The band swells up
          out of the page navy and sinks back into it — both ends are the page
          colour, so there is no boundary left to read as an edge — and the
          peak stays within a step of the field, so the swell never resolves
          into a stripe. A whisper of the sections' halftone bloom bridges the
          gap, so the pixel field never fully drops out between them. */}
      <div className="relative">
        <DitherBand
          from="#06121C"
          via="#0D2231"
          to="#06121C"
          heightClass="h-[clamp(4.5rem,9vh,7.5rem)]"
          className="-mt-px"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-32 -bottom-32 z-[1] opacity-[0.13]"
        >
          <DitherHalo strength={0.32} center={[0.5, 0.5]} radius={[0.7, 0.5]} cell={4} />
        </div>
      </div>

      <DeferredUseCases />
      <PricingSection />
      <FaqSection />
      <Footer />
    </div>
  )
}

export default App
