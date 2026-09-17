import type { ReactNode } from 'react'

/** Turns Accelute URLs and the contact email into links inside catalog copy. */
export default function LinkedCopy({ text }: { text: string }) {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  const token = /(app\.accelute\.co|accelute\.co|hi@accelute\.co)/g
  for (const match of text.matchAll(token)) {
    const value = match[0]
    const index = match.index ?? 0
    if (index > last) nodes.push(text.slice(last, index))
    if (value === 'hi@accelute.co') {
      nodes.push(
        <a key={key++} href="mailto:hi@accelute.co">
          hi@accelute.co
        </a>,
      )
    } else if (value === 'app.accelute.co') {
      nodes.push(
        <a key={key++} href="https://app.accelute.co/">
          app.accelute.co
        </a>,
      )
    } else {
      nodes.push(
        <a key={key++} href="https://accelute.co/">
          accelute.co
        </a>,
      )
    }
    last = index + value.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}
