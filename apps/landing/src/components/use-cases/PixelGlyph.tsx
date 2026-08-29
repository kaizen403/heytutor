/* Small pixel-art marks for the use-case rows. Each glyph is an 7×7 bitmap of
   '1'/'.' rows, rendered as <rect>s — crisp at any size, no icon font, and it
   keeps the blueprint/plotter character of the rest of the page. */

const GLYPHS = {
  /** Concentric burst — a question opening out. */
  burst: [
    '..111..',
    '.1...1.',
    '1..1..1',
    '1.111.1',
    '1..1..1',
    '.1...1.',
    '..111..',
  ],
  /** Bracketed frame — marks and annotations closing around a figure. */
  frame: [
    '11...11',
    '1.....1',
    '.......',
    '..111..',
    '.......',
    '1.....1',
    '11...11',
  ],
  /** Interrupt — a stroke cut across a running line. */
  interrupt: [
    '.......',
    '1.1.1.1',
    '...1...',
    '.11111.',
    '...1...',
    '1.1.1.1',
    '.......',
  ],
  /** Notes — an arrow coming down into a tray. */
  notes: [
    '...1...',
    '...1...',
    '.11111.',
    '..111..',
    '...1...',
    '1.....1',
    '1111111',
  ],
  /** Rewind — a chevron pair pointing back. */
  rewind: [
    '...1..1',
    '..11.11',
    '.111111',
    '1111111',
    '.111111',
    '..11.11',
    '...1..1',
  ],
} as const

export type PixelGlyphName = keyof typeof GLYPHS

export default function PixelGlyph({
  name,
  className = '',
}: {
  name: PixelGlyphName
  className?: string
}) {
  const rows = GLYPHS[name]
  return (
    <svg viewBox="0 0 7 7" className={className} fill="currentColor" aria-hidden="true">
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === '1' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null,
        ),
      )}
    </svg>
  )
}
