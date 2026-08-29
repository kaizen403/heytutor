import { Suspense, lazy } from 'react'
import Hero from './components/Hero'
import DitherBand from './components/dither/DitherBand'
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
      {/* Separation between the lesson and the use cases. A rule would be the
          one hard edge on a page that otherwise dissolves everywhere, so this
          melts a lifted navy down into the section instead — the same pixel
          transition the hero uses into the lesson, just shorter and quieter. */}
      <DitherBand
        from="#1B3242"
        to="#06121C"
        via="#16303F"
        heightClass="h-[clamp(3.5rem,7vh,6rem)]"
        className="-mt-px"
      />

      <Suspense fallback={<div className="min-h-[760px]" aria-hidden />}>
        <UseCasesSection />
      </Suspense>
      <Footer />
    </div>
  )
}

export default App
