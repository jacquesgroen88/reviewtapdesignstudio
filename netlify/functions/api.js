import serverless from 'serverless-http'
import express    from 'express'
import cors       from 'cors'
import uploadRouter   from '../../backend/src/routes/upload.js'
import removeBgRouter from '../../backend/src/routes/removeBg.js'
import qrRouter       from '../../backend/src/routes/qr.js'
import ordersRouter   from '../../backend/src/routes/orders.js'
import jobsRouter     from '../../backend/src/routes/jobs.js'
import designsRouter  from '../../backend/src/routes/designs.js'
import proxyImageRouter from '../../backend/src/routes/proxyImage.js'

const app = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))

app.use('/api/upload',    uploadRouter)
app.use('/api/remove-bg', removeBgRouter)
app.use('/api/qr',        qrRouter)
app.use('/api/orders',    ordersRouter)
app.use('/api/jobs',      jobsRouter)
app.use('/api/designs',   designsRouter)
app.use('/api/proxy-image', proxyImageRouter)
app.get('/api/health',    (_, res) => res.json({ ok: true }))

export const handler = serverless(app)
