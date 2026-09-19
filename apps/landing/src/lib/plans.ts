/** Student-facing catalog. Do not add plans that are not in the billing plan. */

export const TOP_UP = {
  priceUsd: 10,
} as const

export type PlanHrefKind = 'login' | 'contact'

type PlanBase = {
  name: string
  blurb: string
  cta: string
  hrefKind: PlanHrefKind
  featured?: boolean
  badge?: string
}

export type IndividualPlan = PlanBase & {
  id: 'free' | 'plus' | 'pro'
  priceUsd: number
  hrefKind: 'login'
}

export type TeamPlan = PlanBase & {
  id: 'team'
  priceUsd: null
  hrefKind: 'contact'
}

export type LandingPlan = IndividualPlan | TeamPlan

export const PLANS: readonly LandingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    blurb: 'Monthly included usage to try physics, maths, and a doubt chain.',
    cta: 'Try it free',
    hrefKind: 'login',
  },
  {
    id: 'plus',
    name: 'Plus',
    priceUsd: 19,
    blurb: 'Daily practice. About a lesson or two a day.',
    cta: 'Get Plus',
    hrefKind: 'login',
    featured: true,
    badge: 'Most students',
  },
  {
    id: 'pro',
    name: 'Pro',
    priceUsd: 39,
    blurb: 'Heavy exam weeks when you need the board every day.',
    cta: 'Get Pro',
    hrefKind: 'login',
  },
  {
    id: 'team',
    name: 'Team',
    priceUsd: null,
    blurb: 'Coaching centres. Pooled usage, billed with us, not self-serve.',
    cta: 'Contact for centres',
    hrefKind: 'contact',
  },
]
