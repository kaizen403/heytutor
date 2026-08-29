import { useState, type FormEvent } from 'react'
import { ArrowUpRight, Check, Play } from 'lucide-react'
import Brand from './Brand'
import Button from './ui/Button'
import DitherHalo from './dither/DitherHalo'
import Logo from './Logo'
import Reveal from './Reveal'
import { TUTOR_APP_HREF, tutorQuestionHref } from '../lib/tutorAppHref'

type FooterLink = { label: string; href: string }

type SocialLink = {
  label: string
  href: string
  path: string
}

// Brand marks are no longer shipped by lucide-react, so these are inline paths.
const X_PATH =
  'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'

const GITHUB_PATH =
  'M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11.1 11.1 0 0 1 2.89-.39c.98 0 1.97.13 2.89.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.24 2.76.12 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.35.78 1.05.78 2.12 0 1.53-.01 2.77-.01 3.15 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z'

const LINKEDIN_PATH =
  'M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0z'

const YOUTUBE_PATH =
  'M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.55 15.57V8.43L15.82 12z'

const NAVIGATION_LINKS: FooterLink[] = [
  { label: 'How it works', href: '#lesson' },
  { label: 'Use cases', href: '#use-cases' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Try the app', href: TUTOR_APP_HREF },
]

const COMPANY_LINKS: FooterLink[] = [
  { label: 'About', href: '#' },
  { label: 'Terms', href: '#' },
  { label: 'Privacy Policy', href: '#' },
]

const SOCIAL_LINKS: SocialLink[] = [
  { label: 'X', href: '#', path: X_PATH },
  { label: 'GitHub', href: '#', path: GITHUB_PATH },
  { label: 'LinkedIn', href: '#', path: LINKEDIN_PATH },
  { label: 'YouTube', href: '#', path: YOUTUBE_PATH },
]

const LUCKY_QUESTIONS = [
  'Explain photosynthesis step by step',
  'Why is the sky blue?',
  'Solve x² − 5x + 6 = 0',
  'What caused the French Revolution?',
  'How do black holes work?',
  'Explain the chain rule with an example',
]

const CONTAINER = 'mx-auto max-w-6xl px-5 sm:px-8 lg:px-10'

/* ANSI Shadow wordmark. Fixed-width art, so it scales as one block via
   `.ascii-mark`'s clamped font-size rather than by wrapping. */
const WORDMARK = [
  ' █████╗  ██████╗ ██████╗███████╗██╗     ██╗   ██╗████████╗███████╗',
  '██╔══██╗██╔════╝██╔════╝██╔════╝██║     ██║   ██║╚══██╔══╝██╔════╝',
  '███████║██║     ██║     █████╗  ██║     ██║   ██║   ██║   █████╗  ',
  '██╔══██║██║     ██║     ██╔══╝  ██║     ██║   ██║   ██║   ██╔══╝  ',
  '██║  ██║╚██████╗╚██████╗███████╗███████╗╚██████╔╝   ██║   ███████╗',
  '╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝╚══════╝ ╚═════╝    ╚═╝   ╚══════╝',
].join('\n')

function FooterLinkList({ links }: { links: FooterLink[] }) {
  return (
    <ul className="mt-5 space-y-3">
      {links.map((link) => (
        <li key={link.label}>
          <a
            href={link.href}
            className="text-[15px] text-[rgba(240,245,247,0.58)] no-underline transition-colors duration-300 hover:text-frost"
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  )
}

function FeelingLucky() {
  const pickRandomQuestion = () => {
    const question =
      LUCKY_QUESTIONS[Math.floor(Math.random() * LUCKY_QUESTIONS.length)]
    window.location.assign(tutorQuestionHref(question))
  }

  return (
    <a
      href={TUTOR_APP_HREF}
      onClick={(event) => {
        event.preventDefault()
        pickRandomQuestion()
      }}
      className="group flex shrink-0 flex-col items-center gap-3 no-underline"
    >
      <span className="flex h-14 w-14 rotate-12 items-center justify-center rounded-2xl border border-[rgba(202,229,241,0.16)] bg-[rgba(89,175,212,0.10)] text-sky-300 transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105 sm:h-16 sm:w-16">
        <Logo className="h-6 w-6 sm:h-7 sm:w-7" />
      </span>
      <span className="hidden items-center gap-1 font-hand text-[24px] font-semibold leading-none text-[rgba(240,245,247,0.5)] transition-colors duration-300 group-hover:text-frost sm:flex">
        <ArrowUpRight className="h-4 w-4" strokeWidth={2.5} />
        Feeling lucky?
      </span>
    </a>
  )
}

function SubscribeForm() {
  const [subscribed, setSubscribed] = useState(false)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubscribed(true)
  }

  if (subscribed) {
    return (
      <p className="flex items-center gap-2 text-[15px] text-frost">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[rgba(202,229,241,0.20)] bg-[rgba(89,175,212,0.14)] text-sky-300">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
        You&rsquo;re on the list. Talk soon.
      </p>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="glass flex items-center gap-2 rounded-2xl py-1.5 pl-5 pr-1.5"
    >
      <input
        type="email"
        required
        placeholder="Enter email address"
        className="min-w-0 flex-1 bg-transparent py-2 text-sm text-frost outline-none placeholder:text-[rgba(240,245,247,0.42)]"
      />
      <Button type="submit" variant="sky" size="sm" className="shrink-0">
        Subscribe
      </Button>
    </form>
  )
}

export default function Footer() {
  return (
    <footer id="pricing" className="relative overflow-hidden">
      {/* The page's closing tone. `.band-deep` sits the sky low in the navy and
          masks away at the top, so the seam with <UseCasesSection> never shows. */}
      <div aria-hidden className="band-deep pointer-events-none absolute inset-0" />

      {/* The same halftone family as the use-case bloom, turned on its head:
          coarser cells and a wide field rising off the bottom edge rather than
          a tight bloom behind a heading. Same texture, different weather. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[620px] opacity-[0.28]"
        style={{
          WebkitMaskImage:
            'radial-gradient(86% 96% at 50% 104%, #000 0%, rgba(0,0,0,0.5) 46%, transparent 82%)',
          maskImage:
            'radial-gradient(86% 96% at 50% 104%, #000 0%, rgba(0,0,0,0.5) 46%, transparent 82%)',
        }}
      >
        <DitherHalo
          tint="#59AFD4"
          strength={0.72}
          center={[0.5, 1.02]}
          radius={[0.66, 0.78]}
          cell={5}
        />
      </div>

      <div className={`relative z-10 ${CONTAINER} pb-10 pt-28 sm:pt-32 lg:pt-40`}>
        {/* ── The call to action ── */}
        <Reveal variant="rise" className="mx-auto max-w-3xl text-center">
          <h2 className="type-h2 text-frost">
            Every subject, explained <span className="text-ice">out loud</span>,
            stroke by stroke.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[rgba(240,245,247,0.62)] sm:text-lg">
            Ask your first question and watch the board fill in as the tutor talks
            you through it.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button href={TUTOR_APP_HREF} size="lg">
              <Play className="h-4 w-4" />
              Try it free
            </Button>
            <Button href="#lesson" variant="ghost" size="lg">
              See how it works
            </Button>
          </div>
        </Reveal>

        <hr className="rule-glow mt-20 border-0 sm:mt-24" />

        {/* ── Directory ── */}
        <div className="mt-12 flex flex-col gap-12 lg:flex-row lg:justify-between lg:gap-16">
          <div className="flex flex-col gap-8">
            <Brand href="/" />
            <div className="flex gap-2.5">
              {SOCIAL_LINKS.map(({ label, href, path }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-[rgba(202,229,241,0.13)] bg-white/[0.03] text-[rgba(240,245,247,0.7)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(202,229,241,0.26)] hover:text-frost sm:h-11 sm:w-11"
                >
                  <svg viewBox="0 0 24 24" className="h-[17px] w-[17px]" fill="currentColor" aria-hidden>
                    <path d={path} />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-y-10 sm:grid-cols-2 sm:gap-x-12 lg:max-w-md">
            <div>
              <h3 className="type-accent-s text-[rgba(202,229,241,0.5)]">Navigation</h3>
              <FooterLinkList links={NAVIGATION_LINKS} />
            </div>
            <div>
              <h3 className="type-accent-s text-[rgba(202,229,241,0.5)]">Company</h3>
              <FooterLinkList links={COMPANY_LINKS} />
            </div>
          </div>

          <div className="flex flex-col gap-8 lg:items-end">
            <div className="w-full max-w-sm">
              <p className="text-[15px] text-[rgba(240,245,247,0.58)]">Learning moves fast.</p>
              <p className="mt-1 font-heading text-xl tracking-[-0.02em] text-frost sm:text-2xl">
                Stay ahead with Accelute.
              </p>
              <div className="mt-4">
                <SubscribeForm />
              </div>
            </div>
            <FeelingLucky />
          </div>
        </div>

        <p className="mt-16 text-xs text-[rgba(240,245,247,0.42)]">
          &copy; 2026 Accelute. All rights reserved.
        </p>
      </div>

      {/* Wordmark, set as ASCII */}
      <div
        aria-hidden
        className="pointer-events-none relative z-10 mt-8 flex select-none justify-center overflow-hidden pb-10 sm:mt-12 sm:pb-14"
      >
        <pre className="ascii-mark m-0">{WORDMARK}</pre>
      </div>
    </footer>
  )
}
