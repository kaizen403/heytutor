"use client";

/**
 * The margin of a working notebook, drawn around the empty board.
 *
 * The first screen is one prompt and one input on a very large field, and an
 * empty field reads as unfinished. These fill it the way a student's margin
 * fills: instruments, a few formulas in the hand, and the small marks made
 * while thinking. Everything is decorative and inert, and none of it is
 * allowed anywhere the input or the suggestion stack can reach.
 *
 * Rendered as a sibling of the landing column rather than inside it: the
 * column animates in with a transform, which would make it the containing
 * block for these and pin them to the text instead of the panel edges.
 *
 * CanvasLanding already keeps its own doodles in these margins: books centred
 * at 56% on the left, a stack of three formulas centred at 56% on the right.
 * Nothing here may occupy those bands, and no hand-written maths goes on the
 * right at all — two columns of it in one margin is a pile, not a layout.
 */
export function LandingDoodles() {
  return (
    <div className="lds" aria-hidden>
      <span className="lds__item lds__item--compass">
        <CompassDoodle />
      </span>
      <span className="lds__item lds__item--flask">
        <FlaskDoodle />
      </span>
      <span className="lds__item lds__item--atom">
        <AtomDoodle />
      </span>
      <span className="lds__item lds__item--triangle">
        <SetSquareDoodle />
      </span>
      <span className="lds__item lds__item--bulb">
        <BulbDoodle />
      </span>
      <span className="lds__item lds__item--clip">
        <PaperClipDoodle />
      </span>

      <span className="lds__hand lds__hand--force">F = ma</span>
      <span className="lds__hand lds__hand--motion">v = u + at</span>

      <span className="lds__tick lds__tick--one">✓</span>
      <span className="lds__tick lds__tick--two">?</span>

      <style>{STYLES}</style>
    </div>
  );
}

/* ── The instruments ──────────────────────────────────────────────────────
   One stroke weight throughout, no fills: they have to read as pen on paper
   beside the hand-written formulas, not as an icon set. */

function CompassDoodle() {
  return (
    <svg viewBox="0 0 64 72" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {/* Hinge, then the two legs splayed from it. */}
        <circle cx="32" cy="11" r="4" />
        <path d="M32 15v5" />
        <path d="M30 20 16 60" />
        <path d="M34 20l14 40" />
        {/* Pencil leg foot and needle point. */}
        <path d="M14 55h5" strokeWidth="1.2" />
        <path d="M16 60l-1.5 5 4-2z" />
        <path d="M45 55h5" strokeWidth="1.2" />
        <path d="M48 60l1.5 5-4-2z" />
        {/* The arc it has just swept. */}
        <path d="M13 68q19 8 38 0" strokeWidth="1.1" strokeDasharray="3 4" />
      </g>
    </svg>
  );
}

function FlaskDoodle() {
  return (
    <svg viewBox="0 0 56 64" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 6h12" />
        <path d="M24 6v18L11 50a4 4 0 0 0 3.5 6h27A4 4 0 0 0 45 50L32 24V6" />
        {/* Fill line and the bubbles above it. */}
        <path d="M17 42h22" strokeWidth="1.2" />
        <circle cx="24" cy="36" r="1.6" strokeWidth="1.1" />
        <circle cx="31" cy="31" r="1.1" strokeWidth="1.1" />
        <circle cx="27" cy="26" r="0.9" strokeWidth="1.1" />
      </g>
    </svg>
  );
}

function AtomDoodle() {
  return (
    <svg viewBox="0 0 72 72" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <ellipse cx="36" cy="36" rx="31" ry="12" />
        <ellipse cx="36" cy="36" rx="31" ry="12" transform="rotate(60 36 36)" />
        <ellipse cx="36" cy="36" rx="31" ry="12" transform="rotate(120 36 36)" />
      </g>
      <circle cx="36" cy="36" r="3.4" fill="currentColor" />
      <circle cx="66" cy="30" r="2" fill="currentColor" opacity="0.75" />
      <circle cx="19" cy="55" r="2" fill="currentColor" opacity="0.75" />
    </svg>
  );
}

function SetSquareDoodle() {
  return (
    <svg viewBox="0 0 72 60" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 52h56L8 8z" />
        {/* Right-angle mark at the corner that has one. */}
        <path d="M8 44h8v8" strokeWidth="1.2" />
        {/* The angle arc at the far corner, the way it gets marked up. */}
        <path d="M52 52a16 16 0 0 0-6-12" strokeWidth="1.1" />
        {/* Edge graduations. */}
        <path d="M20 52v-4M32 52v-4M44 52v-4" strokeWidth="1" />
      </g>
    </svg>
  );
}

function BulbDoodle() {
  return (
    <svg viewBox="0 0 48 60" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M24 6a14 14 0 0 0-8 25.5c1.6 1.3 2.5 3 2.5 5V38h11v-1.5c0-2 .9-3.7 2.5-5A14 14 0 0 0 24 6" />
        <path d="M18.5 43h11M20 48h8" strokeWidth="1.3" />
        {/* Filament. */}
        <path d="M21 31l3-5 3 5" strokeWidth="1.1" />
        {/* The idea, arriving. */}
        <path d="M24 1v-1M6 14l-3-2M42 14l3-2M9 27l-3.5 1M39 27l3.5 1" strokeWidth="1.2" />
      </g>
    </svg>
  );
}

function PaperClipDoodle() {
  return (
    <svg viewBox="0 0 40 64" fill="none" aria-hidden>
      <path
        d="M28 18v26a10 10 0 0 1-20 0V16a7 7 0 0 1 14 0v26a4 4 0 0 1-8 0V20"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/*
  Placement is a two-column margin: everything sits in the outer ~16% of the
  panel on each side, so the 40rem centre column the prompt and the suggestion
  stack occupy is never encroached on. Below 1280px the field thins to the four
  strongest pieces; below 1024px it goes entirely, because there is no margin
  left to draw in.
*/
const STYLES = `
.lds {
  position: absolute;
  inset: 0;
  pointer-events: none;
  user-select: none;
  overflow: hidden;
  color: var(--frost);
  display: none;
}

@media (min-width: 1024px) {
  .lds { display: block; }
}

.lds__item {
  position: absolute;
  display: block;
  opacity: 0.4;
  animation: lds-drift 13s ease-in-out infinite;
}

.lds__item svg {
  display: block;
  width: 100%;
  height: auto;
}

.lds__hand {
  position: absolute;
  font-family: var(--font-hand);
  font-size: clamp(1.05rem, 1.5vw, 1.5rem);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  color: var(--sky-200);
  opacity: 0.4;
  animation: lds-drift 16s ease-in-out infinite;
}

.lds__tick {
  position: absolute;
  font-family: var(--font-hand);
  font-size: 1.75rem;
  line-height: 1;
  color: var(--sky-400);
  opacity: 0.34;
  animation: lds-drift 11s ease-in-out infinite;
}

/* Left margin. */
.lds__item--compass  { left: 3.5%;  top: 16%; width: clamp(2.6rem, 4vw, 3.9rem); transform: rotate(-11deg); animation-delay: -1.5s; }
.lds__item--flask    { left: 6%;    top: 62%; width: clamp(2.2rem, 3.4vw, 3.3rem); transform: rotate(7deg);  animation-delay: -6s; }
.lds__hand--force    { left: 4.5%;  top: 30%; transform: rotate(-4deg);  animation-delay: -3s; }
.lds__hand--motion   { left: 7.5%;  top: 82%; transform: rotate(3deg);   animation-delay: -9s; }
.lds__tick--one      { left: 12.5%; top: 30%; transform: rotate(-9deg);  animation-delay: -4.5s; }

/* Right margin. */
.lds__item--atom     { right: 3%;   top: 14%; width: clamp(3rem, 4.6vw, 4.5rem);  transform: rotate(9deg);   animation-delay: -2.5s; }
.lds__item--triangle { right: 5.5%; top: 80%; width: clamp(2.8rem, 4.2vw, 4.2rem); transform: rotate(-6deg); animation-delay: -7.5s; }
.lds__item--bulb     { right: 11%;  top: 28%; width: clamp(1.9rem, 2.8vw, 2.7rem); transform: rotate(5deg);  animation-delay: -5s; }
.lds__item--clip     { right: 13%;  top: 86%; width: clamp(1.2rem, 1.8vw, 1.7rem); transform: rotate(-14deg); animation-delay: -10s; }
.lds__tick--two      { right: 14%;  top: 24%; transform: rotate(11deg);  animation-delay: -2s; }

/*
  The drift has to be additive with each piece's own rotation, and a transform
  shorthand would overwrite it — so the movement rides on translate/rotate,
  which compose on top of the transform property rather than replacing it.
*/
@keyframes lds-drift {
  0%, 100% { translate: 0 0; }
  50%      { translate: 0 -7px; }
}

@media (max-width: 1279px) {
  .lds__item--bulb,
  .lds__item--clip,
  .lds__hand--motion,
  .lds__tick--one,
  .lds__tick--two {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lds__item,
  .lds__hand,
  .lds__tick {
    animation: none;
  }
}
`;
