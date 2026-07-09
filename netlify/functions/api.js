import serverless from 'serverless-http'
import express    from 'express'
import cors       from 'cors'
import uploadRouter   from '../../backend/src/routes/upload.js'
import qrRouter       from '../../backend/src/routes/qr.js'
import ordersRouter   from '../../backend/src/routes/orders.js'
import jobsRouter     from '../../backend/src/routes/jobs.js'
import designsRouter  from '../../backend/src/routes/designs.js'
import teamRouter     from '../../backend/src/routes/team.js'
import approvalsRouter from '../../backend/src/routes/approvals.js'
import logoRequestsRouter from '../../backend/src/routes/logoRequests.js'
import { requireAuth } from '../../backend/src/middleware/auth.js'

const app = express()

// Same-site only (the SPA calls /api relatively; nothing else should)
app.use(cors({
  origin: [
    'https://link.reviewtap.co.za',
    'https://unrivaled-fairy-147ae5.netlify.app',
  ],
}))
app.use(express.json({ limit: '50mb' }))

app.get('/api/health', (_, res) => res.json({ ok: true }))

// All API routes require a signed-in team member. The QR redirect (/r/:code)
// and proxy-image are separate standalone functions and are NOT affected.
app.use('/api', requireAuth)
app.use('/api/upload',  uploadRouter)
app.use('/api/qr',      qrRouter)
app.use('/api/orders',  ordersRouter)
app.use('/api/jobs',    jobsRouter)
app.use('/api/designs', designsRouter)
app.use('/api/team',    teamRouter)
app.use('/api/approvals', approvalsRouter)
app.use('/api/logo-requests', logoRequestsRouter)

export const handler = serverless(app)
