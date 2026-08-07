const DEFAULT_DEV_TUTOR_ORIGIN = 'http://localhost:3000'
const DEFAULT_PROD_TUTOR_ORIGIN = 'https://heytutor.vercel.app'

function normalizeOrigin(origin?: string): string {
  const value = origin?.trim()
  return value ? value.replace(/\/$/, '') : ''
}

const configuredTutorOrigin = normalizeOrigin(import.meta.env.VITE_TUTOR_ORIGIN)

export const TUTOR_APP_ORIGIN =
  configuredTutorOrigin ||
  (import.meta.env.DEV ? DEFAULT_DEV_TUTOR_ORIGIN : DEFAULT_PROD_TUTOR_ORIGIN)

export const TUTOR_APP_HREF = new URL('/', `${TUTOR_APP_ORIGIN}/`).toString()

export function tutorQuestionHref(question: string): string {
  const url = new URL(TUTOR_APP_HREF)
  const normalizedQuestion = question.trim()
  if (normalizedQuestion) {
    url.searchParams.set('q', normalizedQuestion)
  }
  return url.toString()
}
