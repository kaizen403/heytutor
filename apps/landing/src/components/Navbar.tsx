import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import Logo from './Logo'

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <nav className="animate-fade-down relative z-20 flex items-center justify-between px-5 py-4 sm:px-8 sm:py-5 lg:px-10">
      <div className="flex items-center gap-2 text-brand-fg">
        <Logo className="h-5 w-5 sm:h-6 sm:w-6" />
        <span className="text-base font-semibold tracking-tight">Accelute</span>
      </div>

      <div className="hidden items-center gap-8 md:flex">
        <a href="#how-it-works" className="text-[13px] text-brand-muted hover:text-brand-fg">
          How it works
        </a>
        <a href="#features" className="text-[13px] text-brand-muted hover:text-brand-fg">
          Features
        </a>
        <a href="#pricing" className="text-[13px] text-brand-muted hover:text-brand-fg">
          Pricing
        </a>
      </div>

      <div className="flex items-center gap-3">
        <a
          href="/app"
          className="hidden rounded-full bg-brand-cta px-4 py-2 text-[13px] font-medium text-white hover:bg-brand-fg-soft sm:px-5 md:inline-block"
        >
          Try it free
        </a>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-full text-brand-fg hover:bg-black/5 md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="animate-fade-up absolute left-4 right-4 top-full rounded-2xl bg-white/90 px-5 py-3 backdrop-blur-xl ring-1 ring-brand-border md:hidden">
          <a href="#how-it-works" className="block border-b border-brand-border py-2.5 text-[15px] text-brand-muted hover:text-brand-fg">
            How it works
          </a>
          <a href="#features" className="block border-b border-brand-border py-2.5 text-[15px] text-brand-muted hover:text-brand-fg">
            Features
          </a>
          <a href="#pricing" className="block py-2.5 text-[15px] text-brand-muted hover:text-brand-fg">
            Pricing
          </a>
          <a href="/app" className="mt-2 block rounded-full bg-brand-cta px-4 py-2 text-center text-[13px] font-medium text-white">
            Try it free
          </a>
        </div>
      )}
    </nav>
  )
}
