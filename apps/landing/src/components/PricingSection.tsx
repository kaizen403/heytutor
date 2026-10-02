import { Check, Plus } from 'lucide-react'
import { useEffect, useId } from 'react'
import Button from './ui/Button'
import DitherHalo from './dither/DitherHalo'
import Reveal from './Reveal'
import SketchWallpaper from './sketch/SketchWallpaper'
import { CAL_BOOKING_HREF } from '../lib/calHref'
import { PLANS, type IndividualPlan } from '../lib/plans'
import { TUTOR_LOGIN_HREF, tutorCreditsHref, tutorPlanHref } from '../lib/tutorAppHref'
import { formatUpgradePrice, useUpgradeCatalog, type Currency, type UpgradePrice } from '../lib/useUpgradeCatalog'

function PlanCard({ plan, currency, price, failed }: {
  plan: IndividualPlan; currency: Currency | null; price?: UpgradePrice; failed: boolean
}) {
  const paid = plan.id === 'plus'
  const label = !paid ? currency === 'INR' ? '₹0' : '$0'
    : price ? formatUpgradePrice(price) : !currency ? 'Finding your currency…'
    : currency === 'USD' ? '$29' : failed ? 'INR amount unavailable' : 'Checking INR amount…'
  return (
    <article className={`glass card-lift flex h-full flex-col rounded-2xl p-5 sm:p-7 ${paid ? 'rim-sky border-[rgba(89,175,212,0.38)] bg-[rgba(89,175,212,0.06)]' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="type-accent-s text-sky-300">{plan.name}</h3>
        {plan.badge ? <span className="rounded-full border border-[rgba(202,229,241,0.18)] bg-[rgba(89,175,212,0.12)] px-2.5 py-1 text-xs text-sky-200">{plan.badge}</span> : null}
      </div>
      <p className="mt-5 flex flex-wrap items-baseline gap-1.5" aria-live="polite">
        <span className={`font-heading leading-none tracking-[-0.03em] text-frost ${paid && !price && currency !== 'USD' ? 'text-xl' : 'text-[34px] sm:text-[40px]'}`}>{label}</span>
        {!paid || price || currency === 'USD' ? <span className="text-sm text-brand-muted-dark">/ month</span> : null}
      </p>
      <p className="mt-3 font-heading text-lg tracking-[-0.02em] text-sky-200">Live whiteboard tutoring</p>
      <p className="mt-3 text-sm leading-relaxed text-brand-muted-dark">{plan.blurb}</p>
      <ul className="mt-5 space-y-2.5">
        {['Spoken, step-by-step explanations', 'Diagrams, notes, and lesson replay'].map(point => (
          <li key={point} className="flex items-start gap-2.5 text-sm leading-relaxed text-brand-muted-dark">
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[rgba(202,229,241,0.18)] bg-[rgba(89,175,212,0.12)] text-sky-300"><Check className="h-2.5 w-2.5" strokeWidth={3} /></span>
            {point}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-7">
        <Button href={paid ? tutorPlanHref('plus', currency ?? undefined) : TUTOR_LOGIN_HREF} variant={paid ? 'ice' : 'sky'} size="md" block>{plan.cta}</Button>
        <p className="mt-3 text-xs leading-relaxed text-brand-muted-dark">{paid ? 'One month per purchase. No automatic renewal.' : 'Start learning. No payment required.'}</p>
      </div>
    </article>
  )
}

export default function PricingSection() {
  const { currency, prices, failed, selectCurrency } = useUpgradeCatalog()
  const currencyId = useId()
  useEffect(() => {
    if (window.location.hash === '#pricing') document.getElementById('pricing')?.scrollIntoView({ block: 'start' })
  }, [])
  return (
    <section id="pricing" className="relative scroll-mt-28 overflow-hidden px-5 pb-16 pt-20 sm:px-8 sm:pb-24 sm:pt-24 lg:px-10 lg:pb-28 lg:pt-28">
      <div aria-hidden className="band-lift pointer-events-none absolute inset-0" />
      <SketchWallpaper variant="use-cases" className="z-[1]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[380px] opacity-[0.20]" style={{ WebkitMaskImage: 'radial-gradient(58% 62% at 50% 28%, #000 0%, transparent 78%)', maskImage: 'radial-gradient(58% 62% at 50% 28%, #000 0%, transparent 78%)' }}><DitherHalo strength={0.5} center={[0.5, 0.28]} /></div>
      <div className="relative z-10 mx-auto max-w-5xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(202,229,241,0.16)] bg-[rgba(89,175,212,0.08)] px-3 py-1.5 type-accent-s text-sky-300"><span className="h-1.5 w-1.5 rounded-full bg-sky-500" />Upgrade now</span>
          <h2 className="type-h2 mt-5 text-frost">Make room for your <span className="text-ice">next breakthrough.</span></h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-brand-muted-dark sm:text-lg">Start with a question. Go further with Plus. Your whiteboard is ready whenever you are.</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-sm text-brand-muted-dark">
            <label htmlFor={currencyId}>Your currency</label>
            <select id={currencyId} value={currency ?? ''} disabled={!currency} onChange={event => selectCurrency(event.target.value as Currency)} className="rounded-lg border border-white/20 bg-ink px-3 py-2 text-frost focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">
              {!currency ? <option value="">Detecting…</option> : null}
              <option value="INR">INR · ₹</option><option value="USD">USD · $</option>
            </select>
          </div>
        </Reveal>
        <Reveal group as="div" delay={80} className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2 lg:gap-5">
          {PLANS.filter((plan): plan is IndividualPlan => plan.id !== 'team').map(plan => <PlanCard key={plan.id} plan={plan} currency={currency} price={prices.plus} failed={failed} />)}
        </Reveal>
        <Reveal variant="fade" delay={120} className="glass mt-5 flex flex-col gap-5 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-3">
            <span className="mt-1 rounded-full bg-sky-500/10 p-2 text-sky-300"><Plus className="h-5 w-5" aria-hidden /></span>
            <div><h3 className="font-heading text-lg text-frost">A little more room to learn.</h3><p className="mt-1 max-w-lg text-sm leading-relaxed text-brand-muted-dark">Add credits to your current plan whenever you need more practice. They last until your current usage period ends.</p></div>
          </div>
          <Button href={tutorCreditsHref(currency ?? undefined)} variant="sky" size="md" className="shrink-0">Add credits{prices.lesson_top_up ? ` · ${formatUpgradePrice(prices.lesson_top_up)}` : currency === 'USD' ? ' · $10' : ''}</Button>
        </Reveal>
        <Reveal variant="fade" delay={160} className="mt-6 space-y-3 text-center">
          <p className="text-xs leading-relaxed text-brand-muted-dark">{currency === 'INR' && prices.plus ? 'INR equivalent of $29. ' : ''}The final amount is shown before payment. If you are 13–17, a parent or guardian completes paid checkout.</p>
          {failed ? <p role="status" className="text-xs text-brand-muted-dark">{currency === 'INR' ? 'We could not get a recent INR amount. Please try again shortly.' : 'Payment options will be confirmed when you sign in.'}</p> : null}
          <p className="text-sm text-brand-muted-dark">Learning together at a coaching centre? <a className="text-sky-200 underline underline-offset-4" href={CAL_BOOKING_HREF} target="_blank" rel="noreferrer">Let’s talk.</a></p>
        </Reveal>
      </div>
    </section>
  )
}
