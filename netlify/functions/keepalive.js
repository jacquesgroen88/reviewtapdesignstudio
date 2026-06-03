import { listQRCodes } from '../../backend/src/services/database.js'

// Scheduled function — pings the database daily so Supabase's free tier
// never pauses from inactivity. A paused DB would make QR redirects fail,
// so this keeps QR hosting reliable.
export const config = { schedule: '@daily' }

export async function handler() {
  try {
    await listQRCodes()
    console.log('keepalive: db reachable')
  } catch (err) {
    console.error('keepalive failed:', err.message)
  }
  return { statusCode: 200, body: 'ok' }
}
