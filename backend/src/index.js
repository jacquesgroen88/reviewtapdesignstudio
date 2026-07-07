import 'dotenv/config'
import express    from 'express'
import cors       from 'cors'
import uploadRouter   from './routes/upload.js'
import qrRouter       from './routes/qr.js'
import redirectRouter from './routes/redirect.js'
import ordersRouter   from './routes/orders.js'
import jobsRouter     from './routes/jobs.js'
import designsRouter  from './routes/designs.js'
import proxyImageRouter from './routes/proxyImage.js'

const app  = express()
const PORT = process.env.PORT || 4000

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }))
app.use(express.json({ limit: '50mb' }))

app.use('/api/upload',    uploadRouter)
app.use('/api/qr',        qrRouter)
app.use('/api/orders',    ordersRouter)
app.use('/api/jobs',      jobsRouter)
app.use('/api/designs',   designsRouter)
app.use('/api/proxy-image', proxyImageRouter)
app.use('/r',             redirectRouter)   // dynamic QR redirect: /r/:code

app.get('/api/health', (_, res) => res.json({ ok: true }))

app.listen(PORT, () => console.log(`ReviewTap backend :${PORT}`))
