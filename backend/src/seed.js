import bcrypt from 'bcryptjs'
import { assertRuntimeConfig, getConfig } from './config.js'
import { connectDatabase, disconnectDatabase } from './db.js'
import { Category, Product, User } from './models.js'
import { products } from '../../frontend/src/data/products.js'

const config = getConfig()
assertRuntimeConfig(config)
await connectDatabase(config.mongoUri)
try {
  for (const [index, name] of ['Girls', 'Boys', 'Baby'].entries()) {
    await Category.updateOne({ slug: name.toLowerCase() }, { $set: { name, sortOrder: index + 1, isActive: true } }, { upsert: true })
  }
  for (const item of products) {
    const variants = item.sizes.flatMap((size, sizeIndex) => item.colors.map((color, colorIndex) => {
      const stock = colorIndex === 0 ? Math.floor(item.stock / item.sizes.length) + (sizeIndex < item.stock % item.sizes.length ? 1 : 0) : 0
      return { size, color, stock }
    }))
    await Product.updateOne({ legacyId: item.id }, {
      $set: { ...item, legacyId: item.id, slug: item.id, stock: item.stock, variants, isActive: true },
    }, { upsert: true, runValidators: true })
  }
  if (config.adminEmail && config.adminPassword) {
    assertRuntimeConfig(config)
    if (config.adminPassword.length < 12 || Buffer.byteLength(config.adminPassword, 'utf8') > 72) throw new Error('ADMIN_PASSWORD must contain at least 12 characters and no more than 72 UTF-8 bytes.')
    const passwordHash = await bcrypt.hash(config.adminPassword, 12)
    await User.updateOne({ email: config.adminEmail }, { $setOnInsert: { name: config.adminName, email: config.adminEmail, role: 'admin', passwordHash, isActive: true } }, { upsert: true })
    console.info(`Admin account ensured for ${config.adminEmail}. Existing password was left unchanged.`)
  } else console.info('ADMIN_EMAIL / ADMIN_PASSWORD not set; no admin account was created.')
  console.info(`Seeded ${products.length} catalog products and 3 categories.`)
} finally {
  await disconnectDatabase()
}
