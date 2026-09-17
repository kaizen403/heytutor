import { useEffect } from 'react'
import FaqList from './FaqList'
import Reveal from './Reveal'
import { pageByPath } from '../lib/seo'

const HOME_FAQS = pageByPath('/')!.faqs

export default function FaqSection() {
  useEffect(() => {
    if (window.location.hash !== '#faq') return
    document.getElementById('faq')?.scrollIntoView({ block: 'start' })
  }, [])

  return (
    <section
      id="faq"
      className="relative scroll-mt-28 overflow-hidden px-5 pb-16 pt-12 sm:px-8 sm:pb-24 sm:pt-16 lg:px-10"
    >
      <div className="relative z-10 mx-auto max-w-3xl">
        <Reveal className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(202,229,241,0.16)] bg-[rgba(89,175,212,0.08)] px-3 py-1.5 type-accent-s text-sky-300">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
            Questions
          </span>
          <h2 className="type-h2 mt-5 text-frost">
            What people ask about <span className="text-ice">Accelute</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-brand-muted-dark sm:text-lg">
            Accelute is an AI whiteboard tutor — a live board, a voice, and a
            lesson you can interrupt. Here is the short version.
          </p>
        </Reveal>
        <Reveal delay={80} className="mt-10 sm:mt-12">
          <FaqList faqs={HOME_FAQS} />
        </Reveal>
      </div>
    </section>
  )
}
