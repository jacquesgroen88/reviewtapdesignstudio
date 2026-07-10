import 'dotenv/config'
import express    from 'express'
import cors       from 'cors'
import uploadRouter   from './routes/upload.js'
import qrRouter       from './routes/qr.js'
import redirectRouter from './routes/redirect.js'
import ordersRouter   from './routes/orders.js'
import jobsRouter     from './routes/jobs.js'
import designsRouter  from './routes/designs.js'
import teamRouter     from './routes/team.js'
import approvalsRouter from './routes/approvals.js'
import approvePublicRouter from './routes/approvePublic.js'
import logoRequestsRouter from './routes/logoRequests.js'
import logoRequestPublicRouter from './routes/logoRequestPublic.js'
import activityRouter from './routes/activity.js'
import proxyImageRouter from './routes/proxyImage.js'
import { requireAuth } from './middleware/auth.js'

const app  = express()
const PORT = process.env.PORT || 4000

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }))
app.use(express.json({ limit: '50mb' }))

// Public: health, QR redirect (sacred — never behind auth), image proxy
// (no-header <img>/canvas loads; hardened by domain allowlist instead).
app.get('/api/health', (_, res) => res.json({ ok: true }))
app.use('/r',               redirectRouter)   // dynamic QR redirect: /r/:code
app.use('/approve',         approvePublicRouter)   // client approval page (no login)
app.use('/logo-request',    logoRequestPublicRouter)   // client logo-upload page (no login)
app.use('/api/proxy-image', proxyImageRouter)

// Everything else requires a signed-in team member
app.use('/api', requireAuth)
app.use('/api/upload',  uploadRouter)
app.use('/api/qr',      qrRouter)
app.use('/api/orders',  ordersRouter)
app.use('/api/jobs',    jobsRouter)
app.use('/api/designs', designsRouter)
app.use('/api/team',    teamRouter)
app.use('/api/approvals', approvalsRouter)
app.use('/api/logo-requests', logoRequestsRouter)
app.use('/api/activity', activityRouter)

app.listen(PORT, () => console.log(`ReviewTap backend :${PORT}`))
