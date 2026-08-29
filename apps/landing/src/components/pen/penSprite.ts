/* ═══════════════════════════════════════════════════════════════════════════
   penSprite — a matte-graphite rollerball drawn ONCE into an offscreen canvas
   with plain Canvas2D vectors, for an animation loop to blit every frame.

   Two ideas do most of the work:

   1. Cylinder-by-band. The pen is filled one material band at a time (nib
      cone, steel collar, grip, accent ring, barrel) and every band is a rect
      painted with a HORIZONTAL gradient — dark near edge, bright about a third
      of the way across, dark far edge. A vertical object shaded across its
      horizontal axis is what the eye reads as "round", and per-band gradients
      let each material keep its own falloff while the bright line stays on one
      continuous axis down the whole pen.

   2. Clip first, paint careless. The silhouette is built once and installed as
      a clip, so every band, groove, highlight and shadow can be a full-width
      rect: the clip trims each one to the outline for free and no pass has to
      know the local silhouette width. Only the definition stroke and the
      pocket clip — which stands proud of the barrel — are drawn after the clip
      is released.

   Fully deterministic: same (length, dpr) always yields the same pixels.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PenSprite {
  canvas: HTMLCanvasElement
  /** CSS px */
  width: number
  height: number
  /** Pen tip position within the sprite, in CSS px from the sprite's top-left. */
  tipX: number
  tipY: number
}

interface Pt {
  x: number
  y: number
}

interface Rgb {
  r: number
  g: number
  b: number
}

/* ── Proportions ──────────────────────────────────────────────────────────
   `t` is distance UP from the tip as a fraction of pen length (t = 0 tip,
   t = 1 cap end); `w` is silhouette half-width as a fraction of the widest
   barrel half-width, itself HB_FRACTION of the pen length.                  */

/* Barrel half-width as a fraction of length. 0.078 puts the body at ~8.5:1,
   a slim rollerball; larger values read as a marker. */
const HB_FRACTION = 0.078

interface Sample {
  t: number
  w: number
}

const PROFILE: readonly Sample[] = [
  { t: 0.0, w: 0.02 }, // needle point
  { t: 0.022, w: 0.11 },
  { t: 0.1, w: 0.34 }, // nib cone
  { t: 0.132, w: 0.52 }, // steel collar
  { t: 0.152, w: 0.56 },
  { t: 0.355, w: 0.69 }, // grip section (slight swell)
  { t: 0.395, w: 0.73 }, // accent ring
  { t: 0.43, w: 0.75 },
  { t: 0.89, w: 0.71 }, // barrel, near-parallel
  { t: 0.95, w: 0.6 }, // shoulder
  { t: 1.0, w: 0.28 }, // cap end, domed from here
]

const MAX_W = PROFILE.reduce((m, s) => Math.max(m, s.w), 0)

/* Material band boundaries, in the same t units. */
const T_CONE_END = 0.132
const T_COLLAR_END = 0.152
const T_GRIP_END = 0.395
const T_RING_END = 0.43

/* Pocket clip extent. */
const T_CLIP_LO = 0.6
const T_CLIP_HI = 0.96

/* ── Colour ───────────────────────────────────────────────────────────────*/

const rgbOf = (hex: string): Rgb => {
  const v = Number.parseInt(hex.slice(1), 16)
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 }

const lerpRgb = (a: Rgb, b: Rgb, k: number): Rgb => ({
  r: a.r + (b.r - a.r) * k,
  g: a.g + (b.g - a.g) * k,
  b: a.b + (b.b - a.b) * k,
})

const css = (c: Rgb, alpha = 1): string =>
  `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`

interface Material {
  light: Rgb
  mid: Rgb
  dark: Rgb
}

const material = (light: string, dark: string, mid?: string): Material => ({
  light: rgbOf(light),
  mid: mid ? rgbOf(mid) : lerpRgb(rgbOf(light), rgbOf(dark), 0.55),
  dark: rgbOf(dark),
})

const STEEL = material('#EDF2F5', '#6B7B87', '#A7B6C1')
const CHROME = material('#F2F7FA', '#8E9DA9')
const GRIP = material('#2A3A48', '#0A121A', '#18242F')
const ACCENT = material('#8CCBE6', '#2E7CA3', '#59AFD4')
const BARREL = material('#22303E', '#0E1822')
const CLIP_TOP = rgbOf('#DCE6EC')
const CLIP_BOTTOM = rgbOf('#7E8D99')

/* ── Curves ───────────────────────────────────────────────────────────────*/

/**
 * Centripetal (alpha = ½) Catmull–Rom → the two cubic control points for the
 * p1→p2 span. Centripetal rather than uniform because the profile samples are
 * bunched very unevenly around the nib (0.000 → 0.022 → 0.100); uniform
 * parameterisation overshoots on spacing like that and would bulge the cone.
 */
const crControls = (p0: Pt, p1: Pt, p2: Pt, p3: Pt): [Pt, Pt] => {
  const eps = 1e-6
  const l1 = Math.max(Math.hypot(p1.x - p0.x, p1.y - p0.y), eps)
  const l2 = Math.max(Math.hypot(p2.x - p1.x, p2.y - p1.y), eps)
  const l3 = Math.max(Math.hypot(p3.x - p2.x, p3.y - p2.y), eps)
  // With alpha = ½ the knot spacing d^(2·alpha) is just the raw distance and
  // d^alpha its square root, which collapses the general formula to this.
  const e1 = Math.sqrt(l1)
  const e2 = Math.sqrt(l2)
  const e3 = Math.sqrt(l3)
  const dA = 3 * e1 * (e1 + e2)
  const dB = 3 * e3 * (e3 + e2)
  const kA = 2 * l1 + 3 * e1 * e2 + l2
  const kB = 2 * l3 + 3 * e3 * e2 + l2
  return [
    {
      x: (l1 * p2.x - l2 * p0.x + kA * p1.x) / dA,
      y: (l1 * p2.y - l2 * p0.y + kA * p1.y) / dA,
    },
    {
      x: (l3 * p1.x - l2 * p3.x + kB * p2.x) / dB,
      y: (l3 * p1.y - l2 * p3.y + kB * p2.y) / dB,
    },
  ]
}

/** Append a smooth curve through `pts`; the current point must already be pts[0]. */
const smoothThrough = (ctx: CanvasRenderingContext2D, pts: readonly Pt[]): void => {
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const [c1, c2] = crControls(p0, p1, p2, p3)
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p2.x, p2.y)
  }
}

/** Rounded polygon: start on an edge midpoint so every vertex can be an arcTo. */
const roundPolyPath = (ctx: CanvasRenderingContext2D, pts: readonly Pt[], r: number): void => {
  const n = pts.length
  const first = pts[0]
  const last = pts[n - 1]
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2)
  for (let i = 0; i < n; i += 1) {
    const cur = pts[i]
    const next = pts[(i + 1) % n]
    ctx.arcTo(cur.x, cur.y, next.x, next.y, r)
  }
  ctx.closePath()
}

/* ── Public geometry ──────────────────────────────────────────────────────*/

const safeLength = (length: number): number =>
  Number.isFinite(length) && length > 1 ? length : 1

/** Half-width of the barrel at its widest, in CSS px, for a given pen length. */
export function penBarrelHalfWidth(length: number): number {
  return MAX_W * HB_FRACTION * safeLength(length)
}

/* ── Render ───────────────────────────────────────────────────────────────*/

/** `length` = full pen length in CSS px. `dpr` = device pixel ratio to render at. */
export function renderPenSprite(length: number, dpr: number): PenSprite {
  const len = safeLength(length)
  const scale = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 4) : 1

  const hb = HB_FRACTION * len
  const maxHalf = MAX_W * hb
  const proud = Math.max(1, 0.022 * len) // how far the pocket clip stands off the barrel
  const pad = Math.max(2, 0.014 * len) // keeps antialiasing and the clip off the sprite edge

  const width = 2 * (maxHalf + proud) + 2 * pad
  const height = len + 2 * pad
  const cx = width / 2
  const tipY = pad + len

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))

  const sprite: PenSprite = { canvas, width, height, tipX: cx, tipY }
  const ctx = canvas.getContext('2d')
  if (!ctx) return sprite

  // Everything below is authored in CSS px; the backing store is the only
  // thing that knows about dpr.
  ctx.scale(scale, scale)

  /* The dome is charged against the pen's own length rather than added on top,
     so `length` stays the honest tip-to-cap measurement the caller rotates by. */
  const capHalf = PROFILE[PROFILE.length - 1].w * hb
  const domeH = capHalf // hemispherical cap: the rise equals its own half-width
  const bodyLen = len - domeH

  const yAt = (t: number): number => tipY - t * bodyLen

  const profileW = (t: number): number => {
    if (t <= 0) return PROFILE[0].w
    for (let i = 1; i < PROFILE.length; i += 1) {
      const b = PROFILE[i]
      if (t <= b.t) {
        const a = PROFILE[i - 1]
        return a.w + (b.w - a.w) * ((t - a.t) / (b.t - a.t))
      }
    }
    return PROFILE[PROFILE.length - 1].w
  }

  const halfAt = (t: number): number => profileW(t) * hb

  /* ── Silhouette ─────────────────────────────────────────────────────────*/

  const leftPts: Pt[] = PROFILE.map((s) => ({ x: cx - s.w * hb, y: yAt(s.t) })).reverse()
  const rightPts: Pt[] = PROFILE.map((s) => ({ x: cx + s.w * hb, y: yAt(s.t) }))
  const yCap = yAt(1)
  const K = 0.5523 // circular-arc constant, for the two quarter-ellipse cubics of the dome

  /* The shoulder arrives at the cap leaning steeply inward (0.60 → 0.28 over
     five hundredths of the length), so a dome with the usual vertical base
     tangent leaves a visible kink — a bullet with a knob screwed on. Leaning
     the dome's base handles along the shoulder's own direction instead makes
     the join tangent-continuous, and the end reads as one rounded form. */
  const shoulder = PROFILE[PROFILE.length - 2]
  const capSample = PROFILE[PROFILE.length - 1]
  const leanRun = (capSample.w - shoulder.w) * hb
  const leanRise = -(capSample.t - shoulder.t) * bodyLen
  const leanMag = Math.hypot(leanRun, leanRise) || 1
  const leanLen = domeH * K * 0.5
  const leanX = (leanRun / leanMag) * leanLen
  const leanY = (leanRise / leanMag) * leanLen

  const traceSilhouette = (): void => {
    ctx.beginPath()
    ctx.moveTo(leftPts[0].x, leftPts[0].y)
    smoothThrough(ctx, leftPts) // cap → tip down the left
    ctx.lineTo(rightPts[0].x, rightPts[0].y) // across the ~1px flat of the needle point
    smoothThrough(ctx, rightPts) // tip → cap up the right
    ctx.bezierCurveTo(cx + capHalf + leanX, yCap + leanY, cx + capHalf * K, yCap - domeH, cx, yCap - domeH)
    ctx.bezierCurveTo(cx - capHalf * K, yCap - domeH, cx - capHalf - leanX, yCap + leanY, cx - capHalf, yCap)
    ctx.closePath()
  }

  /* ── Pocket clip geometry (needed early: its contact shadow is painted
        inside the silhouette clip, the blade itself long after) ────────────*/

  const bladeW = Math.max(2, 0.052 * len)
  const bladeRight = cx + halfAt(0.8) + proud
  const bladeLeft = bladeRight - bladeW
  const bladeCx = (bladeLeft + bladeRight) / 2
  const bladeTop = yAt(T_CLIP_HI)
  const bladeBottom = yAt(T_CLIP_LO)
  const ballR = bladeW * 0.6
  const ballCy = bladeBottom - ballR
  const bladeLean = bladeW * 0.55 // the blade tilts in at the top, where it anchors to the shoulder

  /* ── Materials ──────────────────────────────────────────────────────────*/

  ctx.save()
  traceSilhouette()
  ctx.clip()

  /**
   * One band's cross-pen ramp. `halfW` is the band's own widest half-width
   * pulled slightly inboard, so the darkest stop lands at (not beyond) the
   * silhouette edge. Anchoring every band to the barrel's width instead would
   * make the narrow nib sample only the bright centre and read dead flat.
   */
  const cylinder = (halfW: number, m: Material): CanvasGradient => {
    const g = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0)
    g.addColorStop(0.0, css(lerpRgb(m.dark, BLACK, 0.38)))
    g.addColorStop(0.07, css(m.dark))
    g.addColorStop(0.22, css(m.mid))
    g.addColorStop(0.34, css(m.light))
    g.addColorStop(0.52, css(m.mid))
    g.addColorStop(0.8, css(m.dark))
    g.addColorStop(1.0, css(lerpRgb(m.dark, BLACK, 0.32)))
    return g
  }

  /** Full-sprite-width fill for one material band; the clip does the trimming. */
  const band = (tLo: number, tHi: number, m: Material, yTop = yAt(tHi), yBottom = yAt(tLo)): void => {
    const anchor = Math.max(profileW(tLo), profileW(tHi)) * hb * 0.85
    ctx.fillStyle = cylinder(anchor, m)
    ctx.fillRect(0, yTop, width, yBottom - yTop)
  }

  band(T_RING_END, 1, BARREL, 0) // runs up over the domed cap
  band(T_GRIP_END, T_RING_END, ACCENT)
  band(T_COLLAR_END, T_GRIP_END, GRIP)
  band(T_CONE_END, T_COLLAR_END, CHROME)
  band(0, T_CONE_END, STEEL, undefined, height) // runs down past the needle point

  /* Grip texture: a shallow groove reads as a dark hairline with the light
     catching its lower lip. */
  const RINGS = 6
  for (let i = 0; i < RINGS; i += 1) {
    const y = yAt(0.19 + (0.365 - 0.19) * (i / (RINGS - 1)))
    ctx.fillStyle = 'rgba(2, 8, 14, 0.30)'
    ctx.fillRect(0, y, width, 1)
    ctx.fillStyle = 'rgba(176, 204, 222, 0.12)'
    ctx.fillRect(0, y + 1, width, 0.5)
  }

  /* ── Lighting ───────────────────────────────────────────────────────────*/

  /* The long highlights fade across the pen AND along it, which one linear
     gradient cannot express, so they are composed on a scratch canvas: paint
     the cross-pen ramps, erase the ends with a vertical destination-out ramp,
     then stamp the result through the silhouette clip in a single draw. */
  const yLightTop = yAt(0.99)
  const yLightBottom = yAt(T_COLLAR_END)
  const glow = document.createElement('canvas')
  glow.width = canvas.width
  glow.height = canvas.height
  const gctx = glow.getContext('2d')
  if (gctx) {
    gctx.scale(scale, scale)

    // Specular: a soft stripe centred 32% across the barrel, 18% of it wide.
    const specCx = cx - maxHalf + 0.32 * 2 * maxHalf
    const specW = 0.18 * 2 * maxHalf
    const spec = gctx.createLinearGradient(specCx - specW / 2, 0, specCx + specW / 2, 0)
    spec.addColorStop(0.0, 'rgba(255, 255, 255, 0)')
    spec.addColorStop(0.34, 'rgba(255, 255, 255, 0.2)')
    spec.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)')
    spec.addColorStop(0.68, 'rgba(255, 255, 255, 0.17)')
    spec.addColorStop(1.0, 'rgba(255, 255, 255, 0)')
    gctx.fillStyle = spec
    gctx.fillRect(specCx - specW / 2, yLightTop, specW, yLightBottom - yLightTop)

    // Rim light on the far edge, peaking just inboard of the occlusion band
    // below so the darkening pass does not swallow it.
    const rim = gctx.createLinearGradient(cx + 0.5 * maxHalf, 0, cx + maxHalf, 0)
    rim.addColorStop(0.0, 'rgba(204, 230, 241, 0)')
    rim.addColorStop(0.76, 'rgba(204, 230, 241, 0.1)')
    rim.addColorStop(1.0, 'rgba(204, 230, 241, 0.045)')
    gctx.fillStyle = rim
    gctx.fillRect(cx + 0.5 * maxHalf, yLightTop, width, yLightBottom - yLightTop)

    gctx.globalCompositeOperation = 'destination-out'
    const taper = gctx.createLinearGradient(0, yLightTop, 0, yLightBottom)
    taper.addColorStop(0.0, 'rgba(0, 0, 0, 1)')
    taper.addColorStop(0.17, 'rgba(0, 0, 0, 0)')
    taper.addColorStop(0.86, 'rgba(0, 0, 0, 0)')
    taper.addColorStop(1.0, 'rgba(0, 0, 0, 1)')
    gctx.fillStyle = taper
    // Overhang both ends: the painted band's own fractional-pixel edges would
    // otherwise survive the taper as bright hairlines across the pen.
    gctx.fillRect(0, yLightTop - 2, width, yLightBottom - yLightTop + 4)
    gctx.globalCompositeOperation = 'source-over'

    // The scratch canvas is at device resolution, so a CSS-px destination rect
    // under the same scale lands it 1:1.
    ctx.drawImage(glow, 0, 0, width, height)
  }

  // Edge occlusion: the outer ~12% of each side turns away from the light.
  const occW = 0.12 * 2 * maxHalf
  const occLeft = ctx.createLinearGradient(cx - maxHalf, 0, cx - maxHalf + occW, 0)
  occLeft.addColorStop(0, 'rgba(0, 0, 0, 0.35)')
  occLeft.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = occLeft
  ctx.fillRect(0, 0, cx - maxHalf + occW, height)
  const occRight = ctx.createLinearGradient(cx + maxHalf - occW, 0, cx + maxHalf, 0)
  occRight.addColorStop(0, 'rgba(0, 0, 0, 0)')
  occRight.addColorStop(1, 'rgba(0, 0, 0, 0.35)')
  ctx.fillStyle = occRight
  ctx.fillRect(cx + maxHalf - occW, 0, width - (cx + maxHalf - occW), height)

  // Ambient occlusion where the grip sits recessed between two proud parts.
  const aoAboveCollar = ctx.createLinearGradient(0, yAt(T_COLLAR_END + 0.035), 0, yAt(T_COLLAR_END))
  aoAboveCollar.addColorStop(0, 'rgba(0, 0, 0, 0)')
  aoAboveCollar.addColorStop(1, 'rgba(0, 0, 0, 0.3)')
  ctx.fillStyle = aoAboveCollar
  ctx.fillRect(0, yAt(T_COLLAR_END + 0.035), width, yAt(T_COLLAR_END) - yAt(T_COLLAR_END + 0.035))

  const aoBelowRing = ctx.createLinearGradient(0, yAt(T_GRIP_END), 0, yAt(T_GRIP_END - 0.04))
  aoBelowRing.addColorStop(0, 'rgba(0, 0, 0, 0.26)')
  aoBelowRing.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = aoBelowRing
  ctx.fillRect(0, yAt(T_GRIP_END), width, yAt(T_GRIP_END - 0.04) - yAt(T_GRIP_END))

  // Contact occlusion under the pocket clip. Painted here, inside the clip, so
  // it cannot spill past the barrel edge.
  const contact = ctx.createLinearGradient(bladeLeft - bladeW * 0.9, 0, bladeLeft, 0)
  contact.addColorStop(0, 'rgba(0, 0, 0, 0)')
  contact.addColorStop(1, 'rgba(0, 0, 0, 0.24)')
  ctx.fillStyle = contact
  ctx.fillRect(bladeLeft - bladeW * 0.9, bladeTop, bladeW * 0.9, bladeBottom - bladeTop)

  ctx.restore()

  /* ── Definition stroke ──────────────────────────────────────────────────*/

  traceSilhouette()
  ctx.lineWidth = 0.75
  ctx.strokeStyle = 'rgba(6, 18, 28, 0.55)'
  ctx.stroke()

  /* ── Pocket clip ────────────────────────────────────────────────────────
     Drawn last and unclipped: it stands proud of the barrel, and sitting on
     top of the outline stroke is what puts it in front of the pen.          */

  ctx.beginPath()
  roundPolyPath(
    ctx,
    [
      { x: bladeLeft - bladeLean, y: bladeTop },
      { x: bladeRight - bladeLean, y: bladeTop },
      { x: bladeRight, y: ballCy },
      { x: bladeLeft, y: ballCy },
    ],
    bladeW * 0.42,
  )
  const bladeFill = ctx.createLinearGradient(0, bladeTop, 0, bladeBottom)
  bladeFill.addColorStop(0, css(CLIP_TOP))
  bladeFill.addColorStop(1, css(CLIP_BOTTOM))
  ctx.fillStyle = bladeFill
  ctx.fill()
  // A cross-blade sheen on top of the length-wise gradient, on the same axis as
  // the barrel highlight, so the clip catches the light the pen does.
  const bladeSheen = ctx.createLinearGradient(bladeLeft - bladeLean, 0, bladeRight, 0)
  bladeSheen.addColorStop(0.0, 'rgba(20, 32, 44, 0.34)')
  bladeSheen.addColorStop(0.3, 'rgba(255, 255, 255, 0.3)')
  bladeSheen.addColorStop(0.62, 'rgba(255, 255, 255, 0)')
  bladeSheen.addColorStop(1.0, 'rgba(16, 28, 38, 0.42)')
  ctx.fillStyle = bladeSheen
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(38, 54, 68, 0.8)'
  ctx.stroke()

  // Ball end. Wider than the blade, so its fill hides the blade's lower edge
  // and the two read as one part.
  ctx.beginPath()
  ctx.arc(bladeCx, ballCy, ballR, 0, Math.PI * 2)
  const ballFill = ctx.createLinearGradient(bladeCx - ballR, 0, bladeCx + ballR, 0)
  ballFill.addColorStop(0.0, css(lerpRgb(CLIP_BOTTOM, BLACK, 0.35)))
  ballFill.addColorStop(0.32, css(CLIP_TOP))
  ballFill.addColorStop(0.62, css(lerpRgb(CLIP_TOP, CLIP_BOTTOM, 0.7)))
  ballFill.addColorStop(1.0, css(lerpRgb(CLIP_BOTTOM, BLACK, 0.42)))
  ctx.fillStyle = ballFill
  ctx.fill()
  ctx.strokeStyle = 'rgba(38, 54, 68, 0.8)'
  ctx.stroke()

  return sprite
}
