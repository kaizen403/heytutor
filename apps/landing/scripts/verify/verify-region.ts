import assert from 'node:assert/strict'
import region from '../../api/region.ts'
import worker from '../../public/_worker.js'

const makeRequest = (country?: string, origin = 'https://app.accelute.co', method = 'GET') => {
  const request = new Request('https://accelute.co/api/region', { method, headers: { origin, ...(country ? { 'x-vercel-ip-country': country } : {}) } })
  Object.defineProperty(request, 'cf', { value: country ? { country } : undefined })
  return request
}
const assets = { fetch: () => new Response('static asset') }
for (const handler of [region, (request: Request) => worker.fetch(request, { ASSETS: assets })]) {
  const india = handler(makeRequest('IN'))
  assert.deepEqual(await india.json(), { country: 'IN' }, 'returns only the hosting country, without IP or coordinates')
  assert.equal(india.headers.get('access-control-allow-origin'), 'https://app.accelute.co')
  assert.equal(india.headers.get('cache-control'), 'private, no-store')
  assert.equal(india.headers.get('vary'), 'Origin')
  assert.deepEqual(await handler(makeRequest('US')).json(), { country: 'US' })
  for (const invalid of [undefined, 'XX', 'invalid']) assert.deepEqual(await handler(makeRequest(invalid)).json(), { country: null })
  assert.equal(handler(makeRequest('IN', 'https://evil.test')).headers.get('access-control-allow-origin'), null)
  assert.equal(handler(makeRequest('IN', 'https://app.accelute.co', 'POST')).status, 405)
}
assert.equal(await worker.fetch(new Request('https://accelute.co/terms'), { ASSETS: assets }).text(), 'static asset', 'ordinary pages still use the static asset binding')
console.log('✓ Vercel/Cloudflare country-only endpoints, private cache, CORS, methods, and static pages')
