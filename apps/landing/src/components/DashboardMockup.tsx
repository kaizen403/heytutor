import { useRef, type CSSProperties, type RefObject } from 'react'
import { ArrowUp, Download, Highlighter, Image, Maximize, MessageSquare, Mic, Pause, RotateCcw, Settings, X } from 'lucide-react'
import LiveLessonBoard from './hero-lesson/LiveLessonBoard'
import { useLessonSimulation, type SoundState } from './hero-lesson/useLessonSimulation'
import { LESSON_TITLE, QUESTION_TEXT, type LessonSnapshot } from './hero-lesson/lessonScript'
import type { CursorState, WhiteboardHandle } from '@heytutor/whiteboard'
import { DesktopSidebar } from './use-cases/DesktopChrome'
import product from './use-cases/lessonAsset.json'
import './use-cases/useCases.css'
import './hero-lesson/heroProduct.css'

export interface DashboardDrive {
  question: string
  snapshot: LessonSnapshot
  sound: SoundState
  toggleSound: () => void
  boardRef: (handle: WhiteboardHandle | null) => void
  cursorState: CursorState
  pressed?: 'replay' | 'download' | null
}

function DashboardChrome({ rootRef, drive }: { rootRef: RefObject<HTMLDivElement | null>; drive: DashboardDrive }) {
  const { snapshot, boardRef, cursorState, question } = drive
  const live = snapshot.teaching || snapshot.phase === 'submit'
  const typed = question.slice(0, snapshot.typedCount)
  return (
    <div ref={rootRef} className="hero-product" data-lesson-phase={snapshot.phase} data-lesson-clock={snapshot.timeSeconds ?? 0} style={product.theme as CSSProperties}>
      <DesktopSidebar title={LESSON_TITLE} preview="v = 15 cm · hᵢ = −1.5 cm" />
      <main className="hero-product-main">
        <header className="demo-session-header">
          <div className="demo-session-identity">
            <strong>{LESSON_TITLE}</strong>
            <small>{live ? 'Lesson in progress on the whiteboard' : 'Whiteboard session'}</small>
          </div>
          <div className="demo-header-actions" aria-hidden="true">
            <span className="demo-app-button"><MessageSquare size={14} />Ask</span>
            <span className="demo-toolbar-button"><RotateCcw size={14} />Replay</span>
            <span className="demo-toolbar-button"><Download size={14} />Download</span>
            <span className="demo-toolbar-button"><Maximize size={15} /></span>
            {live && <><i className="demo-header-rule" /><span className="demo-app-button">Stop</span></>}
          </div>
        </header>
        <div className="hero-product-board">
          <LiveLessonBoard snapshot={snapshot} boardRef={boardRef} cursorState={cursorState} />
        </div>
        <div className="hero-product-composer demo-input-bar" aria-hidden="true">
          <span className="demo-input-icon"><Image size={20} /></span>
          <div className={`mockup-input demo-question ${typed ? 'demo-question--typed' : ''}`} data-typed-count={snapshot.typedCount}>
            {typed || (snapshot.teaching ? 'Ask a doubt about this lesson' : 'Ask a question or paste a photo')}
            {typed && <i className="demo-caret" />}
          </div>
          {snapshot.teaching && <span className="demo-input-icon"><Highlighter size={16} /></span>}
          <span className="demo-input-icon"><Mic size={18} /></span>
          {snapshot.teaching && <><span className="demo-input-icon demo-pause"><Pause size={16} fill="currentColor" /></span><span className="demo-input-icon"><X size={16} /></span></>}
          <span className="demo-input-icon"><Settings size={18} /></span>
          <span className={`demo-app-button ${typed || snapshot.teaching ? 'demo-app-button--primary' : ''}`}>
            {snapshot.teaching ? 'Ask Doubt' : <>Ask<ArrowUp size={14} /></>}
          </span>
        </div>
      </main>
    </div>
  )
}

function StandaloneDashboard() {
  const rootRef = useRef<HTMLDivElement>(null)
  const drive = useLessonSimulation(rootRef)
  return <DashboardChrome rootRef={rootRef} drive={{ ...drive, question: QUESTION_TEXT }} />
}

export default function DashboardMockup({ drive }: { drive?: DashboardDrive }) {
  const rootRef = useRef<HTMLDivElement>(null)
  return drive ? <DashboardChrome rootRef={rootRef} drive={drive} /> : <StandaloneDashboard />
}
