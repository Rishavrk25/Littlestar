import test from 'node:test'
import assert from 'node:assert/strict'
import { unlink } from 'node:fs/promises'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { createApp } from '../src/app.js'
import { assertRuntimeConfig, getConfig } from '../src/config.js'
import { Cart, Category, ContactMessage, Order, Product, User, Wishlist } from '../src/models.js'

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/little_star_kids_wear_test'
const url = new URL(mongoUri)
const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''))
if (process.env.NODE_ENV !== 'test' || !databaseName.endsWith('_test') || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('Tests require NODE_ENV=test and a local MongoDB database name ending in _test; the suite drops that database.')

const config = {
  nodeEnv: 'test', port: 0, mongoUri, jwtSecret: 'little-star-test-secret-with-more-than-32-characters', jwtExpiresIn: '1h',
  origins: ['http://127.0.0.1:5173'], cookieSecure: false, cookieSameSite: 'lax', adminEmail: '', adminPassword: '', adminName: 'Test Admin',
  rateLimitWindowMs: 60000, rateLimitMax: 1000,
}

test('API integration: catalog, auth, cart, wishlist, checkout, admin, and contact', async (t) => {
  const validEnvironment = { NODE_ENV: 'development', PORT: '5000', MONGODB_URI: 'mongodb://127.0.0.1:27017/little_star_kids_wear_test', JWT_SECRET: 'runtime-test-secret-at-least-32-characters-long', CORS_ORIGINS: 'http://localhost:5173' }
  assert.doesNotThrow(() => assertRuntimeConfig(getConfig(validEnvironment)))
  assert.throws(() => assertRuntimeConfig(getConfig({ ...validEnvironment, NODE_ENV: 'production', MONGODB_URI: '' })), /MONGODB_URI/)
  assert.throws(() => assertRuntimeConfig(getConfig({ ...validEnvironment, COOKIE_SAME_SITE: 'none', COOKIE_SECURE: 'false' })), /COOKIE_SECURE/)
  assert.throws(() => assertRuntimeConfig(getConfig({ ...validEnvironment, RATE_LIMIT_MAX: '0' })), /Rate-limit/)
  await mongoose.connect(mongoUri)
  await mongoose.connection.dropDatabase()
  await Promise.all([User.init(), Product.init(), Category.init(), Cart.init(), Wishlist.init(), Order.init(), ContactMessage.init()])
  await Category.create([{ name: 'Girls', slug: 'girls' }, { name: 'Boys', slug: 'boys' }, { name: 'Baby', slug: 'baby' }])
  const product = await Product.create({
    legacyId: 'g1', slug: 'g1', name: 'Floral Dream Frock', description: 'A soft play-ready frock.', category: 'Girls', subcategory: 'Dresses',
    sizes: ['4-5Y', '5-6Y'], ageRange: ['2–5'], colors: ['Rose'], occasion: ['Birthday'], price: 999, originalPrice: 1199, discount: 17,
    images: ['/assets/products/girl-01.jpg'], material: 'Cotton', rating: 4.8, reviews: 20, featured: true, newArrival: true, stock: 4,
    variants: [{ size: '4-5Y', color: 'Rose', stock: 3 }, { size: '5-6Y', color: 'Rose', stock: 1 }], tags: ['soft'],
  })
  const admin = await User.create({ name: 'Test Admin', email: 'admin@example.test', passwordHash: await bcrypt.hash('Admin-test-password-123', 10), role: 'admin' })
  const app = createApp({ config })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  let guestCookie = ''; let userCookie = ''; let adminCookie = ''; let secondUserCookie = ''; let customerOrderId = ''
  const uploadedFiles = new Set()
  const request = async (path, { method = 'GET', body, cookie = '', headers = {} } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    const setCookies = response.headers.getSetCookie?.() || []
    for (const value of setCookies) {
      const pair = value.split(';', 1)[0]
      if (pair.startsWith('ls_guest=')) guestCookie = pair
      if (pair.startsWith('ls_session=')) {
        if (cookie.includes('admin@example.test')) adminCookie = pair
      }
    }
    return { status: response.status, headers: response.headers, body: await response.json() }
  }
  const uploadRequest = async (path, { files = [], cookie = '' } = {}) => {
    const form = new FormData()
    files.forEach((file) => form.append('images', new Blob([file.bytes], { type: file.type }), file.name))
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: cookie ? { Cookie: cookie } : {}, body: form })
    return { status: response.status, headers: response.headers, body: await response.json() }
  }
  const captureSession = async (path, body, initialCookie = guestCookie) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(initialCookie ? { Cookie: initialCookie } : {}) }, body: JSON.stringify(body) })
    const setCookies = response.headers.getSetCookie?.() || []
    const cookie = setCookies.map((value) => value.split(';', 1)[0]).find((value) => value.startsWith('ls_session=')) || ''
    const payload = await response.json()
    return { status: response.status, body: payload, cookie, setCookies }
  }
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    await Promise.all([...uploadedFiles].map((filename) => unlink(new URL(`../uploads/${filename}`, import.meta.url)).catch(() => {})))
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  })

  await t.test('health, catalog queries, legacy ID, categories, and protected access', async () => {
    const health = await request('/health'); assert.equal(health.status, 200); assert.equal(health.body.data.database, 'connected')
    const list = await request('/products?category=Girls&age=2-5&sort=price-asc&limit=1'); assert.equal(list.status, 200); assert.equal(list.body.data.items[0].id, 'g1'); assert.equal(list.body.data.pagination.total, 1)
    const detail = await request('/products/g1'); assert.equal(detail.body.data.product.name, 'Floral Dream Frock')
    assert.equal((await request(`/products/${product._id}`)).body.data.product.id, 'g1')
    assert.equal((await request('/products/not-a-product')).status, 404)
    assert.equal((await request('/products/search?search=floral')).body.data.items.length, 1)
    assert.equal((await request('/products/featured')).body.data.items.length, 1)
    assert.equal((await request('/products/new-arrivals')).body.data.items.length, 1)
    assert.equal((await request('/products/category/girls')).body.data.items.length, 1)
    assert.equal((await request('/categories')).body.data.items.length, 3)
    assert.equal((await request('/admin/dashboard')).status, 401)
  })

  await t.test('guest cart and wishlist enforce variants, quantities, and uniqueness', async () => {
    const initial = await request('/cart'); assert.equal(initial.status, 200); assert.match(guestCookie, /^ls_guest=/)
    const add = await request('/cart', { method: 'POST', cookie: guestCookie, body: { productId: 'g1', size: '4-5Y', color: 'Rose', quantity: 2 } }); assert.equal(add.status, 201); assert.equal(add.body.data.subtotal, 1998); const lineId = add.body.data.items[0].itemId
    assert.equal((await request('/cart', { method: 'POST', cookie: guestCookie, body: { productId: 'g1', size: 'wrong', color: 'Rose', quantity: 1 } })).status, 400)
    assert.equal((await request('/cart', { method: 'POST', cookie: guestCookie, body: { productId: 'missing', size: '4-5Y', color: 'Rose', quantity: 1 } })).status, 404)
    assert.equal((await request('/cart', { method: 'POST', cookie: guestCookie, body: { productId: 'g1', size: '4-5Y', color: 'Rose', quantity: 21 } })).status, 400)
    assert.equal((await request('/cart', { method: 'POST', cookie: guestCookie, body: { productId: 'g1', size: '4-5Y', color: 'Rose', quantity: 2 } })).status, 409)
    assert.equal((await request(`/cart/${lineId}`, { method: 'PUT', cookie: guestCookie, body: { quantity: 4 } })).status, 409)
    assert.equal((await request(`/cart/${lineId}`, { method: 'PUT', cookie: guestCookie, body: { quantity: '2' } })).status, 400)
    assert.equal((await request(`/cart/${lineId}`, { method: 'PUT', cookie: guestCookie, body: { quantity: 1 } })).status, 200)
    assert.equal((await request(`/cart/${lineId}`, { method: 'PUT', cookie: guestCookie, body: { quantity: 2 } })).status, 200)
    assert.equal((await request(`/cart/${lineId}`, { method: 'DELETE', cookie: guestCookie })).body.data.items.length, 0)
    assert.equal((await request('/cart', { method: 'POST', cookie: guestCookie, body: { productId: 'g1', size: '4-5Y', color: 'Rose', quantity: 2 } })).status, 201)
    const saved = await request('/wishlist/g1', { method: 'POST', cookie: guestCookie }); assert.equal(saved.status, 200); assert.deepEqual(saved.body.data.ids, ['g1'])
    const savedAgain = await request('/wishlist/g1', { method: 'POST', cookie: guestCookie }); assert.equal(savedAgain.body.data.ids.length, 1)
    assert.equal((await request('/wishlist/g1', { method: 'DELETE', cookie: guestCookie })).body.data.ids.length, 0)
    assert.equal((await request('/wishlist/g1', { method: 'POST', cookie: guestCookie })).body.data.ids.length, 1)
    assert.equal((await request('/wishlist/not-a-product', { method: 'POST', cookie: guestCookie })).status, 404)
  })

  await t.test('registration/login hashes passwords and merges guest cart', async () => {
    assert.equal((await captureSession('/auth/register', { name: '   ', email: 'bad', password: 'short' })).status, 400)
    assert.equal((await captureSession('/auth/register', { name: { value: 'Name' }, email: 'typed@example.test', password: 'Valid-password-123' })).status, 400)
    assert.equal((await captureSession('/auth/register', { name: 'A'.repeat(121), email: 'long@example.test', password: 'Valid-password-123' })).status, 400)
    const guestAdd = await request('/cart', { method: 'POST', cookie: guestCookie, body: { productId: 'g1', size: '4-5Y', color: 'Rose', quantity: 1 } }); assert.equal(guestAdd.status, 201)
    const registered = await captureSession('/auth/register', { name: 'Aarav Sharma', email: 'aarav@example.test', password: 'Customer-password-123', role: 'admin' })
    assert.equal(registered.status, 201); assert.ok(registered.cookie); userCookie = `${guestCookie}; ${registered.cookie}`
    const user = await User.findOne({ email: 'aarav@example.test' }).select('+passwordHash'); assert.notEqual(user.passwordHash, 'Customer-password-123'); assert.equal(user.role, 'customer')
    assert.equal(registered.body.data.user.role, 'customer')
    assert.equal('passwordHash' in registered.body.data.user, false)
    assert.equal(registered.setCookies.find((cookie) => cookie.startsWith('ls_session=')).includes('HttpOnly'), true)
    assert.equal(registered.setCookies.find((cookie) => cookie.startsWith('ls_session=')).includes('SameSite=Lax'), true)
    assert.equal((await request('/admin/dashboard', { cookie: userCookie })).status, 403)
    const me = await request('/auth/me', { cookie: userCookie }); assert.equal(me.body.data.user.email, 'aarav@example.test')
    assert.equal((await request('/auth/addresses', { cookie: userCookie })).body.data.addresses.length, 0)
    assert.equal((await request('/auth/addresses', { method: 'POST', cookie: userCookie, body: { fullName: 'Aarav Sharma', line1: '12 Little Street', city: 'Darbhanga', postalCode: 'bad' } })).status, 400)
    const addressResponse = await request('/auth/addresses', { method: 'POST', cookie: userCookie, body: { fullName: 'Aarav Sharma', phone: '+91 98765 43210', line1: '12 Little Street', city: 'Darbhanga', postalCode: '846001' } })
    assert.equal(addressResponse.status, 201, JSON.stringify(addressResponse.body)); assert.equal(addressResponse.body.data.addresses.length, 1)
    assert.equal((await request('/auth/addresses/not-an-id', { method: 'DELETE', cookie: userCookie })).status, 404)
    assert.equal((await request('/auth/addresses/' + addressResponse.body.data.addresses[0]._id, { method: 'DELETE', cookie: userCookie })).body.data.addresses.length, 0)
    assert.equal((await request('/auth/me', { method: 'PUT', cookie: userCookie, body: { name: 'Aarav S', phone: 9876543210 } })).status, 400)
    assert.equal((await request('/auth/me', { method: 'PUT', cookie: userCookie, body: { name: 'A', phone: '+91 98765 43210' } })).status, 400)
    assert.equal((await request('/auth/me', { method: 'PUT', cookie: userCookie, body: { name: 'Aarav S', phone: '+91 98765 43210' } })).body.data.user.phone, '+91 98765 43210')
    assert.equal((await request('/orders', { headers: { Authorization: 'Bearer invalid.token.value' } })).status, 401)
    const merged = await request('/cart', { cookie: userCookie }); assert.equal(merged.body.data.items.length, 1); assert.equal(merged.body.data.items[0].quantity, 3)
    assert.deepEqual((await request('/wishlist', { cookie: userCookie })).body.data.ids, ['g1'])
    assert.equal((await captureSession('/auth/register', { name: 'Aarav Sharma', email: 'aarav@example.test', password: 'Customer-password-123' })).status, 409)
    assert.equal((await request('/auth/login', { method: 'POST', body: { email: 'aarav@example.test', password: 'incorrect' } })).status, 401)
  })

  await t.test('COD order uses server totals, is idempotent, and cancellation restores stock', async () => {
    const before = await Product.findById(product._id).lean()
    const response = await request('/orders', { method: 'POST', cookie: userCookie, headers: { 'Idempotency-Key': 'order-test-key-0001-long' }, body: { name: 'Aarav Sharma', email: 'aarav@example.test', phone: '+91 98765 43210', paymentMethod: 'cod', price: 1, subtotal: 1, discount: 100000, shipping: 0, total: 1, address: { fullName: 'Aarav Sharma', line1: '12 Little Street', city: 'Darbhanga', postalCode: '846001' } } })
    assert.equal(response.status, 201); const order = response.body.data.order; assert.equal(order.subtotal, 2997); assert.equal(order.shipping, 0); assert.equal(order.total, 2997); assert.equal(order.paymentStatus, 'pending')
    customerOrderId = order._id
    assert.equal((await request(`/orders/${order._id}`, { cookie: userCookie })).body.data.order.total, 2997)
    const replay = await request('/orders', { method: 'POST', cookie: userCookie, headers: { 'Idempotency-Key': 'order-test-key-0001-long' }, body: {} }); assert.equal(replay.body.data.reused, true); assert.equal(replay.body.data.order._id, order._id)
    const history = await request('/orders', { cookie: userCookie }); assert.equal(history.body.data.items[0].orderNumber, order.orderNumber)
    assert.equal((await request('/orders', { method: 'POST', cookie: userCookie, headers: { 'Idempotency-Key': 'order-test-online-0001-long' }, body: { paymentMethod: 'online' } })).status, 422)
    const cancelled = await request(`/orders/${order._id}/cancel`, { method: 'PUT', cookie: userCookie }); assert.equal(cancelled.status, 200); assert.equal(cancelled.body.data.order.orderStatus, 'cancelled')
    const after = await Product.findById(product._id).lean(); assert.equal(after.stock, before.stock)
    assert.equal((await request('/cart', { method: 'DELETE', cookie: userCookie })).status, 200)
    assert.equal((await request('/orders', { method: 'POST', cookie: userCookie, headers: { 'Idempotency-Key': 'order-empty-cart-key-0001' }, body: { name: 'Aarav Sharma', email: 'aarav@example.test', phone: '+91 98765 43210', address: { fullName: 'Aarav Sharma', line1: '12 Little Street', city: 'Darbhanga', postalCode: '846001' } } })).status, 400)
  })

  await t.test('admin product/order/customer APIs and contact validation work', async () => {
    const logged = await captureSession('/auth/login', { email: admin.email, password: 'Admin-test-password-123' })
    assert.equal(logged.status, 200); adminCookie = logged.cookie
    assert.equal((await request('/admin/dashboard', { cookie: adminCookie })).status, 200)
    assert.equal((await request('/orders', { cookie: adminCookie })).status, 403)
    assert.equal((await request('/auth/addresses', { cookie: adminCookie })).status, 403)
    assert.equal((await request('/auth/me', { method: 'PUT', cookie: adminCookie, body: { name: 'Test Admin', phone: '+91 98765 40000' } })).status, 200)
    const created = await request('/products', { method: 'POST', cookie: adminCookie, body: { name: 'Sunny Day Dress', category: 'Girls', price: 1200, stock: 5 } }); assert.equal(created.status, 201); const newId = created.body.data.product.id
    assert.equal((await request(`/products/${newId}`, { method: 'PUT', cookie: adminCookie, body: { name: 'Sunny Day Dress Updated', price: 1250 } })).body.data.product.price, 1250)
    assert.equal((await request(`/products/${newId}`, { method: 'PATCH', cookie: adminCookie, body: { price: 1100 } })).body.data.product.price, 1100)
    assert.equal((await request(`/products/${newId}`, { method: 'PATCH', cookie: adminCookie, body: { price: 'not-a-number' } })).status, 400)
    assert.equal((await request('/admin/products?search=Sunny', { cookie: adminCookie })).body.data.items.length, 1)
    assert.equal((await request('/admin/customers', { cookie: adminCookie })).body.data.items.length, 1)
    assert.equal((await request('/admin/products?category=Girls', { cookie: adminCookie })).body.data.items.every((item) => item.category === 'Girls'), true)
    assert.equal((await request('/admin/orders', { cookie: adminCookie })).status, 200)
    assert.equal((await request('/admin/products?active=yes', { cookie: adminCookie })).status, 400)
    assert.equal((await request('/admin/orders?status=unknown', { cookie: adminCookie })).status, 400)
    assert.equal((await request('/cart', { method: 'POST', cookie: userCookie, body: { productId: newId, size: '3-4Y', color: 'Navy', quantity: 1 } })).status, 201)
    assert.equal((await request(`/wishlist/${newId}`, { method: 'POST', cookie: userCookie })).status, 200)
    assert.equal((await request(`/products/${newId}`, { method: 'PATCH', cookie: adminCookie, body: { isActive: false } })).status, 200)
    assert.equal((await request('/cart', { cookie: userCookie })).body.data.items.length, 0)
    assert.equal((await request('/wishlist', { cookie: userCookie })).body.data.ids.includes(newId), false)
    const closedOrder = await Order.findOne({ orderStatus: 'cancelled' })
    assert.equal((await request(`/admin/orders/${closedOrder._id}/status`, { method: 'PUT', cookie: adminCookie, body: { status: 'processing' } })).status, 409)
    assert.equal((await request('/products', { method: 'POST', cookie: userCookie, body: { name: 'Forbidden', category: 'Girls', price: 20 } })).status, 403)
    assert.equal((await request('/contact', { method: 'POST', body: { name: 'X', email: 'x', phone: '1', message: 'bad' } })).status, 400)
    const contact = await request('/contact', { method: 'POST', body: { name: 'Parent Name', email: 'parent@example.test', phone: '+91 98765 43210', message: 'Please help me with a size.' } })
    assert.equal(contact.status, 201)
    assert.equal((await request('/admin/contact-messages', { cookie: adminCookie })).body.data.items.length, 1)
    assert.equal((await request(`/admin/contact-messages/${contact.body.data.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'read' } })).body.data.message.status, 'read')
    assert.equal((await request(`/admin/contact-messages/${contact.body.data.id}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'invalid' } })).status, 400)
    assert.equal((await request('/admin/contact-messages?status=invalid', { cookie: adminCookie })).status, 400)
    assert.equal((await request('/products/bestsellers')).body.data.items.length, 1)
    assert.equal((await request(`/products/${newId}`, { method: 'DELETE', cookie: adminCookie })).status, 200)
    assert.equal((await request(`/products/${newId}`)).status, 404)
  })

  await t.test('admin can upload multiple validated images and only remove unlinked uploads', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64')
    assert.equal((await uploadRequest('/admin/uploads', { files: [{ name: 'first.png', type: 'image/png', bytes: png }] })).status, 401)
    const badSignature = await uploadRequest('/admin/uploads', { cookie: adminCookie, files: [{ name: 'not-an-image.png', type: 'image/png', bytes: Buffer.from('not an image') }] })
    assert.equal(badSignature.status, 400)
    const uploaded = await uploadRequest('/admin/uploads', { cookie: adminCookie, files: [
      { name: 'front.png', type: 'image/png', bytes: png },
      { name: 'back.png', type: 'image/png', bytes: png },
    ] })
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body))
    const images = uploaded.body.data.images
    assert.equal(images.length, 2)
    assert.notEqual(images[0], images[1])
    images.forEach((image) => uploadedFiles.add(image.split('/').pop()))
    const served = await fetch(`http://127.0.0.1:${server.address().port}${images[0]}`)
    assert.equal(served.status, 200)
    assert.match(served.headers.get('content-type'), /^image\/png/)
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), png)

    const linked = await request('/products/g1', { method: 'PATCH', cookie: adminCookie, body: { images: [images[0]] } })
    assert.equal(linked.status, 200)
    const firstCleanup = await request('/admin/uploads', { method: 'DELETE', cookie: adminCookie, body: { images } })
    assert.equal(firstCleanup.body.data.removed, 1)
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${images[0]}`)).status, 200)
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${images[1]}`)).status, 404)

    assert.equal((await request('/products/g1', { method: 'PATCH', cookie: adminCookie, body: { images: ['/assets/products/girl-01.jpg'] } })).status, 200)
    const finalCleanup = await request('/admin/uploads', { method: 'DELETE', cookie: adminCookie, body: { images: [images[0]] } })
    assert.equal(finalCleanup.body.data.removed, 1)
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${images[0]}`)).status, 404)
  })

  await t.test('dynamic categories support product creation and category filtering', async () => {
    assert.equal((await request('/categories', { method: 'POST', cookie: adminCookie, body: { name: 'Girls' } })).status, 409)
    const categoryResponse = await request('/categories', { method: 'POST', cookie: adminCookie, body: { name: 'Party Wear', description: 'Special occasion outfits', sortOrder: 4 } })
    assert.equal(categoryResponse.status, 201)
    const createdProduct = await request('/products', { method: 'POST', cookie: adminCookie, body: { name: 'Party Wear Set', category: 'Party Wear', price: 799, stock: 3, sizes: ['6-8Y'], colors: ['Teal'] } })
    assert.equal(createdProduct.status, 201)
    const productId = createdProduct.body.data.product.id
    assert.equal(createdProduct.body.data.product.category, 'Party Wear')
    assert.equal((await request('/admin/products?category=party-wear', { cookie: adminCookie })).body.data.items[0].id, productId)
    assert.equal((await request('/products/category/party-wear')).body.data.items[0].id, productId)

    const renamed = await request(`/categories/${categoryResponse.body.data._id}`, { method: 'PUT', cookie: adminCookie, body: { name: 'Celebration Wear' } })
    assert.equal(renamed.status, 200)
    assert.equal(renamed.body.data.slug, 'celebration-wear')
    assert.equal((await request(`/products/${productId}`)).body.data.product.category, 'Celebration Wear')
    assert.equal((await request('/products/category/celebration-wear')).body.data.items[0].id, productId)
    assert.equal((await request('/products?category=Celebration%20Wear')).body.data.items.some((item) => item.id === productId), true)
    assert.equal((await request('/cart', { method: 'POST', cookie: adminCookie, body: { productId, size: '6-8Y', color: 'Teal', quantity: 1 } })).status, 201)
    assert.equal((await request(`/wishlist/${productId}`, { method: 'POST', cookie: adminCookie })).status, 200)
    assert.equal((await request(`/categories/${renamed.body.data._id}`, { method: 'PUT', cookie: adminCookie, body: { isActive: 'false' } })).status, 400)
    assert.equal((await request(`/categories/${renamed.body.data._id}`, { method: 'PUT', cookie: adminCookie, body: { isActive: false } })).body.data.isActive, false)
    assert.equal((await request(`/products/${productId}`)).status, 404)
    assert.equal((await request('/products?category=Celebration%20Wear')).body.data.items.length, 0)
    assert.equal((await request('/cart', { cookie: adminCookie })).body.data.items.length, 0)
    assert.equal((await request('/wishlist', { cookie: adminCookie })).body.data.ids.length, 0)
    assert.equal((await request('/cart', { method: 'POST', cookie: adminCookie, body: { productId, size: '6-8Y', color: 'Teal', quantity: 1 } })).status, 404)
    assert.equal((await request(`/wishlist/${productId}`, { method: 'POST', cookie: adminCookie })).status, 404)
    const removable = await request('/categories', { method: 'POST', cookie: adminCookie, body: { name: 'Temporary Category' } })
    assert.equal(removable.status, 201)
    assert.equal((await request(`/categories/${removable.body.data._id}`, { method: 'DELETE', cookie: adminCookie })).body.data.category.isActive, false)
  })

  await t.test('product creation rejects malformed stock and boolean fields', async () => {
    const invalidStock = await request('/products', { method: 'POST', cookie: adminCookie, body: { name: 'Invalid Stock', category: 'Girls', price: 100, stock: -1 } })
    assert.equal(invalidStock.status, 400)
    const stringStock = await request('/products', { method: 'POST', cookie: adminCookie, body: { name: 'String Stock', category: 'Girls', price: 100, stock: '4' } })
    assert.equal(stringStock.status, 400)
    const stringBoolean = await request('/products', { method: 'POST', cookie: adminCookie, body: { name: 'String Featured', category: 'Girls', price: 100, featured: 'false' } })
    assert.equal(stringBoolean.status, 400)
    assert.equal((await request('/products', { method: 'POST', cookie: adminCookie, body: { name: 'String Price', category: 'Girls', price: '100' } })).status, 400)
    assert.equal((await request('/products', { method: 'POST', cookie: adminCookie, body: { name: 'Negative Price', category: 'Girls', price: -1 } })).status, 400)
    assert.equal((await request('/products', { method: 'POST', cookie: adminCookie, body: { name: 'Invalid Original Price', category: 'Girls', price: 200, originalPrice: 100 } })).status, 400)
    const unsafeImage = await request('/products', { method: 'POST', cookie: adminCookie, body: { name: 'Unsafe Image', category: 'Girls', price: 100, images: ['javascript:alert(1)'] } })
    assert.equal(unsafeImage.status, 400)
    const malformedVariant = await request('/products', { method: 'POST', cookie: adminCookie, body: { name: 'Malformed Variant', category: 'Girls', price: 100, sizes: ['4Y'], colors: ['Blue'], variants: [null] } })
    assert.equal(malformedVariant.status, 400)
    const duplicateVariants = await request('/products', { method: 'POST', cookie: adminCookie, body: { name: 'Duplicate Variants', category: 'Girls', price: 100, sizes: ['4Y'], colors: ['Blue'], variants: [{ size: '4Y', color: 'Blue', stock: 1 }, { size: '4Y', color: 'Blue', stock: 2 }] } })
    assert.equal(duplicateVariants.status, 400)
  })

  await t.test('concurrent cancellation restores stock once', async () => {
    const raceProduct = await Product.create({
      legacyId: 'race-product', slug: 'race-product', name: 'Race Condition Outfit', category: 'Girls', price: 500, originalPrice: 500,
      sizes: ['4-5Y'], colors: ['Blue'], stock: 2, variants: [{ size: '4-5Y', color: 'Blue', stock: 2 }],
    })
    await request('/cart', { method: 'POST', cookie: userCookie, body: { productId: raceProduct.id, size: '4-5Y', color: 'Blue', quantity: 1 } })
    const placed = await request('/orders', { method: 'POST', cookie: userCookie, headers: { 'Idempotency-Key': 'order-race-cancel-0001' }, body: { name: 'Aarav Sharma', email: 'aarav@example.test', phone: '+91 98765 43210', paymentMethod: 'cod', address: { fullName: 'Aarav Sharma', line1: '12 Little Street', city: 'Darbhanga', postalCode: '846001' } } })
    assert.equal(placed.status, 201)
    const orderId = placed.body.data.order._id
    const cancellations = await Promise.all([
      request(`/orders/${orderId}/cancel`, { method: 'PUT', cookie: userCookie }),
      request(`/orders/${orderId}/cancel`, { method: 'PUT', cookie: userCookie }),
    ])
    assert.deepEqual(cancellations.map((response) => response.status).sort(), [200, 409])
    assert.equal((await Product.findById(raceProduct._id)).stock, 2)
  })

  await t.test('search, filters, sorting, and pagination return correct product sets', async () => {
    const combined = await request('/products?category=Girls&age=2-5&size=4-5Y&color=Rose&occasion=Birthday&minPrice=900&maxPrice=1000')
    assert.equal(combined.status, 200)
    assert.deepEqual(combined.body.data.items.map((item) => item.id), ['g1'])
    assert.equal((await request('/products/search?search=FLORAL')).body.data.items[0].id, 'g1')
    assert.equal((await request('/products?search=.*')).body.data.items.length, 0)
    assert.equal((await request('/products?search=%E2%98%85')).body.data.items.length, 0)
    assert.equal((await request('/products?category=Unknown%20Category')).body.data.items.length, 0)
    assert.equal((await request('/products?age=2-5&age=5-8')).status, 400)
    assert.equal((await request('/products?limit=1&limit=2')).status, 400)
    assert.equal((await request('/products?minPrice=not-a-number')).status, 400)
    assert.equal((await request('/products?minPrice=1200&price=under-1000')).body.data.items.length, 0)
    const firstPage = await request('/products?category=Girls&sort=price-asc&page=1&limit=1')
    const secondPage = await request('/products?category=Girls&sort=price-asc&page=2&limit=1')
    assert.equal(firstPage.body.data.pagination.total, 2)
    assert.equal(firstPage.body.data.items[0].price, 500)
    assert.equal(secondPage.body.data.items[0].price, 999)
    assert.notEqual(firstPage.body.data.items[0].id, secondPage.body.data.items[0].id)
    assert.equal((await request('/products?category=Girls&sort=price-desc')).body.data.items[0].id, 'g1')
    assert.equal((await request('/products?category=Girls&sort=name-asc')).body.data.items[0].id, 'g1')
    assert.equal((await request('/products?category=Girls&sort=name-desc')).body.data.items[0].id, 'race-product')
    assert.equal((await request('/products?category=Girls&sort=oldest')).body.data.items[0].id, 'g1')
    assert.equal((await request('/products?category=Girls&sort=newest')).body.data.items[0].id, 'race-product')
    const bounded = await request('/products?page=0&limit=999999')
    assert.equal(bounded.body.data.pagination.page, 1)
    assert.equal(bounded.body.data.pagination.limit, 100)
    assert.equal((await request('/products?page=1000000&limit=1')).body.data.items.length, 0)
  })

  await t.test('customer sessions keep cart, wishlist, and order history private', async () => {
    const registered = await captureSession('/auth/register', { name: 'Mira Parent', email: 'mira@example.test', password: 'Another-password-123' })
    assert.equal(registered.status, 201)
    secondUserCookie = `${guestCookie}; ${registered.cookie}`
    assert.equal((await request('/orders', { cookie: secondUserCookie })).body.data.items.length, 0)
    assert.equal((await request(`/orders/${customerOrderId}`, { cookie: secondUserCookie })).status, 404)
    assert.deepEqual((await request('/wishlist', { cookie: secondUserCookie })).body.data.ids, [])
    await request('/cart', { method: 'DELETE', cookie: userCookie })
    await request('/cart', { method: 'POST', cookie: userCookie, body: { productId: 'g1', size: '4-5Y', color: 'Rose', quantity: 1 } })
    assert.equal((await request('/cart', { cookie: secondUserCookie })).body.data.items.length, 0)
    assert.deepEqual((await request('/wishlist', { cookie: secondUserCookie })).body.data.ids, [])
    assert.equal((await request('/admin/dashboard', { cookie: secondUserCookie })).status, 403)
    assert.equal((await request('/orders')).status, 401)
  })

  await t.test('concurrent first guest cart and wishlist writes are retried safely', async () => {
    const initialized = await request('/cart')
    const anonymousCookie = initialized.headers.getSetCookie().map((cookie) => cookie.split(';', 1)[0]).find((cookie) => cookie.startsWith('ls_guest='))
    assert.ok(anonymousCookie)
    const cartWrites = await Promise.all([
      request('/cart', { method: 'POST', cookie: anonymousCookie, body: { productId: 'g1', size: '4-5Y', color: 'Rose', quantity: 1 } }),
      request('/cart', { method: 'POST', cookie: anonymousCookie, body: { productId: 'g1', size: '4-5Y', color: 'Rose', quantity: 1 } }),
    ])
    assert.deepEqual(cartWrites.map((response) => response.status), [201, 201])
    assert.equal((await request('/cart', { cookie: anonymousCookie })).body.data.items[0].quantity, 2)
    const wishlistWrites = await Promise.all([
      request('/wishlist/g1', { method: 'POST', cookie: anonymousCookie }),
      request('/wishlist/g1', { method: 'POST', cookie: anonymousCookie }),
    ])
    assert.ok(wishlistWrites.every((response) => response.status === 200))
    assert.deepEqual((await request('/wishlist', { cookie: anonymousCookie })).body.data.ids, ['g1'])
  })

  await t.test('only one customer can purchase the last unit', async () => {
    await request('/cart', { method: 'DELETE', cookie: userCookie })
    const lastUnit = await Product.create({
      legacyId: 'last-unit-product', slug: 'last-unit-product', name: 'Last Unit Outfit', category: 'Girls', price: 600, originalPrice: 600,
      sizes: ['5-6Y'], colors: ['Green'], stock: 1, variants: [{ size: '5-6Y', color: 'Green', stock: 1 }],
    })
    for (const cookie of [userCookie, secondUserCookie]) {
      const added = await request('/cart', { method: 'POST', cookie, body: { productId: lastUnit.id, size: '5-6Y', color: 'Green', quantity: 1 } })
      assert.equal(added.status, 201)
    }
    const payload = { name: 'Parent Name', email: 'parent@example.test', phone: '+91 98765 43210', address: { fullName: 'Parent Name', line1: '1 Test Street', city: 'Darbhanga', postalCode: '846001' } }
    const results = await Promise.all([
      request('/orders', { method: 'POST', cookie: userCookie, headers: { 'Idempotency-Key': 'race-order-last-unit-user1' }, body: payload }),
      request('/orders', { method: 'POST', cookie: secondUserCookie, headers: { 'Idempotency-Key': 'race-order-last-unit-user2' }, body: payload }),
    ])
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409])
    const persisted = await Product.findById(lastUnit._id).lean()
    assert.equal(persisted.stock, 0)
    assert.equal(persisted.variants[0].stock, 0)
    assert.equal(await Order.countDocuments({ 'items.product': lastUnit._id }), 1)
  })

  await t.test('concurrent duplicate idempotency keys create one order and one stock decrement', async () => {
    await request('/cart', { method: 'DELETE', cookie: userCookie })
    const productForReplay = await Product.create({
      legacyId: 'replay-product', slug: 'replay-product', name: 'Replay Test Outfit', category: 'Girls', price: 800, originalPrice: 800,
      sizes: ['9-10Y'], colors: ['Pink'], stock: 3, variants: [{ size: '9-10Y', color: 'Pink', stock: 3 }],
    })
    assert.equal((await request('/cart', { method: 'POST', cookie: userCookie, body: { productId: productForReplay.id, size: '9-10Y', color: 'Pink', quantity: 1 } })).status, 201)
    const body = { name: 'Aarav Sharma', email: 'aarav@example.test', phone: '+91 98765 43210', address: { fullName: 'Aarav Sharma', line1: '12 Little Street', city: 'Darbhanga', postalCode: '846001' } }
    const attempts = await Promise.all([
      request('/orders', { method: 'POST', cookie: userCookie, headers: { 'Idempotency-Key': 'order-concurrent-replay-0001' }, body }),
      request('/orders', { method: 'POST', cookie: userCookie, headers: { 'Idempotency-Key': 'order-concurrent-replay-0001' }, body }),
    ])
    assert.deepEqual(attempts.map((result) => result.status).sort(), [200, 201])
    assert.equal(attempts.filter((result) => result.body.data.reused).length, 1)
    assert.equal(await Order.countDocuments({ 'items.product': productForReplay._id }), 1)
    assert.equal((await Product.findById(productForReplay._id)).stock, 2)
  })

  await t.test('admin order statuses follow the allowed progression', async () => {
    const productForStatus = await Product.create({
      legacyId: 'status-product', slug: 'status-product', name: 'Status Test Outfit', category: 'Girls', price: 700, originalPrice: 700,
      sizes: ['7-8Y'], colors: ['Yellow'], stock: 2, variants: [{ size: '7-8Y', color: 'Yellow', stock: 2 }],
    })
    await request('/cart', { method: 'DELETE', cookie: userCookie })
    await request('/cart', { method: 'POST', cookie: userCookie, body: { productId: productForStatus.id, size: '7-8Y', color: 'Yellow', quantity: 1 } })
    const placed = await request('/orders', { method: 'POST', cookie: userCookie, headers: { 'Idempotency-Key': 'order-status-test-0001' }, body: { name: 'Aarav Sharma', email: 'aarav@example.test', phone: '+91 98765 43210', address: { fullName: 'Aarav Sharma', line1: '12 Little Street', city: 'Darbhanga', postalCode: '846001' } } })
    assert.equal(placed.status, 201)
    const id = placed.body.data.order._id
    assert.equal((await request(`/admin/orders/${id}/status`, { method: 'PUT', cookie: adminCookie, body: { status: 'shipped' } })).status, 409)
    assert.equal((await request(`/admin/orders/${id}/status`, { method: 'PUT', cookie: adminCookie, body: { status: 'processing' } })).body.data.order.orderStatus, 'processing')
    assert.equal((await request(`/admin/orders/${id}/status`, { method: 'PUT', cookie: adminCookie, body: { status: 'confirmed' } })).status, 409)
    assert.equal((await request(`/admin/orders/${id}/status`, { method: 'PUT', cookie: adminCookie, body: { status: 'shipped' } })).body.data.order.orderStatus, 'shipped')
    assert.equal((await request(`/admin/orders/${id}/status`, { method: 'PUT', cookie: adminCookie, body: { status: 'processing' } })).status, 409)
    assert.equal((await request(`/admin/orders/${id}/status`, { method: 'PUT', cookie: adminCookie, body: { status: 'delivered' } })).body.data.order.orderStatus, 'delivered')
    assert.equal((await request(`/admin/orders/${id}/status`, { method: 'PUT', cookie: adminCookie, body: { status: 'delivered' } })).status, 200)
    assert.equal((await request(`/admin/orders/${id}/status`, { method: 'PUT', cookie: userCookie, body: { status: 'cancelled' } })).status, 403)
    assert.equal((await request(`/orders/${id}/cancel`, { method: 'PUT', cookie: userCookie })).status, 409)
  })

  await t.test('CORS, malformed JSON, unknown routes, and incorrect methods are handled safely', async () => {
    const allowed = await request('/health', { headers: { Origin: 'http://127.0.0.1:5173' } })
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173')
    assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true')
    const preflight = await fetch(`${base}/auth/login`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } })
    assert.equal(preflight.status, 204)
    const denied = await request('/health', { headers: { Origin: 'https://untrusted.example' } })
    assert.equal(denied.status, 403)
    assert.equal(denied.body.success, false)
    const malformed = await fetch(`${base}/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":' })
    assert.equal(malformed.status, 400)
    const malformedBody = await malformed.json()
    assert.equal(malformedBody.success, false)
    assert.equal('stack' in malformedBody, false)
    assert.equal((await request('/not-a-route')).status, 404)
    assert.equal((await request('/health', { method: 'POST' })).status, 404)
    assert.equal((await request('/products', { method: 'POST' })).status, 401)
  })

  await t.test('login and registration rate limits return 429', async (t) => {
    const limitedApp = createApp({ config: { ...config, rateLimitMax: 1000 } })
    const limitedServer = limitedApp.listen(0, '127.0.0.1')
    await new Promise((resolve) => limitedServer.once('listening', resolve))
    t.after(async () => new Promise((resolve) => limitedServer.close(resolve)))
    const limitedBase = `http://127.0.0.1:${limitedServer.address().port}/api`
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await fetch(`${limitedBase}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bad', password: '' }) })
      assert.equal(response.status, 400)
    }
    const limited = await fetch(`${limitedBase}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bad', password: '' }) })
    assert.equal(limited.status, 429)
    assert.equal((await limited.json()).error.code, 'AUTH_RATE_LIMITED')
  })

  await t.test('logout clears the session cookie and signed-out requests are unauthorized', async () => {
    const loggedOut = await request('/auth/logout', { method: 'POST', cookie: userCookie })
    assert.equal(loggedOut.status, 200)
    assert.equal(loggedOut.body.data.loggedOut, true)
    assert.equal(loggedOut.headers.getSetCookie().some((cookie) => cookie.startsWith('ls_session=;')), true)
    assert.equal((await request('/orders')).status, 401)
  })
})
