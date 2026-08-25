import { useState, type FormEvent } from 'react'
import { ArrowUpRight, Check } from 'lucide-react'
import Logo from './Logo'
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
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
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

function FooterLinkList({ links }: { links: FooterLink[] }) {
  return (
    <ul className="mt-5 space-y-3.5">
      {links.map((link) => (
        <li key={link.label}>
          <a
            href={link.href}
            className="text-[15px] font-medium text-brand-fg-soft no-underline transition-colors hover:text-brand-primary"
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  )
}

function WaveArtwork() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="footer-wave absolute inset-0">
        {/* Wide ambient glow rising from below the bottom edge */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(150% 110% at 60% 110%, rgba(37, 99, 235, 0.5) 0%, rgba(37, 99, 235, 0.22) 40%, transparent 70%)',
          }}
        />
        {/* Hot core of the horizon arc, anchored just below the bottom-right */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(110% 75% at 60% 104%, rgba(224, 242, 255, 0.95) 0%, rgba(95, 164, 249, 0.85) 18%, rgba(37, 99, 235, 0.5) 40%, transparent 65%)',
          }}
        />
        {/* Faint secondary glow toward the upper right */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(55% 40% at 90% 30%, rgba(37, 99, 235, 0.18) 0%, transparent 70%)',
          }}
        />
      </div>
      {/* Vignettes: keep top near-black for legibility, deepen the bottom */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#06061F]/90 via-[#06061F]/20 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#06061F]/35 via-transparent to-transparent" />
    </div>
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
      className="group absolute right-6 top-6 flex flex-col items-center gap-3 no-underline sm:right-10 sm:top-10 lg:static lg:shrink-0"
    >
      <span className="flex h-14 w-14 rotate-12 items-center justify-center rounded-2xl bg-brand-primary text-white shadow-lg shadow-brand-primary/40 transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105 sm:h-16 sm:w-16">
        <Logo className="h-6 w-6 sm:h-7 sm:w-7" />
      </span>
      <span className="hidden items-center gap-1 font-hand text-[24px] font-semibold leading-none text-[#6B7280] transition-colors group-hover:text-brand-fg-soft sm:flex">
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
      <p className="flex items-center gap-2 text-[15px] font-medium text-brand-fg-soft">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-primary text-white">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
        You&rsquo;re on the list &mdash; talk soon.
      </p>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 rounded-full bg-white py-1.5 pl-5 pr-1.5 shadow-sm ring-1 ring-black/5"
    >
      <input
        type="email"
        required
        placeholder="Enter email address"
        className="min-w-0 flex-1 bg-transparent py-2 text-sm text-brand-fg-soft outline-none placeholder:text-gray-400"
      />
      <button
        type="submit"
        className="shrink-0 rounded-full bg-[#151517] px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-black sm:px-6 sm:py-3 sm:text-sm"
      >
        Subscribe
      </button>
    </form>
  )
}

export default function Footer() {
  return (
    <footer id="pricing" className="landing-section-inset bg-brand-section">
      <div className={`${CONTAINER} pt-10 sm:pt-12 lg:pt-14`}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
          {/* Dark showcase card */}
          <div className="relative min-h-[480px] overflow-hidden rounded-[28px] bg-brand-footer lg:col-span-5 lg:min-h-[560px]">
            <WaveArtwork />

            <div className="relative z-10 flex h-full flex-col justify-between p-8 sm:p-10">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-brand-fg">
                  <Logo className="h-5 w-5" />
                </span>
                <span className="text-lg font-semibold tracking-tight text-white">
                  Accelute
                </span>
              </div>

              <div>
                <p className="font-heading text-2xl leading-[1.15] tracking-[-0.02em] sm:text-[28px]">
                  <span className="block text-white">Every subject, explained</span>
                  <span className="block text-white/60">
                    out loud, stroke by stroke.
                  </span>
                </p>

                <div className="mt-9 flex flex-col items-start gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                  <span className="-rotate-2 whitespace-nowrap pb-1 font-hand text-[24px] font-semibold leading-none text-white/85 sm:text-[26px]">
                    Stay in touch!
                  </span>
                  <div className="flex gap-2.5">
                    {SOCIAL_LINKS.map(({ label, href, path }) => (
                      <a
                        key={label}
                        href={href}
                        aria-label={label}
                        className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 text-white ring-1 ring-white/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/10 hover:ring-white/25 sm:h-11 sm:w-11"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-[17px] w-[17px]"
                          fill="currentColor"
                          aria-hidden
                        >
                          <path d={path} />
                        </svg>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Light utility card */}
          <div className="relative flex flex-col rounded-[28px] bg-white p-6 ring-1 ring-black/5 sm:p-10 lg:col-span-7">
            <div className="flex items-start justify-between gap-8">
              <div className="grid w-full grid-cols-1 gap-y-10 sm:grid-cols-2 sm:gap-x-20 sm:gap-y-0 lg:w-auto">
                <div>
                  <h3 className="font-hand text-[28px] font-semibold leading-none text-[#6B7280] sm:text-[32px]">
                    Navigation
                  </h3>
                  <FooterLinkList links={NAVIGATION_LINKS} />
                </div>
                <div>
                  <h3 className="font-hand text-[28px] font-semibold leading-none text-[#6B7280] sm:text-[32px]">
                    Company
                  </h3>
                  <FooterLinkList links={COMPANY_LINKS} />
                </div>
              </div>
              <FeelingLucky />
            </div>

            <div className="mt-auto flex flex-col gap-8 pt-14 sm:flex-row sm:items-end sm:justify-between lg:pt-16">
              <p className="order-2 text-xs text-[#8A8A8A] sm:order-1">
                &copy; 2026 Accelute. All rights reserved.
              </p>

              <div className="order-1 w-full max-w-md sm:order-2 sm:w-auto">
                <p className="text-base text-[#6B7280]">Learning moves fast.</p>
                <p className="mt-1 font-heading text-xl font-bold tracking-[-0.02em] text-brand-fg-soft sm:text-2xl">
                  Stay ahead with Accelute.
                </p>
                <div className="mt-4">
                  <SubscribeForm />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Giant watermark */}
      <div aria-hidden className="pointer-events-none mt-12 select-none overflow-hidden sm:mt-16">
        <span className="block whitespace-nowrap text-center font-heading text-[clamp(5rem,17vw,15rem)] font-extrabold leading-none tracking-[-0.04em] text-[#E9EBF1]">
          Accelute
        </span>
      </div>
    </footer>
  )
}
