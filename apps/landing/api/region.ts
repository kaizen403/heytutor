export const config = { runtime: 'edge' }

/** Country only: no IP, coordinates, login state, or provider secrets. */
export default function region(request: Request): Response {
  const country = request.headers.get('x-vercel-ip-country')?.toUpperCase()
  const origin = request.headers.get('origin')
  const headers = new Headers({ 'cache-control': 'private, no-store', vary: 'Origin' })
  if (origin && ['https://app.accelute.co', 'http://localhost:3000'].includes(origin)) headers.set('access-control-allow-origin', origin)
  if (request.method !== 'GET') return new Response(null, { status: 405, headers })
  return Response.json({ country: country && /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null }, { headers })
}
