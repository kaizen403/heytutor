/** Student-facing catalog. Do not add plans that are not in the billing plan. */

type PlanHrefKind = 'login' | 'contact'

type PlanBase = {
  name: string
  blurb: string
  cta: string
  hrefKind: PlanHrefKind
  featured?: boolean
  badge?: string
}

export type IndividualPlan = PlanBase & {
  id: 'free' | 'plus'
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
    blurb: 'Explore a new way to learn with clear explanations on a live whiteboard.',
    cta: 'Try it free',
    hrefKind: 'login',
  },
  {
    id: 'plus',
    name: 'Plus',
    priceUsd: 29,
    blurb: 'More room to practise, ask why, and turn difficult topics into progress.',
    cta: 'Upgrade now',
    hrefKind: 'login',
    featured: true,
    badge: 'Your next step',
  },
  {
    id: 'team',
    name: 'Team',
    priceUsd: null,
    blurb: 'Bring whiteboard tutoring to your coaching centre with a plan for your team.',
    cta: 'Contact for centres',
    hrefKind: 'contact',
  },
]
