import type { Faq } from '../lib/seo'
import LinkedCopy from './LinkedCopy'

export default function FaqList({ faqs }: { faqs: readonly Faq[] }) {
  if (faqs.length === 0) return null

  return (
    <div className="divide-y divide-[rgba(202,229,241,0.10)] border-y border-[rgba(202,229,241,0.10)] [&_a]:text-ice [&_a]:underline-offset-2 hover:[&_a]:underline">
      {faqs.map((faq) => (
        <div key={faq.question} className="py-5 sm:py-6">
          <h3 className="font-heading text-[17px] font-medium tracking-[-0.02em] text-frost sm:text-[18px]">
            {faq.question}
          </h3>
          <p className="mt-2 text-[15px] leading-relaxed text-[rgba(240,245,247,0.72)]">
            <LinkedCopy text={faq.answer} />
          </p>
        </div>
      ))}
    </div>
  )
}
