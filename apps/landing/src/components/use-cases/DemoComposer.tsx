import {
  ArrowUp,
  Highlighter,
  Image,
  Mic,
  Pause,
  Play,
  Settings,
  X,
} from 'lucide-react'
import type { DemoFrame } from './demoTimeline'
import asset from './lessonAsset.json'

/** The desktop InputBar, MarkedDoubtBar and PausedLectureBar presentation.
 * Product labels and palette are generated from their production sources. */
export default function DemoComposer({ frame }: { frame: DemoFrame }) {
  const doubt = frame.beat === 'doubt'
  const marked = frame.circle === 1
  const choosing = frame.beat === 'ask' && frame.t < 3.4
  const typing = Boolean(frame.input)
  return (
    <div className="demo-input-chrome" aria-hidden="true">
      {frame.continued && (
        <div className="demo-doubt-panel demo-paused-panel">
          <div>
            <p>{asset.copy.PAUSED_LECTURE_TITLE}</p>
            <span>{asset.copy.PAUSED_LECTURE_BODY}</span>
          </div>
          <div className="demo-paused-actions">
            <span className="demo-app-button">
              {asset.copy.PAUSED_LECTURE_ANOTHER_DOUBT_LABEL}
            </span>
            <span className="demo-app-button demo-app-button--primary">
              {asset.copy.PAUSED_LECTURE_CONTINUE_LABEL}
            </span>
          </div>
        </div>
      )}
      {frame.marking && (
        <div className="demo-doubt-panel">
          <div className="demo-mark-hint">
            <Highlighter size={16} />
            <span>
              {marked
                ? asset.copy.MARK_MODE_EMPTY_HINT
                : asset.copy.MARK_MODE_HINT}
            </span>
            <span className="demo-clear-marks">
              {marked ? 'Clear marks' : ''}
            </span>
            <span className="demo-round-control">
              <X size={14} />
            </span>
          </div>
          {marked && (
            <div className="demo-mark-chip">
              <span>circled</span>
              <span>R_p = 4 Ω</span>
              <X size={12} />
            </div>
          )}
        </div>
      )}
      <div className="demo-input-bar">
        <span className="demo-input-icon">
          <Image size={20} />
        </span>
        <div
          className={`demo-question ${typing ? 'demo-question--typed' : ''}`}
        >
          {frame.input ||
            (frame.marking
              ? 'What about this?'
              : frame.continued
                ? asset.copy.PAUSED_LECTURE_PLACEHOLDER
                : choosing
                  ? 'Ask a question or paste a photo'
                  : 'Ask a doubt about this lesson')}
          {typing && <i className="demo-caret" />}
        </div>
        {!choosing && (
          <span
            className={`demo-input-icon ${frame.marking ? 'demo-marker-armed' : ''}`}
          >
            <Highlighter size={16} />
          </span>
        )}
        <span className="demo-input-icon">
          <Mic size={18} />
        </span>
        {!choosing && (
          <>
            <span className="demo-input-icon demo-pause">
              {doubt && frame.t >= 3.2 ? (
                <Play size={16} fill="currentColor" />
              ) : (
                <Pause size={16} fill="currentColor" />
              )}
            </span>
            <span className="demo-input-icon demo-cancel">
              <X size={16} />
            </span>
          </>
        )}
        <span className="demo-input-icon">
          <Settings size={18} />
        </span>
        <span
          className={`demo-app-button demo-app-button--primary ${frame.pressed && (doubt || choosing) ? 'demo-pressed' : ''}`}
        >
          {choosing ? (
            <>
              Ask
              <ArrowUp size={14} />
            </>
          ) : marked && frame.marking ? (
            asset.copy.MARK_SUBMIT_LABEL
          ) : (
            'Ask Doubt'
          )}
        </span>
      </div>
    </div>
  )
}
