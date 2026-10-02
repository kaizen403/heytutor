import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.tsx'

const handwritingFont = document.getElementById('caveat-fonts')
if (handwritingFont instanceof HTMLLinkElement) {
  const enableFont = () => { handwritingFont.media = 'all' }
  if (handwritingFont.sheet) enableFont()
  else handwritingFont.addEventListener('load', enableFont, { once: true })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
)
