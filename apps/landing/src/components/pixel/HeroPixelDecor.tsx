import PixelIllustration from './PixelIllustration'
import { paintBook, paintBulb } from './pixelPaints'

/* The hero's outer thirds are empty: the headline is centred and the plotted
   graph only spans the middle ~40%. Two illustrations sit in that margin —
   one a side, large enough to actually read.
 *
 * Earlier this was eight 16×16 sprites scattered about; at that resolution a
 * compass or a flask is a few blobs, and eight of them is noise. Two subjects
 * at 64 cells carry the same idea and are legible: the cells land near 3.5px,
 * matching the dither field, so the pixel language is consistent across the
 * page rather than one part of it looking coarse.
 *
 * Below `lg` there is no margin to fill, so none of it renders.
 */

export default function HeroPixelDecor({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none hidden lg:block ${className}`}>
      <PixelIllustration
        paint={paintBook}
        cells={64}
        className="animate-aurora absolute left-[6%] top-[46%] w-[224px]"
        style={{ opacity: 0.26, transform: 'rotate(-5deg)', animationDelay: '-4s' }}
      />
      <PixelIllustration
        paint={paintBulb}
        cells={64}
        className="animate-aurora absolute right-[6%] top-[44%] w-[196px]"
        style={{ opacity: 0.28, transform: 'rotate(4deg)', animationDelay: '-12s' }}
      />
    </div>
  )
}
