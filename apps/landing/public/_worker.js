const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; media-src 'self' blob: data:; connect-src 'self' https://app.accelute.co; frame-src https://app.accelute.co; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self' https://app.accelute.co; frame-ancestors 'none'; upgrade-insecure-requests",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), fullscreen=(self \"https://app.accelute.co\")",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname !== '/api/region') return env.ASSETS.fetch(request)
    const country = String(request.cf?.country ?? '')
    const headers = new Headers({ ...securityHeaders, 'cache-control': 'private, no-store', vary: 'Origin' })
    const origin = request.headers.get('origin')
    if (origin && ['https://app.accelute.co', 'http://localhost:3000'].includes(origin)) headers.set('access-control-allow-origin', origin)
    if (request.method !== 'GET') return new Response(null, { status: 405, headers })
    return Response.json({ country: typeof country === 'string' && /^[A-Z]{2}$/.test(country) && country !== 'XX' ? country : null }, { headers })
  },
}
