import {
  ChevronDown,
  List,
  Maximize,
  Pause,
  SkipBack,
  Volume2,
} from 'lucide-react'
import type { DemoFrame } from './demoTimeline'

export default function DemoPlayback({ frame }: { frame: DemoFrame }) {
  return (
    <div className="demo-playback" aria-hidden="true">
      <div className="demo-playback-track">
        <span
          style={{
            width: `${frame.t < 3.5 ? (frame.t / 3.5) * 25 : 66 + (frame.t - 3.5) * 2}%`,
          }}
        />
      </div>
      <div className="demo-playback-row">
        <SkipBack size={17} />
        <Pause size={17} fill="currentColor" />
        <Volume2 size={17} />
        <span>
          {frame.t < 3.5 ? '0:08' : '0:32'} <small>/ 0:48</small>
        </span>
        <span className="demo-playback-chapter">
          {frame.t < 3.5 ? 'Series resistance' : 'Parallel resistance'}
          <List size={16} />
        </span>
        <span className={frame.step === 2 ? 'demo-speed-selected' : ''}>
          {frame.t < 4.2 ? '1×' : '1.5×'}
          <ChevronDown size={12} />
        </span>
        <Maximize size={16} />
      </div>
    </div>
  )
}
