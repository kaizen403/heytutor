interface MarqueeLogo {
  src: string
  alt: string
  gradient: { from: string; to: string }
}

const LOGOS: MarqueeLogo[] = [
  { src: 'https://svgl.app/library/procure.svg', alt: 'Procure', gradient: { from: '#3B82F6', to: '#1D4ED8' } },
  { src: 'https://svgl.app/library/shopify.svg', alt: 'Shopify', gradient: { from: '#FDE047', to: '#F59E0B' } },
  { src: 'https://svgl.app/library/blender.svg', alt: 'Blender', gradient: { from: '#60A5FA', to: '#2563EB' } },
  { src: 'https://svgl.app/library/figma.svg', alt: 'Figma', gradient: { from: '#C084FC', to: '#7C3AED' } },
  { src: 'https://svgl.app/library/spotify.svg', alt: 'Spotify', gradient: { from: '#FB7185', to: '#E11D48' } },
  { src: 'https://svgl.app/library/lottielab.svg', alt: 'Lottielab', gradient: { from: '#FDE047', to: '#4ADE80' } },
  { src: 'https://svgl.app/library/google-cloud.svg', alt: 'Google Cloud', gradient: { from: '#7DD3FC', to: '#38BDF8' } },
  { src: 'https://svgl.app/library/bing.svg', alt: 'Bing', gradient: { from: '#22D3EE', to: '#0D9488' } },
]

const MASK = 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)'

function LogoCard({ logo }: { logo: MarqueeLogo }) {
  return (
    <div className="group relative flex h-24 w-40 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/60 bg-white shadow-sm transition-all hover:border-slate-300">
      <div
        aria-hidden
        className="absolute inset-0 scale-150 opacity-0 transition-all duration-500 group-hover:scale-100 group-hover:opacity-100"
        style={{ background: `linear-gradient(135deg, ${logo.gradient.from}, ${logo.gradient.to})` }}
      />
      <img
        src={logo.src}
        alt={logo.alt}
        loading="lazy"
        className="relative z-10 h-8 w-auto max-w-[60%] object-contain transition-all duration-500 group-hover:brightness-0 group-hover:invert"
      />
    </div>
  )
}

export default function LogoMarquee() {
  return (
    <section aria-label="Logo cloud" className="relative bg-brand-section pt-24 pb-16 sm:pt-32 sm:pb-20 lg:pt-44">
      <div
        className="marquee overflow-hidden"
        style={{ maskImage: MASK, WebkitMaskImage: MASK }}
      >
        <div className="marquee-track flex w-max">
          {[0, 1].map((half) => (
            <div key={half} className="flex gap-4 pr-4" aria-hidden={half === 1}>
              {LOGOS.map((logo) => (
                <LogoCard key={`${half}-${logo.alt}`} logo={logo} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
