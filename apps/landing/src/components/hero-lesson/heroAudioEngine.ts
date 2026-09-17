/**
 * Plays the hero voiceover. Web Audio is the path that survives iOS: one
 * unlock() inside the tap, then BufferSource.start() for every loop wrap
 * without a new gesture. HTMLAudioElement is the fallback when decode fails;
 * it still refuses overlapping play() and never seeks from rAF.
 *
 * iOS will not speak if we BufferSource.start() on a context that is still
 * `suspended` or WebKit-`interrupted`. Unlock creates/resumes the live
 * context inside the tap, plays a silent HTML sound so the phone uses the
 * media route, and start() waits until state === 'running'.
 */
import {
  audioContextNeedsResume,
  HERO_SILENT_UNLOCK_SRC,
  isUnlockBlockingError,
} from './heroAudioClock'

export interface HeroAudioEngine {
  loadFromArrayBuffer(data: ArrayBuffer): Promise<void>
  /** Must run inside the user gesture that turned the speaker on. */
  unlock(): void
  start(offsetSec: number): void
  stop(): void
  getPositionSec(): number | null
  isPlaying(): boolean
  isStartInFlight(): boolean
  isUnlocked(): boolean
  isReady(): boolean
  release(): void
}

type Mode = 'webaudio' | 'html'

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

function offlineContextCtor(): (typeof OfflineAudioContext) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    OfflineAudioContext?: typeof OfflineAudioContext
    webkitOfflineAudioContext?: typeof OfflineAudioContext
  }
  return w.OfflineAudioContext ?? w.webkitOfflineAudioContext ?? null
}

function decodeAudio(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  const copy = data.slice(0)
  try {
    const result = ctx.decodeAudioData(copy)
    if (result && typeof (result as Promise<AudioBuffer>).then === 'function') {
      return result
    }
  } catch {
    /* callback form below */
  }
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(data.slice(0), resolve, reject)
  })
}

function unlockHtmlMedia(): void {
  if (typeof Audio === 'undefined') return
  const el = new Audio(HERO_SILENT_UNLOCK_SRC)
  el.setAttribute('playsinline', '')
  el.setAttribute('webkit-playsinline', '')
  el.preload = 'auto'
  el.volume = 1
  void el.play().catch(() => undefined)
}

export function createHeroAudioEngine(options: { onBlocked: () => void }): HeroAudioEngine {
  const onBlocked = options.onBlocked
  let mode: Mode = 'webaudio'
  let ready = false
  let unlocked = false
  let playing = false
  let startInFlight = false
  let pendingOffset: number | null = null
  let ctx: AudioContext | null = null
  let gain: GainNode | null = null
  let buffer: AudioBuffer | null = null
  let raw: ArrayBuffer | null = null
  let source: AudioBufferSourceNode | null = null
  let sourceGen = 0
  let startedAt = 0
  let offsetAtStart = 0
  let html: HTMLAudioElement | null = null
  let objectUrl: string | null = null

  const wireStateChange = (context: AudioContext): void => {
    context.onstatechange = () => {
      if (!unlocked || context.state === 'closed') return
      if (audioContextNeedsResume(context.state)) void context.resume()
    }
  }

  const ensureContext = (): AudioContext | null => {
    const Ctor = audioContextCtor()
    if (!Ctor) return null
    if (ctx && ctx.state !== 'closed') return ctx
    ctx = new Ctor()
    gain = ctx.createGain()
    gain.gain.value = 1
    gain.connect(ctx.destination)
    wireStateChange(ctx)
    return ctx
  }

  const recreateContextInsideGesture = (): AudioContext | null => {
    const Ctor = audioContextCtor()
    if (!Ctor) return null
    if (ctx && ctx.state !== 'closed' && ctx.state !== 'interrupted') return ctx
    if (ctx && ctx.state !== 'closed') {
      ctx.onstatechange = null
      void ctx.close().catch(() => undefined)
    }
    ctx = new Ctor()
    gain = ctx.createGain()
    gain.gain.value = 1
    gain.connect(ctx.destination)
    wireStateChange(ctx)
    return ctx
  }

  const stopSource = (): void => {
    sourceGen += 1
    pendingOffset = null
    if (source) {
      try {
        source.onended = null
        source.stop()
      } catch {
        /* already stopped */
      }
      try {
        source.disconnect()
      } catch {
        /* already disconnected */
      }
      source = null
    }
    if (html && !html.paused) html.pause()
    playing = false
    startInFlight = false
  }

  const setupHtml = (data: ArrayBuffer): void => {
    if (typeof Audio === 'undefined') return
    const blob = new Blob([data], { type: 'audio/mpeg' })
    objectUrl = URL.createObjectURL(blob)
    html = new Audio(objectUrl)
    html.preload = 'auto'
    html.setAttribute('playsinline', '')
    html.setAttribute('webkit-playsinline', '')
    html.controls = false
    html.addEventListener('ended', () => {
      playing = false
      startInFlight = false
    })
    html.style.position = 'fixed'
    html.style.width = '0'
    html.style.height = '0'
    html.style.opacity = '0'
    html.setAttribute('aria-hidden', 'true')
    document.body.appendChild(html)
    mode = 'html'
  }

  const startWebAudio = (offsetSec: number): void => {
    if (!ctx || !buffer || !gain || ctx.state !== 'running') {
      startInFlight = false
      return
    }
    const remaining = buffer.duration - offsetSec
    if (remaining <= 0.05) return
    const gen = ++sourceGen
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(gain)
    const off = Math.max(0, offsetSec)
    src.onended = () => {
      if (gen !== sourceGen) return
      playing = false
      source = null
    }
    src.start(0, off)
    source = src
    offsetAtStart = off
    startedAt = ctx.currentTime
    playing = true
    startInFlight = false
  }

  const startHtml = (offsetSec: number): void => {
    const el = html
    if (!el || startInFlight) return
    const target = Math.max(0, offsetSec)
    const seekTo = (node: HTMLAudioElement) => {
      if (Math.abs(node.currentTime - target) > 0.05) node.currentTime = target
    }
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seekTo(el)
    } else {
      el.addEventListener('loadedmetadata', () => seekTo(el), { once: true })
    }
    startInFlight = true
    void el
      .play()
      .then(() => {
        startInFlight = false
        playing = true
      })
      .catch((error: unknown) => {
        startInFlight = false
        playing = false
        if (isUnlockBlockingError(error)) onBlocked()
      })
  }

  const runPendingStart = (): void => {
    const off = pendingOffset
    pendingOffset = null
    if (off == null || !unlocked || !ready) {
      startInFlight = false
      return
    }
    if (mode === 'webaudio') startWebAudio(off)
    else startHtml(off)
  }

  return {
    async loadFromArrayBuffer(data: ArrayBuffer) {
      raw = data.slice(0)
      const Offline = offlineContextCtor()
      if (Offline) {
        try {
          const offline = new Offline(1, 1, 44100)
          buffer = await decodeAudio(offline, data.slice(0))
          mode = 'webaudio'
          ready = true
          return
        } catch {
          buffer = null
        }
      }
      const context = ensureContext()
      if (context) {
        try {
          buffer = await decodeAudio(context, data.slice(0))
          mode = 'webaudio'
          ready = true
          return
        } catch {
          buffer = null
        }
      }
      setupHtml(data)
      ready = html !== null
    },

    unlock() {
      unlocked = true
      unlockHtmlMedia()
      const context = recreateContextInsideGesture() ?? ensureContext()
      if (!context) {
        if (raw && !html) setupHtml(raw)
        if (html) void html.play().then(() => html?.pause()).catch(() => undefined)
        return
      }
      if (audioContextNeedsResume(context.state)) void context.resume()
      try {
        const blip = context.createBuffer(1, 1, context.sampleRate)
        const src = context.createBufferSource()
        src.buffer = blip
        src.connect(context.destination)
        src.start(0)
      } catch {
        /* resume() is the unlock; the blip is best-effort */
      }
    },

    start(offsetSec: number) {
      if (!ready || !unlocked) return
      stopSource()
      pendingOffset = offsetSec
      if (mode === 'webaudio') {
        const context = ensureContext()
        if (!context) {
          if (raw) setupHtml(raw)
          startHtml(offsetSec)
          return
        }
        if (context.state !== 'running') {
          startInFlight = true
          void context.resume().then(runPendingStart).catch(() => {
            startInFlight = false
            playing = false
            if (raw) {
              setupHtml(raw)
              startHtml(offsetSec)
            } else {
              onBlocked()
            }
          })
          return
        }
        runPendingStart()
        return
      }
      startHtml(offsetSec)
    },

    stop() {
      stopSource()
    },

    getPositionSec() {
      if (!playing) return null
      if (mode === 'webaudio' && ctx) {
        return offsetAtStart + (ctx.currentTime - startedAt)
      }
      if (html) return html.currentTime
      return null
    },

    isPlaying: () => playing,
    isStartInFlight: () => startInFlight,
    isUnlocked: () => unlocked,
    isReady: () => ready,

    release() {
      stopSource()
      unlocked = false
      ready = false
      buffer = null
      raw = null
      if (ctx && ctx.state !== 'closed') {
        ctx.onstatechange = null
        void ctx.close().catch(() => undefined)
      }
      ctx = null
      gain = null
      if (html) {
        html.removeAttribute('src')
        html.load()
        html.remove()
        html = null
      }
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
        objectUrl = null
      }
    },
  }
}
