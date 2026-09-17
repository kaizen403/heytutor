import Button from '../components/ui/Button'
import FaqList from '../components/FaqList'
import Footer from '../components/Footer'
import LinkedCopy from '../components/LinkedCopy'
import Navbar from '../components/Navbar'
import SeoHead from '../components/SeoHead'
import { TUTOR_LOGIN_HREF } from '../lib/tutorAppHref'
import { pageByPath, relatedPages } from '../lib/seo'

export default function ContentPage({ path }: { path: string }) {
  const page = pageByPath(path)
  if (!page) return null

  const related = relatedPages(page.path)

  return (
    <div className="relative min-h-screen bg-ink-950 text-frost">
      <SeoHead path={page.path} />
      <Navbar />
      <main className="relative z-10 mx-auto max-w-3xl px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        <nav aria-label="Breadcrumb" className="text-[13px] text-[rgba(240,245,247,0.45)]">
          <ol className="flex flex-wrap items-center gap-2">
            <li>
              <a href="/" className="transition-colors hover:text-frost">
                Accelute
              </a>
            </li>
            <li aria-hidden>/</li>
            <li className="text-[rgba(240,245,247,0.72)]">{page.breadcrumb}</li>
          </ol>
        </nav>

        <p className="type-accent-s mt-8 text-[rgba(202,229,241,0.5)]">{page.kicker}</p>
        <h1 className="type-h2 mt-3 text-frost">{page.headline}</h1>
        <p className="mt-4 text-base leading-relaxed text-[rgba(240,245,247,0.72)] sm:text-lg">
          <LinkedCopy text={page.lead} />
        </p>

        <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-[rgba(240,245,247,0.72)] [&_a]:text-ice [&_a]:underline-offset-2 hover:[&_a]:underline">
          {(page.sections ?? []).map((section) => (
            <section key={section.heading} className="space-y-3">
              <h2 className="font-heading text-[22px] font-medium tracking-[-0.02em] text-frost">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>
                  <LinkedCopy text={paragraph} />
                </p>
              ))}
              {section.bullets ? (
                <ul className="list-disc space-y-2 pl-5">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        {page.faqs.length > 0 ? (
          <section className="mt-14 sm:mt-16">
            <h2 className="font-heading text-[22px] font-medium tracking-[-0.02em] text-frost">
              Questions
            </h2>
            <div className="mt-4">
              <FaqList faqs={page.faqs} />
            </div>
          </section>
        ) : null}

        {related.length > 0 ? (
          <nav aria-label="Related pages" className="mt-14 sm:mt-16">
            <h2 className="font-heading text-[22px] font-medium tracking-[-0.02em] text-frost">
              More about Accelute
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {related.map((item) => (
                <li key={item.path}>
                  <a
                    href={item.path}
                    className="glass block rounded-2xl px-4 py-4 no-underline transition-colors hover:border-[rgba(202,229,241,0.26)]"
                  >
                    <span className="type-accent-s text-sky-300">{item.kicker}</span>
                    <span className="mt-1 block font-heading text-[16px] tracking-[-0.02em] text-frost">
                      {item.headline}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="mt-14 flex flex-wrap items-center gap-3 sm:mt-16">
          <Button href={TUTOR_LOGIN_HREF} size="lg">
            Try it free
          </Button>
          <Button href="/#lesson" variant="ghost" size="lg">
            See a lesson
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  )
}
