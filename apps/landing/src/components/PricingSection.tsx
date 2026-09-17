import { Check } from 'lucide-react'
import { useEffect } from 'react'
import Button from './ui/Button'
import DitherHalo from './dither/DitherHalo'
import Reveal from './Reveal'
import SketchWallpaper from './sketch/SketchWallpaper'
import { CAL_BOOKING_HREF } from '../lib/calHref'
import { PLANS, TOP_UP, type LandingPlan } from '../lib/plans'
import { TUTOR_LOGIN_HREF } from '../lib/tutorAppHref'

function planHref(plan: LandingPlan): string {
  return plan.hrefKind === 'contact' ? CAL_BOOKING_HREF : TUTOR_LOGIN_HREF
}

function Price({ plan }: { plan: LandingPlan }) {
  if (plan.priceUsd === null) {
    return (
      <p className="mt-5 font-heading text-[34px] leading-none tracking-[-0.03em] text-frost sm:text-[40px]">
        Contact
      </p>
    )
  }

  return (
    <p className="mt-5 flex items-baseline gap-1.5">
      <span className="font-heading text-[34px] leading-none tracking-[-0.03em] text-frost sm:text-[40px]">
        ${plan.priceUsd}
      </span>
      <span className="text-sm text-[rgba(240,245,247,0.48)]">/ month</span>
    </p>
  )
}

function PlanPoints({ plan }: { plan: LandingPlan }) {
  const points =
    plan.id === 'team'
      ? ['Pooled usage for a centre', 'Invoice, not self-serve checkout']
      : [
          'Doubts on those questions included',
          'Included usage resets each calendar month',
        ]

  return (
    <ul className="mt-5 space-y-2.5">
      {points.map((point) => (
        <li
          key={point}
          className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-[rgba(240,245,247,0.68)]"
        >
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[rgba(202,229,241,0.18)] bg-[rgba(89,175,212,0.12)] text-sky-300">
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
          {point}
        </li>
      ))}
    </ul>
  )
}

function PlanCard({ plan }: { plan: LandingPlan }) {
  const featured = Boolean(plan.featured)

  return (
    <article
      className={`glass card-lift flex h-full flex-col rounded-2xl p-5 sm:p-6 ${
        featured ? 'rim-sky border-[rgba(89,175,212,0.38)] bg-[rgba(89,175,212,0.06)]' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="type-accent-s text-sky-300">{plan.name}</h3>
        {plan.badge ? (
          <span className="rounded-full border border-[rgba(202,229,241,0.18)] bg-[rgba(89,175,212,0.12)] px-2.5 py-1 text-[11px] font-medium tracking-[-0.01em] text-sky-200">
            {plan.badge}
          </span>
        ) : null}
      </div>
      <Price plan={plan} />
      {plan.id === 'team' ? (
        <p className="mt-2 font-heading text-lg tracking-[-0.02em] text-sky-200">
          Pooled usage
        </p>
      ) : (
        <p className="mt-2 font-heading text-lg tracking-[-0.02em] text-sky-200">
          Monthly included usage
        </p>
      )}
      <p className="mt-3 text-[13.5px] leading-relaxed text-brand-muted-dark">
        {plan.blurb}
      </p>
      <PlanPoints plan={plan} />
      <div className="mt-auto pt-6">
        <Button
          href={planHref(plan)}
          variant={featured ? 'ice' : plan.hrefKind === 'contact' ? 'ghost' : 'sky'}
          size="md"
          block
          {...(plan.hrefKind === 'contact'
            ? { target: '_blank', rel: 'noreferrer' }
            : {})}
        >
          {plan.cta}
        </Button>
      </div>
    </article>
  )
}

export default function PricingSection() {
  useEffect(() => {
    if (window.location.hash !== '#pricing') return
    document.getElementById('pricing')?.scrollIntoView({ block: 'start' })
  }, [])

  return (
    <section
      id="pricing"
      className="relative scroll-mt-28 overflow-hidden px-5 pb-16 pt-20 sm:px-8 sm:pb-24 sm:pt-24 lg:px-10 lg:pb-28 lg:pt-28"
    >
      <div aria-hidden className="band-lift pointer-events-none absolute inset-0" />
      <SketchWallpaper variant="use-cases" className="z-[1]" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[380px] opacity-[0.20]"
        style={{
          WebkitMaskImage: 'radial-gradient(58% 62% at 50% 28%, #000 0%, transparent 78%)',
          maskImage: 'radial-gradient(58% 62% at 50% 28%, #000 0%, transparent 78%)',
        }}
      >
        <DitherHalo strength={0.5} center={[0.5, 0.28]} />
      </div>

      <div className="relative z-10 mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(202,229,241,0.16)] bg-[rgba(89,175,212,0.08)] px-3 py-1.5 type-accent-s text-sky-300">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
            Pricing
          </span>
          <h2 className="type-h2 mt-5 text-frost">
            Plans for <span className="text-ice">practice</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-brand-muted-dark sm:text-lg">
            Each plan includes monthly usage. Included usage resets each
            calendar month.
          </p>
        </Reveal>

        <Reveal
          group
          as="div"
          delay={80}
          className="mt-12 grid gap-4 sm:mt-14 sm:grid-cols-2 lg:gap-5"
        >
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </Reveal>

        <Reveal variant="fade" delay={160} className="mt-8 sm:mt-10">
          <div className="glass rim-sky mx-auto flex max-w-3xl flex-col items-center gap-1 rounded-2xl px-5 py-5 text-center sm:px-8">
            <p className="type-accent-s text-sky-300">Top-up</p>
            <p className="mt-2 text-[15px] leading-relaxed text-[rgba(240,245,247,0.72)]">
              Add usage for ${TOP_UP.priceUsd}. Stacks on any plan for this
              calendar month.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-[rgba(240,245,247,0.48)]">
              Prices in USD. If you are 13–17, a parent or guardian completes
              paid checkout.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
