import { useEffect, type ReactNode } from 'react'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'

export function LegalSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-[22px] font-medium tracking-[-0.02em] text-frost">
        {title}
      </h2>
      {children}
    </section>
  )
}

export default function LegalDocument({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: ReactNode
}) {
  useEffect(() => {
    window.scrollTo(0, 0)
    document.title = `${title} · Accelute`
  }, [title])

  return (
    <div className="relative min-h-screen bg-ink-950 text-frost">
      <Navbar />
      <main className="relative z-10 mx-auto max-w-2xl px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <p className="type-accent-s text-[rgba(202,229,241,0.5)]">Legal</p>
        <h1 className="type-h2 mt-3 text-frost">{title}</h1>
        <p className="mt-3 text-sm text-[rgba(240,245,247,0.45)]">
          Last updated {updated}
        </p>
        <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-[rgba(240,245,247,0.72)] [&_a]:text-ice [&_a]:underline-offset-2 hover:[&_a]:underline [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  )
}
