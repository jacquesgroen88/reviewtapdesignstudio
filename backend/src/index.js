import 'dotenv/config'
import express    from 'express'
import cors       from 'cors'
import uploadRouter   from './routes/upload.js'
import removeBgRouter from './routes/removeBg.js'
import qrRouter       from './routes/qr.js'
import redirectRouter from './routes/redirect.js'

const app  = express()
const PORT = process.env.PORT || 4000

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }))
app.use(express.json({ limit: '50mb' }))

app.use('/api/upload',    uploadRouter)
app.use('/api/remove-bg', removeBgRouter)
app.use('/api/qr',        qrRouter)
app.use('/r',             redirectRouter)   // dynamic QR redirect: /r/:code

app.get('/api/health', (_, res) => res.json({ ok: true }))

app.listen(PORT, () => console.log(`ReviewTap backend :${PORT}`))
