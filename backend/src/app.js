import crypto from 'node:crypto'
import express from 'express'
import multer from 'multer'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rateLimit } from 'express-rate-limit'
import mongoose from 'mongoose'
import Razorpay from 'razorpay'
import { getConfig } from './config.js'
import { User, Product, Category, Cart, Wishlist, Order, ContactMessage } from './models.js'

const guestCookieName = 'ls_guest'
const authCookieName = 'ls_session'
const adminCookieName = 'ls_admin_session'
const uploadDirectory = fileURLToPath(new URL('../uploads/', import.meta.url))
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 30, fileSize: 5 * 1024 * 1024, parts: 30 },
  fileFilter(_req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return callback(fail(400, 'Choose JPEG, PNG, or WebP images.', 'INVALID_UPLOAD'))
    callback(null, true)
  },
})
const orderTransitions = {
  confirmed: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
}
const slugify = (value) => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const asProduct = (product) => {
  if (!product) return null
  const value = typeof product.toJSON === 'function' ? product.toJSON() : product
  return { ...value, id: value.legacyId || value._id?.toString() || value.id }
}
const asOrder = (order) => {
  if (!order) return null
  const value = typeof order.toJSON === 'function' ? order.toJSON() : { ...order }
  delete value.idempotencyKey
  delete value.user
  delete value.guestId
  delete value.__v
  return value
}
const envelope = (res, data, status = 200) => res.status(status).json({ success: true, data })
const fail = (status, message, code = 'REQUEST_ERROR') => Object.assign(new Error(message), { status, code })
const cleanText = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : ''
function requestText(value, label, { min = 0, max = 200, required = false } = {}) {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string' || value.length > max) throw fail(400, `${label} must be a string of up to ${max} characters.`, 'INVALID_INPUT')
  const text = value.trim()
  if (text.length < min) throw fail(400, `${label} must contain at least ${min} characters.`, 'INVALID_INPUT')
  return text
}
function queryText(query, key, max = 200) {
  const value = query[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > max) throw fail(400, `Query parameter ${key} must be a string of up to ${max} characters.`, 'INVALID_QUERY')
  return value.trim()
}
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

function imageExtension(buffer, mimeType) {
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const isWebp = buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  if (isJpeg && mimeType === 'image/jpeg') return 'jpg'
  if (isPng && mimeType === 'image/png') return 'png'
  if (isWebp && mimeType === 'image/webp') return 'webp'
  return ''
}

function setAuthCookie(req, res, token, config, role = null) {
  const isRoleAdmin = role === 'admin' || req.get('X-App-Role') === 'admin'
  const cookieName = isRoleAdmin ? adminCookieName : authCookieName
  res.cookie(cookieName, token, { httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 })
}
function setGuestCookie(res, id, config) {
  res.cookie(guestCookieName, id, { httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite, path: '/', maxAge: 365 * 24 * 60 * 60 * 1000 })
}
function getGuest(req, res, config) {
  let guestId = req.cookies?.[guestCookieName]
  if (!guestId || !/^[a-f0-9-]{36}$/i.test(guestId)) {
    guestId = crypto.randomUUID()
    setGuestCookie(res, guestId, config)
  }
  return guestId
}
function tokenFromRequest(req) {
  const roleHeader = req.get('X-App-Role')
  if (roleHeader === 'admin' && req.cookies?.[adminCookieName]) return req.cookies[adminCookieName]
  if (roleHeader === 'customer' && req.cookies?.[authCookieName]) return req.cookies[authCookieName]
  if (req.cookies?.[adminCookieName] && (req.path?.startsWith('/admin') || !req.cookies?.[authCookieName])) return req.cookies[adminCookieName]
  if (req.cookies?.[authCookieName]) return req.cookies[authCookieName]
  if (req.cookies?.[adminCookieName]) return req.cookies[adminCookieName]
  const header = req.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}
async function resolveAuth(req, config) {
  const token = tokenFromRequest(req)
  if (!token) return null
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { issuer: 'little-star-kids-wear', audience: 'little-star-client' })
    const user = await User.findById(decoded.sub).select('+passwordHash')
    if (!user || !user.isActive) return null
    return user
  } catch { return null }
}
function auth(config, required = true, admin = false, customerOnly = false) {
  return async (req, _res, next) => {
    try {
      req.user = await resolveAuth(req, config)
      if (required && !req.user) throw fail(401, 'Please sign in to continue.', 'AUTH_REQUIRED')
      if (admin && req.user?.role !== 'admin') throw fail(403, 'Administrator access is required.', 'ADMIN_REQUIRED')
      if (customerOnly && req.user && req.user.role !== 'customer') throw fail(403, 'Customer access is required.', 'CUSTOMER_REQUIRED')
      next()
    } catch (error) { next(error) }
  }
}
function ownerQuery(req, guestId) { return req.user ? { user: req.user._id } : { guestId } }
function validateAddress(body, { requirePhone = false } = {}) {
  const address = {
    fullName: requestText(body.fullName, 'Full name', { min: 2, max: 120, required: true }),
    line1: requestText(body.line1 || body.address, 'Street address', { min: 4, max: 180, required: true }),
    line2: requestText(body.line2, 'Address line 2', { max: 180 }),
    city: requestText(body.city, 'City', { min: 2, max: 80, required: true }),
    state: requestText(body.state, 'State', { max: 80 }),
    postalCode: requestText(body.postalCode || body.pinCode, 'PIN code', { max: 6, required: true }),
    country: requestText(body.country === undefined ? 'India' : body.country, 'Country', { max: 60 }),
    landmark: requestText(body.landmark, 'Landmark', { max: 120 }),
  }
  const phone = requestText(body.phone, 'Phone number', { max: 20 })
  if (address.fullName.length < 2 || address.line1.length < 4 || address.city.length < 2 || !/^\d{6}$/.test(address.postalCode) || (requirePhone && !/^[+\d()\s-]{8,20}$/.test(phone))) {
    throw fail(400, 'Enter a full name, street address, city, valid six-digit PIN code, and valid phone number.', 'INVALID_ADDRESS')
  }
  return requirePhone ? { ...address, phone } : address
}
function variantFor(product, size, color) {
  return product.variants.find((variant) => variant.size === size && variant.color === color)
}
async function resolveCategory(value) {
  if (typeof value !== 'string' || value.length > 80) throw fail(400, 'Category must be a string of up to 80 characters.', 'INVALID_CATEGORY')
  const name = value.trim()
  if (!name) return null
  return Category.findOne({ isActive: true, $or: [{ slug: slugify(name) }, { name: new RegExp(`^${escapeRegex(name)}$`, 'i') }] })
}
async function activeProductFilter(extra = {}) {
  const activeCategories = await Category.find({ isActive: true }).distinct('name')
  return { isActive: true, category: { $in: activeCategories }, ...extra }
}
async function productFilter(query) {
  const filter = await activeProductFilter()
  if (query.category !== undefined) {
    const category = await resolveCategory(queryText(query, 'category', 80))
    filter.category = category?.name || '__no_active_category__'
  }
  const age = queryText(query, 'age', 20)
  const size = queryText(query, 'size', 20)
  const color = queryText(query, 'color', 40)
  const occasion = queryText(query, 'occasion', 60)
  const priceBand = queryText(query, 'price', 20)
  queryText(query, 'sort', 32)
  if (age) filter.ageRange = age.replace('-', '–')
  if (size) filter.sizes = size
  if (color) filter.colors = color
  if (occasion) filter.occasion = new RegExp(`^${escapeRegex(occasion)}$`, 'i')
  const minRaw = queryText(query, 'minPrice', 32)
  const maxRaw = queryText(query, 'maxPrice', 32)
  const minPrice = minRaw === undefined ? undefined : Number(minRaw)
  const maxPrice = maxRaw === undefined ? undefined : Number(maxRaw)
  if ((minPrice !== undefined && (!minRaw || !Number.isFinite(minPrice) || minPrice < 0)) || (maxPrice !== undefined && (!maxRaw || !Number.isFinite(maxPrice) || maxPrice < 0)) || (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice)) throw fail(400, 'Enter a valid minimum and maximum price range.', 'INVALID_QUERY')
  const priceConditions = []
  if (minPrice !== undefined) priceConditions.push({ price: { $gte: minPrice } })
  if (maxPrice !== undefined) priceConditions.push({ price: { $lte: maxPrice } })
  if (priceBand) {
    const bands = { 'under-1000': { $lt: 1000 }, '1000-1500': { $gte: 1000, $lte: 1500 }, 'over-1500': { $gt: 1500 } }
    if (!bands[priceBand]) throw fail(400, 'Unsupported price range.', 'INVALID_QUERY')
    priceConditions.push({ price: bands[priceBand] })
  }
  if (priceConditions.length === 1) filter.price = priceConditions[0].price
  else if (priceConditions.length > 1) filter.$and = [...(filter.$and || []), ...priceConditions]
  const rawSearch = query.search === undefined ? queryText(query, 'q', 100) : queryText(query, 'search', 100)
  const search = rawSearch || ''
  if (search) {
    const escaped = escapeRegex(search)
    filter.$or = [{ name: new RegExp(escaped, 'i') }, { description: new RegExp(escaped, 'i') }, { tags: new RegExp(escaped, 'i') }, { category: new RegExp(escaped, 'i') }]
  }
  return filter
}
function pagination(query) {
  const parse = (key, fallback, maximum) => {
    const value = queryText(query, key, 32)
    if (value === undefined) return fallback
    if (!/^-?\d+$/.test(value)) throw fail(400, `Query parameter ${key} must be an integer.`, 'INVALID_QUERY')
    return Math.max(1, Math.min(maximum, Number(value) || 1))
  }
  const page = parse('page', 1, 100000)
  const limit = parse('limit', 24, 100)
  return { page, limit, skip: (page - 1) * limit }
}
function sortFor(value) {
  if (value === 'price-asc') return { price: 1, _id: 1 }
  if (value === 'price-desc') return { price: -1, _id: -1 }
  if (value === 'rating') return { rating: -1, reviews: -1 }
  if (value === 'newest') return { createdAt: -1, _id: -1 }
  if (value === 'oldest') return { createdAt: 1, _id: 1 }
  if (value === 'name-asc') return { name: 1, _id: 1 }
  if (value === 'name-desc') return { name: -1, _id: -1 }
  return { featured: -1, createdAt: -1, _id: -1 }
}

async function populatedCart(query, guestId) {
  let cart = await Cart.findOne(query).populate('items.product')
  if (!cart) return { items: [], subtotal: 0, discount: 0, shipping: 0, total: 0 }
  const activeCategories = new Set(await Category.find({ isActive: true }).distinct('name'))
  const items = cart.items.filter((line) => line.product?.isActive && activeCategories.has(line.product.category)).map((line) => {
    const product = asProduct(line.product)
    const variant = variantFor(line.product, line.size, line.color)
    return { itemId: line._id.toString(), id: product.id, productId: product.id, size: line.size, color: line.color, quantity: line.quantity, stock: variant?.stock ?? 0, product }
  })
  const subtotal = items.reduce((sum, line) => sum + line.product.price * line.quantity, 0)
  const discount = items.reduce((sum, line) => sum + Math.max(0, line.product.originalPrice - line.product.price) * line.quantity, 0)
  const shipping = subtotal === 0 || subtotal >= 1499 ? 0 : 99
  return { items, subtotal, discount, shipping, total: subtotal + shipping }
}
async function addCartItem(query, product, size, color, quantity, availableStock) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let cart = await Cart.findOne(query)
    if (!cart) cart = new Cart(query)
    const line = cart.items.find((item) => item.product.toString() === product._id.toString() && item.size === size && item.color === color)
    const nextQuantity = (line?.quantity || 0) + quantity
    if (nextQuantity > 20) throw fail(400, 'A cart line cannot contain more than 20 items.', 'INVALID_QUANTITY')
    if (nextQuantity > availableStock) throw fail(409, `Only ${availableStock} of this size and color are available.`, 'INSUFFICIENT_STOCK')
    if (line) line.quantity = nextQuantity
    else cart.items.push({ product: product._id, legacyId: product.legacyId || product.id, size, color, quantity })
    try {
      await cart.save()
      return
    } catch (error) {
      if (attempt < 3 && (error.code === 11000 || error.name === 'VersionError')) continue
      throw error
    }
  }
  throw fail(409, 'The cart changed while this item was being added. Please try again.', 'CART_CHANGED')
}

export function createApp(options = {}) {
  const config = options.config || getConfig()
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(cors({ origin(origin, callback) { if (!origin || config.origins.includes(origin)) return callback(null, true); return callback(fail(403, 'This origin is not allowed.', 'CORS_ORIGIN_DENIED')) }, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'] }))
  app.use('/uploads', express.static(uploadDirectory, { dotfiles: 'deny', fallthrough: false, immutable: true, index: false, maxAge: '1y' }))
  app.use(express.json({
    limit: '64kb',
    strict: true,
    verify: (req, _res, buffer) => {
      if (req.originalUrl?.startsWith('/api/payment/razorpay/webhook')) req.rawBody = buffer
    },
  }))
  app.use(cookieParser())
  app.use((req, res, next) => {
    const start = process.hrtime.bigint()
    res.on('finish', () => {
      if (config.nodeEnv !== 'test') {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6
        console.info(`${req.method} ${req.path} ${res.statusCode} ${durationMs.toFixed(1)}ms`)
      }
    })
    next()
  })
  const generalLimit = rateLimit({ windowMs: config.rateLimitWindowMs, limit: config.rateLimitMax, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' } } })
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, error: { code: 'AUTH_RATE_LIMITED', message: 'Too many sign-in attempts. Please wait and try again.' } } })
  app.use('/api', generalLimit)

  app.get('/api/health', (_req, res) => envelope(res, { status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', uptimeSeconds: Math.floor(process.uptime()) }))

  const api = express.Router()
  const maybeUser = auth(config, false)
  const customer = auth(config, false, false, true)
  const signedInCustomer = auth(config, true, false, true)
  const admin = auth(config, true, true)
  const signedIn = auth(config, true)

  api.post('/admin/uploads', admin, imageUpload.array('images', 30), async (req, res) => {
    const files = req.files || []
    if (!files.length) throw fail(400, 'Choose at least one image to upload.', 'INVALID_UPLOAD')
    const prepared = files.map((file) => {
      const extension = imageExtension(file.buffer, file.mimetype)
      if (!extension) throw fail(400, 'One or more files are not valid JPEG, PNG, or WebP images.', 'INVALID_UPLOAD')
      return { buffer: file.buffer, filename: `image-${crypto.randomUUID()}.${extension}` }
    })
    await mkdir(uploadDirectory, { recursive: true })
    const written = []
    try {
      for (const file of prepared) {
        await writeFile(path.join(uploadDirectory, file.filename), file.buffer, { flag: 'wx' })
        written.push(file.filename)
      }
    } catch (error) {
      await Promise.all(written.map((filename) => unlink(path.join(uploadDirectory, filename)).catch(() => {})))
      throw error
    }
    envelope(res, { images: written.map((filename) => `/uploads/${filename}`) }, 201)
  })

  api.delete('/admin/uploads', admin, async (req, res) => {
    const images = stringArrayInput(req.body.images, 'Images', { maxItems: 60, maxLength: 100 })
    if (images.some((image) => !/^\/uploads\/image-[a-f0-9-]{36}\.(?:jpg|png|webp)$/i.test(image))) throw fail(400, 'Only uploaded product images can be removed.', 'INVALID_UPLOAD')
    let removed = 0
    for (const image of images) {
      if (await Product.exists({ $or: [{ images: image }, { 'colorImages.images': image }] })) continue
      const filename = path.basename(image)
      try { await unlink(path.join(uploadDirectory, filename)); removed++ }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    envelope(res, { removed })
  })

  api.post('/auth/register', authLimit, async (req, res) => {
    const name = requestText(req.body.name, 'Name', { min: 2, max: 120, required: true })
    const email = requestText(req.body.email, 'Email', { max: 254, required: true }).toLowerCase()
    const password = typeof req.body.password === 'string' ? req.body.password : ''
    if (name.length < 2 || !validEmail(email) || Buffer.byteLength(password, 'utf8') < 8 || Buffer.byteLength(password, 'utf8') > 72) throw fail(400, 'Enter your name, a valid email, and a password of 8–72 bytes.', 'INVALID_REGISTRATION')
    const passwordHash = await bcrypt.hash(password, 12)
    let user
    try { user = await User.create({ name, email, passwordHash, role: 'customer' }) }
    catch (error) { if (error.code === 11000) throw fail(409, 'An account with this email already exists.', 'EMAIL_IN_USE'); throw error }
    const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn, issuer: 'little-star-kids-wear', audience: 'little-star-client' })
    setAuthCookie(req, res, token, config)
    await mergeGuestState(req, res, config, user)
    return envelope(res, { user: user.toJSON() }, 201)
  })
  api.post('/auth/google', authLimit, async (req, res) => {
    const { token } = req.body
    if (!token) throw fail(400, 'Google token is required.', 'INVALID_REQUEST')
    let payload
    try {
      const { OAuth2Client } = await import('google-auth-library')
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || 'dummy')
      if (process.env.GOOGLE_CLIENT_ID) {
        const ticket = await client.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID })
        payload = ticket.getPayload()
      } else {
        // Mock payload for local development without actual client ID
        const decoded = jwt.decode(token)
        if (!decoded || !decoded.email) throw new Error('Invalid mock token')
        payload = decoded
      }
    } catch (e) {
      throw fail(401, 'Invalid Google token.', 'UNAUTHORIZED')
    }
    if (!payload.email) throw fail(400, 'Google account must have an email.', 'INVALID_ACCOUNT')
    let user = await User.findOne({ email: payload.email.toLowerCase() })
    if (user && !user.isActive) throw fail(403, 'Account is deactivated. Please contact support.', 'ACCOUNT_DISABLED')
    if (!user) {
      user = await User.create({
        name: payload.name || 'Google User',
        email: payload.email.toLowerCase(),
        role: 'customer',
        authProvider: 'google',
        googleId: payload.sub,
        lastLoginAt: new Date()
      })
    } else {
      if (!user.googleId && payload.sub) user.googleId = payload.sub
      user.lastLoginAt = new Date()
      await user.save()
    }
    const jwtToken = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn, issuer: 'little-star-kids-wear', audience: 'little-star-client' })
    setAuthCookie(req, res, jwtToken, config)
    await mergeGuestState(req, res, config, user)
    return envelope(res, { user: user.toJSON() }, 200)
  })
  api.post('/auth/login', authLimit, async (req, res) => {
    const email = requestText(req.body.email, 'Email', { max: 254, required: true }).toLowerCase()
    const password = typeof req.body.password === 'string' ? req.body.password : ''
    if (!validEmail(email) || Buffer.byteLength(password, 'utf8') < 8 || Buffer.byteLength(password, 'utf8') > 72) throw fail(400, 'Enter a valid email and password of 8–72 bytes.', 'INVALID_CREDENTIALS')
    const user = await User.findOne({ email, isActive: true }).select('+passwordHash')
    if (!user) throw fail(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS')
    if (!user.passwordHash) throw fail(400, 'This account is registered with Google. Please sign in with Google.', 'USE_GOOGLE_LOGIN')
    if (!(await bcrypt.compare(password, user.passwordHash))) throw fail(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS')
    user.lastLoginAt = new Date()
    await user.save()
    setAuthCookie(req, res, jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn, issuer: 'little-star-kids-wear', audience: 'little-star-client' }), config, user.role)
    await mergeGuestState(req, res, config, user)
    return envelope(res, { user: user.toJSON() })
  })

  api.post('/auth/logout', maybeUser, async (req, res) => {
    const cookieName = req.get('X-App-Role') === 'admin' ? adminCookieName : authCookieName
    res.clearCookie(cookieName, { path: '/' }); envelope(res, { loggedOut: true })
  })
  api.get('/auth/me', maybeUser, async (req, res) => envelope(res, { user: req.user ? req.user.toJSON() : null }))
  api.put('/auth/me', signedIn, async (req, res) => {
    const name = requestText(req.body.name, 'Name', { min: 2, max: 120, required: true })
    const phone = requestText(req.body.phone, 'Phone number', { max: 20 })
    const contactEmail = requestText(req.body.contactEmail, 'Contact email', { max: 254 }).toLowerCase()
    if (name.length < 2 || (phone && !/^[+\d()\s-]{8,20}$/.test(phone)) || (contactEmail && !validEmail(contactEmail))) {
      throw fail(400, 'Enter a valid name, contact email, and phone number.', 'INVALID_PROFILE')
    }
    req.user.name = name
    req.user.phone = phone
    if (req.body.contactEmail !== undefined) req.user.contactEmail = contactEmail
    await req.user.save()
    envelope(res, { user: req.user.toJSON() })
  })
  api.get('/auth/addresses', signedInCustomer, (req, res) => envelope(res, { addresses: req.user.addresses }))
  api.post('/auth/addresses', signedInCustomer, async (req, res) => {
    const address = validateAddress(req.body, { requirePhone: true })
    const label = cleanText(req.body.label || 'Home', 40) || 'Home'
    const makeDefault = req.body.isDefault !== false
    saveUserContactAndAddress(req.user, { address, label, makeDefault })
    await req.user.save()
    envelope(res, { addresses: req.user.addresses, user: req.user.toJSON() }, 201)
  })
  api.put('/auth/addresses/:addressId/default', signedInCustomer, async (req, res) => {
    const address = req.user.addresses.id(req.params.addressId)
    if (!address) throw fail(404, 'Address not found.', 'NOT_FOUND')
    req.user.addresses.forEach((entry) => { entry.isDefault = entry._id.equals(address._id) })
    await req.user.save()
    envelope(res, { addresses: req.user.addresses, user: req.user.toJSON() })
  })
  api.delete('/auth/addresses/:addressId', signedInCustomer, async (req, res) => {
    const address = req.user.addresses.id(req.params.addressId)
    if (!address) throw fail(404, 'Address not found.', 'NOT_FOUND')
    address.deleteOne()
    if (req.user.addresses.length && !req.user.addresses.some((entry) => entry.isDefault)) {
      req.user.addresses[req.user.addresses.length - 1].isDefault = true
    }
    await req.user.save()
    envelope(res, { addresses: req.user.addresses, user: req.user.toJSON() })
  })

  api.get('/categories', async (_req, res) => {
    const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean()
    envelope(res, { items: categories })
  })
  api.post('/categories', admin, async (req, res) => {
    const name = requestText(req.body.name, 'Category name', { min: 2, max: 80, required: true })
    if (name.length < 2) throw fail(400, 'Category name is required.', 'INVALID_CATEGORY')
    const suppliedSlug = req.body.slug === undefined ? name : requestText(req.body.slug, 'Category slug', { max: 100, required: true })
    const description = requestText(req.body.description, 'Category description', { max: 500 })
    const slug = slugify(suppliedSlug)
    if (!slug || (req.body.sortOrder !== undefined && (typeof req.body.sortOrder !== 'number' || !Number.isFinite(req.body.sortOrder)))) throw fail(400, 'Enter a valid category slug and sort order.', 'INVALID_CATEGORY')
    try { const category = await Category.create({ name, slug, description, sortOrder: req.body.sortOrder ?? 0 }); envelope(res, category, 201) }
    catch (error) { if (error.code === 11000) throw fail(409, 'A category with that name or slug already exists.', 'CATEGORY_EXISTS'); throw error }
  })
  api.put('/categories/:id', admin, async (req, res) => {
    const category = await Category.findById(req.params.id)
    if (!category) throw fail(404, 'Category not found.', 'NOT_FOUND')
    const previousName = category.name
    if (req.body.name !== undefined) {
      category.name = requestText(req.body.name, 'Category name', { min: 2, max: 80, required: true })
    }
    if (req.body.slug !== undefined || category.name !== previousName) {
      const slug = slugify(req.body.slug === undefined ? category.name : requestText(req.body.slug, 'Category slug', { max: 100, required: true }))
      if (!slug) throw fail(400, 'Enter a valid category slug.', 'INVALID_CATEGORY')
      category.slug = slug
    }
    if (req.body.description !== undefined) category.description = requestText(req.body.description, 'Category description', { max: 500 })
    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== 'boolean') throw fail(400, 'isActive must be a boolean.', 'INVALID_CATEGORY')
      category.isActive = req.body.isActive
    }
    try { await category.save() }
    catch (error) { if (error.code === 11000) throw fail(409, 'A category with that name or slug already exists.', 'CATEGORY_EXISTS'); throw error }
    if (category.name !== previousName) await Product.updateMany({ category: previousName }, { $set: { category: category.name } })
    if (!category.isActive) await removeCategoryReferences(category.name)
    envelope(res, category)
  })
  api.delete('/categories/:id', admin, async (req, res) => {
    const category = await Category.findByIdAndUpdate(req.params.id, { isActive: false }, { returnDocument: 'after' })
    if (!category) throw fail(404, 'Category not found.', 'NOT_FOUND')
    await removeCategoryReferences(category.name)
    envelope(res, { category })
  })

  api.get('/products', async (req, res) => {
    const { page, limit, skip } = pagination(req.query)
    const filter = await productFilter(req.query)
    const [items, total] = await Promise.all([Product.find(filter).sort(sortFor(req.query.sort)).skip(skip).limit(limit).lean(), Product.countDocuments(filter)])
    envelope(res, { items: items.map(asProduct), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  })
  api.get('/products/search', async (req, res) => {
    const { page, limit, skip } = pagination(req.query)
    const filter = await productFilter(req.query)
    const [items, total] = await Promise.all([Product.find(filter).sort(sortFor(req.query.sort)).skip(skip).limit(limit).lean(), Product.countDocuments(filter)])
    envelope(res, { items: items.map(asProduct), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  })
  api.get('/products/featured', async (req, res) => {
    const { limit } = pagination(req.query)
    const items = await Product.find(await activeProductFilter({ featured: true })).sort({ rating: -1 }).limit(limit).lean()
    envelope(res, { items: items.map(asProduct) })
  })
  api.get('/products/new-arrivals', async (req, res) => {
    const { limit } = pagination(req.query)
    const items = await Product.find(await activeProductFilter({ newArrival: true })).sort({ createdAt: -1 }).limit(limit).lean()
    envelope(res, { items: items.map(asProduct) })
  })
  api.get('/products/bestsellers', async (req, res) => {
    const { limit } = pagination(req.query)
    const activeCategories = await Category.find({ isActive: true }).distinct('name')
    const soldItems = await Order.aggregate([
      { $match: { orderStatus: { $ne: 'cancelled' } } }, { $unwind: '$items' },
      { $group: { _id: '$items.product', sold: { $sum: '$items.quantity' } } }, { $sort: { sold: -1 } }, { $limit: limit },
      { $lookup: { from: Product.collection.name, localField: '_id', foreignField: '_id', as: 'product' } }, { $unwind: '$product' },
      { $match: { 'product.isActive': true, 'product.category': { $in: activeCategories } } }, { $replaceRoot: { newRoot: '$product' } },
    ])
    const fallback = soldItems.length < limit ? await Product.find({ isActive: true, category: { $in: activeCategories }, featured: true, _id: { $nin: soldItems.map((item) => item._id) } }).sort({ reviews: -1, rating: -1 }).limit(limit - soldItems.length).lean() : []
    envelope(res, { items: [...soldItems, ...fallback].map(asProduct) })
  })
  api.get('/products/category/:category', async (req, res) => {
    const category = await resolveCategory(req.params.category)
    if (!category) throw fail(404, 'Category not found.', 'NOT_FOUND')
    const { page, limit, skip } = pagination(req.query)
    const filter = { ...await productFilter(req.query), category: category.name }
    const [items, total] = await Promise.all([Product.find(filter).sort(sortFor(req.query.sort)).skip(skip).limit(limit).lean(), Product.countDocuments(filter)])
    envelope(res, { items: items.map(asProduct), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  })
  api.get('/products/:id', async (req, res) => {
    const id = req.params.id
    const query = mongoose.isValidObjectId(id) ? { $or: [{ _id: id }, { legacyId: id }, { slug: id }] } : { $or: [{ legacyId: id }, { slug: id }] }
    const product = await Product.findOne({ ...query, isActive: true }).lean()
    if (!product || !(await Category.exists({ name: product.category, isActive: true }))) throw fail(404, 'Product not found.', 'NOT_FOUND')
    envelope(res, { product: asProduct(product) })
  })
  api.post('/products', admin, async (req, res) => {
    const product = await buildProduct(req.body)
    const saved = await Product.create(product)
    envelope(res, { product: asProduct(saved) }, 201)
  })
  api.put('/products/:id', admin, async (req, res) => {
    const product = await findProduct(req.params.id)
    if (!product) throw fail(404, 'Product not found.', 'NOT_FOUND')
    const wasActive = product.isActive
    await updateProduct(product, req.body)
    await product.save()
    if (wasActive && !product.isActive) await removeProductReferences(product)
    envelope(res, { product: asProduct(product) })
  })
  api.patch('/products/:id', admin, async (req, res) => {
    const product = await findProduct(req.params.id)
    if (!product) throw fail(404, 'Product not found.', 'NOT_FOUND')
    const wasActive = product.isActive
    await updateProduct(product, req.body)
    await product.save()
    if (wasActive && !product.isActive) await removeProductReferences(product)
    envelope(res, { product: asProduct(product) })
  })
  api.delete('/products/:id', admin, async (req, res) => {
    const product = await findProduct(req.params.id)
    if (!product) throw fail(404, 'Product not found.', 'NOT_FOUND')
    await removeProductReferences(product)
    await product.deleteOne()
    envelope(res, { success: true })
  })

  api.get('/cart', maybeUser, async (req, res) => {
    const guestId = getGuest(req, res, config)
    envelope(res, await populatedCart(ownerQuery(req, guestId), guestId))
  })
  api.post('/cart', maybeUser, async (req, res) => {
    const guestId = getGuest(req, res, config)
    const id = requestText(req.body.productId || req.body.id, 'Product ID', { min: 1, max: 100, required: true })
    const size = requestText(req.body.size, 'Size', { min: 1, max: 20, required: true }); const color = requestText(req.body.color, 'Color', { min: 1, max: 40, required: true })
    const quantity = req.body.quantity
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw fail(400, 'Choose a product, size, color, and quantity from 1 to 20.', 'INVALID_CART_ITEM')
    const product = await findProduct(id)
    if (!product || !product.isActive || !(await Category.exists({ name: product.category, isActive: true }))) throw fail(404, 'Product is no longer available.', 'PRODUCT_UNAVAILABLE')
    const variant = variantFor(product, size, color)
    if (!variant) throw fail(400, 'That size and color combination is unavailable.', 'VARIANT_UNAVAILABLE')
    const query = ownerQuery(req, guestId)
    await addCartItem(query, product, size, color, quantity, variant.stock)
    envelope(res, await populatedCart(query, guestId), 201)
  })
  api.put('/cart/:itemId', maybeUser, async (req, res) => {
    const guestId = getGuest(req, res, config); const query = ownerQuery(req, guestId)
    const cart = await Cart.findOne(query)
    if (!cart) throw fail(404, 'Cart item not found.', 'NOT_FOUND')
    const line = cart.items.id(req.params.itemId)
    if (!line) throw fail(404, 'Cart item not found.', 'NOT_FOUND')
    const quantity = req.body.quantity
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw fail(400, 'Quantity must be from 1 to 20.', 'INVALID_QUANTITY')
    const product = await Product.findById(line.product)
    const variant = product && variantFor(product, line.size, line.color)
    if (!product?.isActive || !variant || quantity > variant.stock || !(await Category.exists({ name: product.category, isActive: true }))) throw fail(409, 'Requested quantity is not in stock.', 'INSUFFICIENT_STOCK')
    line.quantity = quantity; await cart.save(); envelope(res, await populatedCart(query, guestId))
  })
  api.delete('/cart/:itemId', maybeUser, async (req, res) => {
    const guestId = getGuest(req, res, config); const query = ownerQuery(req, guestId)
    const cart = await Cart.findOne(query)
    if (!cart || !cart.items.id(req.params.itemId)) throw fail(404, 'Cart item not found.', 'NOT_FOUND')
    cart.items.id(req.params.itemId).deleteOne(); await cart.save(); envelope(res, await populatedCart(query, guestId))
  })
  api.delete('/cart', maybeUser, async (req, res) => {
    const guestId = getGuest(req, res, config); const query = ownerQuery(req, guestId)
    await Cart.findOneAndUpdate(query, { $set: { items: [] } }, { upsert: true, setDefaultsOnInsert: true })
    envelope(res, { items: [], subtotal: 0, discount: 0, shipping: 0, total: 0 })
  })

  api.get('/wishlist', maybeUser, async (req, res) => {
    const guestId = getGuest(req, res, config); const query = ownerQuery(req, guestId)
    const wishlist = await Wishlist.findOne(query).populate('products').lean()
    const items = (wishlist?.products || []).filter((product) => product?.isActive).map(asProduct)
    envelope(res, { items, ids: wishlist?.legacyIds || [] })
  })
  api.post('/wishlist/:productId', maybeUser, async (req, res) => {
    const guestId = getGuest(req, res, config); const query = ownerQuery(req, guestId)
    const product = await findProduct(req.params.productId)
    if (!product || !product.isActive || !(await Category.exists({ name: product.category, isActive: true }))) throw fail(404, 'Product not found.', 'NOT_FOUND')
    const update = { $addToSet: { products: product._id, legacyIds: product.legacyId || product.id } }
    let wishlist
    try { wishlist = await Wishlist.findOneAndUpdate(query, update, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }).populate('products') }
    catch (error) {
      if (error.code !== 11000) throw error
      wishlist = await Wishlist.findOneAndUpdate(query, update, { returnDocument: 'after' }).populate('products')
      if (!wishlist) throw error
    }
    envelope(res, { items: wishlist.products.filter((item) => item.isActive).map(asProduct), ids: wishlist.legacyIds })
  })
  api.delete('/wishlist/:productId', maybeUser, async (req, res) => {
    const guestId = getGuest(req, res, config); const query = ownerQuery(req, guestId)
    const product = await findProduct(req.params.productId)
    const wishlist = await Wishlist.findOne(query)
    if (wishlist && product) { wishlist.products.pull(product._id); wishlist.legacyIds = wishlist.legacyIds.filter((id) => id !== (product.legacyId || product.id)); await wishlist.save() }
    const fresh = wishlist ? await Wishlist.findById(wishlist._id).populate('products') : null
    envelope(res, { items: (fresh?.products || []).filter((item) => item.isActive).map(asProduct), ids: fresh?.legacyIds || [] })
  })

  const razorpayKeyId = config.razorpayKeyId || (options.razorpay ? options.razorpayKeyId || 'rzp_test_mock' : '')
  const razorpayKeySecret = config.razorpayKeySecret || (options.razorpay ? options.razorpayKeySecret || 'rzp_secret_mock' : '')
  const razorpayWebhookSecret = config.razorpayWebhookSecret || options.razorpayWebhookSecret || ''
  const razorpayClient = options.razorpay || (razorpayKeyId && razorpayKeySecret ? new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret }) : null)

  const orderResponsePayload = (order, extras = {}) => {
    const payload = { order: asOrder(order), ...extras }
    if (order?.paymentMethod === 'razorpay' && order?.paymentStatus === 'pending' && order?.orderStatus !== 'cancelled' && order?.razorpayOrderId) {
      payload.razorpayOrder = {
        id: order.razorpayOrderId,
        amount: Math.round(order.total * 100),
        currency: order.currency || 'INR',
        receipt: order.orderNumber,
      }
      payload.razorpayKeyId = razorpayKeyId
    }
    return payload
  }

  const verifyRazorpaySignature = (payload, secret, signature) => {
    if (!secret || typeof signature !== 'string' || !/^[a-f0-9]+$/i.test(signature)) return false
    const expected = crypto.createHmac('sha256', secret).update(payload).digest()
    const provided = Buffer.from(signature, 'hex')
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided)
  }

  const canAccessOrderPayment = (req, order) => {
    if (order.user) return Boolean(req.user && order.user.toString() === req.user._id.toString())
    if (order.guestId) return req.cookies?.[guestCookieName] === order.guestId
    return false
  }

  const clearCartForOrder = async (order) => {
    if (order.user) await Cart.findOneAndUpdate({ user: order.user }, { $set: { items: [] } })
    else if (order.guestId) await Cart.findOneAndUpdate({ guestId: order.guestId }, { $set: { items: [] } })
  }

  const markRazorpayOrderPaid = async (order, paymentId) => {
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: { $in: ['pending', 'failed'] }, orderStatus: { $ne: 'cancelled' } },
      { $set: { paymentStatus: 'paid', razorpayPaymentId: paymentId, paidAt: new Date(), paymentFailureReason: '' } },
      { returnDocument: 'after' }
    )
    if (updated) await clearCartForOrder(order)
    return updated
  }

  const cancelUnpaidRazorpayOrder = async (order, reason) => {
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: { $in: ['pending', 'failed'] }, orderStatus: { $in: ['confirmed', 'processing'] } },
      { $set: { paymentStatus: 'failed', orderStatus: 'cancelled', paymentFailureReason: reason || 'Payment cancelled by customer' } },
      { returnDocument: 'after' }
    )
    if (updated) {
      await restoreStock(updated.items.map((item) => ({ productId: item.product, size: item.size, color: item.color, quantity: item.quantity })))
    }
    return updated
  }

  api.get('/payment/razorpay/config', (_req, res) => {
    envelope(res, { enabled: Boolean(razorpayClient), keyId: razorpayClient ? razorpayKeyId : '' })
  })

  api.post('/orders', maybeUser, async (req, res) => {
    const idempotencyKey = requestText(req.get('Idempotency-Key') || req.body.idempotencyKey, 'Idempotency key', { max: 100, required: true })
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{16,100}$/.test(idempotencyKey)) throw fail(400, 'A valid Idempotency-Key header is required.', 'IDEMPOTENCY_KEY_REQUIRED')
    if (req.body.paymentMethod === 'online') throw fail(422, 'Online payments via generic gateway are unavailable. Please choose Razorpay or Cash on Delivery.', 'GATEWAY_UNAVAILABLE')
    const guestId = req.user ? '' : getGuest(req, res, config)
    const scopedKey = `${req.user ? req.user._id.toString() : guestId}:${idempotencyKey}`
    const previous = await Order.findOne({ idempotencyKey: scopedKey, user: req.user?._id || null })
    if (previous) return envelope(res, orderResponsePayload(previous, { reused: true }), 200)
    const paymentMethod = req.body.paymentMethod === 'razorpay' ? 'razorpay' : 'cod'
    if (paymentMethod === 'razorpay' && !razorpayClient) throw fail(503, 'Online payments via Razorpay are currently unavailable. Please choose Cash on Delivery.', 'RAZORPAY_UNAVAILABLE')
    const cartQuery = ownerQuery(req, guestId)
    const cart = await Cart.findOne(cartQuery).populate('items.product')
    if (!cart?.items.length) throw fail(400, 'Your bag is empty.', 'EMPTY_CART')
    const activeCategories = new Set(await Category.find({ isActive: true }).distinct('name'))
    const buyer = {
      name: requestText(req.body.name || req.body.fullName, 'Name', { min: 2, max: 120, required: true }),
      email: requestText(req.body.email, 'Email', { max: 254, required: true }).toLowerCase(),
      phone: requestText(req.body.phone, 'Phone number', { max: 20, required: true }),
    }
    const address = validateAddress(req.body.address || req.body)
    const notes = requestText(req.body.notes, 'Order notes', { max: 500 })
    if (buyer.name.length < 2 || !validEmail(buyer.email) || !/^[+\d()\s-]{8,20}$/.test(buyer.phone)) throw fail(400, 'Enter a valid name, email, and phone number.', 'INVALID_BUYER')
    const itemSnapshots = []; const decremented = []
    let subtotal = 0; let discount = 0
    try {
      for (const line of cart.items) {
        const product = line.product
        const variant = product && variantFor(product, line.size, line.color)
        if (!product?.isActive || !activeCategories.has(product.category) || !variant) throw fail(409, 'A product in your bag is no longer available.', 'PRODUCT_UNAVAILABLE')
        const updated = await Product.updateOne({ _id: product._id, isActive: true, variants: { $elemMatch: { size: line.size, color: line.color, stock: { $gte: line.quantity } } } }, { $inc: { 'variants.$.stock': -line.quantity, stock: -line.quantity } })
        if (!updated.modifiedCount) throw fail(409, `${product.name} is out of stock in the selected size and color.`, 'INSUFFICIENT_STOCK')
        decremented.push({ productId: product._id, size: line.size, color: line.color, quantity: line.quantity })
        subtotal += product.price * line.quantity
        discount += Math.max(0, product.originalPrice - product.price) * line.quantity
        const colorEntry = product.colorImages?.find(ci => ci.color?.toLowerCase() === line.color?.toLowerCase())
        const itemImage = colorEntry?.images?.[0] || product.images?.[0] || ''
        itemSnapshots.push({ product: product._id, productId: product.legacyId || product.id, name: product.name, image: itemImage, size: line.size, color: line.color, quantity: line.quantity, unitPrice: product.price, originalUnitPrice: product.originalPrice })
      }
      const shipping = subtotal >= 1499 ? 0 : 99
      const total = subtotal + shipping
      const orderNumber = `LS${new Date().toISOString().slice(2, 10).replaceAll('-', '')}${crypto.randomInt(1000, 9999)}`

      let rzpOrder = null
      if (paymentMethod === 'razorpay') {
        try {
          rzpOrder = await razorpayClient.orders.create({
            amount: Math.round(total * 100),
            currency: 'INR',
            receipt: orderNumber,
            notes: { orderNumber, buyerEmail: buyer.email },
          })
        } catch (razorpayError) {
          if (config.nodeEnv !== 'test') console.error('Razorpay order creation failed:', razorpayError?.error?.description || razorpayError.message)
          throw fail(502, 'Could not start online payment with Razorpay. Please try again or choose Cash on Delivery.', 'RAZORPAY_ORDER_FAILED')
        }
      }

      const order = await Order.create({
        orderNumber,
        idempotencyKey: scopedKey,
        user: req.user?._id || null,
        guestId: req.user ? '' : guestId,
        buyer,
        shippingAddress: address,
        items: itemSnapshots,
        subtotal,
        discount,
        shipping,
        total,
        paymentMethod,
        paymentStatus: 'pending',
        razorpayOrderId: rzpOrder?.id || undefined,
        orderStatus: 'confirmed',
        notes,
      })

      if (paymentMethod === 'cod') {
        await Cart.findOneAndUpdate(cartQuery, { $set: { items: [] } })
      }

      if (req.user) {
        try {
          saveUserContactAndAddress(req.user, {
            contactEmail: buyer.email,
            phone: buyer.phone,
            address: { ...address, phone: buyer.phone },
            makeDefault: true,
          })
          await req.user.save()
        } catch (profileError) {
          console.warn('Could not save user contact/address after order:', profileError.message)
        }
      }

      if (paymentMethod === 'razorpay') {
        return envelope(res, orderResponsePayload(order, { user: req.user ? req.user.toJSON() : null }), 201)
      }

      return envelope(res, { order: asOrder(order), user: req.user ? req.user.toJSON() : null }, 201)
    } catch (error) {
      await restoreStock(decremented)
      if (error.code === 11000 && error.keyPattern?.idempotencyKey) {
        const existing = await Order.findOne({ idempotencyKey: scopedKey, user: req.user?._id || null }); if (existing) return envelope(res, orderResponsePayload(existing, { reused: true }))
      }
      throw error
    }
  })
  api.get('/orders', signedInCustomer, async (req, res) => {
    const { page, limit, skip } = pagination(req.query)
    const [items, total] = await Promise.all([Order.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Order.countDocuments({ user: req.user._id })])
    envelope(res, { items: items.map(asOrder), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  })
  api.post('/payment/razorpay/verify', maybeUser, async (req, res) => {
    if (!razorpayClient || !razorpayKeySecret) throw fail(503, 'Razorpay verification is not configured on the server.', 'RAZORPAY_UNAVAILABLE')
    const razorpayOrderId = requestText(req.body.razorpay_order_id, 'Razorpay order ID', { min: 4, max: 120, required: true })
    const razorpayPaymentId = requestText(req.body.razorpay_payment_id, 'Razorpay payment ID', { min: 4, max: 120, required: true })
    const razorpaySignature = requestText(req.body.razorpay_signature, 'Razorpay signature', { min: 10, max: 256, required: true })
    if (!verifyRazorpaySignature(`${razorpayOrderId}|${razorpayPaymentId}`, razorpayKeySecret, razorpaySignature)) {
      throw fail(400, 'Invalid payment signature.', 'PAYMENT_FAILED')
    }
    const order = await Order.findOne({ razorpayOrderId }).select('+guestId')
    if (!order) throw fail(404, 'Order not found.', 'NOT_FOUND')
    if (!canAccessOrderPayment(req, order)) throw fail(403, 'You are not allowed to verify this payment.', 'FORBIDDEN')
    if (order.paymentStatus === 'paid') {
      return envelope(res, { verified: true, order: asOrder(order), user: req.user ? req.user.toJSON() : null })
    }
    if (order.orderStatus === 'cancelled') throw fail(409, 'This order has already been cancelled.', 'ORDER_CANCELLED')
    const updated = await markRazorpayOrderPaid(order, razorpayPaymentId)
    if (!updated) throw fail(409, 'Payment could not be finalized for this order.', 'PAYMENT_CONFLICT')
    envelope(res, { verified: true, order: asOrder(updated), user: req.user ? req.user.toJSON() : null })
  })
  api.post('/payment/razorpay/failure', maybeUser, async (req, res) => {
    const razorpayOrderId = requestText(req.body.razorpay_order_id, 'Razorpay order ID', { min: 4, max: 120, required: true })
    const reason = requestText(req.body.reason, 'Failure reason', { max: 200 }) || 'Payment cancelled by customer'
    const order = await Order.findOne({ razorpayOrderId }).select('+guestId')
    if (!order) throw fail(404, 'Order not found.', 'NOT_FOUND')
    if (!canAccessOrderPayment(req, order)) throw fail(403, 'You are not allowed to update this order.', 'FORBIDDEN')
    if (order.paymentStatus === 'paid') return envelope(res, { cancelled: false, order: asOrder(order) })
    const updated = await cancelUnpaidRazorpayOrder(order, reason)
    envelope(res, { cancelled: Boolean(updated), order: asOrder(updated || order) })
  })
  api.post('/payment/razorpay/webhook', async (req, res) => {
    if (!razorpayWebhookSecret) throw fail(503, 'Razorpay webhook secret is not configured.', 'RAZORPAY_WEBHOOK_NOT_CONFIGURED')
    const signature = req.get('x-razorpay-signature') || ''
    const rawPayload = req.rawBody || Buffer.from(JSON.stringify(req.body || {}))
    if (!verifyRazorpaySignature(rawPayload, razorpayWebhookSecret, signature)) {
      throw fail(400, 'Invalid Razorpay webhook signature.', 'INVALID_SIGNATURE')
    }
    const event = cleanText(req.body?.event, 80)
    const paymentEntity = req.body?.payload?.payment?.entity
    const orderEntity = req.body?.payload?.order?.entity
    const rzpOrderId = cleanText(paymentEntity?.order_id || orderEntity?.id, 120)
    if (rzpOrderId && (event === 'payment.captured' || event === 'order.paid')) {
      const paymentId = cleanText(paymentEntity?.id, 120)
      const order = await Order.findOne({ razorpayOrderId: rzpOrderId }).select('+guestId')
      if (order && order.paymentStatus !== 'paid' && order.orderStatus !== 'cancelled' && paymentId) {
        await markRazorpayOrderPaid(order, paymentId)
      }
    } else if (rzpOrderId && event === 'payment.failed') {
      const order = await Order.findOne({ razorpayOrderId: rzpOrderId }).select('+guestId')
      if (order && order.paymentStatus === 'pending' && order.orderStatus !== 'cancelled') {
        const reason = cleanText(paymentEntity?.error_description || paymentEntity?.error_reason, 200) || 'Payment failed'
        await Order.updateOne(
          { _id: order._id, paymentStatus: 'pending', orderStatus: { $ne: 'cancelled' } },
          { $set: { paymentStatus: 'failed', paymentFailureReason: reason } }
        )
      }
    }
    envelope(res, { received: true })
  })
  api.get('/orders/:id', signedInCustomer, async (req, res) => {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id })
    if (!order) throw fail(404, 'Order not found.', 'NOT_FOUND')
    envelope(res, { order: asOrder(order) })
  })
  api.put('/orders/:id/cancel', signedInCustomer, async (req, res) => {
    const order = await Order.findOneAndUpdate({ _id: req.params.id, user: req.user._id, orderStatus: { $in: ['confirmed', 'processing'] }, paymentStatus: 'pending' }, { $set: { orderStatus: 'cancelled' } }, { returnDocument: 'after' })
    if (!order) {
      const existing = await Order.findOne({ _id: req.params.id, user: req.user._id }).select('_id')
      if (!existing) throw fail(404, 'Order not found.', 'NOT_FOUND')
      throw fail(409, 'This order can no longer be cancelled online.', 'ORDER_NOT_CANCELLABLE')
    }
    await restoreStock(order.items.map((item) => ({ productId: item.product, size: item.size, color: item.color, quantity: item.quantity })))
    envelope(res, { order: asOrder(order) })
  })

  api.post('/contact', async (req, res) => {
    const name = requestText(req.body.name, 'Name', { min: 2, max: 120, required: true }); const email = requestText(req.body.email, 'Email', { max: 254, required: true }).toLowerCase(); const phone = requestText(req.body.phone, 'Phone number', { max: 20, required: true }); const message = requestText(req.body.message, 'Message', { min: 10, max: 3000, required: true })
    if (name.length < 2 || !validEmail(email) || !/^[+\d()\s-]{8,20}$/.test(phone) || message.length < 10) throw fail(400, 'Enter a valid name, email, phone, and message of at least 10 characters.', 'INVALID_CONTACT')
    const contactMessage = await ContactMessage.create({ name, email, phone, message })
    envelope(res, { message: 'Thanks for reaching out. We will be in touch soon.', id: contactMessage.id }, 201)
  })

  api.get('/admin/dashboard', admin, async (_req, res) => {
    const [orders, sales, products, customers, recentOrders] = await Promise.all([
      Order.countDocuments(), Order.aggregate([{ $match: { orderStatus: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Product.countDocuments({ isActive: true }), User.countDocuments({ role: 'customer', isActive: true }), Order.find().sort({ createdAt: -1 }).limit(5).lean(),
    ])
    envelope(res, { totalOrders: orders, totalSales: sales[0]?.total || 0, products, customers, recentOrders: recentOrders.map(asOrder) })
  })
  api.get('/admin/products', admin, async (req, res) => {
    const query = queryText(req.query, 'search', 100) || ''; const filter = {}
    if (req.query.active !== undefined) {
      const active = queryText(req.query, 'active', 5)
      if (!['true', 'false'].includes(active)) throw fail(400, 'Active filter must be true or false.', 'INVALID_QUERY')
      filter.isActive = active === 'true'
    }
    const categoryName = queryText(req.query, 'category', 80)
    if (categoryName) {
      const category = await Category.findOne({ $or: [{ slug: slugify(categoryName) }, { name: new RegExp(`^${escapeRegex(categoryName)}$`, 'i') }] })
      filter.category = category?.name || '__no_category__'
    }
    if (query) filter.$or = [{ name: new RegExp(escapeRegex(query), 'i') }, { legacyId: new RegExp(escapeRegex(query), 'i') }]
    const { page, limit, skip } = pagination(req.query)
    const [items, total] = await Promise.all([Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Product.countDocuments(filter)])
    envelope(res, { items: items.map(asProduct), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  })
  api.get('/admin/orders', admin, async (req, res) => {
    const filter = {}
    const status = queryText(req.query, 'status', 20)
    if (status) {
      if (!['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'].includes(status)) throw fail(400, 'Unsupported order status filter.', 'INVALID_QUERY')
      filter.orderStatus = status
    }
    const search = queryText(req.query, 'search', 100) || ''
    if (search) filter.$or = [{ orderNumber: new RegExp(escapeRegex(search), 'i') }, { 'buyer.name': new RegExp(escapeRegex(search), 'i') }]
    const { page, limit, skip } = pagination(req.query)
    const [items, total] = await Promise.all([Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Order.countDocuments(filter)])
    envelope(res, { items: items.map(asOrder), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  })
  api.put('/admin/orders/:id/status', admin, async (req, res) => {
    const status = cleanText(req.body.status, 20).toLowerCase()
    if (!['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'].includes(status)) throw fail(400, 'Unsupported order status.', 'INVALID_STATUS')
    const order = await Order.findById(req.params.id)
    if (!order) throw fail(404, 'Order not found.', 'NOT_FOUND')
    if (status === order.orderStatus) return envelope(res, { order: asOrder(order) })
    if (!orderTransitions[order.orderStatus]?.includes(status)) {
      throw fail(409, `Cannot transition order status from ${order.orderStatus} to ${status}.`, 'INVALID_TRANSITION')
    }
    const filter = { _id: order._id, orderStatus: order.orderStatus }
    if (status === 'cancelled') {
      if (order.paymentStatus !== 'pending') throw fail(409, 'Only unpaid orders can be cancelled.', 'ORDER_NOT_CANCELLABLE')
      filter.paymentStatus = 'pending'
    }
    const updated = await Order.findOneAndUpdate(filter, { $set: { orderStatus: status } }, { returnDocument: 'after' })
    if (!updated) throw fail(409, 'The order changed while this update was being applied. Reload and try again.', 'ORDER_CHANGED')
    if (status === 'cancelled') await restoreStock(updated.items.map((item) => ({ productId: item.product, size: item.size, color: item.color, quantity: item.quantity })))
    envelope(res, { order: asOrder(updated) })
  })
  api.delete('/admin/orders/:id', admin, async (req, res) => {
    const order = await Order.findByIdAndDelete(req.params.id)
    if (!order) throw fail(404, 'Order not found.', 'NOT_FOUND')
    envelope(res, { deleted: true })
  })
  api.get('/admin/customers', admin, async (req, res) => {
    const search = queryText(req.query, 'search', 100) || ''
    const filter = { role: 'customer' }
    if (search) { const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }] }
    const { page, limit, skip } = pagination(req.query)
    const [users, total] = await Promise.all([User.find(filter).select('-passwordHash').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), User.countDocuments(filter)])
    const orderStats = await Order.aggregate([{ $match: { user: { $in: users.map((user) => user._id) } } }, { $group: { _id: '$user', orderCount: { $sum: 1 }, amountSpent: { $sum: '$total' }, lastOrderAt: { $max: '$createdAt' } } }])
    const stats = new Map(orderStats.map((item) => [item._id.toString(), item]))
    envelope(res, { items: users.map((user) => ({ ...user, orderStats: stats.get(user._id.toString()) || { orderCount: 0, amountSpent: 0, lastOrderAt: null } })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  })
  api.get('/admin/contact-messages', admin, async (req, res) => {
    const { page, limit, skip } = pagination(req.query); const filter = {}
    const status = queryText(req.query, 'status', 20)
    if (status) {
      if (!['new', 'read', 'resolved'].includes(status)) throw fail(400, 'Unsupported contact message status filter.', 'INVALID_QUERY')
      filter.status = status
    }
    const [items, total] = await Promise.all([ContactMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), ContactMessage.countDocuments(filter)])
    envelope(res, { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  })
  api.patch('/admin/contact-messages/:id', admin, async (req, res) => {
    if (!['new', 'read', 'resolved'].includes(req.body.status)) throw fail(400, 'Unsupported contact message status.', 'INVALID_STATUS')
    const message = await ContactMessage.findByIdAndUpdate(req.params.id, { status: req.body.status }, { returnDocument: 'after' })
    if (!message) throw fail(404, 'Message not found.', 'NOT_FOUND')
    envelope(res, { message })
  })

  app.use('/api', api)
  app.use('/api', (_req, _res, next) => next(fail(404, 'API route not found.', 'NOT_FOUND')))
  app.use((error, _req, res, _next) => {
    const duplicate = error.code === 11000
    const uploadLimitError = error instanceof multer.MulterError
    const candidateStatus = Number(error.status || (uploadLimitError ? error.code === 'LIMIT_FILE_SIZE' ? 413 : 400 : duplicate ? 409 : error.name === 'ValidationError' || error.name === 'CastError' ? 400 : 500))
    const status = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599 ? candidateStatus : 500
    const safeInternalCode = typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/i.test(error.code) ? error.code : 'INTERNAL_ERROR'
    const code = uploadLimitError ? 'INVALID_UPLOAD' : duplicate ? 'DUPLICATE_RECORD' : status !== 500 && error.code && typeof error.code === 'string' ? safeInternalCode : status === 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR'
    let message = uploadLimitError ? error.code === 'LIMIT_FILE_SIZE' ? 'Each image must be 5 MB or smaller.' : 'Choose up to 8 images in one upload.' : status === 500 ? 'Something went wrong.' : error.message || 'Something went wrong.'
    if (duplicate) {
      if (error.keyPattern?.slug || (error.message && error.message.includes('slug_1'))) {
        const valMatch = error.message?.match(/dup key: \{ [^:]*: "([^"]+)" \}/) || error.message?.match(/slug: "([^"]+)"/)
        const duplicateVal = error.keyValue?.slug || (valMatch ? valMatch[1] : '')
        message = duplicateVal
          ? `A product named "${duplicateVal}" already exists in your catalog. Please choose a different product name.`
          : 'A product with this name or slug already exists in your catalog. Please choose a different product name.'
      } else if (error.keyPattern?.email || (error.message && error.message.includes('email_1'))) {
        message = 'An account with this email address already exists.'
      } else if (error.keyPattern?.legacyId || (error.message && error.message.includes('legacyId_1'))) {
        message = 'A product with this ID already exists.'
      } else {
        message = 'A record with this information already exists.'
      }
    }
    if (status === 500 && config.nodeEnv !== 'test') console.error('Unhandled API error', { name: /^[A-Za-z0-9_]{1,60}$/.test(error.name || '') ? error.name : 'Error', code: safeInternalCode })
    res.status(status).json({ success: false, error: { code, message } })
  })
  return app

  async function mergeGuestState(req, res, runtimeConfig, user) {
    const guestId = req.cookies?.[guestCookieName]
    if (!guestId) return
    const [guestCart, guestWishlist] = await Promise.all([Cart.findOne({ guestId }), Wishlist.findOne({ guestId })])
    if (guestCart?.items.length) {
      const userCart = await Cart.findOne({ user: user._id }) || new Cart({ user: user._id, items: [] })
      for (const guestLine of guestCart.items) {
        const product = await Product.findById(guestLine.product)
        const variant = product && variantFor(product, guestLine.size, guestLine.color)
        if (!product?.isActive || !(await Category.exists({ name: product.category, isActive: true })) || !variant) continue
        const existing = userCart.items.find((line) => line.product.toString() === guestLine.product.toString() && line.size === guestLine.size && line.color === guestLine.color)
        if (existing) existing.quantity = Math.min(variant.stock, 20, existing.quantity + guestLine.quantity)
        else if (variant.stock) userCart.items.push({ ...guestLine.toObject(), quantity: Math.min(variant.stock, 20, guestLine.quantity) })
      }
      await userCart.save(); await guestCart.deleteOne()
    }
    if (guestWishlist?.products.length) {
      const userWishlist = await Wishlist.findOne({ user: user._id }) || new Wishlist({ user: user._id, products: [], legacyIds: [] })
      for (let i = 0; i < guestWishlist.products.length; i++) {
        const productId = guestWishlist.products[i].toString()
        const product = await Product.findById(productId)
        if (!product?.isActive || !(await Category.exists({ name: product.category, isActive: true }))) continue
        if (!userWishlist.products.some((id) => id.toString() === productId)) userWishlist.products.push(guestWishlist.products[i])
      }
      userWishlist.legacyIds = [...new Set([...userWishlist.legacyIds, ...guestWishlist.legacyIds])]
      await userWishlist.save(); await guestWishlist.deleteOne()
    }
    setGuestCookie(res, guestId, runtimeConfig)
  }
}

async function findProduct(id) {
  if (mongoose.isValidObjectId(id)) return Product.findOne({ $or: [{ _id: id }, { legacyId: id }, { slug: id }] })
  return Product.findOne({ $or: [{ legacyId: id }, { slug: id }] })
}
function numberInput(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw fail(400, `${label} must be a valid number from ${min} to ${max}.`, 'INVALID_PRODUCT')
  }
  return value
}
function stringArrayInput(value, label, { maxItems, maxLength, fallback = [] }) {
  if (value === undefined) return fallback
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > maxLength)) {
    throw fail(400, `${label} must be an array of up to ${maxItems} non-empty strings (maximum ${maxLength} characters each).`, 'INVALID_PRODUCT')
  }
  return [...new Set(value.map((item) => item.trim()))]
}
function booleanInput(body, fields) {
  for (const field of fields) if (body[field] !== undefined && typeof body[field] !== 'boolean') throw fail(400, `${field} must be a boolean.`, 'INVALID_PRODUCT')
}
async function productCategory(value) {
  if (typeof value !== 'string' || value.length > 80) throw fail(400, 'Choose an active product category.', 'INVALID_PRODUCT')
  const category = await resolveCategory(value)
  if (!category) throw fail(400, 'Choose an active product category.', 'INVALID_PRODUCT')
  return category.name
}
function normalizeColorImages(input, productColors = []) {
  if (input === undefined || input === null) return []
  let entries = []
  if (Array.isArray(input)) {
    entries = input
  } else if (typeof input === 'object') {
    entries = Object.entries(input).map(([color, images]) => ({ color, images }))
  } else {
    throw fail(400, 'Color images must be an array or object mapping colors to images.', 'INVALID_PRODUCT')
  }

  const result = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const color = typeof entry.color === 'string' ? entry.color.trim() : ''
    if (!color || color.length > 40) continue
    const rawImages = Array.isArray(entry.images) ? entry.images : []
    const images = rawImages
      .filter((img) => typeof img === 'string' && img.trim().length > 0 && img.length <= 500)
      .map((img) => img.trim())
    if (images.some((image) => !(/^\/(?!\/)/.test(image) || /^https?:\/\//i.test(image)))) {
      throw fail(400, 'Images must use a local path or an HTTP(S) URL.', 'INVALID_PRODUCT')
    }
    result.push({ color, images })
  }
  return result
}

async function buildProduct(body) {
  const name = requestText(body.name, 'Product name', { min: 2, max: 160, required: true }); const category = await productCategory(body.category)
  const price = numberInput(body.price, 'Price', { min: 1 })
  const stock = body.stock === undefined ? 0 : numberInput(body.stock, 'Stock', { min: 0, max: 100000, integer: true })
  booleanInput(body, ['featured', 'newArrival', 'isActive'])
  const sizes = stringArrayInput(body.sizes, 'Sizes', { maxItems: 30, maxLength: 20, fallback: category === 'Baby' ? ['0-3M', '3-6M', '6-9M', '9-12M'] : ['3-4Y', '4-5Y', '5-6Y', '6-7Y', '8-9Y', '10-11Y', '12-13Y', '14-15Y'] })
  const colors = stringArrayInput(body.colors, 'Colors', { maxItems: 20, maxLength: 40, fallback: ['Navy'] })
  if (!sizes.length || !colors.length) throw fail(400, 'At least one size and one color are required.', 'INVALID_PRODUCT')
  const variants = Array.isArray(body.variants) ? normalizeVariants(body.variants, sizes, colors) : generatedVariants(sizes, colors, stock)
  if (body.variants !== undefined && !Array.isArray(body.variants)) throw fail(400, 'Variants must be an array.', 'INVALID_PRODUCT')
  if (body.stock !== undefined && body.variants !== undefined && variants.reduce((sum, variant) => sum + variant.stock, 0) !== stock) throw fail(400, 'Stock must equal the total stock across variants.', 'INVALID_PRODUCT')
  const originalPrice = body.originalPrice === undefined ? price : numberInput(body.originalPrice, 'Original price', { min: 1 })
  if (originalPrice < price) throw fail(400, 'Original price cannot be lower than the selling price.', 'INVALID_PRODUCT')
  const colorImages = normalizeColorImages(body.colorImages, colors)
  let images = stringArrayInput(body.images, 'Images', { maxItems: 60, maxLength: 500, fallback: [] })
  if (images.some((image) => !(/^\/(?!\/)/.test(image) || /^https?:\/\//i.test(image)))) throw fail(400, 'Images must use a local path or an HTTP(S) URL.', 'INVALID_PRODUCT')
  if (colorImages.length > 0) {
    const allColorImages = colorImages.flatMap((c) => c.images)
    images = [...new Set([...images, ...allColorImages])].filter(Boolean)
  }
  if (!images.length) images = ['/assets/products/girl-01.jpg']
  const ageRange = stringArrayInput(body.ageRange, 'Age ranges', { maxItems: 10, maxLength: 20 })
  const occasion = stringArrayInput(body.occasion, 'Occasions', { maxItems: 20, maxLength: 60 })
  const tags = stringArrayInput(body.tags, 'Tags', { maxItems: 20, maxLength: 40 })
  const slugInput = body.slug === undefined ? name : requestText(body.slug, 'Product slug', { max: 100, required: true })
  const slug = slugify(slugInput)
  if (!slug) throw fail(400, 'Product slug must contain letters or numbers.', 'INVALID_PRODUCT')
  const legacyId = requestText(body.legacyId, 'Legacy product ID', { max: 100 })
  const description = requestText(body.description, 'Description', { max: 4000 })
  const subcategory = requestText(body.subcategory === undefined ? 'Clothing' : body.subcategory, 'Subcategory', { max: 80, required: true })
  const material = requestText(body.material, 'Material', { max: 200 })
  return { legacyId: legacyId || undefined, name, slug, description, category, subcategory, sizes, ageRange, colors, occasion, price, originalPrice, discount: Math.round((1 - price / originalPrice) * 100), images, colorImages, material, rating: 0, reviews: 0, featured: body.featured ?? false, newArrival: body.newArrival ?? false, stock: variants.reduce((sum, variant) => sum + variant.stock, 0), variants, tags, isActive: body.isActive ?? true }
}
function normalizeVariants(input, sizes, colors) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 400 || input.some((variant) => !variant || typeof variant !== 'object' || Array.isArray(variant))) throw fail(400, 'Variants must contain between 1 and 400 objects.', 'INVALID_PRODUCT')
  const variants = input.map((variant) => {
    if (typeof variant.size !== 'string' || variant.size.length > 20 || typeof variant.color !== 'string' || variant.color.length > 40) throw fail(400, 'Every variant needs a size and color within the allowed length.', 'INVALID_PRODUCT')
    const size = variant.size.trim(); const color = variant.color.trim()
    if (!size || !color || !sizes.includes(size) || !colors.includes(color)) throw fail(400, 'Every variant must use a listed size and color.', 'INVALID_PRODUCT')
    if (variant.stock !== undefined) numberInput(variant.stock, 'Variant stock', { min: 0, max: 100000, integer: true })
    if (variant.sku !== undefined && (typeof variant.sku !== 'string' || variant.sku.length > 64)) throw fail(400, 'Variant SKU must be a string of up to 64 characters.', 'INVALID_PRODUCT')
    return { size, color, sku: cleanText(variant.sku, 64), stock: variant.stock ?? 0 }
  })
  if (new Set(variants.map((variant) => `${variant.size}\u0000${variant.color}`)).size !== variants.length) throw fail(400, 'Variant size and color combinations must be unique.', 'INVALID_PRODUCT')
  if (!variants.length) throw fail(400, 'At least one valid size and color variant is required.', 'INVALID_PRODUCT')
  return variants
}
function generatedVariants(sizes, colors, totalStock) {
  const numVariants = sizes.length * colors.length
  let variants = sizes.flatMap((size) => colors.map((color) => ({ size, color, stock: 0 })))
  for (let i = 0; i < totalStock; i++) {
    variants[i % numVariants].stock++
  }
  return variants
}
async function updateProduct(product, body) {
  const oldStock = product.variants.reduce((sum, variant) => sum + variant.stock, 0)
  const variantsChanged = (body.sizes !== undefined && JSON.stringify(body.sizes) !== JSON.stringify(product.sizes)) || (body.colors !== undefined && JSON.stringify(body.colors) !== JSON.stringify(product.colors))
  const allowed = ['name', 'description', 'category', 'subcategory', 'sizes', 'ageRange', 'colors', 'occasion', 'price', 'originalPrice', 'images', 'colorImages', 'material', 'featured', 'newArrival', 'tags', 'isActive']
  const arrayFields = { sizes: [30, 20], ageRange: [10, 20], colors: [20, 40], occasion: [20, 60], images: [60, 500], tags: [20, 40] }
  const textFields = { description: 4000, subcategory: 80, material: 200 }
  booleanInput(body, ['featured', 'newArrival', 'isActive'])
  if (body.name !== undefined) product.name = requestText(body.name, 'Product name', { min: 2, max: 160, required: true })
  for (const [field, maxLength] of Object.entries(textFields)) if (body[field] !== undefined && (typeof body[field] !== 'string' || body[field].length > maxLength)) throw fail(400, `${field} must be a string of up to ${maxLength} characters.`, 'INVALID_PRODUCT')
  for (const [field, [maxItems, maxLength]] of Object.entries(arrayFields)) if (body[field] !== undefined) product[field] = stringArrayInput(body[field], field, { maxItems, maxLength })
  if (body.colorImages !== undefined) {
    product.colorImages = normalizeColorImages(body.colorImages, product.colors)
    if (product.colorImages.length > 0) {
      const allColorImages = product.colorImages.flatMap((c) => c.images)
      product.images = [...new Set([...(product.images || []), ...allColorImages])].filter(Boolean)
    }
  }
  if (body.images !== undefined && product.images.some((image) => !(/^\/(?!\/)/.test(image) || /^https?:\/\//i.test(image)))) throw fail(400, 'Images must use a local path or an HTTP(S) URL.', 'INVALID_PRODUCT')
  if (body.category !== undefined) product.category = await productCategory(body.category)
  if (body.price !== undefined) product.price = numberInput(body.price, 'Price', { min: 1 })
  if (body.originalPrice !== undefined) product.originalPrice = numberInput(body.originalPrice, 'Original price', { min: 1 })
  if (body.stock !== undefined) numberInput(body.stock, 'Stock', { min: 0, max: 100000, integer: true })
  for (const key of allowed) if (body[key] !== undefined && !['category', 'price', ...Object.keys(arrayFields)].includes(key)) product[key] = body[key]
  if (body.slug !== undefined) {
    if (typeof body.slug !== 'string' || !slugify(body.slug)) throw fail(400, 'Product slug must be a non-empty string.', 'INVALID_PRODUCT')
    product.slug = slugify(body.slug)
  }
  if (body.stock !== undefined && body.variants !== undefined) throw fail(400, 'Send either stock or variants, not both.', 'INVALID_PRODUCT')
  if (body.variants !== undefined) product.variants = normalizeVariants(body.variants, product.sizes, product.colors)
  else if (variantsChanged) {
    if (!product.sizes.length || !product.colors.length) throw fail(400, 'At least one size and one color are required.', 'INVALID_PRODUCT')
    product.variants = generatedVariants(product.sizes, product.colors, oldStock)
  }
  if (body.stock !== undefined && body.variants === undefined) {
    const stock = Math.max(0, Math.min(100000, Number(body.stock) || 0))
    if (!product.variants.length) product.variants = generatedVariants(product.sizes, product.colors, stock)
    else {
      const oldTotal = product.variants.reduce((sum, variant) => sum + variant.stock, 0)
      let delta = stock - oldTotal
      if (delta >= 0) product.variants[0].stock += delta
      else for (const variant of product.variants) { const removed = Math.min(variant.stock, -delta); variant.stock -= removed; delta += removed; if (!delta) break }
    }
  }
  product.stock = product.variants.reduce((sum, variant) => sum + variant.stock, 0)
  if (body.price !== undefined && body.originalPrice === undefined) product.originalPrice = Math.max(product.originalPrice, product.price)
  if (body.originalPrice !== undefined && product.originalPrice < product.price) throw fail(400, 'Original price cannot be lower than the selling price.', 'INVALID_PRODUCT')
  if (body.price !== undefined || body.originalPrice !== undefined) product.discount = Math.round((1 - product.price / product.originalPrice) * 100)
  if (product.name) product.slug = slugify(product.slug || product.name)
}
async function removeProductReferences(product) {
  const productId = product._id
  const idStr = product.legacyId || product.id || product._id?.toString()
  
  await Cart.updateMany({}, { $pull: { items: { product: productId } } })
  await Wishlist.updateMany({}, { $pull: { products: productId, legacyIds: { $in: [idStr, productId.toString()] } } })
}
async function removeCategoryReferences(categoryName) {
  const products = await Product.find({ category: categoryName }).select('_id legacyId').lean()
  if (!products.length) return
  const productIds = products.map((product) => product._id)
  const legacyIds = products.map((product) => product.legacyId || product._id.toString())
  await Promise.all([
    Cart.updateMany({}, { $pull: { items: { product: { $in: productIds } } } }),
    Wishlist.updateMany({}, { $pull: { products: { $in: productIds }, legacyIds: { $in: legacyIds } } }),
  ])
}
function saveUserContactAndAddress(user, { contactEmail, phone, address, label = 'Home', makeDefault = true } = {}) {
  if (!user) return
  if (phone) user.phone = phone
  if (contactEmail) user.contactEmail = contactEmail.toLowerCase()
  if (!address) return

  const norm = (value) => String(value || '').trim().toLowerCase()
  const existing = user.addresses.find((entry) =>
    norm(entry.fullName) === norm(address.fullName) &&
    norm(entry.line1) === norm(address.line1) &&
    norm(entry.city) === norm(address.city) &&
    norm(entry.postalCode) === norm(address.postalCode) &&
    norm(entry.landmark) === norm(address.landmark)
  )

  const shouldDefault = makeDefault || user.addresses.length === 0
  if (shouldDefault) {
    user.addresses.forEach((entry) => { entry.isDefault = false })
  }

  if (existing) {
    if (address.phone) existing.phone = address.phone
    if (address.line2 !== undefined) existing.line2 = address.line2
    if (address.state !== undefined) existing.state = address.state
    if (address.country) existing.country = address.country
    if (label && !existing.label) existing.label = label
    if (shouldDefault) existing.isDefault = true
  } else {
    user.addresses.push({
      label: label || 'Home',
      fullName: address.fullName,
      phone: address.phone || user.phone || '',
      line1: address.line1,
      line2: address.line2 || '',
      city: address.city,
      state: address.state || '',
      postalCode: address.postalCode,
      country: address.country || 'India',
      landmark: address.landmark || '',
      isDefault: shouldDefault,
    })
  }
}

async function restoreStock(changes) {
  for (const change of changes) await Product.updateOne({ _id: change.productId, 'variants.size': change.size, 'variants.color': change.color }, { $inc: { 'variants.$.stock': change.quantity, stock: change.quantity } })
}
