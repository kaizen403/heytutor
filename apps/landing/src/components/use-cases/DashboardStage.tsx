import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import DashboardMockup from '../DashboardMockup'
import { RESISTORS_DEMO } from './demoCopy'
import { useUseCaseDemo, type BeatId } from './useUseCaseDemo'

/* ═══════════════════════════════════════════════════════════════════════════
   DashboardStage — the real tutor dashboard, performing one beat.

   Not a redrawing of the product: this mounts DashboardMockup itself, the same
   1280px component /record.html renders to cut the hero video from, already on
   the Night Blueprint palette. Every control and hairline is the shipping one.

   The difference from the hero is who holds the clock. There the mockup runs
   its own lesson end to end; here `useUseCaseDemo` poses it, so each use case
   actually performs the thing its title claims — the question typing itself,
   a doubt cutting in, replay being pressed — instead of showing a still.
   ═══════════════════════════════════════════════════════════════════════════ */

/** DashboardMockup's design size; record.tsx renders 1600×953 at 1.25×. */
const DESIGN_W = 1280
const DESIGN_H = 762
/* On phones the stage frames only the main column: the 264px sidebar crops
   away (what the product itself does on small screens) and the fit covers the
   box, so the board fills the frame instead of leaving a sliver of clipped
   sidebar text and dead navy under the mockup. */
const SIDEBAR_W = 264
const MOBILE_MQ = '(max-width: 639px)'

export interface StageFocus {
  /** Zoom origin as a fraction of the dashboard, [x, y]. */
  origin: [number, number]
  scale: number
}

export default function DashboardStage({
  beat,
  focus,
  paused = false,
  active = true,
}: {
  beat: BeatId
  focus: StageFocus
  paused?: boolean
  /** Latches true once the section has been seen; gates the first draw. */
  active?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ fit: 0, cropSidebar: false })
  const drive = useUseCaseDemo(beat, RESISTORS_DEMO, paused, active)

  // The mockup lays out at a fixed 1280px, so it has to be scaled to whatever
  // width the stage actually gets. On phones the sidebar crops away and the
  // fit covers the box height too.
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const mobile = window.matchMedia(MOBILE_MQ)
    const measure = () => {
      const crop = mobile.matches
      const fit = crop
        ? Math.max(node.clientWidth / (DESIGN_W - SIDEBAR_W), node.clientHeight / DESIGN_H)
        : node.clientWidth / DESIGN_W
      setView({ fit, cropSidebar: crop })
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
    <div ref={ref} className="relative h-full w-full overflow-hidden rounded-[14px]">
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `translateX(${cropSidebar ? -SIDEBAR_W * fit : 0}px) scale(${fit})`,
        }}
      >
        <m.div
          style={{
            width: DESIGN_W,
            height: DESIGN_H,
            originX: focus.origin[0],
            originY: focus.origin[1],
          }}
          animate={{ scale: focus.scale }}
          transition={{ type: 'spring', stiffness: 58, damping: 18, mass: 0.9 }}
        >
          <DashboardMockup drive={drive} />
        </m.div>
      </div>

      {/* Holds the framed view together at its edges without covering chrome. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[14px] shadow-[inset_0_0_0_1px_rgba(202,229,241,0.10),inset_0_0_70px_-24px_rgba(3,11,18,0.92)]"
      />
    </div>
  )
}
