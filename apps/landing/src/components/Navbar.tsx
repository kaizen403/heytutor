import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import Brand from './Brand'
import Button from './ui/Button'
import { TUTOR_APP_HREF } from '../lib/tutorAppHref'

const NAV_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
]

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // The island always has a body so it reads as a floating tile, but it starts
  // sheer over the hero and firms up once content scrolls under it. The hero
  // whiteboard is near-white; without that step the links drop to ~2:1.
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
          className={`flex items-center justify-between rounded-[16px] border px-3.5 py-2.5 transition-[background-color,border-color,box-shadow,backdrop-filter] duration-500 sm:px-4 ${
            lifted
              ? 'border-[rgba(202,229,241,0.16)] bg-[rgba(6,18,28,0.82)] shadow-[0_18px_50px_-24px_rgba(3,11,18,0.9)] backdrop-blur-2xl backdrop-saturate-150'
              : 'border-[rgba(202,229,241,0.10)] bg-[rgba(6,18,28,0.45)] backdrop-blur-xl'
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
            <Button href={TUTOR_APP_HREF} size="sm" className="hidden md:inline-flex">
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
            <Button href={TUTOR_APP_HREF} size="sm" block className="mt-3">
              Try it free
            </Button>
          </div>
        )}
      </div>
    </nav>
  )
}
