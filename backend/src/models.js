import mongoose from 'mongoose'

const { Schema, model, models } = mongoose
const addressSchema = new Schema({
  label: { type: String, trim: true, maxlength: 40, default: 'Home' },
  fullName: { type: String, trim: true, maxlength: 120, required: true },
  phone: { type: String, trim: true, maxlength: 20, required: true },
  line1: { type: String, trim: true, maxlength: 180, required: true },
  line2: { type: String, trim: true, maxlength: 180, default: '' },
  city: { type: String, trim: true, maxlength: 80, required: true },
  state: { type: String, trim: true, maxlength: 80, default: '' },
  postalCode: { type: String, trim: true, match: /^\d{6}$/, required: true },
  country: { type: String, trim: true, maxlength: 60, default: 'India' },
  landmark: { type: String, trim: true, maxlength: 120, default: '' },
  isDefault: { type: Boolean, default: false },
}, { _id: true })

const UserSchema = new Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254, index: true },
  contactEmail: { type: String, lowercase: true, trim: true, maxlength: 254, default: '' },
  phone: { type: String, trim: true, maxlength: 20, default: '', index: true },
  passwordHash: { type: String, select: false },
  googleId: { type: String, sparse: true, index: true },
  authProvider: { type: String, enum: ['local', 'google', 'phone'], default: 'local' },
  role: { type: String, enum: ['customer', 'admin'], default: 'customer', index: true },
  addresses: { type: [addressSchema], default: [] },
  isActive: { type: Boolean, default: true, index: true },
  lastLoginAt: { type: Date, default: null },
}, { timestamps: true, toJSON: { transform: (_doc, ret) => { delete ret.passwordHash; delete ret.__v; return ret } } })

const variantSchema = new Schema({
  size: { type: String, trim: true, required: true, maxlength: 20 },
  color: { type: String, trim: true, required: true, maxlength: 40 },
  sku: { type: String, trim: true, maxlength: 64, default: '' },
  stock: { type: Number, min: 0, default: 0 },
}, { _id: true })

const colorImageSchema = new Schema({
  color: { type: String, trim: true, required: true, maxlength: 40 },
  images: { type: [String], default: [] },
}, { _id: false })

const ProductSchema = new Schema({
  legacyId: { type: String, trim: true, unique: true, sparse: true, index: true },
  slug: { type: String, required: true, trim: true, unique: true, lowercase: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 4000, default: '' },
  category: { type: String, required: true, trim: true, maxlength: 80, index: true },
  subcategory: { type: String, trim: true, maxlength: 80, default: 'Clothing' },
  sizes: { type: [String], default: [] },
  ageRange: { type: [String], default: [] },
  colors: { type: [String], default: [] },
  occasion: { type: [String], default: [] },
  price: { type: Number, required: true, min: 1 },
  originalPrice: { type: Number, required: true, min: 1 },
  discount: { type: Number, min: 0, max: 100, default: 0 },
  images: { type: [String], default: [] },
  colorImages: { type: [colorImageSchema], default: [] },
  material: { type: String, trim: true, maxlength: 200, default: '' },
  rating: { type: Number, min: 0, max: 5, default: 0 },
  reviews: { type: Number, min: 0, default: 0 },
  featured: { type: Boolean, default: false, index: true },
  newArrival: { type: Boolean, default: false, index: true },
  stock: { type: Number, min: 0, default: 0 },
  variants: { type: [variantSchema], default: [] },
  tags: { type: [String], default: [] },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true, toJSON: { virtuals: true, transform: (_doc, ret) => { ret.id = ret.legacyId || ret._id.toString(); delete ret.legacyId; delete ret.__v; return ret } } })
ProductSchema.index({ name: 'text', description: 'text', tags: 'text' })

const CategorySchema = new Schema({
  name: { type: String, required: true, trim: true, unique: true, maxlength: 80 },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  isActive: { type: Boolean, default: true, index: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true })

const cartLineSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  legacyId: { type: String, required: true },
  size: { type: String, trim: true, required: true, maxlength: 20 },
  color: { type: String, trim: true, required: true, maxlength: 40 },
  quantity: { type: Number, min: 1, max: 20, required: true },
}, { _id: true })
const CartSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true, index: true },
  guestId: { type: String, unique: true, sparse: true, index: true },
  items: { type: [cartLineSchema], default: [] },
}, { timestamps: true })

const WishlistSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true, index: true },
  guestId: { type: String, unique: true, sparse: true, index: true },
  products: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
  legacyIds: { type: [String], default: [] },
}, { timestamps: true })

const orderItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  productId: { type: String, required: true },
  name: { type: String, required: true, maxlength: 160 },
  image: { type: String, default: '' },
  size: { type: String, required: true, maxlength: 20 },
  color: { type: String, required: true, maxlength: 40 },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  originalUnitPrice: { type: Number, required: true, min: 0 },
}, { _id: false })
const OrderSchema = new Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  guestId: { type: String, default: '', select: false },
  buyer: { name: { type: String, required: true }, email: { type: String, required: true, lowercase: true }, phone: { type: String, required: true } },
  shippingAddress: { fullName: { type: String, required: true }, line1: { type: String, required: true }, line2: { type: String, default: '' }, city: { type: String, required: true }, state: { type: String, default: '' }, postalCode: { type: String, required: true }, country: { type: String, default: 'India' }, landmark: { type: String, default: '' } },
  items: { type: [orderItemSchema], required: true },
  subtotal: { type: Number, required: true, min: 0 },
  discount: { type: Number, required: true, min: 0 },
  shipping: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'INR', enum: ['INR'] },
  paymentMethod: { type: String, enum: ['cod', 'razorpay'], default: 'cod' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  razorpayOrderId: { type: String, index: true },
  razorpayPaymentId: { type: String, index: true },
  paidAt: { type: Date, default: null },
  paymentFailureReason: { type: String, trim: true, maxlength: 200, default: '' },
  orderStatus: { type: String, enum: ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'], default: 'confirmed', index: true },
  notes: { type: String, trim: true, maxlength: 500, default: '' },
}, { timestamps: true })
OrderSchema.index({ user: 1, createdAt: -1 })

const ContactMessageSchema = new Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  phone: { type: String, required: true, trim: true, maxlength: 20 },
  message: { type: String, required: true, trim: true, minlength: 10, maxlength: 3000 },
  status: { type: String, enum: ['new', 'read', 'resolved'], default: 'new', index: true },
}, { timestamps: true })

export const User = models.User || model('User', UserSchema)
export const Product = models.Product || model('Product', ProductSchema)
export const Category = models.Category || model('Category', CategorySchema)
export const Cart = models.Cart || model('Cart', CartSchema)
export const Wishlist = models.Wishlist || model('Wishlist', WishlistSchema)
export const Order = models.Order || model('Order', OrderSchema)
export const ContactMessage = models.ContactMessage || model('ContactMessage', ContactMessageSchema)
