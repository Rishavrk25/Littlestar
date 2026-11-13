import bcrypt from 'bcryptjs'
import { assertRuntimeConfig, getConfig } from './config.js'
import { connectDatabase } from './db.js'
import { createApp } from './app.js'
import { User, Category, Product } from './models.js'
import { products } from './data/products.js'

const config = assertRuntimeConfig(getConfig())
await connectDatabase(config.mongoUri)

export async function ensureBootstrap(config) {
  try {
    for (const [index, name] of ['Girls', 'Boys', 'Baby'].entries()) {
      await Category.updateOne({ slug: name.toLowerCase() }, { $set: { name, sortOrder: index + 1, isActive: true } }, { upsert: true })
    }

    const productCount = await Product.countDocuments()
    if (productCount < products.length) {
      for (const item of products) {
        const variants = item.sizes.flatMap((size, sizeIndex) => item.colors.map((color, colorIndex) => {
          const stock = colorIndex === 0 ? Math.floor(item.stock / item.sizes.length) + (sizeIndex < item.stock % item.sizes.length ? 1 : 0) : 0
          return { size, color, stock }
        }))
        await Product.updateOne({ legacyId: item.id }, {
          $set: { ...item, legacyId: item.id, slug: item.id, stock: item.stock, variants, isActive: true },
        }, { upsert: true })
      }
      console.info(`Auto-seeded ${products.length} catalog products.`)
    }

    const adminPassword = config.adminPassword || 'admin123admin'
    const passwordHash = await bcrypt.hash(adminPassword, 12)
    const adminTargets = new Set([
      'admin@gmail.com',
      ...(config.adminEmail ? [config.adminEmail.toLowerCase()] : [])
    ])
    for (const email of adminTargets) {
      await User.updateOne(
        { email },
        {
          $set: {
            name: config.adminName || 'Little Star Admin',
            email,
            passwordHash,
            role: 'admin',
            isActive: true,
            authProvider: 'local'
          }
        },
        { upsert: true }
      )
      console.info(`Admin user ensured: ${email}`)
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
