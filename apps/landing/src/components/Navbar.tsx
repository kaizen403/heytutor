import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import Logo from './Logo'

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <nav className="animate-fade-down relative z-20 flex items-center justify-between px-5 py-4 sm:px-8 sm:py-5 lg:px-10">
      <div className="flex items-center gap-2 text-[#003C43]">
        <Logo className="h-5 w-5 sm:h-6 sm:w-6" />
        <span className="text-base font-semibold tracking-tight">Accelute</span>
      </div>

      <div className="hidden items-center gap-8 md:flex">
        <a href="#how-it-works" className="text-[13px] text-[#135D66] hover:text-[#003C43]">
          How it works
        </a>
        <a href="#features" className="text-[13px] text-[#135D66] hover:text-[#003C43]">
          Features
        </a>
        <a href="#pricing" className="text-[13px] text-[#135D66] hover:text-[#003C43]">
          Pricing
        </a>
      </div>

      <div className="flex items-center gap-3">
        <a
          href="/app"
          className="hidden rounded-full bg-[#003C43] px-4 py-2 text-[13px] font-medium text-[#E3FEF7] hover:bg-[#135D66] sm:px-5 md:inline-block"
        >
          Try it free
        </a>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-full text-[#003C43] hover:bg-[#003C43]/10 md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="animate-fade-up absolute left-4 right-4 top-full rounded-2xl bg-[#E3FEF7]/90 px-5 py-3 backdrop-blur-xl ring-1 ring-[#77B0AA]/30 md:hidden">
          <a href="#how-it-works" className="block border-b border-[#77B0AA]/30 py-2.5 text-[15px] text-[#135D66] hover:text-[#003C43]">
            How it works
          </a>
          <a href="#features" className="block border-b border-[#77B0AA]/30 py-2.5 text-[15px] text-[#135D66] hover:text-[#003C43]">
            Features
          </a>
          <a href="#pricing" className="block py-2.5 text-[15px] text-[#135D66] hover:text-[#003C43]">
            Pricing
          </a>
          <a href="/app" className="mt-2 block rounded-full bg-[#003C43] px-4 py-2 text-center text-[13px] font-medium text-[#E3FEF7]">
            Try it free
          </a>
        </div>
      )}
    </nav>
  )
}
