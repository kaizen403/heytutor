import {
  Download,
  Maximize,
  MessageSquare,
  PanelLeft,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ChevronDown,
} from 'lucide-react'
import Brand from '../Brand'
import type { DemoFrame } from './demoTimeline'

/** Desktop BoardHistory + SessionHeader chrome, at their production dimensions. */
export function DesktopSidebar({ title = 'Series & parallel resistors', preview = 'Rₚ = 4 Ω' }: { title?: string; preview?: string } = {}) {
  return (
    <aside className="demo-sidebar" aria-hidden="true">
      <div className="demo-sidebar-header">
        <Brand size="sm" />
        <div className="demo-icon-row">
          <Search size={17} />
          <PanelLeft size={17} />
        </div>
      </div>
      <div className="demo-new-board">
        <span>
          <Plus size={14} />
        </span>
        New board
      </div>
      <div className="demo-account-nav">
        <span>Library</span>
        <span>Progress</span>
      </div>
      <p className="demo-sidebar-label">Recent boards</p>
      {[
        [title, preview],
        [title === 'Series & parallel resistors' ? 'Projectile motion' : 'Series & parallel resistors', title === 'Series & parallel resistors' ? 'R = u² sin(2θ) / g' : 'Rₚ = 4 Ω'],
        ['Pythagorean theorem', 'a² + b² = c²'],
      ].map(([title, preview], index) => (
        <div
          key={title}
          className={`demo-history-item ${index === 0 ? 'demo-history-item--active' : ''}`}
        >
          <span>{title}</span>
          <small>{preview}</small>
        </div>
      ))}
      <div className="demo-sidebar-footer">
        <div className="demo-usage">
          <span>Usage</span>
          <span>76%</span>
          <i />
        </div>
        <div className="demo-profile">
          <span className="demo-avatar">S</span>
          <span>Student</span>
          <Settings size={15} />
          <ChevronDown size={14} />
        </div>
      </div>
    </aside>
  )
}

export function DesktopHeader({ frame }: { frame: DemoFrame }) {
  const notes = frame.beat === 'notes'
  const replay = frame.beat === 'replay'
  const live = !notes && !(frame.beat === 'doubt' && frame.continued)
  return (
    <header className="demo-session-header" aria-hidden="true">
      <div className="demo-session-identity">
        <strong>Series &amp; parallel resistors</strong>
        <small>
          {live ? 'Lesson in progress on the whiteboard' : 'Whiteboard session'}
        </small>
      </div>
      <div className="demo-header-actions">
        <span className="demo-app-button">
          <MessageSquare size={14} />
          Ask
        </span>
        <span
          className={`demo-toolbar-button ${replay && frame.pressed ? 'demo-pressed' : ''}`}
        >
          <RotateCcw size={14} />
          {replay && frame.t >= 1.6 ? 'Replaying…' : 'Replay'}
        </span>
        <span
          className={`demo-toolbar-button ${notes && frame.pressed ? 'demo-pressed' : ''}`}
        >
          <Download size={14} />
          {notes && frame.step === 2
            ? `Preparing… ${Math.round(((frame.t - 3.8) / 3) * 100)}%`
            : 'Download'}
        </span>
        <span className="demo-toolbar-button demo-fullscreen">
          <Maximize size={15} />
        </span>
        {live && (
          <>
            <i className="demo-header-rule" />
            <span className="demo-app-button">Stop</span>
          </>
        )}
      </div>
      {notes && frame.step === 1 && (
        <div className="demo-download-menu">
          <span>Notes (PDF)</span>
          <span className={frame.t > 2.5 ? 'demo-download-selected' : ''}>
            Lecture (MP4)
          </span>
        </div>
      )}
    </header>
  )
}
