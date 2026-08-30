/* The mark is YC's own: path and orange (#F0652F) from the official Simple
   Icons source, split into square + Y so the letterform can ride the frost
   token instead of a hardcoded white. The chip is a solid navy tile — an
   ink-800→ink-900 body with the house rim light and contact shadow — kept
   deliberately opaque so it never reads as a mini navbar. */
export default function BackedByYC({ className = '' }: { className?: string }) {
  return (
    <a
      href="https://www.ycombinator.com"
      target="_blank"
      rel="noreferrer"
      className={`group inline-flex items-center gap-3 rounded-[10px] border border-[rgba(202,229,241,0.16)] bg-[linear-gradient(180deg,#122A39_0%,#0A1B27_100%)] px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(240,245,247,0.10),inset_0_-1px_0_rgba(3,11,18,0.5),0_10px_26px_-14px_rgba(3,11,18,0.65)] transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-px hover:border-[rgba(202,229,241,0.30)] hover:shadow-[inset_0_1px_0_rgba(240,245,247,0.14),inset_0_-1px_0_rgba(3,11,18,0.5),0_14px_32px_-14px_rgba(3,11,18,0.75)] ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] rounded-[3px]" aria-hidden="true">
        <path d="M0 24V0h24v24H0z" fill="#F0652F" />
        <path
          d="M6.951 5.896l4.112 7.708v5.064h1.583v-4.972l4.148-7.799h-1.749l-2.457 4.875c-.372.745-.688 1.434-.688 1.434s-.297-.708-.651-1.434L8.831 5.896h-1.88z"
          fill="var(--frost)"
        />
      </svg>
      <span className="type-accent-s text-[rgba(240,245,247,0.66)] transition-colors duration-300 group-hover:text-frost">
        Backed by YC
      </span>
    </a>
  )
}
