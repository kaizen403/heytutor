import { lazy } from 'react'
import App from './App.tsx'
import { pageByPath } from './lib/seo'

/* The homepage is the entry; the other pages are their own chunks so the
   first visit never downloads legal text or articles. */
const ContentPage = lazy(() => import('./pages/ContentPage.tsx'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage.tsx'))
const TermsPage = lazy(() => import('./pages/TermsPage.tsx'))

export default function Root() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/terms') return <TermsPage />
  if (path === '/privacy') return <PrivacyPage />
  const page = pageByPath(path)
  if (page?.kind === 'article') return <ContentPage path={page.path} />
  return <App />
}
