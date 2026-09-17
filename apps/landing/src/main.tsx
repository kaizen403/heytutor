import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ContentPage from './pages/ContentPage.tsx'
import PrivacyPage from './pages/PrivacyPage.tsx'
import TermsPage from './pages/TermsPage.tsx'
import { pageByPath } from './lib/seo'

function Root() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/terms') return <TermsPage />
  if (path === '/privacy') return <PrivacyPage />
  const page = pageByPath(path)
  if (page?.kind === 'article') return <ContentPage path={page.path} />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
