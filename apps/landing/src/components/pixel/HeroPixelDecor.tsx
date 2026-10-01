import PixelIllustration from './PixelIllustration'
import { paintBook, paintBulb } from './pixelPaints'

/* The hero's outer thirds are empty: the headline is centred and the plotted
   graph only spans the middle ~40%. Two illustrations sit in that margin —
   one a side, large enough to actually read.
 *
 * Earlier this was eight 16×16 sprites scattered about; at that resolution a
 * compass or a flask is a few blobs, and eight of them is noise. Two subjects
 * at 112 cells carry the same idea with room for detail (page block, ribbon,
 * glass highlight, filament supports): the cells land near 2px, a half-step
 * finer than the dither field, so they read as drawn rather than as blocks.
 *
 * Below `lg` there is no margin to fill, so none of it renders.
 */

export default function HeroPixelDecor({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none hidden lg:block ${className}`}>
      <PixelIllustration
        paint={paintBook}
        cells={112}
        className="animate-aurora absolute left-[6%] top-[46%] w-[224px]"
        style={{ opacity: 0.26, transform: 'rotate(-5deg)', animationDelay: '-4s' }}
      />
      <PixelIllustration
        paint={paintBulb}
        cells={112}
        className="animate-aurora absolute right-[6%] top-[44%] w-[196px]"
        style={{ opacity: 0.28, transform: 'rotate(4deg)', animationDelay: '-12s' }}
      />
    </div>
  )
}
