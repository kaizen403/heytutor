import { ArrowRight } from 'lucide-react'
import Logo from './Logo'

type FooterLink = { label: string; href: string }

type FooterColumn = {
  title: string
  links: FooterLink[]
}

const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { label: 'Whiteboard', href: '#how-it-works' },
      { label: 'Voice tutor', href: '#how-it-works' },
      { label: 'Templates', href: '#features' },
      { label: 'Try the app', href: '/app' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Features', href: '#features' },
      { label: 'Docs', href: '#' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '#' },
      { label: 'Terms', href: '#' },
      { label: 'Privacy', href: '#' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },
]

const CONTAINER = 'mx-auto max-w-6xl px-5 sm:px-8 lg:px-10'

function FooterLinkList({ links }: { links: FooterLink[] }) {
  return (
    <ul className="mt-4 space-y-2.5">
      {links.map((link) => (
        <li key={link.label}>
          <a
            href={link.href}
            className="text-[14px] text-[#A1A1A1] no-underline transition-colors hover:text-white"
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  )
}

export default function Footer() {
  return (
    <footer id="pricing" className="landing-section-inset bg-brand-footer text-white">
      <div aria-hidden className="footer-top-blend pointer-events-none h-10 sm:h-12" />

      <div className={CONTAINER}>
        <div className="flex flex-col gap-8 pt-4 sm:flex-row sm:items-end sm:justify-between sm:gap-12 lg:pt-6">
          <h2 className="max-w-xl font-heading text-[clamp(2rem,5vw,3.5rem)] font-medium leading-[1.08] tracking-[-0.03em]">
            What will your next lesson look like?
          </h2>

          <a
            href="/app"
            className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full bg-white px-6 py-3 text-[14px] font-medium text-brand-fg-soft no-underline transition-opacity hover:opacity-85"
          >
            Try it free
            <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </a>
        </div>

        <div className="mt-14 grid grid-cols-2 gap-x-8 gap-y-10 sm:mt-16 sm:flex sm:gap-x-16 lg:gap-x-24">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#8A8A8A]">
                {column.title}
              </h3>
              <FooterLinkList links={column.links} />
            </div>
          ))}
        </div>
      </div>

      <div className="relative mt-14 overflow-hidden border-t border-white/10 sm:mt-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center"
        >
          <span
            className="translate-y-[58%] whitespace-nowrap font-heading text-[clamp(4rem,14vw,9rem)] font-medium leading-none tracking-[-0.04em] text-transparent"
            style={{ WebkitTextStroke: '1px rgba(255, 255, 255, 0.1)' }}
          >
            Accelute
          </span>
        </div>

        <div
          className={`${CONTAINER} relative z-10 flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between`}
        >
          <div className="flex items-center gap-2.5">
            <Logo className="h-5 w-5 shrink-0 text-white" />
            <span className="text-[15px] font-medium tracking-[-0.01em]">Accelute</span>
          </div>

          <p className="text-[12px] text-[#8A8A8A]">© 2026 Accelute</p>
        </div>
      </div>
    </footer>
  )
}
