import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import PrivacyPage from './pages/PrivacyPage.tsx'
import TermsPage from './pages/TermsPage.tsx'

function Root() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/terms') return <TermsPage />
  if (path === '/privacy') return <PrivacyPage />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
