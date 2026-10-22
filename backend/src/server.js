import { assertRuntimeConfig, getConfig } from './config.js'
import { connectDatabase } from './db.js'
import { createApp } from './app.js'

const config = assertRuntimeConfig(getConfig())
await connectDatabase(config.mongoUri)
const app = createApp({ config })
const server = app.listen(config.port, '0.0.0.0', () => console.info(`Little Star API listening on port ${config.port}`))

async function shutdown(signal) {
  console.info(`${signal} received; shutting down.`)
  server.close(async () => {
    const { disconnectDatabase } = await import('./db.js')
    await disconnectDatabase()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))