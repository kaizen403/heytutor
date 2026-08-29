import { createRoot } from 'react-dom/client'
import './index.css'
import DashboardMockup from './components/DashboardMockup'

const SCALE = 1.25

createRoot(document.getElementById('root')!).render(
  <div style={{ width: 1600, height: 953, overflow: 'hidden', background: '#0B0B0C' }}>
    <div style={{ width: 1280, transform: `scale(${SCALE})`, transformOrigin: 'top left' }}>
      <DashboardMockup />
    </div>
  </div>,
)
