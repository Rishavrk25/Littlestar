import bcrypt from 'bcryptjs'
import { assertRuntimeConfig, getConfig } from './config.js'
import { connectDatabase } from './db.js'
import { createApp } from './app.js'
import { User, Category } from './models.js'

const config = assertRuntimeConfig(getConfig())
await connectDatabase(config.mongoUri)

export async function ensureBootstrap(config) {
  try {
    for (const [index, name] of ['Girls', 'Boys', 'Baby'].entries()) {
      await Category.updateOne({ slug: name.toLowerCase() }, { $set: { name, sortOrder: index + 1, isActive: true } }, { upsert: true })
    }
    if (config.adminEmail && config.adminPassword) {
      const existing = await User.findOne({ email: config.adminEmail }).select('+passwordHash')
      const passwordHash = await bcrypt.hash(config.adminPassword, 12)
      if (!existing) {
        await User.create({
          name: config.adminName || 'Little Star Admin',
          email: config.adminEmail,
          role: 'admin',
          passwordHash,
          isActive: true,
        })
        console.info(`Admin user created: ${config.adminEmail}`)
      } else {
        const matches = await bcrypt.compare(config.adminPassword, existing.passwordHash || '')
        if (!matches || existing.role !== 'admin' || !existing.isActive) {
          existing.role = 'admin'
          existing.isActive = true
          existing.passwordHash = passwordHash
          await existing.save()
          console.info(`Admin user updated/synchronized: ${config.adminEmail}`)
        }
      }
    }
  } catch (err) {
    console.warn('Bootstrap initialization notice:', err.message)
  }
}

await ensureBootstrap(config)

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