import { Suspense, lazy } from 'react'
import Hero from './components/Hero'
import DitherBand from './components/dither/DitherBand'
import DitherHalo from './components/dither/DitherHalo'
import LessonShowcase from './components/LessonShowcase'
import Footer from './components/Footer'

/* Split at the section boundary: this keeps Motion and the whole 1280px
   DashboardMockup (Konva included) out of the entry chunk, and the section
   sits far enough below the fold to have loaded before anyone scrolls to it.
   The placeholder reserves its height so nothing shifts when it arrives. */
const UseCasesSection = lazy(() => import('./components/use-cases/UseCasesSection'))

function App() {
  return (
    <div className="relative min-h-screen bg-ink-950 text-frost">
      {/* Hero, the dither melt and the lesson section share one navy field.
          Nothing draws its own background across the seam, so there is no
          element boundary left for a hairline to show up on. */}
      <div className="fx-grain relative bg-ink-950">
        <Hero />
        <DitherBand
          from="#59AFD4"
          via="#1E4D66"
          to="#06121C"
          heightClass="h-[clamp(14rem,28vh,22rem)]"
          className="-mt-8"
        />
        <LessonShowcase />
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

      <Suspense fallback={<div className="min-h-[760px]" aria-hidden />}>
        <UseCasesSection />
      </Suspense>
      <Footer />
    </div>
  )
}

export default App
