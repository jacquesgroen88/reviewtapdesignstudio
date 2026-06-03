import axios from 'axios'

// Only proxy from trusted hosts (Formaloo's S3 + Formaloo domains)
const ALLOWED_HOSTS = [
  's3.amazonaws.com',
  'amazonaws.com',
  'formaloo.me',
  'formaloo.com',
]

// Standalone Netlify Function — returns the image base64-encoded with
// isBase64Encoded:true so binary data survives intact. (Routing this through
// serverless-http/Express corrupts binary as UTF-8.)
export async function handler(event) {
  const url = event.queryStringParameters?.url
  if (!url) return { statusCode: 400, body: 'url query param required' }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { statusCode: 400, body: 'invalid url' }
  }

  const allowed = ALLOWED_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))
  if (!allowed) return { statusCode: 403, body: 'host not allowed' }

  try {
    const upstream = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 })
    const contentType = upstream.headers['content-type'] || 'image/png'
    return {
      statusCode: 200,
      headers: {
        'Content-Type':                contentType,
        'Cache-Control':               'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
      body: Buffer.from(upstream.data).toString('base64'),
      isBase64Encoded: true,
    }
  } catch (err) {
    console.error('proxy-image error:', err.message)
    return { statusCode: 502, body: 'could not fetch image' }
  }
}
