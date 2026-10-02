export default {
  fetch(request, env) {
    if (new URL(request.url).pathname !== '/api/region') return env.ASSETS.fetch(request)
    const country = String(request.cf?.country ?? '')
    const headers = new Headers({ 'cache-control': 'private, no-store', vary: 'Origin' })
    const origin = request.headers.get('origin')
    if (origin && ['https://app.accelute.co', 'http://localhost:3000'].includes(origin)) headers.set('access-control-allow-origin', origin)
    if (request.method !== 'GET') return new Response(null, { status: 405, headers })
    return Response.json({ country: typeof country === 'string' && /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null }, { headers })
  },
}
