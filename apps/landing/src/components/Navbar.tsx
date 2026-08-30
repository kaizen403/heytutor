import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import Brand from './Brand'
import Button from './ui/Button'
import { CAL_BOOKING_HREF } from '../lib/calHref'

const NAV_LINKS = [
  { href: '/#lesson', label: 'How it works' },
  { href: '/#use-cases', label: 'Use cases' },
  { href: '/#pricing', label: 'Pricing' },
]

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // A raised glass tile: the body is a vertical light-fall (bright at the top
  // edge, sinking into the navy at the bottom), the top inner hairline is the
  // light catching the rim, the bottom inner shade is the tile's thickness,
  // and two shadows — a tight contact one and a long ambient one — lift it off
  // the page. It starts sheer over the hero and firms up once content scrolls
  // under it; the hero whiteboard is near-white, so without that step the
  // links drop to ~2:1.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const lifted = scrolled || mobileOpen

  return (
    <nav className="animate-fade-down sticky top-0 z-50 px-4 pt-3 sm:px-6 sm:pt-4">
      <div className="relative mx-auto w-full max-w-6xl">
        <div
          className={`flex items-center justify-between rounded-[16px] border px-3.5 py-2.5 backdrop-blur-2xl backdrop-saturate-150 transition-[background-color,border-color,box-shadow] duration-500 sm:px-4 ${
            lifted
              ? 'border-[rgba(202,229,241,0.20)] bg-[linear-gradient(180deg,rgba(240,245,247,0.13)_0%,rgba(202,229,241,0.05)_42%,rgba(10,27,39,0.42)_100%)] bg-[rgba(6,18,28,0.72)] shadow-[inset_0_1px_0_rgba(240,245,247,0.18),inset_0_-1px_0_rgba(3,11,18,0.45),0_10px_24px_-12px_rgba(3,11,18,0.65),0_30px_70px_-28px_rgba(3,11,18,0.9)]'
              : 'border-[rgba(202,229,241,0.15)] bg-[linear-gradient(180deg,rgba(240,245,247,0.10)_0%,rgba(202,229,241,0.04)_42%,rgba(10,27,39,0.30)_100%)] bg-[rgba(6,18,28,0.42)] shadow-[inset_0_1px_0_rgba(240,245,247,0.14),inset_0_-1px_0_rgba(3,11,18,0.35),0_8px_20px_-12px_rgba(3,11,18,0.5),0_24px_60px_-28px_rgba(3,11,18,0.75)]'
          }`}
        >
          <Brand href="/" className="pl-1" />

          <div className="hidden items-center gap-9 md:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="nav-link text-[13.5px] tracking-[-0.005em] text-[rgba(240,245,247,0.58)] transition-colors duration-300 hover:text-frost"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center">
            <Button
              href={CAL_BOOKING_HREF}
              size="sm"
              className="hidden md:inline-flex"
              target="_blank"
              rel="noopener noreferrer"
            >
              Try it free
            </Button>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center text-[rgba(240,245,247,0.7)] transition-colors duration-300 hover:text-frost md:hidden"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? (
                <X className="h-[22px] w-[22px]" />
              ) : (
                <Menu className="h-[22px] w-[22px]" />
              )}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="glass-deep animate-fade-up absolute inset-x-0 top-full mt-2 rounded-[16px] p-4 md:hidden">
            <div className="flex flex-col gap-0.5">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-2 py-2.5 text-[15px] text-[rgba(240,245,247,0.72)] transition-colors duration-200 hover:bg-white/5 hover:text-frost"
                >
                  {link.label}
                </a>
              ))}
            </div>
            <Button
              href={CAL_BOOKING_HREF}
              size="sm"
              block
              className="mt-3"
              target="_blank"
              rel="noopener noreferrer"
            >
              Try it free
            </Button>
          </div>
        )}
      </div>
    </nav>
  )
}
