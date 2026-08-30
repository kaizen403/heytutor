import { useId, type CSSProperties, type ReactNode, type SVGProps } from 'react'

/* ═══════════════════════════════════════════════════════════════════════
   SKETCH WALLPAPER
   A student's notebook margin, scattered through the empty navy.

   Each doodle is its own small inline SVG — a formula set in DM Mono or a
   diagram drawn in thin round-capped strokes — absolutely positioned in
   the bare margins of its container and rotated a few degrees off true,
   like a page that was shoved into a bag. A feTurbulence displacement
   filter wobbles every stroke so nothing reads as a straight line.

   The character is a student's aggressive margin work, not tidy
   calligraphy: key strokes are retraced with a second offset pass, answers
   get boxed or ringed, wrong terms get crossed out, arcs get cross-hatched,
   and scribbled arrows jab at the parts that matter.

   Static by construction: no animation, no observers, no layout shift.
   aria-hidden and pointer-events-none — it is decoration and nothing else.

   Mount it as an absolutely-positioned layer inside a `relative` section,
   below the content (z-10) and above the band wash, per the band pattern:
     <section className="relative overflow-hidden">
       <div aria-hidden className="band-lift pointer-events-none absolute inset-0" />
       <SketchWallpaper variant="use-cases" className="z-[1]" />
       …content…
     </section>
   ═══════════════════════════════════════════════════════════════════════ */

type SketchTone = 'sky' | 'ink'

/** How hard the ink presses. `bold` scales every cluster's opacity up —
    for the hero's margins, where the wallpaper is the only company. */
type SketchMode = 'quiet' | 'bold'

interface SketchWallpaperProps {
  /** Which scatter to draw; each mount point gets its own selection so the
      page never repeats the same doodle twice in a row. */
  variant?: 'hero' | 'use-cases' | 'footer'
  /** Ink family: sky for navy fields, ink for pale ones. */
  tone?: SketchTone
  /** Ink pressure: bold scales opacities up (hero margins). */
  mode?: SketchMode
  className?: string
}

/* Ink families. Sky is the navy-field set (sky-200 / mist / steel, with a
   sparing sky-400 accent); ink is the pale-field set, for a light band. */
const INKS = {
  sky: {
    'sky-200': '#CCE6F1',
    mist: '#ABC9D5',
    steel: '#608B9D',
    'sky-400': '#7FC4E2',
  },
  ink: {
    'ink-600': '#2C3C4A',
    'ink-500': '#3B5362',
    'ink-400': '#5D6C7B',
  },
} as const

type InkKey = keyof (typeof INKS)['sky'] | keyof (typeof INKS)['ink']

/* ── Shared bits ─────────────────────────────────────────────────────── */

type DoodleProps = { ink: string }
type Doodle = (props: DoodleProps) => ReactNode

/** Latin text rides DM Mono; the group's currentColor carries the ink. */
function SketchText({
  x,
  y,
  size,
  children,
  ...rest
}: { x: number; y: number; size: number; children: ReactNode } & SVGProps<SVGTextElement>) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={size}
      fill="currentColor"
      stroke="none"
      fontFamily="'DM Mono', ui-monospace, monospace"
      {...rest}
    >
      {children}
    </text>
  )
}

/** The stroke defaults every doodle draws with. */
function Doodle({ ink, children }: { ink: string; children: ReactNode }) {
  return (
    <g
      color={ink}
      stroke="currentColor"
      fill="none"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </g>
  )
}

/** A stroke retraced with a second, slightly offset pass — a pen going over
    a line twice because the first pass wasn't dark enough. */
function Double({
  d,
  dx = 1.6,
  dy = 1.1,
  ...rest
}: { d: string; dx?: number; dy?: number } & SVGProps<SVGPathElement>) {
  return (
    <>
      <path d={d} {...rest} />
      <path d={d} transform={`translate(${dx} ${dy})`} opacity={0.6} {...rest} />
    </>
  )
}

/* ── Hand-sketched symbols ─────────────────────────────────────────────
   DM Mono carries no Greek and no math operators, so π Σ Δ λ θ √ ∫ are
   drawn as pen strokes. They sit with the font text the way a student's
   own margin marks do — and the wobble filter treats them the same. */

type SymProps = { x: number; y: number; s?: number }

const Pi = ({ x, y, s = 1 }: SymProps) => (
  <path d={`M${x - 16 * s} ${y} v ${30 * s} M${x + 14 * s} ${y} v ${30 * s} M${x - 20 * s} ${y} h ${40 * s}`} />
)

const Delta = ({ x, y, s = 1 }: SymProps) => (
  <path d={`M${x} ${y} L ${x + 22 * s} ${y + 42 * s} H ${x - 22 * s} Z`} />
)

const Lambda = ({ x, y, s = 1 }: SymProps) => (
  <path d={`M${x} ${y} l ${16 * s} ${26 * s} l ${20 * s} ${-26 * s} M${x} ${y} l ${-10 * s} ${30 * s}`} />
)

const Theta = ({ x, y, s = 1 }: SymProps) => (
  <g>
    <circle cx={x} cy={y} r={16 * s} />
    <path d={`M${x - 16 * s} ${y} h ${32 * s}`} />
  </g>
)

/** The radical sign: a diagonal with a bar that runs over the radicand. */
const Radical = ({ x, y, s = 1, bar }: SymProps & { bar: number }) => (
  <path d={`M${x} ${y} l ${7 * s} ${13 * s} l ${9 * s} ${-20 * s} h ${bar}`} />
)

/** The integral sign: a long S with a hook at each end. */
const Integral = ({ x, y, s = 1 }: SymProps) => (
  <path
    d={`M${x} ${y} q ${-16 * s} ${30 * s} 0 ${64 * s} q ${16 * s} ${34 * s} 0 ${64 * s} M${x} ${y} q ${-8 * s} ${-10 * s} ${-16 * s} ${-6 * s} M${x} ${y + 128 * s} q ${8 * s} ${10 * s} ${16 * s} ${6 * s}`}
  />
)

/* ── The doodles ───────────────────────────────────────────────────────
   Each is drawn in a 320×240 space, centred on (160,120). */

/** E = mc², underlined with a scratchy double pass. */
const DoodleEmc2 = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={128} size={34}>E = mc²</SketchText>
    <path d="M96 146 q 32 -7 64 0 t 64 0" strokeWidth={2} />
    <path d="M100 151 q 30 -5 60 0 t 60 0" strokeWidth={1.6} opacity={0.7} />
  </Doodle>
)

/** PV = nRT, underlined. */
const DoodlePvnrt = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={34}>PV = nRT</SketchText>
    <path d="M104 142 q 28 -4 56 0 t 56 0" strokeWidth={1.7} />
  </Doodle>
)

/** V = IR, with a resistor zigzag. */
const DoodleVir = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={70} size={30}>V = IR</SketchText>
    <path d="M104 128 h 18 l 10 12 l 20 -24 l 20 24 l 20 -24 l 10 12 h 18" />
  </Doodle>
)

/** a² + b² = c² over a right triangle, hatched like a shaded face. */
const DoodleTriPythag = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={42} size={22}>a² + b² = c²</SketchText>
    <Double d="M110 170 L 110 78 M110 170 L 232 170 M110 78 L 232 170" />
    <path d="M110 158 L 122 158 L 122 170" />
    <path
      d="M110 95 L 209 170 M110 110 L 190 170 M110 125 L 170 170 M110 140 L 150 170 M110 155 L 130 170"
      strokeWidth={1.8}
    />
    <SketchText x={92} y={132} size={20}>a</SketchText>
    <SketchText x={166} y={192} size={20}>b</SketchText>
    <SketchText x={182} y={112} size={20}>c</SketchText>
  </Doodle>
)

/** The quadratic formula, set as a fraction with a drawn radical. */
const DoodleQuadratic = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={36} y={132} size={24}>x =</SketchText>
    <path d="M62 128 h 206" />
    <SketchText x={86} y={116} size={20}>−b ± </SketchText>
    <Radical x={116} y={116} bar={136} />
    <SketchText x={204} y={116} size={20}>(b² − 4ac)</SketchText>
    <SketchText x={165} y={148} size={20}>2a</SketchText>
  </Doodle>
)

/** A sine curve on sketched axes, the axes retraced. */
const DoodleSineCurve = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <Double d="M56 122 H 268 M268 122 l -8 -4 M268 122 l -8 4" />
    <Double d="M162 44 V 196 M162 44 l -4 8 M162 44 l 4 8" />
    <path d="M56 122 q 26 -52 52 0 t 52 0 t 52 0 t 52 0" />
    <SketchText x={118} y={58} size={18}>sin</SketchText>
    <Theta x={152} y={54} s={0.5} />
  </Doodle>
)

/** A projectile's parabola, with launch arrow, angle, dashed range / height
    projections from the peak to the axes, and cross-hatch under the arc. */
const DoodleProjectile = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <Double d="M64 192 H 284 M284 192 l -8 -4 M284 192 l -8 4" />
    <Double d="M84 208 V 36 M84 36 l -4 8 M84 36 l 4 8" />
    <path d="M84 192 Q 184 16 284 192" />
    <path d="M184 104 V 192 M84 104 H 184" strokeDasharray="7 7" strokeWidth={2} />
    <path
      d="M100 192 l 14 -37 M118 192 l 14 -54 M136 192 l 14 -67 M154 192 l 14 -76 M172 192 l 14 -79 M190 192 l 14 -75 M208 192 l 14 -64 M226 192 l 14 -47"
      strokeWidth={1.8}
    />
    <path d="M84 192 l 26 -46 M110 146 l -2 12 M110 146 l 12 -2" />
    <SketchText x={58} y={140} size={18}>v</SketchText>
    <Theta x={128} y={176} s={0.55} />
  </Doodle>
)

/** A circle with its radius, the circle retraced. */
const DoodleCircleRadius = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <Double d="M160 52 A 68 68 0 1 1 159.9 52" />
    <circle cx={160} cy={120} r={3} fill="currentColor" stroke="none" />
    <path d="M160 120 L 228 120" />
    <SketchText x={198} y={106} size={20}>r</SketchText>
  </Doodle>
)

/** A pendulum, swung off vertical with its angle marked, the string retraced. */
const DoodlePendulum = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <path d="M120 36 h 80 M160 36 v 22" />
    <Double d="M160 58 L 186 152" />
    <circle cx={186} cy={166} r={14} />
    <path d="M160 98 A 40 40 0 0 1 171 97" />
    <Theta x={180} y={86} s={0.5} />
  </Doodle>
)

/** A Bohr atom: nucleus, three tilted orbits, electrons. */
const DoodleBohrAtom = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <circle cx={160} cy={120} r={11} />
    <circle cx={160} cy={120} r={3} fill="currentColor" stroke="none" />
    <ellipse cx={160} cy={120} rx={72} ry={26} transform="rotate(-16 160 120)" />
    <ellipse cx={160} cy={120} rx={54} ry={20} transform="rotate(22 160 120)" />
    <ellipse cx={160} cy={120} rx={90} ry={33} transform="rotate(5 160 120)" />
    <circle cx={232} cy={120} r={2.5} fill="currentColor" stroke="none" transform="rotate(-16 160 120)" />
    <circle cx={106} cy={120} r={2.5} fill="currentColor" stroke="none" transform="rotate(22 160 120)" />
    <circle cx={160} cy={30} r={2.5} fill="currentColor" stroke="none" transform="rotate(5 160 120)" />
  </Doodle>
)

/** A benzene ring. */
const DoodleBenzene = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <path d="M160 58 L 214 89 L 214 151 L 160 182 L 106 151 L 106 89 Z" />
    <circle cx={160} cy={120} r={36} />
  </Doodle>
)

/** An Erlenmeyer flask with a liquid line and bubbles. */
const DoodleFlask = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <path d="M138 36 H 182 V 66 L 222 158 Q 224 170 212 170 H 108 Q 96 170 98 158 L 138 66 Z" />
    <path d="M134 36 H 186" />
    <path d="M104 150 q 16 -6 32 0 t 32 0 t 32 0 t 16 0" />
    <circle cx={150} cy={132} r={3} />
    <circle cx={170} cy={120} r={2} />
    <circle cx={184} cy={136} r={2.5} />
  </Doodle>
)

/** A tangent line touching a curve. */
const DoodleTangentLine = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <path d="M56 184 Q 132 56 224 116" />
    <path d="M66 131 L 206 75" />
    <circle cx={136} cy={103} r={3} fill="currentColor" stroke="none" />
    <SketchText x={212} y={66} size={16}>dy/dx</SketchText>
  </Doodle>
)

/** ∫ f(x) dx, with a drawn integral sign. */
const DoodleIntegral = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <Integral x={112} y={98} s={0.4} />
    <SketchText x={196} y={124} size={30}>f(x) dx</SketchText>
  </Doodle>
)

/** Δx = v·t, with a drawn delta. */
const DoodleDeltaX = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <Delta x={104} y={84} s={0.8} />
    <SketchText x={196} y={124} size={32}>x = v·t</SketchText>
  </Doodle>
)

/** λ = v/f, with a drawn lambda and a wave underneath. */
const DoodleLambdaWave = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <Lambda x={104} y={124} s={0.8} />
    <SketchText x={196} y={124} size={32}>= v/f</SketchText>
    <path d="M104 148 q 14 -10 28 0 t 28 0 t 28 0 t 28 0" strokeWidth={1.7} />
  </Doodle>
)

/** An angle with a drawn theta. */
const DoodleThetaAngle = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <path d="M100 168 H 224 M100 168 L 158 92" />
    <path d="M152 168 A 52 52 0 0 1 132 126" />
    <Theta x={150} y={152} s={0.5} />
  </Doodle>
)

/** F = ma, boxed in a wobbly hand-drawn rectangle — the answer, circled off. */
const DoodleBoxedFma = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <Double d="M72 80 L 250 76 L 254 162 L 66 166 Z" />
    <SketchText x={160} y={128} size={34}>F = ma</SketchText>
    <path d="M254 162 l 12 3" strokeWidth={2} />
  </Doodle>
)

/** Euler's identity, ringed with a rough ellipse — the answer, circled off. */
const DoodleCircledEuler = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={96} y={124} size={28}>e</SketchText>
    <SketchText x={116} y={112} size={17}>i</SketchText>
    <Pi x={132} y={112} s={0.5} />
    <SketchText x={214} y={124} size={28}>+ 1 = 0</SketchText>
    <Double d="M160 78 A 104 40 0 1 1 159.9 78" transform="rotate(-5 160 118)" />
    <path d="M258 96 q 12 -4 10 -16" strokeWidth={2} />
  </Doodle>
)

/** A wrong answer crossed out, the right one underlined beside it. */
const DoodleCrossedOut = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={104} y={120} size={30}>x = 2</SketchText>
    <path d="M74 94 L 134 146 M134 94 L 74 146" strokeWidth={2.6} />
    <SketchText x={224} y={120} size={30}>x = 3</SketchText>
    <path d="M188 138 q 10 -4 20 0 t 20 0 t 20 0" strokeWidth={2} />
  </Doodle>
)

/** v = u + at with a scribbled arrow jabbing at the term that matters. */
const DoodleScribbleArrow = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={88} size={30}>v = u + at</SketchText>
    <path d="M140 192 l 16 -14 l 14 2 l 16 -12 l 12 4 l 14 -10" strokeWidth={2} />
    <path d="M212 162 l -9 -9 M212 162 l -4 -12" strokeWidth={2} />
  </Doodle>
)

/* ── Filler doodles ────────────────────────────────────────────────────
   Small single-line expressions and micro-marks that slot between the
   diagram clusters so the field reads continuous — a student's margin
   worked cover-to-cover. */

/** H₂O, with a drawn subscript. */
const DoodleH2O = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={26}>H<tspan dy={7} fontSize={15}>2</tspan>O</SketchText>
  </Doodle>
)

/** CO₂, with a drawn subscript. */
const DoodleCO2 = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={26}>CO<tspan dy={7} fontSize={15}>2</tspan></SketchText>
  </Doodle>
)

/** Δt = 5 s, with a drawn delta. */
const DoodleDeltaT = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <Delta x={104} y={84} s={0.7} />
    <SketchText x={196} y={124} size={28}>t = 5 s</SketchText>
  </Doodle>
)

/** N = kg·m/s² — the newton, unpacked. */
const DoodleNewton = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={26}>N = kg·m/s²</SketchText>
  </Doodle>
)

/** KE = ½mv² — kinetic energy. */
const DoodleKE = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={28}>KE = ½mv²</SketchText>
  </Doodle>
)

/** x² − 5x + 6 = 0 — a quadratic waiting to be factored. */
const DoodleQuadFrag = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={26}>x² − 5x + 6 = 0</SketchText>
  </Doodle>
)

/** A ticked number line. */
const DoodleNumberLine = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <path d="M70 140 H 250" />
    <path d="M70 132 V 148 M115 136 V 144 M160 132 V 148 M205 136 V 144 M250 132 V 148" />
    <SketchText x={70} y={170} size={16}>0</SketchText>
    <SketchText x={160} y={170} size={16}>1</SketchText>
    <SketchText x={250} y={170} size={16}>2</SketchText>
  </Doodle>
)

/** A tiny circuit cell with leads. */
const DoodleCircuitCell = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <path d="M100 120 H 130 M190 120 H 220" />
    <path d="M130 100 V 140 M150 108 V 132" />
    <path d="M150 120 H 190" />
  </Doodle>
)

/** °C = °K − 273 — the conversion, jotted down. */
const DoodleTempConv = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={26}>°C = °K − 273</SketchText>
  </Doodle>
)

/** A pH scale snippet. */
const DoodlePhScale = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={80} y={120} size={24}>pH</SketchText>
    <path d="M130 120 H 260 M130 112 V 128 M260 112 V 128 M195 116 V 124" />
    <SketchText x={130} y={146} size={16}>0</SketchText>
    <SketchText x={260} y={146} size={16}>14</SketchText>
  </Doodle>
)

/** n = m/M — the mole. */
const DoodleMole = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={28}>n = m/M</SketchText>
  </Doodle>
)

/** sin²θ + cos²θ = 1, with drawn thetas. */
const DoodleTrigId = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={92} y={124} size={22}>sin²</SketchText>
    <Theta x={124} y={118} s={0.45} />
    <SketchText x={172} y={124} size={22}>+ cos²</SketchText>
    <Theta x={218} y={118} s={0.45} />
    <SketchText x={250} y={124} size={22}>= 1</SketchText>
  </Doodle>
)

/** a²·b² = (ab)² — exponent fragments. */
const DoodleAbSq = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={26}>a²·b² = (ab)²</SketchText>
  </Doodle>
)

/** A small crossed-out term with the correction beside it. */
const DoodleCrossedSmall = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={110} y={124} size={28}>4x</SketchText>
    <path d="M84 100 L 136 148 M136 100 L 84 148" strokeWidth={2.6} />
    <SketchText x={220} y={124} size={28}>2x</SketchText>
  </Doodle>
)

/** A lone scratchy underline — a pen gesture with nothing under it. */
const DoodleUnderline = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <path d="M80 120 q 40 -8 80 0 t 80 0" strokeWidth={2.4} />
    <path d="M86 128 q 38 -6 76 0 t 76 0" strokeWidth={1.8} opacity={0.7} />
  </Doodle>
)

/** Pen-tap dots and a small cross. */
const DoodleDots = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <circle cx={120} cy={120} r={3} fill="currentColor" stroke="none" />
    <circle cx={160} cy={132} r={2.5} fill="currentColor" stroke="none" />
    <circle cx={200} cy={118} r={3.5} fill="currentColor" stroke="none" />
    <path d="M140 100 l 12 12 M152 100 l -12 12" strokeWidth={2.2} />
  </Doodle>
)

/** 1 m = 100 cm — a unit conversion. */
const DoodleUnitConv = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={26}>1 m = 100 cm</SketchText>
  </Doodle>
)

/** v = fλ, with a drawn lambda. */
const DoodleWaveEq = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={120} y={124} size={28}>v = f</SketchText>
    <Lambda x={172} y={124} s={0.7} />
  </Doodle>
)

/* ── Round-5 fillers ─────────────────────────────────────────────────── */

/** F = G(m₁m₂)/r² — gravity, with drawn subscripts. */
const DoodleGravity = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={24}>
      F = G(m<tspan dy={6} fontSize={14}>1</tspan>m<tspan dy={6} fontSize={14}>2</tspan>)/r²
    </SketchText>
  </Doodle>
)

/** W = Fs — work. */
const DoodleWork = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={28}>W = Fs</SketchText>
  </Doodle>
)

/** P = IV — electric power. */
const DoodlePower = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={28}>P = IV</SketchText>
  </Doodle>
)

/** ρ = m/V — density, with a drawn rho. */
const DoodleDensity = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <path d="M104 94 v 30 q 14 -4 14 12 q 0 14 -14 14" />
    <SketchText x={196} y={124} size={28}>= m/V</SketchText>
  </Doodle>
)

/** v² = u² + 2as — a kinematic equation. */
const DoodleKinematic = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={26}>v² = u² + 2as</SketchText>
  </Doodle>
)

/** s = vt — distance. */
const DoodleDist = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={28}>s = vt</SketchText>
  </Doodle>
)

/** a = v²/r — centripetal acceleration. */
const DoodleCentripetal = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={28}>a = v²/r</SketchText>
  </Doodle>
)

/** Q = mcΔT — heat, with a drawn delta. */
const DoodleHeat = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={104} y={124} size={26}>Q = mc</SketchText>
    <Delta x={188} y={84} s={0.6} />
    <SketchText x={222} y={124} size={26}>T</SketchText>
  </Doodle>
)

/** NaCl — table salt. */
const DoodleNaCl = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={28}>NaCl</SketchText>
  </Doodle>
)

/** H₂SO₄ — sulfuric acid, with drawn subscripts. */
const DoodleSulfuric = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={26}>
      H<tspan dy={6} fontSize={15}>2</tspan>SO<tspan dy={6} fontSize={15}>4</tspan>
    </SketchText>
  </Doodle>
)

/** °F = 9/5·°C + 32 — the Fahrenheit conversion. */
const DoodleFahrenheit = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={24}>°F = 9/5·°C + 32</SketchText>
  </Doodle>
)

/** log(ab) = log a + log b — a log rule. */
const DoodleLogRule = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={22}>log(ab) = log a + log b</SketchText>
  </Doodle>
)

/** a³, underlined. */
const DoodleCube = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={120} size={30}>a³</SketchText>
    <path d="M140 138 q 10 -4 20 0 t 20 0" strokeWidth={2} />
  </Doodle>
)

/** x̄ — the mean, with a drawn macron. */
const DoodleMean = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={128} size={30}>x</SketchText>
    <path d="M140 96 h 40" strokeWidth={2.2} />
  </Doodle>
)

/** x = ±4 — a plus-minus note. */
const DoodlePlusMinus = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={28}>x = ±4</SketchText>
  </Doodle>
)

/** π ≈ 3.14, with drawn pi and approx signs. */
const DoodleApprox = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <Pi x={104} y={124} s={0.8} />
    <path d="M140 120 q 10 -6 20 0 t 20 0 M140 134 q 10 -6 20 0 t 20 0" strokeWidth={2} />
    <SketchText x={214} y={124} size={26}>3.14</SketchText>
  </Doodle>
)

/** p = mv — momentum. */
const DoodleMomentum = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={28}>p = mv</SketchText>
  </Doodle>
)

/** Q = It — charge. */
const DoodleCharge = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={28}>Q = It</SketchText>
  </Doodle>
)

/** E = hf — photon energy. */
const DoodleEnergy = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={160} y={124} size={28}>E = hf</SketchText>
  </Doodle>
)

/** a = Δv/Δt — acceleration, with drawn deltas. */
const DoodleAccel = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <SketchText x={80} y={124} size={26}>a = </SketchText>
    <Delta x={125} y={84} s={0.6} />
    <SketchText x={155} y={124} size={26}>v/</SketchText>
    <Delta x={185} y={84} s={0.6} />
    <SketchText x={210} y={124} size={26}>t</SketchText>
  </Doodle>
)

/** A lone pen cross. */
const DoodleTinyCross = ({ ink }: DoodleProps) => (
  <Doodle ink={ink}>
    <path d="M140 100 l 40 40 M180 100 l -40 40" strokeWidth={2.4} />
  </Doodle>
)

/* ── The scatters ──────────────────────────────────────────────────────
   Each mount point gets its own hand-composed selection — no tiling, no
   repetition. Clusters sit in the outer thirds and the gaps between
   content blocks, never dead-centre behind paragraphs. `left`/`right` are
   percentages of the container; negative values tuck a doodle under the
   edge so only a sliver shows (the mobile treatment). */

interface Cluster {
  doodle: Doodle
  left?: number
  right?: number
  top: number
  width: number
  rotate: number
  opacity: number
  ink: InkKey
  /** Show only below the md breakpoint, in the mobile gaps. */
  mobile?: boolean
  /** Show only at xl and up, where the content column leaves real margins. */
  wideOnly?: boolean
}

const SCATTERS: Record<NonNullable<SketchWallpaperProps['variant']>, Cluster[]> = {
  hero: [
    /* The first screen, worked cover-to-cover. The pen's graph lane owns
        the middle (x 370–916, y 350–584 at 1280, plus a 24px clear margin)
        and the pixel decor props sit in the outer thirds — everything else
        is notebook. Ink runs bold (0.24–0.32 after the multiplier); the
        headline zone carries only faint marks (0.10–0.12). */
    /* ── top-left corner ── */
    { doodle: DoodleEmc2, left: 1.5, top: 12, width: 150, rotate: -4, opacity: 0.22, ink: 'sky-200', wideOnly: true },
    { doodle: DoodleCO2, left: 0.5, top: 25, width: 60, rotate: 3, opacity: 0.19, ink: 'mist', wideOnly: true },
    { doodle: DoodleBoxedFma, left: 3, top: 28, width: 150, rotate: 2, opacity: 0.24, ink: 'sky-200' },
    { doodle: DoodleNewton, left: 18, top: 33, width: 110, rotate: 2, opacity: 0.20, ink: 'mist' },
    { doodle: DoodleKinematic, left: 13, top: 30, width: 90, rotate: 3, opacity: 0.20, ink: 'sky-200' },
    /* ── top-right corner ── */
    { doodle: DoodleSineCurve, right: 1.5, top: 11, width: 170, rotate: 3, opacity: 0.21, ink: 'mist', wideOnly: true },
    { doodle: DoodleTrigId, right: 1, top: 25, width: 120, rotate: 4, opacity: 0.19, ink: 'sky-200', wideOnly: true },
    { doodle: DoodleTriPythag, right: 3, top: 31, width: 150, rotate: -2, opacity: 0.21, ink: 'steel' },
    { doodle: DoodleDeltaT, right: 20, top: 28, width: 90, rotate: -3, opacity: 0.20, ink: 'sky-200' },
    { doodle: DoodlePhScale, right: 20, top: 35, width: 100, rotate: 3, opacity: 0.19, ink: 'mist' },
    { doodle: DoodleLambdaWave, right: 19.5, top: 41, width: 90, rotate: 4, opacity: 0.21, ink: 'sky-200', wideOnly: true },
    { doodle: DoodleHeat, right: 22.5, top: 48, width: 60, rotate: 2, opacity: 0.20, ink: 'mist', wideOnly: true },
    { doodle: DoodleGravity, right: 22.5, top: 54, width: 60, rotate: -3, opacity: 0.19, ink: 'sky-200', wideOnly: true },
    { doodle: DoodleSulfuric, right: 22.5, top: 60, width: 60, rotate: 3, opacity: 0.19, ink: 'mist', wideOnly: true },
    { doodle: DoodleMomentum, right: 14, top: 37, width: 60, rotate: -2, opacity: 0.19, ink: 'steel' },
    { doodle: DoodleMean, right: 14, top: 28, width: 90, rotate: 2, opacity: 0.095, ink: 'steel' },
    /* ── behind the headline: faint, sparse ── */
    { doodle: DoodleTempConv, left: 13, top: 14, width: 90, rotate: -5, opacity: 0.08, ink: 'mist' },
    { doodle: DoodleWork, left: 20, top: 13, width: 70, rotate: -3, opacity: 0.08, ink: 'mist' },
    { doodle: DoodlePower, left: 20, top: 19, width: 60, rotate: 2, opacity: 0.08, ink: 'sky-200' },
    { doodle: DoodleDensity, left: 24, top: 15, width: 80, rotate: -2, opacity: 0.08, ink: 'steel' },
    { doodle: DoodleAbSq, left: 30, top: 15, width: 100, rotate: -3, opacity: 0.08, ink: 'mist' },
    { doodle: DoodleEnergy, left: 41, top: 14, width: 80, rotate: 3, opacity: 0.08, ink: 'mist' },
    { doodle: DoodleCube, left: 51, top: 13, width: 50, rotate: -3, opacity: 0.08, ink: 'sky-200' },
    { doodle: DoodleApprox, left: 55, top: 17, width: 90, rotate: -2, opacity: 0.08, ink: 'steel' },
    { doodle: DoodleUnderline, left: 45, top: 20, width: 80, rotate: 4, opacity: 0.08, ink: 'sky-200' },
    { doodle: DoodleLogRule, left: 30, top: 21, width: 110, rotate: 2, opacity: 0.08, ink: 'mist' },
    { doodle: DoodleDots, right: 45, top: 13, width: 60, rotate: -2, opacity: 0.08, ink: 'mist' },
    { doodle: DoodleFahrenheit, right: 30, top: 12, width: 100, rotate: 3, opacity: 0.08, ink: 'mist' },
    { doodle: DoodleQuadFrag, right: 30, top: 16, width: 120, rotate: 2, opacity: 0.08, ink: 'steel' },
    { doodle: DoodlePlusMinus, right: 38, top: 22, width: 70, rotate: -3, opacity: 0.08, ink: 'sky-200' },
    { doodle: DoodleTinyCross, right: 30, top: 14, width: 40, rotate: -4, opacity: 0.08, ink: 'steel' },
    { doodle: DoodleCentripetal, right: 20, top: 21, width: 80, rotate: -2, opacity: 0.08, ink: 'steel' },
    { doodle: DoodleNaCl, right: 15, top: 13, width: 50, rotate: -2, opacity: 0.08, ink: 'sky-200' },
    /* ── left mid-band, flanking the pen lane ── */
    { doodle: DoodleDist, left: 0.3, top: 36, width: 60, rotate: -3, opacity: 0.20, ink: 'mist' },
    { doodle: DoodlePendulum, left: 0.3, top: 40, width: 70, rotate: -5, opacity: 0.22, ink: 'sky-200' },
    { doodle: DoodleH2O, left: 0.3, top: 45, width: 70, rotate: 3, opacity: 0.20, ink: 'mist' },
    { doodle: DoodleDots, left: 0.3, top: 51, width: 60, rotate: -2, opacity: 0.19, ink: 'steel' },
    { doodle: DoodleVir, left: 0.3, top: 56, width: 70, rotate: 5, opacity: 0.21, ink: 'mist' },
    { doodle: DoodleNumberLine, left: 0.3, top: 62, width: 70, rotate: -2, opacity: 0.19, ink: 'steel' },
    { doodle: DoodleKE, left: 0.3, top: 68, width: 70, rotate: 4, opacity: 0.19, ink: 'sky-200' },
    { doodle: DoodleUnitConv, left: 0.3, top: 74, width: 60, rotate: -3, opacity: 0.17, ink: 'mist' },
    { doodle: DoodleAccel, left: 19.5, top: 34, width: 60, rotate: 3, opacity: 0.19, ink: 'mist' },
    { doodle: DoodleCircleRadius, left: 19.5, top: 38, width: 90, rotate: -3, opacity: 0.21, ink: 'steel' },
    { doodle: DoodleTinyCross, left: 0.3, top: 79, width: 40, rotate: 4, opacity: 0.13, ink: 'steel' },
    /* ── right mid-band, flanking the pen lane ── */
    { doodle: DoodleBohrAtom, right: 0.3, top: 43, width: 60, rotate: -3, opacity: 0.21, ink: 'steel' },
    { doodle: DoodleMole, right: 0.3, top: 49, width: 60, rotate: -2, opacity: 0.19, ink: 'mist' },
    { doodle: DoodleFlask, right: 0.3, top: 56, width: 70, rotate: -5, opacity: 0.22, ink: 'mist' },
    { doodle: DoodleCrossedSmall, right: 0.3, top: 61, width: 70, rotate: 3, opacity: 0.20, ink: 'sky-200' },
    { doodle: DoodleWaveEq, right: 0.3, top: 68, width: 60, rotate: 3, opacity: 0.19, ink: 'mist' },
    { doodle: DoodleCircuitCell, right: 0.3, top: 74, width: 60, rotate: -4, opacity: 0.17, ink: 'steel' },
    { doodle: DoodleCharge, right: 22.5, top: 65, width: 60, rotate: -2, opacity: 0.19, ink: 'sky-200', wideOnly: true },
    /* Mobile: the headline, buttons, pen ink and pixel sea fill the hero,
        so the bare navy is the buttons→pen strip, the top corners below
        the navbar, the bottom strip above the sea, and the headline itself. */
    { doodle: DoodleEmc2, left: 2, top: 49, width: 100, rotate: -4, opacity: 0.22, ink: 'sky-200', mobile: true },
    { doodle: DoodleSineCurve, right: 2, top: 49, width: 90, rotate: 3, opacity: 0.21, ink: 'mist', mobile: true },
    { doodle: DoodleH2O, left: 30, top: 49, width: 70, rotate: 3, opacity: 0.20, ink: 'mist', mobile: true },
    { doodle: DoodleMole, right: 30, top: 50, width: 70, rotate: -2, opacity: 0.19, ink: 'sky-200', mobile: true },
    { doodle: DoodleDots, left: 0, top: 8, width: 70, rotate: -3, opacity: 0.08, ink: 'steel', mobile: true },
    { doodle: DoodleUnderline, right: 0, top: 8, width: 70, rotate: 3, opacity: 0.08, ink: 'mist', mobile: true },
    { doodle: DoodleKE, left: 0, top: 72, width: 60, rotate: 4, opacity: 0.17, ink: 'sky-200', mobile: true },
    { doodle: DoodleCrossedSmall, right: 0, top: 73, width: 60, rotate: -4, opacity: 0.16, ink: 'mist', mobile: true },
    { doodle: DoodleCharge, left: 30, top: 74, width: 60, rotate: -2, opacity: 0.17, ink: 'mist', mobile: true },
    { doodle: DoodleEnergy, right: 30, top: 75, width: 60, rotate: 3, opacity: 0.16, ink: 'sky-200', mobile: true },
    { doodle: DoodleWork, left: 5, top: 17, width: 60, rotate: -3, opacity: 0.08, ink: 'sky-200', mobile: true },
    { doodle: DoodleAbSq, left: 20, top: 15, width: 70, rotate: -3, opacity: 0.08, ink: 'mist', mobile: true },
    { doodle: DoodleMean, left: 35, top: 12, width: 70, rotate: 2, opacity: 0.095, ink: 'steel', mobile: true },
    { doodle: DoodleQuadFrag, right: 20, top: 16, width: 80, rotate: 2, opacity: 0.08, ink: 'steel', mobile: true },
    { doodle: DoodleTinyCross, right: 35, top: 13, width: 60, rotate: -4, opacity: 0.095, ink: 'mist', mobile: true },
  ],
  'use-cases': [
    /* The opening padding, spread across the full width. */
    { doodle: DoodleBoxedFma, left: 3, top: 4, width: 140, rotate: 3, opacity: 0.17, ink: 'sky-200' },
    { doodle: DoodleProjectile, left: 28, top: 3, width: 160, rotate: -3, opacity: 0.18, ink: 'mist' },
    { doodle: DoodleCircleRadius, right: 28, top: 4, width: 130, rotate: -5, opacity: 0.16, ink: 'steel' },
    { doodle: DoodleBenzene, right: 3, top: 3, width: 130, rotate: 4, opacity: 0.17, ink: 'sky-200' },
    /* Between the eyebrow and the grid, flanking the heading. */
    { doodle: DoodleCircledEuler, left: 3, top: 16, width: 160, rotate: -4, opacity: 0.13, ink: 'sky-400' },
    { doodle: DoodleTangentLine, right: 3, top: 17, width: 160, rotate: 2, opacity: 0.17, ink: 'steel' },
    /* The closing padding, spread across the full width. */
    { doodle: DoodleLambdaWave, left: 3, top: 90, width: 140, rotate: 5, opacity: 0.17, ink: 'sky-200' },
    { doodle: DoodleCrossedOut, left: 28, top: 91, width: 140, rotate: 5, opacity: 0.16, ink: 'mist' },
    { doodle: DoodleQuadratic, right: 28, top: 90.5, width: 150, rotate: -2, opacity: 0.18, ink: 'sky-200' },
    { doodle: DoodleFlask, right: 3, top: 91, width: 130, rotate: -5, opacity: 0.17, ink: 'mist' },
    /* Mobile: opening padding, the p→grid gap, and the closing padding. */
    { doodle: DoodleCircledEuler, left: 2, top: 4, width: 110, rotate: -4, opacity: 0.14, ink: 'sky-400', mobile: true },
    { doodle: DoodleBoxedFma, right: 2, top: 5, width: 100, rotate: 3, opacity: 0.17, ink: 'sky-200', mobile: true },
    { doodle: DoodleVir, left: 0, top: 29.2, width: 60, rotate: 5, opacity: 0.16, ink: 'mist', mobile: true },
    { doodle: DoodleBenzene, right: 2, top: 95.5, width: 100, rotate: 4, opacity: 0.17, ink: 'mist', mobile: true },
  ],
  footer: [
    /* The opening padding — the reference band: strongest ink on the page. */
    { doodle: DoodleScribbleArrow, left: 3, top: 5, width: 150, rotate: -4, opacity: 0.19, ink: 'sky-200' },
    { doodle: DoodleSineCurve, left: 28, top: 4, width: 160, rotate: 2, opacity: 0.19, ink: 'steel' },
    { doodle: DoodleFlask, right: 28, top: 5, width: 130, rotate: -5, opacity: 0.19, ink: 'mist' },
    { doodle: DoodleCircledEuler, right: 3, top: 4, width: 160, rotate: 3, opacity: 0.14, ink: 'sky-400' },
    /* Between the CTA buttons and the rule. */
    { doodle: DoodleDeltaX, left: 3, top: 39.5, width: 90, rotate: 5, opacity: 0.16, ink: 'mist' },
    { doodle: DoodleThetaAngle, right: 3, top: 40, width: 90, rotate: 4, opacity: 0.13, ink: 'sky-400' },
    /* The directory's side margins — only at xl, where the column leaves
        real margins; below that the directory fills the width. */
    { doodle: DoodlePvnrt, left: 0.5, top: 62, width: 60, rotate: -2, opacity: 0.16, ink: 'mist', wideOnly: true },
    { doodle: DoodleBohrAtom, right: 0.5, top: 64, width: 60, rotate: -3, opacity: 0.17, ink: 'steel', wideOnly: true },
    /* Flanking the ASCII wordmark, peeking from the page's foot. */
    { doodle: DoodleIntegral, right: 3, top: 94, width: 100, rotate: 4, opacity: 0.13, ink: 'sky-400' },
    { doodle: DoodleEmc2, left: 3, top: 93.5, width: 100, rotate: -4, opacity: 0.18, ink: 'sky-200' },
    /* Mobile: opening padding, the CTA→rule gap, and the closing padding. */
    { doodle: DoodleScribbleArrow, left: 2, top: 4, width: 100, rotate: -4, opacity: 0.18, ink: 'sky-200', mobile: true },
    { doodle: DoodleCircledEuler, right: 2, top: 3, width: 110, rotate: 3, opacity: 0.14, ink: 'sky-400', mobile: true },
    { doodle: DoodleDeltaX, left: 2, top: 20, width: 100, rotate: 5, opacity: 0.16, ink: 'mist', mobile: true },
    { doodle: DoodleFlask, left: 30, top: 30, width: 70, rotate: -5, opacity: 0.17, ink: 'mist', mobile: true },
    { doodle: DoodleThetaAngle, right: 2, top: 21, width: 90, rotate: 4, opacity: 0.13, ink: 'sky-400', mobile: true },
    { doodle: DoodleBenzene, right: 2, top: 95.5, width: 100, rotate: 4, opacity: 0.17, ink: 'mist', mobile: true },
  ],
}

/* ── The wallpaper ───────────────────────────────────────────────────── */

export default function SketchWallpaper({
  variant = 'hero',
  tone = 'sky',
  mode = 'quiet',
  className = '',
}: SketchWallpaperProps) {
  /* Each mount needs its own filter ids — useId keeps them unique. */
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const palette = INKS[tone] as Record<string, string>
  const clusters = SCATTERS[variant]
  const inkScale = mode === 'bold' ? 1.25 : 1

  return (
    <div aria-hidden className={`sketch-wallpaper select-none ${className}`}>
      {clusters.map((cluster, i) => {
        const Doodle = cluster.doodle
        const ink = palette[cluster.ink] ?? '#CCE6F1'
        const style: CSSProperties = {
          position: 'absolute',
          top: `${cluster.top}%`,
          width: cluster.width,
          opacity: Math.min(0.32, cluster.opacity * inkScale),
          transform: `rotate(${cluster.rotate}deg)`,
        }
        if (cluster.left !== undefined) style.left = `${cluster.left}%`
        if (cluster.right !== undefined) style.right = `${cluster.right}%`
        return (
          <svg
            key={i}
            viewBox="0 0 320 240"
            className={
              cluster.mobile ? 'md:hidden' : cluster.wideOnly ? 'hidden xl:block' : 'hidden md:block'
            }
            style={style}
          >
            <defs>
              <filter
                id={`sketch-wobble-${uid}-${i}`}
                x="-12%"
                y="-12%"
                width="124%"
                height="124%"
              >
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.016 0.026"
                  numOctaves={1}
                  seed={i * 7 + 3}
                  result="noise"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="noise"
                  scale={2.4}
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>
            </defs>
            <g filter={`url(#sketch-wobble-${uid}-${i})`}>
              <Doodle ink={ink} />
            </g>
          </svg>
        )
      })}
    </div>
  )
}
