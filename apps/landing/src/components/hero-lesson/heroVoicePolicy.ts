/**
 * When the looping hero lesson is allowed to come out of the speakers.
 *
 * Localhost earns a high Chrome media-engagement index, so a play() issued
 * as soon as the MP3 is ready actually plays. That is the "I started the
 * local server and the tutor was already talking" bug. Sound stays off
 * until the visitor hits the tab speaker.
 */

export type HeroSoundAfterLoad = 'unavailable' | 'off'

export function heroSoundAfterAssetsLoad(input: {
  reducedMotion: boolean
  timingsOk: boolean
}): HeroSoundAfterLoad {
  if (input.reducedMotion || !input.timingsOk) return 'unavailable'
  return 'off'
}

/** A click or key anywhere on the marketing page must not start the lesson voice. */
export function shouldStartHeroVoiceOnPageGesture(): boolean {
  return false
}

/**
 * Visibility starts false until IntersectionObserver reports. Otherwise a
 * below-the-fold load treats the mockup as on-screen and will play() if
 * sound is on.
 */
export function initialHeroSectionVisible(): boolean {
  return false
}

export function shouldAttemptHeroPlayback(input: {
  soundOn: boolean
  sectionVisible: boolean
  documentVisible: boolean
}): boolean {
  return input.soundOn && input.sectionVisible && input.documentVisible
}
