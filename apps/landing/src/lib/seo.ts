/**
 * Marketing SEO catalog — one record per public URL.
 *
 * Titles, descriptions, JSON-LD, sitemap rows, noscript fallbacks, and the
 * article pages all read from here so they cannot drift. The Vite plugin
 * stamps the same fields into each HTML file at build time; <SeoHead> keeps
 * them correct after client navigation.
 */

import { PLANS, type IndividualPlan } from './plans.ts'

export const SITE = {
  name: 'Accelute',
  origin: 'https://accelute.co',
  appOrigin: 'https://app.accelute.co',
  email: 'hi@accelute.co',
  locale: 'en_US',
  language: 'en',
  ogImage: 'https://accelute.co/og-image.png',
  ogImageAlt:
    'Accelute solving a physics question on the whiteboard, with the working written out and a velocity-time graph drawn beside it',
  logo: 'https://accelute.co/icon-512.png',
} as const

export type Faq = {
  question: string
  answer: string
}

export type SeoSection = {
  heading: string
  paragraphs: string[]
  bullets?: string[]
}

export type SeoPageKind = 'home' | 'article' | 'legal'

export type SeoPage = {
  kind: SeoPageKind
  path: string
  slug: string
  title: string
  description: string
  headline: string
  lead: string
  kicker: string
  breadcrumb: string
  changefreq: 'weekly' | 'monthly' | 'yearly'
  priority: number
  faqs: readonly Faq[]
  sections?: readonly SeoSection[]
}

const HOME_FAQS: readonly Faq[] = [
  {
    question: 'What is Accelute?',
    answer:
      'Accelute is an AI whiteboard tutor. You ask a question and it teaches on a live board: it draws the diagram, writes the working, and explains each step out loud, in time with the ink.',
  },
  {
    question: 'What is an AI whiteboard tutor?',
    answer:
      'An AI whiteboard tutor is an AI teacher that uses a board, not a chat box. Accelute draws figures and writes notes while it talks, the way a teacher would at a whiteboard.',
  },
  {
    question: 'How does Accelute work?',
    answer:
      'Type a question or upload a photo of a problem. Accelute plans the lesson, draws on the whiteboard, and narrates each step. You can interrupt with a doubt; it answers on the same board. Replay the lesson or take the notes with you.',
  },
  {
    question: 'Is Accelute a free AI tutor?',
    answer:
      'Yes. Accelute has a free plan with monthly included usage, enough to try a few questions and a doubt chain. Plus and Pro add more if you need the board every day. Follow-up doubts on a question are part of that lesson.',
  },
  {
    question: 'What subjects can I study with Accelute?',
    answer:
      'Accelute teaches every subject you can put on a board: physics, maths, chemistry, coding, and the rest of a school or exam syllabus. Ask in plain language. You do not need a perfect prompt.',
  },
  {
    question: 'How is an AI tutor different from ChatGPT?',
    answer:
      'ChatGPT answers in a text box. Accelute is an AI tutor that writes and draws on a whiteboard while it speaks, so you see the working, not only the answer. Doubts stay on the same board as the lesson.',
  },
  {
    question: 'Can I interrupt the lesson with a doubt?',
    answer:
      'Yes. Cut in mid-stroke and ask. Accelute stops, keeps the original question as context, and answers the doubt on the same board.',
  },
]

export const PAGES: readonly SeoPage[] = [
  {
    kind: 'home',
    path: '/',
    slug: 'index',
    title: 'Accelute | AI Whiteboard Tutor for Every Subject',
    description:
      'Accelute is an AI whiteboard tutor. Ask a question and watch it draw, write, and explain each step out loud, built for how you actually study.',
    headline: 'Accelute, the AI tutor on a live whiteboard.',
    lead: 'Ask a question. Watch the diagram drawn, the working written, and each step explained out loud. An AI tutor for how you actually study.',
    kicker: 'Accelute',
    breadcrumb: 'Home',
    changefreq: 'weekly',
    priority: 1,
    faqs: HOME_FAQS,
  },
  {
    kind: 'article',
    path: '/ai-whiteboard',
    slug: 'ai-whiteboard',
    title: 'AI Whiteboard Tutor | Accelute',
    description:
      'An AI whiteboard that draws diagrams and writes the working while it teaches. Accelute is the AI tutor that uses a live board, not a chat box.',
    headline: 'An AI whiteboard that actually teaches',
    lead: 'Most whiteboards are a blank canvas. Accelute is an AI whiteboard tutor: it draws the figure, writes the working, and talks you through the lesson on a live board.',
    kicker: 'AI whiteboard',
    breadcrumb: 'AI whiteboard',
    changefreq: 'weekly',
    priority: 0.9,
    faqs: [
      {
        question: 'What is an AI whiteboard?',
        answer:
          'An AI whiteboard is a board an AI can write and draw on while it explains. Accelute uses that board as the lesson (diagrams, working, and voice together) rather than as a shared brainstorming canvas.',
      },
      {
        question: 'How is Accelute different from Miro or Explain Everything?',
        answer:
          'Miro and FigJam are team canvases. Explain Everything is for a human teacher to record a board. Accelute is an AI tutor that runs the board for you, on demand, one question at a time.',
      },
      {
        question: 'Does the AI actually draw the diagram?',
        answer:
          'Yes. Accelute draws stroke by stroke on a live whiteboard, in time with the narration. It is not a stock image dropped onto the page after the answer.',
      },
      {
        question: 'Can I use Accelute as a shared tutoring whiteboard?',
        answer:
          'Accelute is a student product: the AI teaches you. It is not a classroom canvas for two humans to draw on together. For that, use a team whiteboard. For a 1:1 AI lesson, use Accelute.',
      },
    ],
    sections: [
      {
        heading: 'A board, not a chat box',
        paragraphs: [
          'When people search for an AI whiteboard, they usually mean one of two things: a team canvas with an assistant bolted on, or a tutor that can actually teach at the board. Accelute is the second.',
          'You ask a question: type it, or photograph a problem. Accelute plans the lesson, then teaches it the way a teacher would: diagram on one side, working on the other, voice in time with the pen.',
          'A chatbot can dump an answer. An AI whiteboard has to show its work.',
        ],
      },
      {
        heading: 'What Accelute draws',
        paragraphs: [
          'The board is the lesson. Accelute draws diagrams stroke by stroke (axes, circuits, shapes, graphs) and writes the notes as it talks. The ink is not a decoration pasted on after the fact. It is the explanation, laid down in order.',
          'If a figure is part of understanding the question, it belongs on the board. If it is not, Accelute still teaches in writing and in voice. You are not staring at a picture while the real answer hides in a paragraph underneath.',
        ],
      },
      {
        heading: 'Not Miro, not a lecture recording',
        paragraphs: [
          'Miro, FigJam, and the other team whiteboards are for workshops. Explain Everything and similar tools are for a human teacher to record a board. Accelute is an AI tutor that runs the board for you, on demand, for one question at a time.',
          'That is why it fits study rather than a meeting: you interrupt, you ask a doubt, you replay the strokes. There is no facilitator and no blank infinite canvas to organise.',
        ],
      },
      {
        heading: 'How a lesson uses the board',
        paragraphs: [
          'A session is one question, taught through. You do not need a lesson plan. You need the thing you are stuck on.',
        ],
        bullets: [
          'Ask. A sentence is enough; a photo of the question works too.',
          'Watch the board. The figure and the working, in the order a teacher would use.',
          'Unmute. The voice sits on the same clock as the pen.',
          'Cut in. A doubt is answered on the same board, with the original question still in context.',
          'Keep it. Replay the lesson or take the notes with you.',
        ],
      },
      {
        heading: 'Who an AI whiteboard is for',
        paragraphs: [
          'Students who learn by watching a figure appear, not by reading a wall of text. Physics, maths, chemistry, and coding all live on a board. Accelute is built for that kind of study, and for every other subject you can explain with a pen.',
        ],
      },
    ],
  },
  {
    kind: 'article',
    path: '/ai-tutor',
    slug: 'ai-tutor',
    title: 'AI Tutor That Draws as It Teaches | Accelute',
    description:
      'Accelute is an AI tutor that talks, writes, and draws on a live whiteboard. Ask a doubt mid-lesson and it answers on the same board.',
    headline: 'An AI tutor that draws while it talks',
    lead: 'Accelute is an AI tutor for every subject. It does not only answer. It teaches: voice, handwriting, and a live whiteboard, in sync, the way a tutor sitting next to you would.',
    kicker: 'AI tutor',
    breadcrumb: 'AI tutor',
    changefreq: 'weekly',
    priority: 0.9,
    faqs: [
      {
        question: 'What is an AI tutor?',
        answer:
          'An AI tutor is software that teaches a student 1:1, not just answers a prompt. Accelute talks, writes the working, and draws on a whiteboard so you can follow the method, not only the final line.',
      },
      {
        question: 'Can an AI tutor replace a teacher?',
        answer:
          'No. Accelute is for learning and practice. It is not a substitute for a qualified teacher, an examiner, or professional advice. AI output can be incomplete or wrong. Check important results yourself.',
      },
      {
        question: 'Does Accelute help with homework?',
        answer:
          'It will teach the question you bring, including a photo of a problem, on a board, out loud. Use it to understand the method. Do not submit the board as your own work or use it to break a school’s academic rules.',
      },
      {
        question: 'Is Accelute free to try?',
        answer:
          'Yes. The free plan includes monthly usage so you can try physics, maths, and a doubt chain before you pay. Open Accelute, ask a question, and unmute.',
      },
    ],
    sections: [
      {
        heading: 'What an AI tutor should do',
        paragraphs: [
          'A tutor does three things at once: talk, write, and watch whether you followed. Most AI tools do the first, as text. Accelute is built for the other two as well.',
          'You get a 1:1 lesson on a board. The tutor writes the step, draws the figure that belongs with it, and says what it is doing. If you are lost, you say so. The lesson stops and the doubt gets its own answer, on the same board.',
        ],
      },
      {
        heading: 'Not ChatGPT, not a photo solver',
        paragraphs: [
          'ChatGPT is a text box. It can be a good explainer, and it is still a wall of prose. Photo solvers give you steps as a list, often without a figure that matches the question.',
          'Accelute is an AI tutor: the working is written, the diagram is drawn, and the voice is timed to the ink. You study the board, not a chat transcript.',
          'It is not a substitute for a teacher, an examiner, or professional advice. AI can be wrong. Check important results. Use it to learn the method, not to cheat an exam.',
        ],
      },
      {
        heading: 'A doubt on the same board',
        paragraphs: [
          'The difference between a chatbot and a tutor is what happens when you interrupt. In a chat, you start another bubble. In Accelute, the lesson pauses, the original question stays in context, and the doubt is taught on the same board.',
          'That is the loop students actually need: try a question, get stuck, ask, see it drawn another way, keep going.',
        ],
      },
      {
        heading: 'Subjects an AI tutor can take',
        paragraphs: [
          'If you can write it on a board, you can ask Accelute. Physics, maths, chemistry, coding, and the rest of a school or exam syllabus. Ask in plain language. You do not need the perfect prompt.',
        ],
      },
      {
        heading: 'How to start',
        paragraphs: [
          'Open Accelute, ask the question you are stuck on, and unmute. The first lesson is the product. The free plan is enough to see whether this way of teaching clicks for you.',
        ],
      },
    ],
  },
  {
    kind: 'article',
    path: '/ai-study',
    slug: 'ai-study',
    title: 'AI Study App with Voice and Whiteboard | Accelute',
    description:
      'Study with an AI tutor that draws the lesson, speaks each step, and saves the board so you can replay it. Accelute is built for real study sessions.',
    headline: 'Study with an AI tutor, on a real board',
    lead: 'AI study only works if you can see the working, hear the explanation, and come back to it. Accelute is built as a study session, not a one-shot answer.',
    kicker: 'AI study',
    breadcrumb: 'AI study',
    changefreq: 'weekly',
    priority: 0.9,
    faqs: [
      {
        question: 'How do I study with AI?',
        answer:
          'Bring one question you are stuck on. Accelute teaches it on a whiteboard, out loud. Interrupt when you are lost, then replay the board later as notes. That is a study session, not a search.',
      },
      {
        question: 'Can I replay an AI study session?',
        answer:
          'Yes. Every lesson stays on its own board. Replay the strokes slower or faster, narration and all, and take the notes with you to revise without the tutor talking.',
      },
      {
        question: 'Is Accelute good for exam revision?',
        answer:
          'Use it to walk a type of question until the method is yours, then replay the board as a revision sheet. It is for practice, not for sitting the exam, and not for breaking a school’s academic rules.',
      },
      {
        question: 'What subjects can I study on Accelute?',
        answer:
          'Physics, maths, chemistry, coding, and the rest of a syllabus you can put on a board. Ask in the words you would use with a teacher.',
      },
    ],
    sections: [
      {
        heading: 'Why study tools fail',
        paragraphs: [
          'Flashcard apps quiz you. Chatbots answer you. Neither is how most people actually learn a hard step: someone at a board, talking while they write, and a page you can replay tonight.',
          'Accelute is an AI study app in that older sense. You sit down with a question. The tutor teaches it. You interrupt. You leave with the board and the notes.',
        ],
      },
      {
        heading: 'A session, not a search',
        paragraphs: [
          'Search is for a fact. Study is for a method. Accelute takes one question at a time and teaches it through: figure, working, voice. When you ask a follow-up, it stays on that question. That is closer to a tutor than to a search box.',
          'Use it for the problem you cannot get past, the derivation you keep mis-copying, the diagram you cannot picture from the textbook.',
        ],
      },
      {
        heading: 'Replay and notes',
        paragraphs: [
          'Every lesson stays on its own board. Replay the strokes slower if you need the hand to land, faster if you already have the idea. The working on the board is the notes. Take them with you and revise without the tutor talking.',
          'That is the study loop: learn it once on the board, then use the same board as a revision sheet.',
        ],
      },
      {
        heading: 'Exam weeks',
        paragraphs: [
          'Accelute is for practice, not for sitting an exam. Use it to walk a type of question until the method is yours. Heavy weeks are what the higher plans are for: more lessons when you need the board every day. The free plan is there so you can try the way it teaches before you pay.',
          'Do not use it to break a school’s academic rules. The point is to understand the step, not to submit the board as your own work.',
        ],
      },
      {
        heading: 'Who it is for',
        paragraphs: [
          'Students who study better by watching a figure drawn than by highlighting a PDF. Anyone who has wished a teacher would just do this one question on the board, out loud, right now.',
        ],
      },
    ],
  },
  {
    kind: 'article',
    path: '/about',
    slug: 'about',
    title: 'About Accelute | The AI Whiteboard Tutor',
    description:
      'Accelute is the AI whiteboard tutor that teaches every subject out loud, stroke by stroke. What it is, who it is for, and how to start.',
    headline: 'Accelute is an AI whiteboard tutor',
    lead: 'Accelute (accelute.co) teaches every subject the way teachers actually teach it: on a whiteboard, out loud, stroke by stroke.',
    kicker: 'About',
    breadcrumb: 'About',
    changefreq: 'monthly',
    priority: 0.7,
    faqs: [
      {
        question: 'What is Accelute?',
        answer:
          'Accelute is an AI whiteboard tutor. The marketing site is accelute.co. The tutor app is app.accelute.co. You ask a question; it draws, writes, and explains on a live board.',
      },
      {
        question: 'How do you spell Accelute?',
        answer:
          'Accelute: A-c-c-e-l-u-t-e. If you searched for Accelute, Accelute AI, or Accelute tutor, this is the product.',
      },
      {
        question: 'How do I contact Accelute?',
        answer:
          'Email hi@accelute.co. Terms of Service and the Privacy Policy are on this site.',
      },
      {
        question: 'Is Accelute an app I install?',
        answer:
          'No. Accelute runs in the browser at app.accelute.co. There is nothing to download. Open it, sign in, and ask a question.',
      },
    ],
    sections: [
      {
        heading: 'The name',
        paragraphs: [
          'Accelute is the product. The marketing site is accelute.co. The tutor app is app.accelute.co. If you searched for Accelute, Accelute AI, or Accelute tutor, you are in the right place.',
        ],
      },
      {
        heading: 'What we make',
        paragraphs: [
          'An AI tutor that draws the diagram, writes the notes, and explains each step in time with the pen. You ask a question. Accelute teaches it. You can interrupt with a doubt, replay the lesson, and keep the notes.',
          'It is a student product. You must be 13 or older. It is not a classroom management tool and not a team whiteboard.',
        ],
      },
      {
        heading: 'Who it is for',
        paragraphs: [
          'Anyone who learns faster when they can see the working. Physics, maths, chemistry, coding, and the rest of the syllabus. Individual study first; coaching centres can talk to us about a team plan.',
        ],
      },
      {
        heading: 'Contact',
        paragraphs: [
          'Email hi@accelute.co. Terms and privacy live on this site. The app is on the web. There is nothing to install.',
        ],
      },
    ],
  },
  {
    kind: 'legal',
    path: '/terms',
    slug: 'terms',
    title: 'Terms of Service | Accelute',
    description:
      'Terms of Service for Accelute, the AI whiteboard tutor at accelute.co. Who may use it, accounts, acceptable use, and billing.',
    headline: 'Terms of Service',
    lead: 'The agreement for using Accelute, accelute.co, and the AI whiteboard tutor.',
    kicker: 'Legal',
    breadcrumb: 'Terms',
    changefreq: 'yearly',
    priority: 0.3,
    faqs: [],
  },
  {
    kind: 'legal',
    path: '/privacy',
    slug: 'privacy',
    title: 'Privacy Policy | Accelute',
    description:
      'Privacy Policy for Accelute. How we collect and use account, lesson, and billing data on accelute.co and the AI tutor app.',
    headline: 'Privacy Policy',
    lead: 'How Accelute collects and uses information on accelute.co and in the tutor app.',
    kicker: 'Legal',
    breadcrumb: 'Privacy',
    changefreq: 'yearly',
    priority: 0.3,
    faqs: [],
  },
]

const PAGE_BY_PATH = new Map(PAGES.map((page) => [page.path, page]))

export function normalizePath(raw: string): string {
  const noQuery = raw.split('?')[0]?.split('#')[0] ?? '/'
  let path = noQuery.trim() || '/'
  if (!path.startsWith('/')) path = `/${path}`
  if (path === '/index.html') return '/'
  if (path.endsWith('.html')) path = path.slice(0, -5)
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

export function pageByPath(pathname: string): SeoPage | undefined {
  return PAGE_BY_PATH.get(normalizePath(pathname))
}

export function canonicalUrl(path: string): string {
  const normalized = normalizePath(path)
  if (normalized === '/') return `${SITE.origin}/`
  return `${SITE.origin}${normalized}`
}

export function htmlFileName(page: SeoPage): string {
  return `${page.slug}.html`
}

export function articlePages(): SeoPage[] {
  return PAGES.filter((page) => page.kind === 'article')
}

export function relatedPages(path: string): SeoPage[] {
  return articlePages().filter((page) => page.path !== normalizePath(path))
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const ORG_ID = `${SITE.origin}/#organization`
const SITE_ID = `${SITE.origin}/#website`
const APP_ID = `${SITE.origin}/#app`

function organizationNode(): Record<string, unknown> {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: SITE.name,
    alternateName: ['Accelute AI', 'Accelute tutor'],
    url: `${SITE.origin}/`,
    email: SITE.email,
    logo: {
      '@type': 'ImageObject',
      url: SITE.logo,
      width: 512,
      height: 512,
    },
  }
}

function websiteNode(): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': SITE_ID,
    url: `${SITE.origin}/`,
    name: SITE.name,
    alternateName: ['Accelute AI', 'Accelute AI tutor'],
    description:
      'An AI whiteboard tutor that draws, writes, and explains every subject out loud.',
    publisher: { '@id': ORG_ID },
    inLanguage: SITE.language,
  }
}

function softwareApplicationNode(full: boolean): Record<string, unknown> {
  const node: Record<string, unknown> = {
    '@type': 'SoftwareApplication',
    '@id': APP_ID,
    name: SITE.name,
    url: `${SITE.origin}/`,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
  }
  if (!full) return node

  const priced = PLANS.filter(
    (plan): plan is IndividualPlan => plan.priceUsd !== null,
  )

  return {
    ...node,
    alternateName: ['Accelute AI', 'Accelute tutor', 'Accelute AI whiteboard'],
    applicationSubCategory: 'AI Tutor',
    image: SITE.ogImage,
    screenshot: SITE.ogImage,
    description:
      'Accelute is an AI whiteboard tutor for every subject. Ask a question and watch it draw the diagram, write the notes, and explain each step out loud, in sync.',
    publisher: { '@id': ORG_ID },
    offers: {
      '@type': 'AggregateOffer',
      lowPrice: String(Math.min(...priced.map((plan) => plan.priceUsd))),
      highPrice: String(Math.max(...priced.map((plan) => plan.priceUsd))),
      priceCurrency: 'USD',
      offerCount: String(priced.length),
      offers: priced.map((plan) => ({
        '@type': 'Offer',
        name: plan.name,
        price: String(plan.priceUsd),
        priceCurrency: 'USD',
        url: `${SITE.origin}/#pricing`,
        availability: 'https://schema.org/InStock',
      })),
    },
    featureList: [
      'Live AI whiteboard',
      'Voice narration in sync with writing',
      'Diagrams drawn stroke by stroke',
      'Interrupt with a doubt on the same board',
      'Lesson replay',
      'Downloadable notes',
      'Physics, maths, chemistry, coding, and more',
    ],
    audience: {
      '@type': 'EducationalAudience',
      educationalRole: 'student',
    },
    isAccessibleForFree: true,
  }
}

function webPageNode(page: SeoPage): Record<string, unknown> {
  const url = canonicalUrl(page.path)
  return {
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: page.title,
    description: page.description,
    isPartOf: { '@id': SITE_ID },
    about: { '@id': APP_ID },
    inLanguage: SITE.language,
    publisher: { '@id': ORG_ID },
  }
}

function breadcrumbNode(page: SeoPage): Record<string, unknown> {
  const elements: Record<string, unknown>[] = [
    {
      '@type': 'ListItem',
      position: 1,
      name: SITE.name,
      item: `${SITE.origin}/`,
    },
  ]
  if (page.path !== '/') {
    elements.push({
      '@type': 'ListItem',
      position: 2,
      name: page.breadcrumb,
      item: canonicalUrl(page.path),
    })
  }
  return {
    '@type': 'BreadcrumbList',
    itemListElement: elements,
  }
}

function faqNode(faqs: readonly Faq[]): Record<string, unknown> | null {
  if (faqs.length === 0) return null
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  }
}

export function jsonLdGraph(page: SeoPage): {
  '@context': string
  '@graph': Record<string, unknown>[]
} {
  const graph: Record<string, unknown>[] = [
    organizationNode(),
    websiteNode(),
    softwareApplicationNode(page.kind === 'home'),
  ]
  if (page.kind !== 'home') {
    graph.push(webPageNode(page), breadcrumbNode(page))
  }
  const faq = faqNode(page.faqs)
  if (faq) graph.push(faq)
  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  }
}

export function renderSeoHead(page: SeoPage): string {
  const url = canonicalUrl(page.path)
  const json = JSON.stringify(jsonLdGraph(page), null, 2).replace(
    /\n/g,
    '\n      ',
  )
  return [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeAttr(page.description)}" />`,
    `<link rel="canonical" href="${escapeAttr(url)}" />`,
    `<meta property="og:url" content="${escapeAttr(url)}" />`,
    `<meta property="og:title" content="${escapeAttr(page.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(page.description)}" />`,
    `<meta name="twitter:title" content="${escapeAttr(page.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(page.description)}" />`,
    `<script type="application/ld+json" id="seo-jsonld">`,
    `      ${json}`,
    `    </script>`,
  ].join('\n    ')
}

function renderNoscript(page: SeoPage): string {
  const parts: string[] = [
    `<noscript>`,
    `      <div style="max-width:42rem;margin:2.5rem auto;padding:0 1.25rem;color:#F0F5F7;font-family:Inter,system-ui,sans-serif;line-height:1.6">`,
    `        <p style="letter-spacing:0.08em;text-transform:uppercase;font-size:12px;color:#A5D6EC">${escapeHtml(page.kicker)}</p>`,
    `        <h1>${escapeHtml(page.headline)}</h1>`,
    `        <p>${escapeHtml(page.lead)}</p>`,
  ]

  if (page.sections) {
    for (const section of page.sections) {
      parts.push(`        <h2>${escapeHtml(section.heading)}</h2>`)
      for (const paragraph of section.paragraphs) {
        parts.push(`        <p>${escapeHtml(paragraph)}</p>`)
      }
      if (section.bullets) {
        parts.push('        <ul>')
        for (const bullet of section.bullets) {
          parts.push(`          <li>${escapeHtml(bullet)}</li>`)
        }
        parts.push('        </ul>')
      }
    }
  }

  if (page.faqs.length > 0) {
    parts.push('        <h2>Questions</h2>')
    for (const faq of page.faqs) {
      parts.push(`        <h3>${escapeHtml(faq.question)}</h3>`)
      parts.push(`        <p>${escapeHtml(faq.answer)}</p>`)
    }
  }

  parts.push(
    `        <p><a href="${SITE.origin}/" style="color:#7FC4E2">Accelute home</a> · <a href="${SITE.appOrigin}/login?google=1" style="color:#7FC4E2">Try it free</a></p>`,
    `      </div>`,
    `    </noscript>`,
  )
  return parts.join('\n')
}

const HEAD_BLOCK =
  /<!--seo-head-->[\s\S]*?<!--\/seo-head-->/
const NOSCRIPT_BLOCK =
  /<!--seo-noscript-->[\s\S]*?<!--\/seo-noscript-->/

export function applySeoToHtml(html: string, page: SeoPage): string {
  if (!HEAD_BLOCK.test(html) || !NOSCRIPT_BLOCK.test(html)) {
    throw new Error(
      'SEO HTML is missing <!--seo-head--> or <!--seo-noscript--> markers',
    )
  }
  return html
    .replace(
      HEAD_BLOCK,
      `<!--seo-head-->\n    ${renderSeoHead(page)}\n    <!--/seo-head-->`,
    )
    .replace(
      NOSCRIPT_BLOCK,
      `<!--seo-noscript-->\n    ${renderNoscript(page)}\n    <!--/seo-noscript-->`,
    )
}

export function renderSitemap(lastmod = new Date().toISOString().slice(0, 10)): string {
  const urls = PAGES.map((page) => {
    const loc = canonicalUrl(page.path)
    return [
      '  <url>',
      `    <loc>${loc}</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      `    <changefreq>${page.changefreq}</changefreq>`,
      `    <priority>${page.priority.toFixed(1)}</priority>`,
      '  </url>',
    ].join('\n')
  }).join('\n')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n')
}

export function articleWordCount(page: SeoPage): number {
  const chunks = [page.headline, page.lead]
  for (const section of page.sections ?? []) {
    chunks.push(section.heading, ...section.paragraphs, ...(section.bullets ?? []))
  }
  for (const faq of page.faqs) {
    chunks.push(faq.question, faq.answer)
  }
  return chunks.join(' ').split(/\s+/).filter(Boolean).length
}
