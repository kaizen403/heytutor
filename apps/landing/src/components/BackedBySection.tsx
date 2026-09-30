import Reveal from './Reveal'

/* Each brand's own dark-background logo, in its own colours. Heights are set
   per logo by eye: a compact mark like AWS needs more height than a long
   wordmark to carry the same visual weight. */
const BACKERS = [
  { name: 'AWS', href: 'https://aws.amazon.com', src: '/logos/aws.svg', ratio: 304 / 182, h: 46 },
  { name: 'Fireworks AI', href: 'https://fireworks.ai', src: '/logos/fireworks.svg', ratio: 343 / 44, h: 25 },
  { name: 'Cartesia', href: 'https://cartesia.ai', src: '/logos/cartesia.svg', ratio: 140 / 20, h: 25 },
  { name: 'Sarvam AI', href: 'https://www.sarvam.ai', src: '/logos/sarvam.svg', ratio: 202 / 32, h: 21 },
]

export default function BackedBySection() {
  return (
    <section
      id="backed-by"
      className="relative overflow-hidden px-5 pb-20 pt-4 sm:px-8 sm:pb-24 lg:px-10"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-[radial-gradient(44%_60%_at_50%_62%,rgba(89,175,212,0.12)_0%,transparent_72%)]"
      />

      <div className="relative z-10 mx-auto max-w-5xl">
        <Reveal className="text-center">
          <h2 className="type-h2 text-frost">
            Backed <span className="text-ice">by</span>
          </h2>
        </Reveal>

        <Reveal
          group
          as="ul"
          delay={80}
          className="mt-10 grid grid-cols-2 items-center justify-items-center gap-x-6 gap-y-10 [--logo-scale:0.78] sm:mt-14 sm:flex sm:flex-wrap sm:justify-center sm:gap-x-16 sm:[--logo-scale:0.9] lg:gap-x-24 lg:[--logo-scale:1]"
        >
          {BACKERS.map((b) => (
            <li key={b.name}>
              <a
                href={b.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-md opacity-90 outline-none transition duration-300 hover:-translate-y-0.5 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sky-500/60 focus-visible:ring-offset-8 focus-visible:ring-offset-ink-950"
              >
                <img
                  src={b.src}
                  alt={b.name}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="block select-none"
                  style={{
                    height: `calc(${b.h}px * var(--logo-scale))`,
                    width: `calc(${(b.h * b.ratio).toFixed(1)}px * var(--logo-scale))`,
                  }}
                />
              </a>
            </li>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
