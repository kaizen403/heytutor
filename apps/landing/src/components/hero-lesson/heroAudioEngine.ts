/**
 * Plays the hero voiceover. Web Audio is the path that survives iOS: one
 * unlock() inside the tap, then BufferSource.start() for every loop wrap
 * without a new gesture. HTMLAudioElement is the fallback when decode fails;
 * it still refuses overlapping play() and never seeks from rAF.
 */
import { isUnlockBlockingError } from './heroAudioClock'

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

function decodeAudio(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
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

export function createHeroAudioEngine(options: { onBlocked: () => void }): HeroAudioEngine {
  const onBlocked = options.onBlocked
  let mode: Mode = 'webaudio'
  let ready = false
  let unlocked = false
  let playing = false
  let startInFlight = false
  let ctx: AudioContext | null = null
  let gain: GainNode | null = null
  let buffer: AudioBuffer | null = null
  let source: AudioBufferSourceNode | null = null
  let sourceGen = 0
  let startedAt = 0
  let offsetAtStart = 0
  let html: HTMLAudioElement | null = null
  let objectUrl: string | null = null

  const ensureContext = (): AudioContext | null => {
    const Ctor = audioContextCtor()
    if (!Ctor) return null
    if (ctx && ctx.state !== 'closed') return ctx
    ctx = new Ctor()
    gain = ctx.createGain()
    gain.gain.value = 1
    gain.connect(ctx.destination)
    return ctx
  }

  const stopSource = (): void => {
    sourceGen += 1
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
    if (!ctx || !buffer || !gain) return
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

  return {
    async loadFromArrayBuffer(data: ArrayBuffer) {
      const context = ensureContext()
      if (context) {
        try {
          buffer = await decodeAudio(context, data)
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
      const context = ensureContext()
      if (context) {
        if (context.state === 'suspended') void context.resume()
        try {
          const blip = context.createBuffer(1, 1, context.sampleRate)
          const src = context.createBufferSource()
          src.buffer = blip
          src.connect(context.destination)
          src.start(0)
        } catch {
          /* resume() is the unlock; the blip is best-effort */
        }
      }
    },

    start(offsetSec: number) {
      if (!ready || !unlocked) return
      stopSource()
      if (mode === 'webaudio') startWebAudio(offsetSec)
      else startHtml(offsetSec)
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
      if (ctx && ctx.state !== 'closed') {
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
