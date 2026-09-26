const DEFAULT_DEV_TUTOR_ORIGIN = 'http://localhost:3000'
const DEFAULT_PROD_TUTOR_ORIGIN = 'https://app.accelute.co'

function normalizeOrigin(origin?: string): string {
  const value = origin?.trim()
  return value ? value.replace(/\/$/, '') : ''
}

const configuredTutorOrigin = normalizeOrigin(import.meta.env.VITE_TUTOR_ORIGIN)

const TUTOR_APP_ORIGIN =
  configuredTutorOrigin ||
  (import.meta.env.DEV ? DEFAULT_DEV_TUTOR_ORIGIN : DEFAULT_PROD_TUTOR_ORIGIN)

export const TUTOR_APP_HREF = new URL('/', `${TUTOR_APP_ORIGIN}/`).toString()

/** Landing CTAs start Google on the tutor origin (`/login?google=1`). */
function tutorLoginHref(next?: string): string {
  const url = new URL('/login', `${TUTOR_APP_ORIGIN}/`)
  url.searchParams.set('google', '1')
  if (next && next !== '/') {
    url.searchParams.set('next', next)
  }
  return url.toString()
}

export const TUTOR_LOGIN_HREF = tutorLoginHref()

export function tutorQuestionHref(question: string): string {
  const destination = new URL('/', `${TUTOR_APP_ORIGIN}/`)
  const normalizedQuestion = question.trim()
  if (normalizedQuestion) {
    destination.searchParams.set('q', normalizedQuestion)
  }
  return tutorLoginHref(`${destination.pathname}${destination.search}`)
}
