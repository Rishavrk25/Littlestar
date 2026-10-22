process.env.NODE_ENV ||= 'test'
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/little_star_kids_wear_test'
await import('./api.test.js')
