import dotenv from 'dotenv'
dotenv.config()

export function getConfig(env = process.env) {
  const origins = (env.CORS_ORIGINS || env.CLIENT_URL || 'http://localhost:5173,http://localhost:5174' || 'https://littlestar-backend.onrender.com')
    .split(',').map((value) => value.trim()).filter(Boolean)
  return {
    nodeEnv: env.NODE_ENV || 'development',
    port: Number(env.PORT || 5000),
    mongoUri: env.MONGODB_URI || (env.NODE_ENV === 'production' ? '' : 'mongodb://127.0.0.1:27017/little_star_kids_wear'),
    jwtSecret: env.JWT_SECRET || '',
    jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
    origins,
    cookieSecure: env.COOKIE_SECURE === 'true' || env.NODE_ENV === 'production',
    cookieSameSite: env.COOKIE_SAME_SITE || 'lax',
    adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    adminPassword: env.ADMIN_PASSWORD || '',
    adminName: env.ADMIN_NAME || 'Little Star Admin',
    rateLimitWindowMs: Number(env.RATE_LIMIT_WINDOW_MS || 900000),
    rateLimitMax: Number(env.RATE_LIMIT_MAX || 150),
    razorpayKeyId: (env.RAZORPAY_KEY_ID || '').trim(),
    razorpayKeySecret: (env.RAZORPAY_KEY_SECRET || '').trim(),
    razorpayWebhookSecret: (env.RAZORPAY_WEBHOOK_SECRET || '').trim(),
  }
}

export function assertRuntimeConfig(config = getConfig()) {
  if (!['development', 'test', 'production'].includes(config.nodeEnv)) throw new Error('NODE_ENV must be development, test, or production.')
  if (!config.jwtSecret || config.jwtSecret.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters.')
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('PORT must be a valid TCP port.')
  if (typeof config.mongoUri !== 'string' || !config.mongoUri) throw new Error('MONGODB_URI must be set to a database connection string.')
  let databaseUrl
  try { databaseUrl = new URL(config.mongoUri) }
  catch { throw new Error('MONGODB_URI must be a valid MongoDB connection string.') }
  if (!['mongodb:', 'mongodb+srv:'].includes(databaseUrl.protocol) || databaseUrl.pathname === '/' || !databaseUrl.pathname) throw new Error('MONGODB_URI must include a MongoDB database name.')
  if (!['lax', 'strict', 'none'].includes(config.cookieSameSite)) throw new Error('COOKIE_SAME_SITE must be lax, strict, or none.')
  if (config.cookieSameSite === 'none' && !config.cookieSecure) throw new Error('COOKIE_SECURE=true is required when COOKIE_SAME_SITE=none.')
  if (!Number.isInteger(config.rateLimitWindowMs) || config.rateLimitWindowMs < 1 || !Number.isInteger(config.rateLimitMax) || config.rateLimitMax < 1) throw new Error('Rate-limit settings must be positive integers.')
  if (Boolean(config.adminEmail) !== Boolean(config.adminPassword)) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be configured together.')
  if (config.adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.adminEmail)) throw new Error('ADMIN_EMAIL must be a valid email address.')
  if (config.adminPassword && (config.adminPassword.length < 12 || Buffer.byteLength(config.adminPassword, 'utf8') > 72)) throw new Error('ADMIN_PASSWORD must contain at least 12 characters and no more than 72 UTF-8 bytes.')
  if (Boolean(config.razorpayKeyId) !== Boolean(config.razorpayKeySecret)) throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be configured together.')
  return config
}
