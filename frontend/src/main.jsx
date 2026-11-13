import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate, useParams, useSearchParams, Navigate } from 'react-router-dom'
import {
  AlertCircle, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Baby, BadgeCheck, Check, ChevronDown, ChevronRight,
  CircleUserRound, ClipboardList, Clock3, CreditCard, Eye, Facebook, Heart, House, Instagram, LayoutDashboard,
  LockKeyhole, LogOut, Mail, MapPin, Menu, Minus, PackageCheck, Pencil, Phone, Plus, Search, Send, ShieldCheck, Shirt,
  ShoppingBag, SlidersHorizontal, Sparkles, Star, Trash2, Truck, UserRound, Users, X,
} from 'lucide-react'
import { moods, imageUrl } from './data/products'
import { api, mediaUrl, productList } from './lib/api'
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google'
import './styles.css'
import './admin-premium.css'

const StoreContext = createContext(null)
let storeBootstrapPromise = null
const initialState = () => ({ cart: [], wishlist: [], user: null, products: [], categories: [], loading: true, apiError: '' })
const cartLineKey = (line) => `${line.id}|${line.size}|${line.color}`
function reducer(state, action) {
  switch (action.type) {
    case 'bootstrap': return { ...state, ...action.value, loading: false, apiError: '' }
    case 'bootstrap-error': return { ...state, loading: false, apiError: action.message }
    case 'cart': return { ...state, cart: action.cart }
    case 'wishlist': return { ...state, wishlist: action.ids }
    case 'products': return { ...state, products: action.products }
    case 'categories': return { ...state, categories: action.categories }
    case 'remove': return { ...state, cart: state.cart.filter((line) => cartLineKey(line) !== action.key) }
    case 'quantity': return { ...state, cart: state.cart.map((line) => cartLineKey(line) === action.key ? { ...line, quantity: Math.max(1, line.quantity + action.delta) } : line) }
    case 'clear': return { ...state, cart: [] }
    case 'toggleWish': return { ...state, wishlist: state.wishlist.includes(action.id) ? state.wishlist.filter((id) => id !== action.id) : [...state.wishlist, action.id] }
    case 'login': return { ...state, user: action.user }
    case 'logout': return { ...state, user: null }
    default: return state
  }
}
function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState)
  const [toast, setToast] = useState('')
  const setCartFromServer = useCallback((payload) => dispatch({ type: 'cart', cart: (payload?.items || []).map((line) => ({ id: line.id || line.productId, size: line.size, color: line.color, quantity: line.quantity, itemId: line.itemId, product: line.product })) }), [])
  const refreshCart = useCallback(async () => {
    const [cart, wishlist] = await Promise.all([api('/cart'), api('/wishlist')])
    setCartFromServer(cart)
    dispatch({ type: 'wishlist', ids: wishlist.ids || (wishlist.items || []).map((item) => item.id) })
  }, [setCartFromServer])
  const refreshUser = useCallback(async () => {
    const result = await api('/auth/me')
    const user = result.user?.role === 'admin' ? null : result.user
    dispatch({ type: 'login', user })
    return user
  }, [])
  const reloadCatalog = useCallback(async () => {
    const [catalog, categories] = await Promise.all([productList({ limit: 100 }), api('/categories')])
    dispatch({ type: 'products', products: catalog.items || [] })
    dispatch({ type: 'categories', categories: categories.items || [] })
    return catalog.items || []
  }, [])
  const dispatchApi = useCallback(async (action) => {
    try {
      if (!state.user && ['add', 'toggleWish'].includes(action.type)) {
        setToast('Please sign in to continue.')
        return false
      }
      if (action.type === 'add') setCartFromServer(await api('/cart', { method: 'POST', body: { productId: action.item.id, size: action.item.size, color: action.item.color, quantity: action.item.quantity } }))
      else if (action.type === 'remove') {
        const line = state.cart.find((item) => cartLineKey(item) === action.key)
        if (line?.itemId) setCartFromServer(await api(`/cart/${line.itemId}`, { method: 'DELETE' }))
      } else if (action.type === 'quantity') {
        const line = state.cart.find((item) => cartLineKey(item) === action.key)
        if (line?.itemId) setCartFromServer(await api(`/cart/${line.itemId}`, { method: 'PUT', body: { quantity: Math.max(1, line.quantity + action.delta) } }))
      } else if (action.type === 'clear') setCartFromServer(await api('/cart', { method: 'DELETE' }))
      else if (action.type === 'toggleWish') {
        const saved = state.wishlist.includes(action.id)
        const result = await api(`/wishlist/${encodeURIComponent(action.id)}`, { method: saved ? 'DELETE' : 'POST' })
        dispatch({ type: 'wishlist', ids: result.ids || (result.items || []).map((item) => item.id) })
      } else dispatch(action)
      return true
    } catch (error) { setToast(error.message || 'Please try again.'); return false }
  }, [setCartFromServer, state.cart, state.wishlist])
  const login = useCallback(async (payload, register = false) => {
    const result = await api(`/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: payload })
    if (result.user?.role === 'admin') throw new Error('Admin accounts cannot be used in the storefront.')
    dispatch({ type: 'login', user: result.user })
    await refreshCart()
    return result.user
  }, [refreshCart])
  const googleLogin = useCallback(async (token) => {
    const result = await api(`/auth/google`, { method: 'POST', body: { token } })
    if (result.user?.role === 'admin') throw new Error('Admin accounts cannot be used in the storefront.')
    dispatch({ type: 'login', user: result.user })
    await refreshCart()
    return result.user
  }, [refreshCart])
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' })
    dispatch({ type: 'logout' })
    await refreshCart()
  }, [refreshCart])
  useEffect(() => {
    let alive = true
    if (!storeBootstrapPromise) storeBootstrapPromise = api('/cart').then((cart) => Promise.all([Promise.resolve(cart), productList({ limit: 100 }), api('/categories'), api('/auth/me'), api('/wishlist')]))
    storeBootstrapPromise.then(([cart, catalog, categories, authResult, wishlist]) => {
      const user = authResult.user?.role === 'admin' ? null : authResult.user
      if (alive) dispatch({ type: 'bootstrap', value: { products: catalog.items || [], categories: categories.items || [], user, cart: (cart.items || []).map((line) => ({ id: line.id || line.productId, size: line.size, color: line.color, quantity: line.quantity, itemId: line.itemId, product: line.product })), wishlist: wishlist.ids || (wishlist.items || []).map((item) => item.id) } })
    }).catch((error) => { if (alive) dispatch({ type: 'bootstrap-error', message: error.message || 'The shop API is unavailable.' }) })
    return () => { alive = false }
  }, [])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 2600); return () => clearTimeout(id) }, [toast])
  const value = useMemo(() => ({ ...state, dispatch: dispatchApi, notify: setToast, cartCount: state.cart.reduce((n, row) => n + row.quantity, 0), refreshCart, refreshUser, reloadCatalog, login, googleLogin, logout }), [state, dispatchApi, refreshCart, refreshUser, reloadCatalog, login, googleLogin, logout])
  return <StoreContext.Provider value={value}>{children}{toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}</StoreContext.Provider>
}
const useStore = () => useContext(StoreContext)
const money = (value) => `₹${Number(value).toLocaleString('en-IN')}`
const stars = <span className="stars" aria-label="Rated 4.8 out of 5">★★★★★</span>

function BrandMark({ light = false }) {
  return <Link to="/" className={`brand-mark ${light ? 'brand-light' : ''}`} aria-label="Little Star Kids Wear home">
    <span className="brand-icon"><img src="/assets/star-mascot.png" alt="" /></span>
    <span className="brand-type">
      <b className="brand-word">{'Little'.split('').map((letter, index) => <span className={`brand-letter brand-letter-${index}`} key={`${letter}-${index}`}>{letter}</span>)}<span className="brand-star-word">Star</span></b>
      <small>KIDS WEAR</small>
    </span>
  </Link>
}

function Header() {
  const { cartCount, wishlist, user } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => { setMenuOpen(false); setSearchOpen(false) }, [location.pathname, location.search])
  const submitSearch = (event) => { event.preventDefault(); navigate(`/shop?search=${encodeURIComponent(query)}`); setSearchOpen(false) }
  return <>
    <div className="announcement"><span>✦</span> New little looks just landed <Link to="/shop?sort=newest">Meet the collection <ArrowRight size={12} /></Link></div>
    <header className="site-header">
      <div className="nav-shell">
        <button className="icon-button mobile-menu-trigger" aria-label={menuOpen ? 'Close menu' : 'Open menu'} onClick={() => { setMenuOpen(!menuOpen); setSearchOpen(false) }}>{menuOpen ? <X /> : <Menu />}</button>
        <BrandMark />
        <nav className={`main-nav ${menuOpen ? 'nav-open' : ''}`} aria-label="Main navigation">
          <Link to="/shop?category=Girls" className={location.pathname === '/shop' && new URLSearchParams(location.search).get('category') === 'Girls' ? 'active' : ''}>Girls</Link><Link to="/shop?category=Boys" className={location.pathname === '/shop' && new URLSearchParams(location.search).get('category') === 'Boys' ? 'active' : ''}>Boys</Link><Link to="/shop?category=Baby" className={location.pathname === '/shop' && new URLSearchParams(location.search).get('category') === 'Baby' ? 'active' : ''}>Baby</Link><Link to="/shop?sort=newest" className={`new-link ${location.pathname === '/shop' && new URLSearchParams(location.search).get('sort') === 'newest' ? 'active' : ''}`}>New in <span>NEW</span></Link>
        </nav>
        <div className="nav-actions">
          <button className="icon-button search-toggle" aria-label="Search" onClick={() => { setSearchOpen(!searchOpen); setMenuOpen(false) }}><Search /></button>
          <Link className="icon-button wish-link" aria-label="Wishlist" to="/wishlist"><Heart /><i>{wishlist.length}</i></Link>
          <Link className="icon-button bag-link" aria-label={`Shopping bag, ${cartCount} items`} to="/cart"><ShoppingBag /><i>{cartCount}</i></Link>
          <Link className="icon-button account-shortcut" aria-label="My account" to="/account"><UserRound /></Link>
        </div>
      </div>
      {searchOpen && <form className="search-pop" onSubmit={submitSearch}><Search size={18} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find their next favourite…" aria-label="Search products" /><button type="submit">Search</button></form>}
    </header>
  </>
}

function Footer() {
  return <footer className="footer">
    <div className="footer-main page-width">
      <div className="footer-brand"><BrandMark light /><p>Little style, big dreams.<br />Made for every little adventure.</p><div className="social-links"><a href="https://instagram.com" aria-label="Instagram"><Instagram size={17} /></a><a href="https://facebook.com" aria-label="Facebook"><Facebook size={17} /></a><a href="https://wa.me/919135594888" aria-label="WhatsApp"><Phone size={17} /></a></div></div>
      <div><h4>Explore</h4><Link to="/shop?category=Girls">Girls</Link><Link to="/shop?category=Boys">Boys</Link><Link to="/shop?category=Baby">Baby</Link><Link to="/shop?sort=newest">New arrivals</Link></div>
      <div><h4>Here to help</h4><Link to="/contact">Contact us</Link><Link to="/size-guide">Size guide</Link><Link to="/orders">Track an order</Link><Link to="/about">Our story</Link></div>
      <div className="footer-note"><span className="eyebrow light-eyebrow">A little note from us</span><h3>Growing up is a big adventure.</h3><p>We make the comfy, happy clothes they can grow into memories with.</p><Link className="text-arrow light-arrow" to="/about">Meet Little Star <ArrowRight size={15} /></Link></div>
    </div>
    <div className="footer-bottom page-width"><span>© 2026 Little Star Kids Wear</span><span><MapPin size={13} /> Zero Mile, Dumri, Biraul, Darbhanga</span><span>Made with a little extra love <span className="pink-heart">♥</span></span></div>
  </footer>
}

function MobileNav() {
  const { cartCount, wishlist, user } = useStore()
  return <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
    <NavLink to="/" end><House size={18} /><span>Home</span></NavLink><NavLink to="/shop"><Shirt size={18} /><span>Shop</span></NavLink><NavLink to="/wishlist"><Heart size={18} /><span>Saved{wishlist.length > 0 && ` · ${wishlist.length}`}</span></NavLink><NavLink to="/cart"><ShoppingBag size={18} /><span>Bag{cartCount > 0 && ` · ${cartCount}`}</span></NavLink><NavLink to="/account"><UserRound size={18} /><span>Account</span></NavLink>
  </nav>
}

function Shell({ children }) {
  const location = useLocation()
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }) }, [location.pathname])
  const isAdmin = location.pathname.startsWith('/admin')
  return <div className={isAdmin ? 'app admin-app min-h-screen antialiased' : 'app min-h-screen antialiased'}>{!isAdmin && <Header />}{children}{!isAdmin && <Footer />}{!isAdmin && <MobileNav />}</div>
}

function ProductCard({ product, large = false }) {
  const { wishlist, dispatch, notify } = useStore()
  const [sizeOpen, setSizeOpen] = useState(false)
  const [size, setSize] = useState('')
  const [selectedColor, setSelectedColor] = useState(product.colors?.[0] || '')
  const saved = wishlist.includes(product.id)
  const add = async () => {
    if (!size) { notify('Choose a size to add this little favourite.'); return }
    const saved = await dispatch({ type: 'add', item: { id: product.id, size, color: selectedColor || product.colors[0], quantity: 1 } })
    if (saved) { notify(`${product.name} added to your bag`); setSizeOpen(false) }
  }
  const currentColorEntry = product.colorImages?.find(
    (ci) => ci.color?.toLowerCase()?.trim() === selectedColor?.toLowerCase()?.trim()
  )
  const cardImage = currentColorEntry?.images?.[0] || product.images?.[0] || '/assets/products/girl-01.jpg'
  return <article className={`product-card ${large ? 'product-card-large' : ''}`}>
    <div className="product-image-wrap">
      <Link to={`/product/${product.id}`} className="product-photo"><img src={mediaUrl(cardImage)} alt={`${product.name} kidswear`} loading="lazy" onError={(e) => { e.currentTarget.src = '/assets/shop-banner.jpg' }} /></Link>
      <span className={`product-badge ${product.newArrival ? 'badge-pink' : ''}`}>{product.newArrival ? 'JUST IN' : product.discount + '% OFF'}</span>
      <button className={`heart-float ${saved ? 'is-saved' : ''}`} aria-label={saved ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`} onClick={async () => { if (await dispatch({ type: 'toggleWish', id: product.id })) notify(saved ? 'Removed from your little favorites' : 'Saved to your little favorites') }}><Heart size={19} fill={saved ? 'currentColor' : 'none'} /></button>
      <button className="quick-add" onClick={() => setSizeOpen(!sizeOpen)}>{sizeOpen ? 'Choose a size' : <>Quick add <Plus size={15} /></>}</button>
      {sizeOpen && <div className="size-popover"><div className="size-popover-title">Choose their size</div><div className="size-options">{product.sizes.map((option) => { const inStock = !product.variants?.length || (product.variants.find((variant) => variant.size === option && variant.color === (selectedColor || product.colors[0]))?.stock || 0) > 0; return <button key={option} disabled={!inStock} className={`${size === option ? 'size-selected' : ''} ${!inStock ? 'size-unavailable' : ''}`} onClick={() => setSize(option)}>{option}</button> })}</div><button className="popover-add" onClick={add}>Add to bag <ArrowRight size={14} /></button></div>}
    </div>
    <div className="product-info"><div className="product-label">{product.category} · {product.subcategory}</div><Link to={`/product/${product.id}`} className="product-title">{product.name}</Link>
    {product.colors?.length > 1 && <div className="card-color-swatches">{product.colors.map((c) => <button key={c} type="button" className={`card-color-dot ${selectedColor === c ? 'is-active' : ''}`} style={{ backgroundColor: c.replace(/\s+/g, '').toLowerCase() }} title={c} aria-label={`View in ${c}`} onClick={(e) => { e.preventDefault(); setSelectedColor(c) }} />)}</div>}
    <div className="product-price"><b>{money(product.price)}</b><del>{money(product.originalPrice)}</del><span>{stars} <small>({product.reviews})</small></span></div></div>
  </article>
}

function Home() {
  const { products } = useStore()
  const featured = ['g1', 'b1', 'baby1'].map((id) => products.find((product) => product.id === id)).filter(Boolean)
  if (!featured.length) featured.push(...products.slice(0, 3))
  const bestsellers = products.filter((item) => item.featured).slice(0, 8)
  return <main>
    <section className="banner-wrap page-width"><div className="banner-frame"><img src="/assets/shop-banner.jpg" alt="Little Star Kids Wear shop banner — ages 0 to 15, premium quality and comfort for kids" /><span className="banner-caption"><Sparkles size={14} /> Made for little moments</span></div></section>
    <section className="home-hero page-width">
      <div className="hero-copy"><span className="eyebrow"><span className="eyebrow-dot" /> THE LITTLE STAR PLAYGROUND</span><h1>Little styles.<br /><em>Big dreams.</em></h1><p>Outfits made for little adventures, big imaginations and everything in between.</p><div className="hero-actions"><Link className="button button-blue" to="/shop?category=Girls">Shop girls <ArrowRight size={17} /></Link><Link className="button button-outline" to="/shop?category=Boys">Shop boys</Link></div><div className="hero-proof"><span className="proof-stars">★★★★★</span><span>Loved by little stars & their grown-ups</span></div><span className="hero-doodle doodle-heart">♡</span></div>
      <div className="hero-visual"><div className="hero-sun"></div><div className="hero-main-photo"><img src={imageUrl('photo-1471286174890-9c112ffca5b4', 1200)} alt="Children in colorful outfits enjoying a day together" onError={(e) => { e.currentTarget.src = '/assets/shop-banner.jpg' }} /></div><div className="hero-photo-small"><img src={imageUrl('photo-1503454537195-1dcabb73ffb9', 500)} alt="A little explorer in a playful outfit" /></div><span className="sticker sticker-new"><Sparkles size={13} /> NEW!</span><span className="sticker sticker-comfy">Cute + comfy</span><div className="hero-star" aria-hidden="true">✦</div><span className="hero-caption">For all their little firsts <ArrowDownRight size={18} /></span></div>
    </section>
    <section className="mood-section section-pad">
      <div className="page-width"><div className="section-heading heading-row"><div><span className="eyebrow">A LITTLE OF THIS, A LITTLE OF THAT</span><h2>Pick a mood <span className="heading-spark">✦</span></h2></div><Link className="text-arrow" to="/shop">See everything <ArrowRight size={16} /></Link></div>
        <div className="mood-rail">{moods.map((mood, index) => <Link key={mood.title} to={`/shop?category=${mood.category}`} className={`mood-card mood-${mood.color}`}><div className="mood-image"><img src={mood.image.startsWith('/') ? mood.image : imageUrl(mood.image, 800)} alt={`${mood.title.toLowerCase()} kidswear inspiration`} loading="lazy" /><span className="mood-index">0{index + 1}</span><span className="mood-arrow"><ArrowUpRight size={17} /></span></div><div className="mood-copy"><h3>{mood.title}</h3><p>{mood.note}</p></div></Link>)}</div>
      </div>
    </section>
    <section className="adventure-section page-width section-pad">
      <div className="adventure-photo"><img src={imageUrl('photo-1471286174890-9c112ffca5b4', 1200)} alt="A little one dressed for a day full of discovery" loading="lazy" /><span className="photo-stamp">made<br />to play <span>✦</span></span></div>
      <div className="adventure-copy"><span className="eyebrow">SOFT ON SKIN. BIG ON FUN.</span><h2>Made for little <span>adventures.</span></h2><p>For the cartwheels, the snack breaks, the one-more-story days. Thoughtful everyday pieces that move at their own little pace.</p><ul className="benefit-list"><li><span><Check size={14} /></span> Soft fabrics, happy skin</li><li><span><Check size={14} /></span> Easy fits for busy days</li><li><span><Check size={14} /></span> Play-ready, picture-worthy</li></ul><Link className="button button-blue" to="/shop">Explore the collection <ArrowRight size={17} /></Link><span className="adventure-scribble">♡</span></div>
    </section>
    <section className="loved-section section-pad">
      <div className="page-width"><div className="section-heading heading-row"><div><span className="eyebrow">LITTLE STARS ARE LOVING THESE</span><h2>Good things, in rotation <span className="heading-spark">✦</span></h2></div><Link className="text-arrow" to="/shop?sort=featured">Shop bestsellers <ArrowRight size={16} /></Link></div>
        {featured.length >= 3 && <div className="editorial-products"><div className="feature-product"><ProductCard product={featured[0]} large /><div className="feature-note"><span>01 — MOST LOVED</span><span>One more twirl? Always.</span></div></div><div className="side-products"><ProductCard product={featured[1]} /><ProductCard product={featured[2]} /></div><div className="micro-product-rail">{bestsellers.map((product) => <ProductCard product={product} key={product.id} />)}</div></div>}
      </div>
    </section>
    <section className="age-section page-width section-pad"><div className="age-heading"><div><span className="eyebrow">LITTLE NOW, BIG SOON</span><h2>Growing up in <span>style.</span></h2></div><p>Comfy, happy fits for every new chapter.</p></div><div className="age-path"><div className="age-line"></div>{[{age:'0–2',label:'Tiny explorer',icon:'☁'},{age:'2–5',label:'Little adventurer',icon:'✿'},{age:'5–8',label:'Playground star',icon:'✦'},{age:'8–12',label:'Style explorer',icon:'↗'},{age:'12–15',label:'Young trendsetter',icon:'♡'}].map((item,i)=><Link to={`/shop?age=${encodeURIComponent(item.age)}`} className={`age-stop age-stop-${i+1}`} key={item.age}><span className="age-icon">{item.icon}</span><b>{item.age}</b><small>{item.label}</small></Link>)}</div></section>
    <section className="occasion-section"><div className="page-width occasion-inner"><div className="occasion-intro"><span className="eyebrow light-eyebrow">EVERY DAY IS AN OCCASION</span><h2>Where are we<br />going today<span>?</span></h2><p>Pick the plan. We’ll find the outfit.</p></div><div className="occasion-list">{['Birthday','Wedding','Festival','Family day','Playground','School event'].map((occasion,i)=><Link key={occasion} to={`/shop?occasion=${encodeURIComponent(occasion)}`}><span>0{i+1}</span>{occasion}<ArrowUpRight size={17} /></Link>)}</div><span className="occasion-balloon">✿</span></div></section>
    <section className="promo-section page-width"><div className="promo-shape">✦</div><div className="promo-copy"><span className="eyebrow light-eyebrow">LITTLE STAR, BIG HEART</span><h2>Let them <em>shine.</em></h2><p>Comfortable clothes for every little moment.</p><Link to="/shop" className="button button-yellow">Find their next favourite <ArrowRight size={17} /></Link></div><div className="promo-image"><img src={imageUrl('photo-1503919005314-30d93d07d823', 900)} alt="Happy child in an easy, colorful outfit" loading="lazy" /></div><span className="promo-side-note">Little style... big dreams... ♡</span></section>
    <section className="trust-row page-width"><div><span><Truck size={19} /></span><b>Free delivery over ₹1,499</b><small>A little treat from us</small></div><div><span><ShieldCheck size={19} /></span><b>Quality you can feel</b><small>Softness, checked twice</small></div><div><span><PackageCheck size={19} /></span><b>Easy 7-day returns</b><small>Find the just-right fit</small></div><div><span><Heart size={19} /></span><b>Made for little people</b><small>Thoughtfully picked styles</small></div></section>
  </main>
}

function Breadcrumbs({ items = [] }) { return <div className="breadcrumbs"><Link to="/">Home</Link>{items.map((item, i) => <React.Fragment key={i}><ChevronRight size={13} />{item.to ? <Link to={item.to}>{item.label}</Link> : <span>{item.label}</span>}</React.Fragment>)}</div> }

function Shop() {
  const { products: catalog, categories } = useStore()
  const [params, setParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filters, setFilters] = useState({ category: params.get('category') || '', age: (params.get('age') || '').replace('–','-'), size: params.get('size') || '', price: params.get('price') || '', color: params.get('color') || '', occasion: params.get('occasion') || '', sort: params.get('sort') || 'featured', search: params.get('search') || '' })
  useEffect(() => { setFilters((f) => ({ ...f, category: params.get('category') || '', age: (params.get('age') || '').replace('–','-'), size: params.get('size') || '', price: params.get('price') || '', color: params.get('color') || '', occasion: params.get('occasion') || '', sort: params.get('sort') || 'featured', search: params.get('search') || '' })) }, [params])
  const set = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setParams((p) => { const next = new URLSearchParams(p); if(value) next.set(key, value); else next.delete(key); return next }, { replace: key === 'search' }) }
  useEffect(() => {
    let active = true
    setLoading(true); setLoadError('')
    productList({ category: filters.category, age: filters.age, size: filters.size, price: filters.price, color: filters.color, occasion: filters.occasion, search: filters.search, sort: filters.sort, limit: 100 })
      .then((result) => { if (active) setFiltered(result.items || []) })
      .catch((error) => { if (active) { setFiltered([]); setLoadError(error.message) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [filters])
  const clear = () => { setFilters({ category: '', age: '', size: '', price: '', color: '', occasion: '', sort: 'featured', search: '' }); setParams({}) }
  return <main className="page-width shop-page"><Breadcrumbs items={[{label:'Shop'}]} /><div className="shop-title-row"><div><span className="eyebrow">A LITTLE SOMETHING FOR EVERYONE</span><h1>{filters.category ? `${filters.category}, with love.` : 'The little star edit.'}</h1><p>For play days, party days and all the in-between ones.</p></div><form className="shop-search" onSubmit={(e)=>e.preventDefault()}><Search size={17} /><input value={filters.search} onChange={(e)=>set('search',e.target.value)} placeholder="Search little favourites" aria-label="Search the shop" /></form></div>
    <div className="shop-toolbar"><button className={`filter-toggle ${filtersOpen ? 'active' : ''}`} onClick={()=>setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} /> Filters <span>{[filters.category,filters.age,filters.size,filters.price,filters.color,filters.occasion].filter(Boolean).length || ''}</span></button><div className="result-count">Showing <b>{filtered.length}</b> little favourites</div><label className="sort-control">Sort by <select value={filters.sort} onChange={(e)=>set('sort',e.target.value)}><option value="featured">Featured</option><option value="newest">Newest</option><option value="price-asc">Price low to high</option><option value="price-desc">Price high to low</option><option value="rating">Top rated</option></select></label></div>
    <div className={`filter-panel ${filtersOpen ? 'filters-open' : ''}`}><label>Category<select value={filters.category} onChange={(e)=>set('category',e.target.value)}><option value="">All little stars</option>{(categories.length ? categories.map((category) => category.name) : ['Girls','Boys','Baby']).map((name)=><option key={name}>{name}</option>)}</select></label><label>Age<select value={filters.age} onChange={(e)=>set('age',e.target.value)}><option value="">Any age</option><option value="0-2">0–2 years</option><option value="2-5">2–5 years</option><option value="5-8">5–8 years</option><option value="8-12">8–12 years</option><option value="12-15">12–15 years</option></select></label><label>Size<select value={filters.size} onChange={(e)=>set('size',e.target.value)}><option value="">Any size</option>{['0-3M','3-6M','6-9M','9-12M','3-4Y','4-5Y','5-6Y','6-7Y','8-9Y','10-11Y','12-13Y','14-15Y'].map(s=><option key={s}>{s}</option>)}</select></label><label>Price<select value={filters.price} onChange={(e)=>set('price',e.target.value)}><option value="">Any price</option><option value="under-1000">Under ₹1,000</option><option value="1000-1500">₹1,000–₹1,500</option><option value="over-1500">₹1,500+</option></select></label><label>Color<select value={filters.color} onChange={(e)=>set('color',e.target.value)}><option value="">Any color</option>{[...new Set(catalog.flatMap(p=>p.colors))].map(s=><option key={s}>{s}</option>)}</select></label><label>Occasion<select value={filters.occasion} onChange={(e)=>set('occasion',e.target.value)}><option value="">Any occasion</option>{[...new Set(catalog.flatMap(p=>p.occasion))].map(s=><option key={s}>{s}</option>)}</select></label><button className="clear-filters" onClick={clear}>Clear all</button></div>
    {loading ? <div className="empty-results" role="status">Loading little favourites…</div> : loadError ? <div className="empty-results" role="alert"><h2>We couldn’t load the shop.</h2><p>{loadError}</p></div> : filtered.length ? <div className="shop-grid">{filtered.map((product)=><ProductCard key={product.id} product={product} />)}</div> : <div className="empty-results"><span>✦</span><h2>No little looks found just yet.</h2><p>Try a different search or let’s start fresh.</p><button className="button button-blue" onClick={clear}>Clear filters</button></div>}
  </main>
}

function ProductDetail() {
  const { id } = useParams(); const { products: catalog, dispatch, wishlist, notify } = useStore(); const product = catalog.find((p) => p.id === id)
  const navigate = useNavigate()
  const [size, setSize] = useState(''); const [color, setColor] = useState(product?.colors[0] || ''); const [quantity, setQuantity] = useState(1); const [open, setOpen] = useState('Product details'); const [error, setError] = useState(''); const [activeImageIndex, setActiveImageIndex] = useState(0)
  useEffect(() => setActiveImageIndex(0), [id, color])
  if (!product) return <NotFound />
  const currentColorEntry = product.colorImages?.find((ci) => ci.color?.toLowerCase()?.trim() === color?.toLowerCase()?.trim())
  const colorSpecificImages = (currentColorEntry?.images || []).filter(Boolean)
  const productImages = colorSpecificImages.length > 0 ? colorSpecificImages : (product.images?.length ? product.images : ['/assets/products/girl-01.jpg'])
  const activeImage = productImages[activeImageIndex] || productImages[0]
  const save = wishlist.includes(product.id)
  const selectedVariant = product.variants?.find((variant) => variant.size === size && variant.color === color)
  const selectedStock = selectedVariant?.stock ?? (product.variants?.length ? 0 : product.stock)
  const colorAvailable = (candidate) => !product.variants?.length || product.variants.some((variant) => variant.color === candidate && variant.stock > 0)
  const sizeAvailable = (candidate) => !product.variants?.length || (product.variants.find((variant) => variant.size === candidate && variant.color === color)?.stock || 0) > 0
  const add = async () => { if (!size) { setError('Pick a size first so we can get the fit just right.'); return false }; if (selectedStock < quantity) { setError('That size and color is out of stock.'); return false }; setError(''); const saved=await dispatch({type:'add',item:{id:product.id,size,color,quantity}}); if(saved) notify(`${product.name} added to your bag`); return saved }
  return <main className="page-width detail-page"><Breadcrumbs items={[{label:'Shop',to:'/shop'},{label:product.name}]} /><div className="detail-grid"><div className="detail-gallery">
      <div className="detail-main-image"><img src={mediaUrl(activeImage)} alt={`${product.name} in ${color}`} onError={(event)=>{event.currentTarget.src='/assets/shop-banner.jpg'}} /><span className="product-badge badge-pink">{product.newArrival?'JUST IN':product.discount + '% OFF'}</span></div>
      <div className="detail-thumbnails" role="group" aria-label={`${product.name} ${color} images`}>{productImages.map((image,index)=><button type="button" className={'detail-thumbnail ' + (index===activeImageIndex?'is-selected':'')} key={color + '-' + image + '-' + index} aria-label={'View image ' + (index + 1) + ' of ' + product.name + ' in ' + color} aria-pressed={index===activeImageIndex} onClick={()=>setActiveImageIndex(index)}><img src={mediaUrl(image)} alt="" loading="lazy" /></button>)}</div>
      </div><div className="detail-info"><span className="eyebrow">{product.category} · {product.subcategory}</span><h1>{product.name}</h1><div className="detail-rating">{stars} <b>{product.rating}</b> <span>({product.reviews} happy reviews)</span></div><div className="detail-price"><b>{money(product.price)}</b><del>{money(product.originalPrice)}</del><span>{product.discount}% off</span></div><p className="detail-description">{product.description}</p><div className="choice-label">Color <b>{color}</b>{colorSpecificImages.length > 0 && <span className="color-images-indicator">✦ {colorSpecificImages.length} {colorSpecificImages.length === 1 ? 'photo' : 'photos'} in {color}</span>}</div><div className="color-options">{product.colors.map((c)=><button disabled={!colorAvailable(c)} className={`color-dot ${color===c?'color-active':''} ${!colorAvailable(c)?'size-unavailable':''}`} style={{ backgroundColor: c.replace(/\s+/g, '').toLowerCase() }} key={c} aria-label={`Choose ${c}${colorAvailable(c)?'':' (out of stock)'}`} title={colorAvailable(c)?c:`${c} — out of stock`} onClick={()=>{setColor(c);if(size&&product.variants?.length&&!product.variants.some((variant)=>variant.size===size&&variant.color===c&&variant.stock>0))setSize('')}} />)}</div><div className="choice-label size-label">Choose size <Link to="/size-guide">Size guide <ArrowUpRight size={13} /></Link></div><div className="detail-sizes">{product.sizes.map((s)=><button key={s} disabled={!sizeAvailable(s)} className={`${size===s?'selected-size':''} ${!sizeAvailable(s)?'size-unavailable':''}`} onClick={()=>{setSize(s);setError('')}}>{s}</button>)}</div>{error&&<p className="form-error">{error}</p>}<div className="quantity-row"><span>Quantity</span><div className="quantity-stepper"><button aria-label="Decrease quantity" onClick={()=>setQuantity(Math.max(1,quantity-1))}><Minus size={14}/></button><span>{quantity}</span><button aria-label="Increase quantity" onClick={()=>setQuantity(Math.min(selectedStock,quantity+1))} disabled={quantity>=selectedStock}><Plus size={14}/></button></div></div><div className="detail-actions"><button className="button button-blue add-cart-button" onClick={add} disabled={Boolean(size && !selectedStock)}>Add to bag <ShoppingBag size={17} /></button><button className={`detail-wish ${save?'is-saved':''}`} aria-label={save?'Remove from wishlist':'Add to wishlist'} onClick={async()=>{if(await dispatch({type:'toggleWish',id:product.id}))notify(save?'Removed from your little favorites':'Saved to your little favorites')}}><Heart fill={save?'currentColor':'none'} /></button></div><button className="button button-outline buy-now" onClick={async()=>{if(size){if(await add())navigate('/checkout')}else setError('Pick a size first so we can get the fit just right.')}}>Buy now <ArrowRight size={16}/></button><div className="delivery-note"><Truck size={17}/><span>Comfy looks on the way. <b>Free delivery over ₹1,499.</b></span></div><div className="detail-accordions">{['Product details','Material & care','Size & fit','Delivery & returns'].map((item)=><div className={`accordion ${open===item?'accordion-open':''}`} key={item}><button onClick={()=>setOpen(open===item?'':item)}>{item}<ChevronDown size={16}/></button>{open===item&&<p>{item==='Product details'?product.description:item==='Material & care'?`${product.material}. Machine wash cold with like colors. Dry in shade for a little longer-lasting love.`:item==='Size & fit'?'True to size with an easy, comfortable fit. Between sizes? We recommend choosing the larger size.':'Ships from our Darbhanga store. Easy 7-day returns on unworn items with tags attached.'}</p>}</div>)}</div></div></div><section className="you-may-like"><div className="section-heading heading-row"><h2>You might also like</h2><Link className="text-arrow" to="/shop">See all <ArrowRight size={15}/></Link></div><div className="recommend-grid">{catalog.filter(p=>p.category===product.category&&p.id!==product.id).slice(0,4).map(p=><ProductCard key={p.id} product={p}/>)}</div></section></main>
}

function Cart() {
  const { cart, products, dispatch, notify } = useStore()
  const lines = cart.map((line) => ({...line, cartKey:cartLineKey(line), product:products.find(p=>p.id===line.id) || line.product})).filter((line)=>line.product)
  const subtotal = lines.reduce((n,line)=>n+line.product.price*line.quantity,0); const discount = lines.reduce((n,line)=>n+(line.product.originalPrice-line.product.price)*line.quantity,0); const shipping = subtotal >= 1499 || !subtotal ? 0 : 99
  return <main className="page-width cart-page"><Breadcrumbs items={[{label:'Your bag'}]} /><div className="cart-heading"><span className="eyebrow">A FEW LITTLE FAVOURITES</span><h1>Your little star’s picks <span>✦</span></h1><p>{lines.length ? `${lines.length} lovely ${lines.length===1?'find':'finds'} in your bag.` : 'Nothing here yet. Let’s find something special.'}</p></div>{lines.length ? <div className="cart-layout"><div className="cart-lines">{lines.map(({product,...line})=><article className="cart-line" key={line.cartKey}><Link to={`/product/${product.id}`} className="cart-photo"><img src={mediaUrl(product.images?.[0]) || '/assets/products/girl-01.jpg'} alt={product.name} /></Link><div className="cart-item-copy"><span className="product-label">{product.category}</span><Link className="cart-item-title" to={`/product/${product.id}`}>{product.name}</Link><p>Size: {line.size} <span>·</span> Color: {line.color}</p><div className="quantity-stepper"><button aria-label="Decrease quantity" onClick={()=>dispatch({type:'quantity',key:line.cartKey,delta:-1})}><Minus size={14}/></button><span>{line.quantity}</span><button aria-label="Increase quantity" onClick={()=>dispatch({type:'quantity',key:line.cartKey,delta:1})}><Plus size={14}/></button></div></div><div className="cart-item-end"><b>{money(product.price*line.quantity)}</b><button className="remove-item" aria-label={`Remove ${product.name}`} onClick={()=>{dispatch({type:'remove',key:line.cartKey});notify('Removed from your bag')}}><Trash2 size={16}/></button></div></article>)}<Link className="text-arrow continue-link" to="/shop"><ArrowLeft size={15}/> Keep discovering</Link></div><aside className="order-card"><span className="eyebrow">THE LITTLE DETAILS</span><h2>Order summary</h2><div className="summary-line"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="summary-line discount-line"><span>Little Star savings</span><b>−{money(discount)}</b></div><div className="summary-line"><span>Delivery</span><b>{shipping?money(shipping):'On us'}</b></div><div className="summary-total"><span>Total</span><b>{money(subtotal+shipping)}</b></div><p className="tax-note">Inclusive of all taxes</p><Link to="/checkout" className="button button-blue full-button">Continue to checkout <ArrowRight size={16}/></Link><div className="secure-note"><LockKeyhole size={14}/> Safe & secure checkout</div></aside></div> : <div className="empty-bag"><div className="empty-star"><Star size={46} fill="currentColor"/></div><h2>Nothing here yet!</h2><p>Let’s find something special for your little star.</p><Link to="/shop" className="button button-blue">Explore the collection <ArrowRight size={16}/></Link></div>}</main>
}

function Wishlist() {
  const { wishlist, products } = useStore(); const saved = products.filter((p)=>wishlist.includes(p.id))
  return <main className="page-width saved-page"><Breadcrumbs items={[{label:'Little favorites'}]} /><div className="saved-heading"><span className="eyebrow">A COLLECTION OF THEIR YESSES</span><h1>Little favorites <span>♡</span></h1><p>All the lovely looks they’ve had their eye on.</p></div>{saved.length?<div className="shop-grid">{saved.map((p)=><ProductCard key={p.id} product={p}/>)}</div>:<div className="empty-bag"><div className="empty-star pink-star">♡</div><h2>Your little star hasn’t picked a favorite yet.</h2><p>When they do, you’ll find it right here.</p><Link to="/shop" className="button button-blue">Find their favourites <ArrowRight size={16}/></Link></div>}</main>
}

let razorpayScriptPromise = null
function loadRazorpayScript() {
  if (typeof window !== 'undefined' && window.Razorpay) return Promise.resolve(true)
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve) => {
      const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')
      if (existing) {
        existing.addEventListener('load', () => resolve(true), { once: true })
        existing.addEventListener('error', () => { razorpayScriptPromise = null; resolve(false) }, { once: true })
        return
      }
      const script = document.createElement('script')
      script.src = 'https://checkout.razorpay.com/v1/checkout.js'
      script.async = true
      script.onload = () => resolve(true)
      script.onerror = () => { razorpayScriptPromise = null; resolve(false) }
      document.body.appendChild(script)
    })
  }
  return razorpayScriptPromise
}

function Checkout() {
  const { cart, products, user, refreshCart, refreshUser } = useStore()
  const [done, setDone] = useState(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [paymentStage, setPaymentStage] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cod')
  const [razorpayConfig, setRazorpayConfig] = useState({ loading: true, enabled: true, keyId: '' })
  const keyRef = useRef('')
  const autofilledUserIdRef = useRef('')
  const savedAddresses = user?.addresses || []

  const [selectedAddressId, setSelectedAddressId] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [fullName, setFullName] = useState('')
  const [line1, setLine1] = useState('')
  const [city, setCity] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [landmark, setLandmark] = useState('')

  useEffect(() => {
    let active = true
    api('/payment/razorpay/config')
      .then((data) => {
        if (!active) return
        const enabled = Boolean(data?.enabled)
        setRazorpayConfig({ loading: false, enabled, keyId: data?.keyId || '' })
        if (!enabled) setPaymentMethod((prev) => (prev === 'razorpay' ? 'cod' : prev))
      })
      .catch(() => {
        if (active) setRazorpayConfig({ loading: false, enabled: false, keyId: '' })
      })
    return () => { active = false }
  }, [])

  const applySavedAddress = useCallback((address) => {
    if (!address) return
    setSelectedAddressId(address._id || '')
    setFullName(address.fullName || '')
    if (address.phone) setPhone(address.phone)
    setLine1(address.line1 || '')
    setCity(address.city || '')
    setPostalCode(address.postalCode || '')
    setLandmark(address.landmark || '')
  }, [])

  useEffect(() => {
    if (!user) {
      autofilledUserIdRef.current = ''
      return
    }
    const userId = user._id || user.id || user.email || 'user'
    if (autofilledUserIdRef.current === userId) return
    autofilledUserIdRef.current = userId
    const addresses = user.addresses || []
    const preferred = addresses.find((entry) => entry.isDefault) || addresses[addresses.length - 1]
    setEmail(user.contactEmail || user.email || '')
    setPhone(preferred?.phone || user.phone || '')
    setFullName(preferred?.fullName || user.name || '')
    if (preferred) {
      setSelectedAddressId(preferred._id || '')
      setLine1(preferred.line1 || '')
      setCity(preferred.city || '')
      setPostalCode(preferred.postalCode || '')
      setLandmark(preferred.landmark || '')
    }
  }, [user])

  if (!user) return <Navigate to="/login" />
  const checkoutLines = cart.map((line) => ({ ...line, resolvedProduct: products.find((item) => item.id === line.id) || line.product }))
  const subtotal = checkoutLines.reduce((sum, line) => sum + (line.resolvedProduct?.price || 0) * line.quantity, 0)
  const shipping = subtotal >= 1499 || subtotal === 0 ? 0 : 99
  const total = subtotal + shipping
  const onSubmit = async (event) => {
    event.preventDefault(); setError(''); setSubmitting(true); setPaymentStage('')
    if (!keyRef.current) keyRef.current = crypto.randomUUID ? crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}-retry`
    try {
      if (paymentMethod === 'razorpay') {
        if (!razorpayConfig.loading && !razorpayConfig.enabled) {
          throw new Error('Online payments via Razorpay are currently unavailable. Please choose Cash on Delivery.')
        }
        setPaymentStage('Loading Razorpay checkout…')
        if (!(await loadRazorpayScript())) {
          throw new Error('Razorpay checkout could not load. Check your internet connection or ad blocker and try again.')
        }
      }

      setPaymentStage(paymentMethod === 'razorpay' ? 'Creating Razorpay order…' : '')
      const result = await api('/orders', { method: 'POST', headers: { 'Idempotency-Key': keyRef.current }, body: {
        name: fullName, email, phone, paymentMethod,
        address: { fullName, line1, city, postalCode, landmark: landmark || '' },
      } })

      if (paymentMethod === 'razorpay') {
        const key = result.razorpayKeyId || razorpayConfig.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID
        if (!result.razorpayOrder?.id || !key) {
          throw new Error('Razorpay payment session could not be started. Please try again.')
        }
        let paymentSettled = false
        let lastFailureReason = ''
        const markAbandoned = async (reason) => {
          try {
            await api('/payment/razorpay/failure', { method: 'POST', body: { razorpay_order_id: result.razorpayOrder.id, reason } })
          } catch {
            // Keep UI recoverable even if cleanup request fails
          }
        }
        const options = {
          key,
          amount: result.razorpayOrder.amount,
          currency: result.razorpayOrder.currency,
          name: 'Little Star Kids Wear',
          description: `Order ${result.order.orderNumber}`,
          order_id: result.razorpayOrder.id,
          notes: { orderNumber: result.order.orderNumber },
          handler: async function (response) {
            paymentSettled = true
            setError('')
            setPaymentStage('Verifying payment…')
            try {
              const verified = await api('/payment/razorpay/verify', { method: 'POST', body: response })
              setDone(verified.order || result.order)
              keyRef.current = ''
              await Promise.all([refreshCart(), refreshUser()])
              window.scrollTo(0, 0)
            } catch (err) {
              setError(err.message || 'Payment verification failed.')
            } finally {
              setSubmitting(false)
              setPaymentStage('')
            }
          },
          modal: {
            ondismiss: async function () {
              if (paymentSettled) return
              paymentSettled = true
              await markAbandoned(lastFailureReason || 'Payment cancelled by customer')
              keyRef.current = ''
              setSubmitting(false)
              setPaymentStage('')
              setError(lastFailureReason
                ? `${lastFailureReason}. Your bag items are still saved—try again or choose Cash on Delivery.`
                : 'Payment was cancelled. Your bag items are still saved—try again or choose Cash on Delivery.')
            },
          },
          prefill: { name: fullName, email, contact: phone.replace(/[^\d+]/g, '') },
          theme: { color: '#3b4a9a' },
        }
        setPaymentStage('Complete payment in Razorpay…')
        const paymentObject = new window.Razorpay(options)
        paymentObject.on('payment.failed', function (failureEvent) {
          lastFailureReason = failureEvent?.error?.description || failureEvent?.error?.reason || 'Payment failed'
          setError(`${lastFailureReason}. You can retry inside Razorpay or close the popup to switch payment method.`)
        })
        paymentObject.open()
        return
      }

      setDone(result.order); keyRef.current = ''; await Promise.all([refreshCart(), refreshUser()]); window.scrollTo(0, 0)
      setSubmitting(false)
      setPaymentStage('')
    } catch (submitError) {
      setError(submitError.message || 'We couldn’t place the order. Please try again.')
      setSubmitting(false)
      setPaymentStage('')
    }
  }
  const submitLabel = submitting
    ? (paymentStage || 'Placing order…')
    : (paymentMethod === 'razorpay' ? 'Pay & place order' : 'Place your order')
  if (done) return <main className="success-page page-width"><div className="success-orbit"><span>✦</span><Check size={38}/></div><span className="eyebrow">A LITTLE JOY IS ON ITS WAY</span><h1>Yay! Order placed! <span>🎉</span></h1><p>Your little star’s new outfit is on the way.</p><div className="order-id">Your order number <b>{done.orderNumber}</b></div><p style={{ marginTop: '-10px', marginBottom: '20px', fontSize: '0.92rem', color: 'var(--ink-soft)' }}>{done.paymentMethod === 'razorpay' ? `Paid online via Razorpay${done.razorpayPaymentId ? ` · ${done.razorpayPaymentId}` : ''}` : 'Cash on delivery'}</p><Link className="button button-blue" to={user ? '/orders' : '/shop'}>{user ? 'See your order' : 'Keep discovering'} <ArrowRight size={16}/></Link></main>
  if (!cart.length) return <main className="page-width checkout-empty"><div className="empty-bag"><div className="empty-star"><ShoppingBag size={34}/></div><h2>Your bag is waiting for a little something.</h2><p>Find an outfit for the next big adventure.</p><Link className="button button-blue" to="/shop">Explore the collection <ArrowRight size={16}/></Link></div></main>
  return <main className="page-width checkout-page"><Breadcrumbs items={[{label:'Your bag',to:'/cart'},{label:'Checkout'}]} /><div className="checkout-head"><span className="eyebrow">THE LAST LITTLE STEP</span><h1>Let’s get it to you.</h1><p>We’ll keep checkout simple and secure.</p></div><div className="checkout-grid"><form id="checkout-form" className="checkout-form" onSubmit={onSubmit}>
    <section className="checkout-block"><div className="checkout-step"><span>01</span><div><h2>Contact</h2><p>Where can we reach you?</p></div></div><div className="field-grid"><label>Email address<input type="email" name="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label><label>Phone number<input type="tel" name="phone" required minLength="10" pattern="(?:\+|[0-9])(?:[0-9]| |-|\(|\)){8,16}[0-9]" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" autoComplete="tel" /></label></div></section>
    <section className="checkout-block"><div className="checkout-step"><span>02</span><div><h2>Delivery address</h2><p>Where should their new favourite go?</p></div></div>{savedAddresses.length > 0 && <div className="saved-address-picker" role="group" aria-label="Saved addresses">{savedAddresses.map((addr) => <button type="button" key={addr._id} className={`saved-address-chip ${selectedAddressId === addr._id ? 'is-selected' : ''}`} onClick={() => applySavedAddress(addr)}><b>{addr.label || 'Saved'}</b><span>{addr.line1}, {addr.city} {addr.postalCode}</span></button>)}</div>}<div className="field-grid"><label className="field-wide">Full name<input name="fullName" required pattern=".*\S.*" value={fullName} onChange={(e) => { setSelectedAddressId(''); setFullName(e.target.value) }} placeholder="Your name" autoComplete="name" /></label><label className="field-wide">Address<input name="line1" required pattern=".*\S.*" value={line1} onChange={(e) => { setSelectedAddressId(''); setLine1(e.target.value) }} placeholder="House no., street, locality" autoComplete="street-address" /></label><label>City<input name="city" required pattern=".*\S.*" value={city} onChange={(e) => { setSelectedAddressId(''); setCity(e.target.value) }} placeholder="Darbhanga" autoComplete="address-level2" /></label><label>PIN code<input name="postalCode" required pattern="[0-9]{6}" value={postalCode} onChange={(e) => { setSelectedAddressId(''); setPostalCode(e.target.value) }} placeholder="846001" autoComplete="postal-code" /></label><label className="field-wide">Landmark <small>(optional)</small><input name="landmark" value={landmark} onChange={(e) => { setSelectedAddressId(''); setLandmark(e.target.value) }} placeholder="Nearby landmark" /></label></div></section>
    <section className="checkout-block"><div className="checkout-step"><span>03</span><div><h2>Delivery method</h2><p>One happy package, coming up.</p></div></div><label className="option-card"><input type="radio" name="delivery" defaultChecked /><span className="option-icon"><Truck size={17}/></span><span><b>Standard delivery</b><small>3–5 working days</small></span><b className="option-price">{shipping ? money(shipping) : 'Free'}</b></label></section>
    <section className="checkout-block"><div className="checkout-step"><span>04</span><div><h2>Payment method</h2><p>Choose what feels easy.</p></div></div><label className="option-card"><input type="radio" name="payment" value="cod" checked={paymentMethod === 'cod'} onChange={() => setPaymentMethod('cod')} /><span className="option-icon"><PackageCheck size={17}/></span><span><b>Cash on delivery</b><small>Pay when your package arrives</small></span></label><label className={`option-card ${!razorpayConfig.loading && !razorpayConfig.enabled ? 'payment-unavailable' : ''}`}><input type="radio" name="payment" value="razorpay" checked={paymentMethod === 'razorpay'} disabled={!razorpayConfig.loading && !razorpayConfig.enabled} onChange={() => setPaymentMethod('razorpay')} /><span className="option-icon"><CreditCard size={17}/></span><span><b>Razorpay (UPI / Cards / NetBanking)</b><small>{!razorpayConfig.loading && !razorpayConfig.enabled ? 'Configure RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET on backend' : 'Pay securely online via Razorpay'}</small></span></label></section>
    {error && <p className="form-error" role="alert">{error}</p>}<button type="submit" className="button button-blue place-order-mobile" disabled={submitting}>{submitLabel} <ArrowRight size={16}/></button></form>
    <aside className="order-card checkout-summary"><span className="eyebrow">YOUR LITTLE PICKS</span><h2>Order summary</h2>{checkoutLines.map((line)=>{const p=line.resolvedProduct;return p&&<div className="checkout-item" key={cartLineKey(line)}><img src={mediaUrl(p.images?.[0]) || '/assets/products/girl-01.jpg'} alt=""/><div><b>{p.name}</b><small>Size {line.size} · Qty {line.quantity}</small></div><span>{money(p.price*line.quantity)}</span></div>})}<div className="summary-line"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="summary-line"><span>Delivery</span><b>{shipping ? money(shipping) : 'Free'}</b></div><div className="summary-total"><span>Total</span><b>{money(total)}</b></div><button form="checkout-form" className="button button-blue full-button" type="submit" disabled={submitting}>{submitLabel} <ArrowRight size={16}/></button><div className="secure-note"><LockKeyhole size={14}/> Secure checkout, happy little hearts</div></aside></div></main>
}
function AuthPage({ register = false }) {
  const { login, googleLogin } = useStore()
  const nav = useNavigate()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const onSubmit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true)
    const data = new FormData(event.currentTarget)
    try {
      const user = await login({ name: data.get('name'), email: data.get('email'), password: data.get('password') }, register)
      nav(user.role === 'admin' ? '/admin' : '/account')
    } catch (requestError) { setError(requestError.message || 'We couldn’t sign you in. Please try again.') }
    finally { setBusy(false) }
  }

  const onGoogleSuccess = async (credentialResponse) => {
    setError(''); setBusy(true)
    try {
      const user = await googleLogin(credentialResponse.credential)
      nav(user.role === 'admin' ? '/admin' : '/account')
    } catch (requestError) { setError(requestError.message || 'Google sign in failed.') }
    finally { setBusy(false) }
  }

  return (
    <main className="auth-page page-width">
      <div className="auth-art">
        <div className="auth-art-circle"><Star size={82} fill="currentColor"/></div>
        <span className="eyebrow light-eyebrow">A LITTLE HELLO</span>
        <h2>{register ? 'New here?' : 'Good to see you.'}<br/><em>{register ? 'Let’s get cozy.' : 'Welcome back.'}</em></h2>
        <p>Your little star’s happy place for all things comfy and cute.</p>
        <span className="auth-art-note">Little style.<br/>Big dreams. ♡</span>
      </div>

      <div className="auth-form-panel">
        <BrandMark/>
        <span className="eyebrow">{register ? 'START YOUR LITTLE STAR ACCOUNT' : 'COME ON IN'}</span>
        <h1>{register ? 'Create an account' : 'Welcome back'}</h1>
        <p>{register ? 'Save favorites and keep all their little looks together.' : 'Sign in to find your saved looks and orders.'}</p>

        <form onSubmit={onSubmit}>
          {register && <label>Your name<input name="name" required minLength="2" pattern=".*\S.*" placeholder="Your name" autoComplete="name"/></label>}
          <label>Email address<input type="email" name="email" required placeholder="you@example.com" autoComplete="email"/></label>
          <label>Password<input type="password" name="password" required minLength="8" maxLength="72" placeholder={register ? '8 or more characters' : 'Your password'} autoComplete={register ? 'new-password' : 'current-password'}/></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-blue full-button" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'} <ArrowRight size={16}/></button>
        </form>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.25rem' }}>
          <GoogleLogin onSuccess={onGoogleSuccess} onError={() => setError('Google sign in was unsuccessful.')}/>
        </div>

        <div className="auth-switch">
          {register ? 'Already have an account?' : 'New to Little Star?'} <Link to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'}</Link>
        </div>
        <p className="mock-note"><LockKeyhole size={13}/> Your account is protected with secure sign-in.</p>
      </div>
    </main>
  )
}

function Account() {
  const { user, logout, refreshUser, notify } = useStore()
  const name = user?.name || 'Little Star grown-up'
  const [error, setError] = useState('')
  const [profileName, setProfileName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [showAddressForm, setShowAddressForm] = useState(false)
  const [addrLabel, setAddrLabel] = useState('Home')
  const [addrName, setAddrName] = useState('')
  const [addrPhone, setAddrPhone] = useState('')
  const [addrLine1, setAddrLine1] = useState('')
  const [addrCity, setAddrCity] = useState('')
  const [addrPostalCode, setAddrPostalCode] = useState('')
  const [addrLandmark, setAddrLandmark] = useState('')
  const [savingAddr, setSavingAddr] = useState(false)

  useEffect(() => {
    if (!user) return
    setProfileName(user.name || '')
    setContactEmail(user.contactEmail || user.email || '')
    setPhone(user.phone || '')
    setAddrName(user.name || '')
    setAddrPhone(user.phone || '')
  }, [user])

  const signOut = async () => { try { await logout(); setError('') } catch (requestError) { setError(requestError.message) } }

  const saveContact = async (event) => {
    event.preventDefault(); setError(''); setSavingProfile(true)
    try {
      await api('/auth/me', { method: 'PUT', body: { name: profileName, contactEmail, phone } })
      await refreshUser()
      notify('Contact details saved.')
    } catch (requestError) {
      setError(requestError.message || 'Could not save contact details.')
    } finally {
      setSavingProfile(false)
    }
  }

  const saveAddress = async (event) => {
    event.preventDefault(); setError(''); setSavingAddr(true)
    try {
      await api('/auth/addresses', {
        method: 'POST',
        body: { label: addrLabel, fullName: addrName, phone: addrPhone, line1: addrLine1, city: addrCity, postalCode: addrPostalCode, landmark: addrLandmark, isDefault: true }
      })
      await refreshUser()
      setAddrLine1(''); setAddrCity(''); setAddrPostalCode(''); setAddrLandmark(''); setShowAddressForm(false)
      notify('Delivery address saved.')
    } catch (requestError) {
      setError(requestError.message || 'Could not save delivery address.')
    } finally {
      setSavingAddr(false)
    }
  }

  const setDefaultAddress = async (addressId) => {
    setError('')
    try {
      await api(`/auth/addresses/${addressId}/default`, { method: 'PUT' })
      await refreshUser()
      notify('Default address updated.')
    } catch (requestError) { setError(requestError.message) }
  }

  const removeAddress = async (addressId) => {
    setError('')
    try {
      await api(`/auth/addresses/${addressId}`, { method: 'DELETE' })
      await refreshUser()
      notify('Address removed.')
    } catch (requestError) { setError(requestError.message) }
  }

  const contactDisplay = user?.phone ? `+91 ${user.phone}` : (user?.contactEmail || (user?.email && !user.email.endsWith('@phone.littlestar.local') ? user.email : 'Little Star Family'))
  const addresses = user?.addresses || []

  return <main className="page-width account-page"><Breadcrumbs items={[{label:'My account'}]} /><div className="account-welcome"><span className="eyebrow">A HOME FOR ALL THEIR LITTLE LOOKS</span><h1>Hello, {name} <span>♡</span></h1><p>Here’s everything for your little star, all in one place.</p></div><div className="account-grid"><Link to="/orders" className="account-tile"><span><ClipboardList/></span><b>My orders</b><small>All the little packages on their way</small><ArrowRight/></Link><Link to="/wishlist" className="account-tile"><span><Heart/></span><b>Little favorites</b><small>Looks they’ve saved for later</small><ArrowRight/></Link><Link to="/size-guide" className="account-tile"><span><Shirt/></span><b>Size guide</b><small>Find their just-right fit</small><ArrowRight/></Link><Link to="/contact" className="account-tile"><span><MapPin/></span><b>Addresses & help</b><small>We’re always happy to help</small><ArrowRight/></Link></div>
    {user && <div className="account-saved-grid">
      <section className="checkout-block">
        <div className="checkout-step"><span>01</span><div><h2>Saved contact details</h2><p>Autofilled automatically at checkout.</p></div></div>
        <form className="checkout-form" onSubmit={saveContact}>
          <div className="field-grid">
            <label className="field-wide">Full name<input required minLength="2" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Your name" /></label>
            <label>Contact email<input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="you@example.com" /></label>
            <label>Phone number<input type="tel" minLength="10" pattern="(?:\+|[0-9])(?:[0-9]| |-|\(|\)){8,16}[0-9]" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" /></label>
          </div>
          <button type="submit" className="button button-blue" style={{ marginTop: '14px' }} disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save contact details'}</button>
        </form>
      </section>

      <section className="checkout-block">
        <div className="checkout-step" style={{ justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span className="account-step-badge">02</span>
            <div><h2>Saved delivery addresses</h2><p>Used to pre-fill your shipping details.</p></div>
          </div>
          <button type="button" className="button button-outline" onClick={() => setShowAddressForm((v) => !v)}>{showAddressForm ? 'Cancel' : 'Add address'}</button>
        </div>

        {showAddressForm && (
          <form className="checkout-form" onSubmit={saveAddress} style={{ marginBottom: '16px' }}>
            <div className="field-grid">
              <label>Label<input value={addrLabel} onChange={(e) => setAddrLabel(e.target.value)} placeholder="Home / Work" /></label>
              <label>Phone<input type="tel" required minLength="10" pattern="(?:\+|[0-9])(?:[0-9]| |-|\(|\)){8,16}[0-9]" value={addrPhone} onChange={(e) => setAddrPhone(e.target.value)} placeholder="+91 98765 43210" /></label>
              <label className="field-wide">Full name<input required pattern=".*\S.*" value={addrName} onChange={(e) => setAddrName(e.target.value)} placeholder="Recipient name" /></label>
              <label className="field-wide">Address<input required pattern=".*\S.*" value={addrLine1} onChange={(e) => setAddrLine1(e.target.value)} placeholder="House no., street, locality" /></label>
              <label>City<input required pattern=".*\S.*" value={addrCity} onChange={(e) => setAddrCity(e.target.value)} placeholder="Darbhanga" /></label>
              <label>PIN code<input required pattern="[0-9]{6}" value={addrPostalCode} onChange={(e) => setAddrPostalCode(e.target.value)} placeholder="846001" /></label>
              <label className="field-wide">Landmark <small>(optional)</small><input value={addrLandmark} onChange={(e) => setAddrLandmark(e.target.value)} placeholder="Nearby landmark" /></label>
            </div>
            <button type="submit" className="button button-blue" style={{ marginTop: '14px' }} disabled={savingAddr}>{savingAddr ? 'Saving…' : 'Save address'}</button>
          </form>
        )}

        {addresses.length ? (
          <div className="saved-address-list">
            {addresses.map((addr) => (
              <div className={`saved-address-item ${addr.isDefault ? 'is-default' : ''}`} key={addr._id}>
                <div>
                  <div className="saved-address-title">
                    <b>{addr.label || 'Home'} · {addr.fullName}</b>
                    {addr.isDefault && <span className="saved-default-tag">Default</span>}
                  </div>
                  <p>{addr.line1}{addr.landmark ? `, ${addr.landmark}` : ''}, {addr.city} - {addr.postalCode}</p>
                  <small>Phone: {addr.phone}</small>
                </div>
                <div className="saved-address-actions">
                  {!addr.isDefault && <button type="button" className="saved-address-default-btn" onClick={() => setDefaultAddress(addr._id)}>Set default</button>}
                  <button type="button" className="remove-item" aria-label="Remove address" onClick={() => removeAddress(addr._id)}><Trash2 size={15}/></button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="saved-address-empty">No saved addresses yet. Add one here or place an order to save it automatically.</p>
        )}
      </section>
    </div>}
    <div className="account-bottom"><div><span className="eyebrow">YOUR LITTLE STAR PROFILE</span><p>{contactDisplay}</p></div>{user?<button className="button button-outline" onClick={signOut}>Sign out <ArrowRight size={14}/></button>:<Link className="button button-blue" to="/login">Sign in / Register <ArrowRight size={14}/></Link>}</div>{error&&<p className="form-error" role="alert">{error}</p>}</main>
}

function Orders() {
  const { user } = useStore(); const [orders, setOrders] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    if (!user) { setOrders([]); setLoading(false); return () => { active = false } }
    api('/orders?limit=100').then((result) => { if (active) setOrders(result.items || []) }).catch((requestError) => { if (active) setError(requestError.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user])
  const statusLabel = (status) => !status ? 'Unknown' : status === 'confirmed' ? 'Processing' : status.charAt(0).toUpperCase() + status.slice(1)
  return <main className="page-width orders-page"><Breadcrumbs items={[{label:'My account',to:'/account'},{label:'My orders'}]} /><div className="account-welcome"><span className="eyebrow">A LITTLE UPDATE</span><h1>Orders & adventures.</h1><p>Here’s a peek at the happy things coming your way.</p></div>{!user ? <div className="empty-bag"><h2>Sign in to see your orders.</h2><Link to="/login" className="button button-blue">Sign in <ArrowRight size={16}/></Link></div> : loading ? <p role="status">Loading your orders…</p> : error ? <p className="form-error" role="alert">{error}</p> : orders.length ? <div className="orders-list">{orders.map((order)=>{const item=order.items?.[0];return <article className="order-history-card" key={order._id}><div className="order-hist-top"><div><span className="eyebrow">ORDER PLACED · {new Date(order.createdAt).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span><h3>{order.orderNumber}</h3></div><span className={`status-pill status-${order.orderStatus}`}><span/>{statusLabel(order.orderStatus)}</span></div><div className="order-hist-content"><div className="order-mini-photo">{item?.image&&<img src={mediaUrl(item.image)} alt=""/>}</div><div><b>{item?.name || `${order.items?.length || 0} items`}{order.items?.length > 1 ? ` + ${order.items.length - 1} more` : ''}</b><small>{item ? `Size ${item.size} · ${item.color} · Qty ${item.quantity}` : 'Little Star Kids Wear'}</small></div><div className="order-total-small"><small>{order.paymentMethod === 'razorpay' ? `Razorpay · ${order.paymentStatus}` : `COD · ${order.paymentStatus}`}</small><b>{money(order.total)}</b></div><Link to="/contact" className="button button-outline">Order help <ArrowRight size={14}/></Link></div></article>})}</div> : <div className="empty-bag"><h2>No orders yet.</h2><p>Your next little adventure starts with the collection.</p><Link to="/shop" className="button button-blue">Explore the collection <ArrowRight size={16}/></Link></div>}</main>
}
function About() {
  return <main className="about-page"><section className="about-hero page-width"><div className="about-title"><span className="eyebrow">OUR LITTLE STORY</span><h1>Every child<br />deserves to <em>shine.</em></h1><p>Little Star is a happy corner for big imaginations, soft fabrics and the everyday magic of growing up.</p><Link className="button button-blue" to="/shop">Meet the collection <ArrowRight size={16}/></Link></div><div className="about-image"><img src={imageUrl('photo-1503454537195-1dcabb73ffb9',1100)} alt="A happy child in a playful outfit"/><span>Little people.<br/>Big light. ✦</span></div></section><section className="about-story page-width"><div className="story-note"><span className="eyebrow">A NOTE FROM OUR LITTLE CORNER</span><h2>Good clothes make room for more play.</h2></div><div className="story-copy"><p>Little Star Kids Wear began with a simple thought: the clothes children live in should feel as lovely as the memories they make in them. So we look for soft, easy pieces with a little bit of personality — the ones they reach for on the big days and the ordinary, wonderful ones too.</p><p>From our home in Zero Mile, Darbhanga, we bring together playful kidswear for ages 0–15. We care about comfort, quality and making it easy for grown-ups to find something that feels just right.</p><Link to="/contact" className="text-arrow">Say hello <ArrowRight size={15}/></Link></div></section><div className="about-values page-width"><div><span>01</span><h3>Kids come first</h3><p>Room to wriggle, run, explore and be exactly who they are.</p></div><div><span>02</span><h3>Comfort is a love language</h3><p>Soft, breathable materials and easy fits for busy little days.</p></div><div><span>03</span><h3>Thoughtfully picked</h3><p>Styles that feel special without being too precious to play in.</p></div></div><section className="about-location page-width"><MapPin/><div><span className="eyebrow">COME FIND US</span><h2>A little star on the map.</h2><p>Zero Mile, Dumri, Biraul, Darbhanga</p></div><a className="button button-outline" href="https://maps.google.com/?q=Zero+Mile+Dumri+Biraul+Darbhanga" target="_blank" rel="noreferrer">Get directions <ArrowUpRight size={15}/></a></section></main>
}

function Contact() {
  const [sent,setSent]=useState(false); const [error,setError]=useState(''); const [busy,setBusy]=useState(false)
  const submit=async(event)=>{event.preventDefault();const form=event.currentTarget;const values=new FormData(form);setError('');setBusy(true);try{await api('/contact',{method:'POST',body:{name:values.get('name'),phone:values.get('phone'),email:values.get('email'),message:values.get('message')}});setSent(true);form.reset()}catch(requestError){setError(requestError.message||'Your message could not be sent. Please try again.')}finally{setBusy(false)}}
  return <main className="page-width contact-page"><Breadcrumbs items={[{label:'Contact'}]} /><div className="contact-grid"><div className="contact-intro"><span className="eyebrow">WE’RE ALL EARS (AND LITTLE STARS)</span><h1>Let’s talk! <span>👋</span></h1><p>Question about a size, a parcel or just want to say hello? We’re right here.</p><div className="contact-details"><a href="tel:+919135594888"><span><Phone size={18}/></span><div><small>Call or WhatsApp</small><b>+91 91355 94888</b></div><ArrowUpRight size={15}/></a><a href="mailto:hello@littlestarkidswear.in"><span><Mail size={18}/></span><div><small>Send us a note</small><b>hello@littlestarkidswear.in</b></div><ArrowUpRight size={15}/></a><div><span><MapPin size={18}/></span><div><small>Find our store</small><b>Zero Mile, Dumri, Biraul,<br/>Darbhanga</b></div></div></div><p className="contact-hours"><Clock3 size={14}/> We’re around Monday–Saturday, 10am–7pm</p></div><div className="contact-form-card"><span className="eyebrow">SEND A LITTLE NOTE</span><h2>How can we help?</h2>{sent?<div className="form-success"><span><Check/></span><h3>Message sent!</h3><p>Thanks for reaching out. We’ll be in touch soon.</p><button className="text-arrow" onClick={()=>{setSent(false);setError('')}}>Send another note <ArrowRight size={14}/></button></div>:<form onSubmit={submit}><label>Your name<input name="name" required minLength="2" pattern=".*\S.*" placeholder="Your name"/></label><div className="field-grid"><label>Phone<input name="phone" required type="tel" minLength="10" pattern="(?:\+|[0-9])(?:[0-9]| |-|\(|\)){8,16}[0-9]" placeholder="+91 98765 43210"/></label><label>Email<input name="email" required type="email" placeholder="you@example.com"/></label></div><label>Your message<textarea name="message" required minLength="10" rows="4" placeholder="Tell us what’s on your mind…"/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button button-blue" disabled={busy}>{busy?'Sending…':'Send your note'} <Send size={15}/></button></form>}</div></div></main>
}
function SizeGuide() {
  const [category,setCategory]=useState('Girls')
  const rows=category==='Baby'?[['0–3 months','55–62 cm','40 cm','40 cm','0-3M'],['3–6 months','62–68 cm','42 cm','42 cm','3-6M'],['6–9 months','68–74 cm','44 cm','44 cm','6-9M'],['9–12 months','74–80 cm','46 cm','46 cm','9-12M']]:[['2–3 years','92–98 cm','54 cm','52 cm','2-3Y'],['3–4 years','98–104 cm','56 cm','54 cm','3-4Y'],['4–5 years','104–110 cm','58 cm','56 cm','4-5Y'],['5–6 years','110–116 cm','60 cm','58 cm','5-6Y'],['6–7 years','116–122 cm','62 cm','60 cm','6-7Y'],['8–9 years','128–134 cm','68 cm','64 cm','8-9Y'],['10–11 years','140–146 cm','74 cm','68 cm','10-11Y'],['12–13 years','152–158 cm','80 cm','72 cm','12-13Y'],['14–15 years','158–164 cm','84 cm','76 cm','14-15Y']]
  return <main className="page-width size-guide-page"><Breadcrumbs items={[{label:'Size guide'}]} /><div className="size-guide-heading"><div><span className="eyebrow">A COMFY FIT, EVERY TIME</span><h1>Find their just-right size.</h1><p>Little bodies grow fast. Here’s a simple guide to help.</p></div><div className="measuring-doodle"><Shirt size={54}/><span>♡</span></div></div><div className="size-tabs">{['Girls','Boys','Baby'].map((c)=><button key={c} className={category===c?'tab-active':''} onClick={()=>setCategory(c)}>{c==='Baby'?<Baby size={16}/>:<Shirt size={16}/>} {c}</button>)}</div><div className="size-table-wrap"><table className="size-table"><thead><tr><th>Age</th><th>Height</th><th>Chest</th><th>Waist</th><th>Little Star size</th></tr></thead><tbody>{rows.map((r)=><tr key={r[0]}>{r.map((c,i)=><td key={i}>{c}</td>)}</tr>)}</tbody></table></div><div className="size-guide-note"><span>✦</span><div><b>Between two sizes?</b><p>We recommend choosing the larger size for a little extra room to grow.</p></div></div><div className="measure-note"><div><span>01</span><h3>Height</h3><p>Measure from the top of their head to the floor, with shoes off.</p></div><div><span>02</span><h3>Chest</h3><p>Wrap the tape around the fullest part, keeping it comfortably loose.</p></div><div><span>03</span><h3>Waist</h3><p>Measure around their natural waist, where trousers usually sit.</p></div></div><Link className="text-arrow size-help" to="/contact">Still not sure? We’re happy to help <ArrowRight size={15}/></Link></main>
}

function AdminErrorAlert({ message, onDismiss, title = 'Unable to save product' }) {
  if (!message) return null

  let displayTitle = title
  let displayMessage = message
  let hint = ''

  if (
    message.includes('E11000') ||
    message.includes('duplicate key error') ||
    message.includes('already exists') ||
    message.includes('DUPLICATE_RECORD')
  ) {
    displayTitle = 'Duplicate Product Name'
    const match =
      message.match(/dup key: \{ [^:]*: "([^"]+)" \}/) ||
      message.match(/slug: "([^"]+)"/) ||
      message.match(/named "([^"]+)"/)
    const name = match ? match[1] : ''
    displayMessage = name
      ? `A product named "${name}" already exists in your catalog.`
      : 'A product with this name or slug already exists in your catalog.'
    hint = 'Please enter a unique product name or edit the existing product from the catalog list.'
  } else if (message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch')) {
    displayTitle = 'Connection Error'
    displayMessage = 'Could not reach the server. Please check your internet connection and try again.'
  }

  return (
    <div className="admin-error-banner" role="alert">
      <div className="admin-error-icon-wrap">
        <AlertCircle size={18} className="admin-error-icon" />
      </div>
      <div className="admin-error-content">
        <h4 className="admin-error-title">{displayTitle}</h4>
        <p className="admin-error-message">{displayMessage}</p>
        {hint && <p className="admin-error-hint">{hint}</p>}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="admin-error-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss error"
          title="Dismiss"
        >
          <X size={15} />
        </button>
      )}
    </div>
  )
}

function AdminLayout({ children }) {
  const { user, logout } = useStore()
  return <div className="admin-layout"><aside className="admin-sidebar"><BrandMark/><div className="admin-label">SHOP MANAGEMENT</div><nav aria-label="Shop management"><NavLink to="/admin" end><LayoutDashboard size={17}/> Overview</NavLink><NavLink to="/admin/products"><Shirt size={17}/> Products</NavLink><NavLink to="/admin/orders"><ClipboardList size={17}/> Orders</NavLink><NavLink to="/admin/customers"><Users size={17}/> Customers</NavLink><NavLink to="/admin/messages"><Mail size={17}/> Messages</NavLink></nav><div className="admin-sidebar-bottom"><span className="admin-avatar" aria-hidden="true">LS</span><span><b>{user?.name || 'Little Star'}</b><small>Shop administrator</small></span><button className="icon-button" aria-label="Sign out" onClick={logout}><LogOut size={17}/></button></div></aside><main className="admin-content">{children}</main></div>
}

function AdminDashboard() {
  const { user, reloadCatalog, refreshCart } = useStore()
  const location = useLocation(); const page = location.pathname.split('/')[2] || 'overview'
  const [query, setQuery] = useState(''); const [status, setStatus] = useState(''); const [showForm, setShowForm] = useState(false)
  const [rows, setRows] = useState([]); const [dashboard, setDashboard] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [formError, setFormError] = useState(''); const [editing, setEditing] = useState(null); const [saving, setSaving] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [imageItems, setImageItems] = useState([]); const [imageError, setImageError] = useState('')
  const imageItemsRef = useRef([]); const imageInputRef = useRef(null)
  const savingRef = useRef(saving); savingRef.current = saving
  const replaceImageItems = useCallback((items) => {
    const keptObjectUrls = new Set(items.filter((item) => item.objectUrl).map((item) => item.preview))
    imageItemsRef.current.forEach((item) => { if (item.objectUrl && !keptObjectUrls.has(item.preview)) URL.revokeObjectURL(item.preview) })
    imageItemsRef.current = items
    setImageItems(items)
  }, [])
  const closeProductForm = useCallback(() => { if (savingRef.current) return; setShowForm(false); setEditing(null); setImageError(''); setFormError(''); replaceImageItems([]); if (imageInputRef.current) imageInputRef.current.value = '' }, [replaceImageItems])
  useEffect(() => () => imageItemsRef.current.forEach((item) => { if (item.objectUrl) URL.revokeObjectURL(item.preview) }), [])
  useEffect(() => {
    if (!showForm) return
    const dialog = document.querySelector('.admin-modal'); const opener = document.activeElement
    if (!dialog) return
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const getFocusable = () => [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => element.getClientRects().length > 0)
    getFocusable()[0]?.focus()
    const onKeyDown = (event) => { if (event.key === 'Escape') { event.preventDefault(); closeProductForm(); return } if (event.key !== 'Tab') return; const focusable = getFocusable(); if (!focusable.length) { event.preventDefault(); dialog.focus(); return } const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() } }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previousBodyOverflow; if (opener instanceof HTMLElement && opener.isConnected) opener.focus() }
  }, [showForm, closeProductForm])
  const load = useCallback(async () => {
    if (!user || user.role !== 'admin') { setLoading(false); return }
    setLoading(true); setError('')
    try {
      if (page === 'overview') setDashboard(await api('/admin/dashboard'))
      else if (page === 'products') { const result = await api(`/admin/products?limit=100&search=${encodeURIComponent(query)}`); setRows(result.items || []) }
      else if (page === 'orders') { const result = await api(`/admin/orders?limit=100&search=${encodeURIComponent(query)}${status ? `&status=${encodeURIComponent(status)}` : ''}`); setRows(result.items || []) }
      else if (page === 'customers') { const result = await api(`/admin/customers?limit=100&search=${encodeURIComponent(query)}`); setRows(result.items || []) }
      else if (page === 'messages') { const result = await api('/admin/contact-messages?limit=100'); setRows(result.items || []) }
    } catch (requestError) { setError(requestError.message || 'Could not load shop management data.') }
    finally { setLoading(false) }
  }, [page, query, status, user])
  useEffect(() => { const timer = setTimeout(load, 400); return () => clearTimeout(timer) }, [load])
  if (user?.role !== 'admin') return <main className="page-width not-found"><span>✦</span><h1>Administrator sign-in required.</h1><p>Sign in with the shop administrator account to manage the store.</p><Link className="button button-blue" to="/login">Sign in <ArrowRight size={15}/></Link></main>
  const formatDate = (date) => new Date(date).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
  const orderStatusLabel = (value) => !value ? 'Unknown' : value === 'confirmed' ? 'Processing' : value.charAt(0).toUpperCase() + value.slice(1)
  const openNew = () => { setEditing(null); setImageError(''); setFormError(''); replaceImageItems([]); if (imageInputRef.current) imageInputRef.current.value = ''; setShowForm(true) }
  const openEdit = (product) => { setEditing(product); setImageError(''); setFormError(''); replaceImageItems((product.images || []).map((url, index) => ({ key: `existing-${index}-${url}`, url, preview: mediaUrl(url), file: null, objectUrl: false }))); if (imageInputRef.current) imageInputRef.current.value = ''; setShowForm(true) }
  const selectProductImages = (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setImageError('Choose JPEG, PNG, or WebP image files.'); return }
    if (files.some((file) => file.size > 5 * 1024 * 1024)) { setImageError('Each image must be 5 MB or smaller.'); return }
    if (imageItemsRef.current.length + files.length > 8) { setImageError('A product can have up to 8 images. Remove an image before adding more.'); return }
    const next = files.map((file, index) => { const preview = URL.createObjectURL(file); return { key: `upload-${Date.now()}-${index}-${file.name}`, preview, file, objectUrl: true } })
    replaceImageItems([...imageItemsRef.current, ...next])
    setImageError('')
  }
  const removeProductImage = (index) => { replaceImageItems(imageItemsRef.current.filter((_, itemIndex) => itemIndex !== index)); setImageError('') }
  const submitProduct = async (event) => {
    event.preventDefault(); setSaving(true); setFormError('')
    const form = event.currentTarget; const data = new FormData(form)
    const body = { name: data.get('name'), category: data.get('category'), price: Number(data.get('price')), stock: Number(data.get('stock')) || 0 }
    if (data.get('colors')) body.colors = data.get('colors').split(',').map(s => s.trim()).filter(Boolean)
    if (data.get('sizes')) body.sizes = data.get('sizes').split(',').map(s => s.trim()).filter(Boolean)
    const existingImages = imageItemsRef.current.filter((item) => !item.file && item.url).map((item) => item.url)
    const newFiles = imageItemsRef.current.filter((item) => item.file).map((item) => item.file)
    let uploadedImages = []
    try {
      if (newFiles.length) {
        const uploadForm = new FormData()
        newFiles.forEach((file) => uploadForm.append('images', file))
        uploadedImages = (await api('/admin/uploads', { method: 'POST', body: uploadForm })).images
      }
      body.images = [...existingImages, ...uploadedImages]
      if (!body.images.length) body.images = ['/assets/products/girl-01.jpg']
      await api(editing ? `/products/${encodeURIComponent(editing.id)}` : '/products', { method: editing ? 'PUT' : 'POST', body })
      const removedUploads = (editing?.images || []).filter((image) => image.startsWith('/uploads/') && !body.images.includes(image))
      if (removedUploads.length) await api('/admin/uploads', { method: 'DELETE', body: { images: removedUploads } }).catch(() => {})
      setShowForm(false); setEditing(null); setImageError(''); setFormError(''); replaceImageItems([]); form.reset(); await load(); await reloadCatalog()
    } catch (requestError) {
      if (uploadedImages.length) await api('/admin/uploads', { method: 'DELETE', body: { images: uploadedImages } }).catch(() => {})
      setFormError(requestError.message || 'Could not save the product.')
    }
    finally { setSaving(false) }
  }
  const deleteProduct = async (product) => {
    if (!window.confirm(`Delete ${product.name}? This action cannot be undone.`)) return
    setRows(current => current.filter(r => r._id !== product._id && r.id !== product.id))
    try { await api(`/products/${encodeURIComponent(product.id || product._id)}`, { method: 'DELETE' }); await load(); await reloadCatalog(); await refreshCart() }
    catch (requestError) { setError(requestError.message); await load() }
  }
  const updateOrder = async (orderId, nextStatus) => {
    try { await api(`/admin/orders/${orderId}/status`, { method: 'PUT', body: { status: nextStatus } }); await load() }
    catch (requestError) { setError(requestError.message) }
  }
  const deleteOrder = async (order) => {
    if (!window.confirm(`Delete order #${order.orderNumber}? This will permanently remove the order.`)) return
    try {
      await api(`/admin/orders/${order._id}`, { method: 'DELETE' })
      if (selectedOrder?._id === order._id) setSelectedOrder(null)
      await load()
    } catch (requestError) { setError(requestError.message || 'Could not delete order.') }
  }
  if (page === 'products') return <AdminLayout>
    <div className="admin-top"><div><span>CATALOGUE</span><h1>Products</h1></div><button className="admin-primary" onClick={openNew}><Plus size={16}/> Add product</button></div>
    {error&&<AdminErrorAlert message={error} onDismiss={() => setError('')} title="Catalogue Notice" />}
    <div className="admin-table-card">
      <div className="admin-table-head"><h2 id="admin-products-heading">All products <span>{rows.length}</span></h2><div className="admin-search"><Search size={16}/><input type="search" inputMode="search" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search products" aria-label="Search admin products"/></div></div>
      <table className="admin-table" aria-labelledby="admin-products-heading"><thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>PRICE</th><th>STOCK</th><th>ACTIONS</th></tr></thead><tbody>{rows.map((product, index)=><tr key={product._id || product.id || index}><td data-label="Product"><div className="admin-product"><img src={mediaUrl(product.images?.[0]) || '/assets/products/girl-01.jpg'} alt=""/><b>{product.name}</b></div></td><td data-label="Category">{product.category}</td><td data-label="Price">{money(product.price)}</td><td data-label="Stock">{(product.stock ?? 0) === 0 ? <span className="admin-status status-stock-out">Stock out</span> : `${product.stock} units`}</td><td data-label="Actions" className="admin-product-actions"><div className="action-buttons-wrap"><button className="admin-icon-btn edit-btn" onClick={()=>openEdit(product)} title="Edit Product"><Pencil size={14}/> <span>Edit</span></button> <button className="admin-icon-btn deactivate-btn" onClick={()=>deleteProduct(product)} title="Delete Product"><Trash2 size={14}/> <span>Delete</span></button></div></td></tr>)}</tbody></table>
      {loading&&<p className="admin-empty" role="status">Loading products…</p>}{!loading&&!rows.length&&<p className="admin-empty">No products found.</p>}
    </div>
    {showForm&&<div className="admin-modal-backdrop" role="presentation" onClick={closeProductForm}><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title" onClick={(event)=>event.stopPropagation()}><button className="admin-modal-close" aria-label="Close" onClick={closeProductForm}><X size={18}/></button><span className="eyebrow">A NEW LITTLE LOOK</span><h2 id="admin-modal-title">{editing?'Edit product':'Add a product'}</h2><form onSubmit={submitProduct}>
      <label>Product name<input required minLength="2" name="name" pattern=".*\S.*" defaultValue={editing?.name || ''} placeholder="e.g. Sunny Day Dress" autoComplete="off" className={formError && (formError.toLowerCase().includes('name') || formError.toLowerCase().includes('duplicate') || formError.toLowerCase().includes('slug')) ? 'input-has-error' : ''} onChange={() => { if (formError) setFormError('') }}/></label>
      <label>Category<select name="category" defaultValue={editing?.category || 'Girls'}><option>Girls</option><option>Boys</option><option>Baby</option></select></label>
      <div className="field-grid"><label>Price (₹)<input required name="price" type="number" inputMode="decimal" min="1" defaultValue={editing?.price || ''} placeholder="999"/></label><label>Stock<input name="stock" type="number" inputMode="numeric" min="0" defaultValue={editing?.stock ?? 0} placeholder="0"/></label></div>
      <div className="field-grid"><label>Colors<input required name="colors" defaultValue={editing?.colors?.join(', ') || ''} placeholder="e.g. Pink, Blue" autoComplete="off"/></label><label>Sizes<input required name="sizes" defaultValue={editing?.sizes?.join(', ') || ''} placeholder="e.g. 2Y, 3Y, 4Y" autoComplete="off"/></label></div>
      <fieldset className="admin-image-field"><legend>Product images</legend><input ref={imageInputRef} className="admin-file-input" id="admin-product-images" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-describedby="admin-image-help" onChange={selectProductImages}/><button type="button" className="admin-upload-button" onClick={()=>imageInputRef.current?.click()}><Plus size={16}/> Add images</button><p id="admin-image-help" className="admin-image-help">Up to 8 images · JPEG, PNG, or WebP · 5 MB max each.</p>{imageError&&<p className="form-error" role="alert">{imageError}</p>}{imageItems.length>0?<div className="admin-image-grid">{imageItems.map((image,index)=><div className="admin-image-preview" key={image.key}><img src={image.preview} alt={'Product image ' + (index + 1) + ' preview'}/>{index===0&&<span className="admin-image-cover">Cover</span>}<button type="button" aria-label={'Remove image ' + (index + 1)} onClick={()=>removeProductImage(index)}><X size={15}/></button></div>)}</div>:<p className="admin-image-empty">No images selected. The standard shop image will be used until you add photos.</p>}</fieldset>
      {formError&&<AdminErrorAlert message={formError} onDismiss={() => setFormError('')} />}<button className="admin-primary" disabled={saving || Boolean(imageError)}><Plus size={15}/>{saving?'Uploading & saving…':'Save product'}</button>
    </form></section></div>}
  </AdminLayout>
  if (page === 'orders') {
    return <AdminLayout><div className="admin-top"><div><span>FULFILMENT</span><h1>Orders</h1></div><label className="admin-filter">Status <select aria-label="Filter orders by status" value={status} onChange={(event)=>setStatus(event.target.value)}><option value="">All orders</option><option value="confirmed">Processing</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select></label></div>{error&&<AdminErrorAlert message={error} onDismiss={() => setError('')} title="Orders Notice" />}<div className="admin-table-card"><div className="admin-table-head"><h2 id="admin-orders-heading">Recent orders <span>{rows.length}</span></h2><div className="admin-search"><Search size={16}/><input type="search" inputMode="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search orders" aria-label="Search admin orders"/></div></div>{loading?<p className="admin-empty" role="status">Loading orders…</p>:!rows.length?<p className="admin-empty">No orders found.</p>:<AdminDataTable orders={rows} onStatusChange={updateOrder} onDeleteOrder={deleteOrder} onViewOrder={setSelectedOrder} labelledBy="admin-orders-heading"/>}</div>{selectedOrder&&<OrderDetailsModal order={selectedOrder} onClose={()=>setSelectedOrder(null)}/>}</AdminLayout>
  }
  if (page === 'customers') return <AdminLayout><div className="admin-top"><div><span>YOUR COMMUNITY</span><h1>Customers</h1></div><span className="admin-filter"><Users size={15}/> {rows.length} customers</span></div>{error&&<AdminErrorAlert message={error} onDismiss={() => setError('')} title="Customers Notice" />}<div className="admin-table-card"><div className="admin-table-head"><h2 id="admin-customers-heading">Little Star families <span>{rows.length}</span></h2><div className="admin-search"><Search size={16}/><input type="search" inputMode="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search customers" aria-label="Search admin customers"/></div></div><table className="admin-table" aria-labelledby="admin-customers-heading"><thead><tr><th>CUSTOMER</th><th>ORDERS</th><th>TOTAL SPENT</th><th>LAST ORDER</th><th>STATUS</th></tr></thead><tbody>{rows.map((customer)=><tr key={customer._id}><td data-label="Customer"><div className="customer-name"><span aria-hidden="true">{(customer.name || 'User').split(' ').map((word)=>word[0]).join('')}</span><b>{customer.name || 'User'}</b></div></td><td data-label="Orders">{customer.orderStats?.orderCount || 0}</td><td data-label="Total spent">{money(customer.orderStats?.amountSpent || 0)}</td><td data-label="Last order">{customer.orderStats?.lastOrderAt ? formatDate(customer.orderStats.lastOrderAt) : '—'}</td><td data-label="Status"><span className="admin-status status-active">{customer.isActive?'Active':'Inactive'}</span></td></tr>)}</tbody></table>{loading&&<p className="admin-empty" role="status">Loading customers…</p>}</div></AdminLayout>
  if (page === 'messages') return <AdminLayout><div className="admin-top"><div><span>CUSTOMER CARE</span><h1>Messages</h1></div><span className="admin-filter"><Mail size={15}/> {rows.length} messages</span></div>{error&&<AdminErrorAlert message={error} onDismiss={() => setError('')} title="Messages Notice" />}<div className="admin-table-card"><div className="admin-table-head"><h2 id="admin-messages-heading">Contact messages <span>{rows.length}</span></h2><div className="admin-search"><Search size={16}/><input type="search" inputMode="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search messages" aria-label="Search admin messages"/></div></div>{loading?<p className="admin-empty" role="status">Loading messages…</p>:rows.length?<table className="admin-table" aria-labelledby="admin-messages-heading"><thead><tr><th>FROM</th><th>PHONE</th><th>MESSAGE</th><th>RECEIVED</th><th>STATUS</th></tr></thead><tbody>{rows.map((message)=><tr key={message._id}><td data-label="From"><b>{message.name}</b><small>{message.email}</small></td><td data-label="Phone">{message.phone}</td><td data-label="Message" className="admin-message-cell">{message.message}</td><td data-label="Received">{formatDate(message.createdAt)}</td><td data-label="Status"><select aria-label={`Status for ${message.name}`} value={message.status} onChange={async(event)=>{try{await api(`/admin/contact-messages/${message._id}`,{method:'PATCH',body:{status:event.target.value}});await load()}catch(requestError){setError(requestError.message)}}}><option value="new">New</option><option value="read">Read</option><option value="resolved">Resolved</option></select></td></tr>)}</tbody></table>:<p className="admin-empty">No contact messages yet.</p>}</div></AdminLayout>
  const recent = (dashboard?.recentOrders || []).map((order)=>[order.orderNumber,formatDate(order.createdAt),order.buyer?.name || 'Guest',money(order.total),orderStatusLabel(order.orderStatus),order._id,order.orderStatus])
  return <AdminLayout><div className="admin-top"><div><span>SHOP OVERVIEW</span><h1>Good afternoon, {user.name} ✦</h1><p>Here’s what’s happening at your shop today.</p></div><span className="admin-filter"><Clock3 size={15}/> Live data</span></div>{error&&<AdminErrorAlert message={error} onDismiss={() => setError('')} title="Overview Notice" />}<div className="admin-stats"><div><span>Total orders</span><b>{dashboard?.totalOrders ?? '—'}</b><small>All orders</small><ClipboardList/></div><div><span>Total sales</span><b>{money(dashboard?.totalSales || 0)}</b><small>Excluding cancelled</small><span className="stat-rupee">₹</span></div><div><span>Products</span><b>{dashboard?.products ?? '—'}</b><small>Active styles</small><Shirt/></div><div><span>Customers</span><b>{dashboard?.customers ?? '—'}</b><small>Registered families</small><Users/></div></div><div className="admin-lower"><div className="admin-table-card"><div className="admin-table-head"><h2 id="admin-dashboard-orders-heading">Recent orders</h2><Link to="/admin/orders">View all <ArrowRight size={14}/></Link></div>{loading?<p className="admin-empty" role="status">Loading dashboard…</p>:<AdminDataTable rows={recent} compact onStatusChange={updateOrder} labelledBy="admin-dashboard-orders-heading"/>}</div><div className="admin-side-card"><span className="eyebrow">SHOP MANAGEMENT</span><div className="admin-note-icon"><Star fill="currentColor"/></div><h2>Your shop is shining.</h2><p>{dashboard?.products || 0} lovely styles are active. Review stock and keep the little stars coming back for more.</p><Link to="/admin/products" className="text-arrow">Manage products <ArrowRight size={15}/></Link></div></div></AdminLayout>
}

function OrderDetailsModal({ order, onClose }) {
  if (!order) return null
  return <div className="admin-modal-backdrop" role="presentation" onClick={onClose}><section className="admin-modal" style={{ maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }} role="dialog" aria-modal="true" aria-labelledby="order-modal-title" onClick={(e)=>e.stopPropagation()}><button className="admin-modal-close" aria-label="Close" onClick={onClose}><X size={18}/></button><span className="eyebrow">ORDER DETAILS</span><h2 id="order-modal-title">Order #{order.orderNumber}</h2><div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', margin: '0.6rem 0 1.25rem' }}><span className={`status-pill status-${order.orderStatus}`} style={{ padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.825rem', fontWeight: 600 }}>{order.orderStatus}</span><span style={{ background: '#f3f4f6', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.825rem' }}>{new Date(order.createdAt).toLocaleString('en-IN')}</span><span style={{ background: '#f3f4f6', padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.825rem' }}>{order.paymentMethod?.toUpperCase()} ({order.paymentStatus})</span></div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', background: '#f8fafc', padding: '1rem', borderRadius: '12px', marginBottom: '1.25rem' }}><div><h4 style={{ margin: '0 0 0.35rem', fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>Customer & Contact</h4><p style={{ margin: '0 0 0.2rem', fontWeight: 600 }}>{order.buyer?.name || 'Guest'}</p><p style={{ margin: '0 0 0.2rem', fontSize: '0.85rem' }}>{order.buyer?.email}</p><p style={{ margin: 0, fontSize: '0.85rem' }}>{order.buyer?.phone}</p></div><div><h4 style={{ margin: '0 0 0.35rem', fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>Delivery Address</h4><p style={{ margin: '0 0 0.2rem', fontWeight: 600 }}>{order.shippingAddress?.fullName || order.buyer?.name}</p><p style={{ margin: '0 0 0.2rem', fontSize: '0.85rem' }}>{order.shippingAddress?.line1}{order.shippingAddress?.line2 ? `, ${order.shippingAddress.line2}` : ''}</p><p style={{ margin: 0, fontSize: '0.85rem' }}>{order.shippingAddress?.city}, {order.shippingAddress?.state} {order.shippingAddress?.postalCode}</p></div></div><h4 style={{ margin: '0 0 0.6rem', fontSize: '0.9rem' }}>Items Ordered ({order.items?.length || 0})</h4><div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.25rem' }}>{(order.items || []).map((item, idx)=><div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem', border: '1px solid #e2e8f0', borderRadius: '8px' }}>{item.image&&<img src={mediaUrl(item.image)} alt="" style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '6px' }}/>} <div style={{ flex: 1 }}><b style={{ display: 'block', fontSize: '0.875rem' }}>{item.name}</b><small style={{ color: '#64748b' }}>Size {item.size} · {item.color} · Qty {item.quantity}</small></div><div style={{ textAlign: 'right' }}><b>{money(item.unitPrice * item.quantity)}</b><small style={{ display: 'block', color: '#64748b', fontSize: '0.75rem' }}>{money(item.unitPrice)} each</small></div></div>)}</div><div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1.25rem' }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}><span>Subtotal</span><b>{money(order.subtotal || 0)}</b></div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}><span>Delivery</span><b>{order.shipping ? money(order.shipping) : 'Free'}</b></div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 700, borderTop: '1px solid #e2e8f0', paddingTop: '0.5rem' }}><span>Total</span><b>{money(order.total || 0)}</b></div></div><button className="button button-blue full-button" onClick={onClose}>Close</button></section></div>
}

function AdminDataTable({ orders, rows, compact = false, onStatusChange, onDeleteOrder, onViewOrder, labelledBy }) {
  if (orders && orders.length > 0) {
    return <table className="admin-table" aria-labelledby={labelledBy}><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>AMOUNT</th><th>STATUS</th>{!compact&&<th>DATE</th>}{(!compact||onViewOrder||onDeleteOrder)&&<th>ACTIONS</th>}</tr></thead><tbody>{orders.map((order)=><tr key={order._id}><td data-label="Order"><b>{order.orderNumber}</b></td><td data-label="Customer"><div><b>{order.buyer?.name || 'Guest'}</b><small style={{ display: 'block', color: 'var(--ink-light, #666)' }}>{order.buyer?.phone}</small></div></td><td data-label="Amount"><b>{money(order.total)}</b><small style={{ display: 'block', textTransform: 'uppercase', fontSize: '0.72rem', color: order.paymentStatus === 'paid' ? '#16a34a' : '#d97706' }}>{order.paymentMethod === 'razorpay' ? 'Razorpay' : 'COD'} · {order.paymentStatus}</small></td><td data-label="Status">{onStatusChange ? <select aria-label={`Order ${order.orderNumber} status`} value={order.orderStatus} onChange={(event)=>onStatusChange(order._id,event.target.value)}><option value="confirmed">Processing</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select> : <span className={`admin-status status-${order.orderStatus}`}>{order.orderStatus}</span>}</td>{!compact&&<td data-label="Date">{new Date(order.createdAt).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>}<td data-label="Actions" className="admin-product-actions"><div className="action-buttons-wrap">{onViewOrder&&<button className="admin-icon-btn edit-btn" onClick={()=>onViewOrder(order)} title="See order details"><Eye size={14}/> <span>Details</span></button>}{onDeleteOrder&&<button className="admin-icon-btn deactivate-btn" onClick={()=>onDeleteOrder(order)} title="Delete order"><Trash2 size={14}/> <span>Delete</span></button>}</div></td></tr>)}</tbody></table>
  }
  const legacyRows = rows || []
  return <table className="admin-table" aria-labelledby={labelledBy}><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>AMOUNT</th><th>STATUS</th>{!compact&&<th>DATE</th>}</tr></thead><tbody>{legacyRows.map((row, index)=><tr key={row[5] || index}><td data-label="Order"><b>{row[0]}</b>{compact&&<small>{row[1]}</small>}</td><td data-label="Customer">{row[2]}</td><td data-label="Amount">{row[3]}</td><td data-label="Status">{onStatusChange && row[5] ? <select aria-label={`Order ${row[0]} status`} value={row[6]} onChange={(event)=>onStatusChange(row[5],event.target.value)}><option value="confirmed">Processing</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option><option value="cancelled">Cancelled</option></select> : <span className={`admin-status status-${row[4].toLowerCase()}`}>{row[4]}</span>}</td>{!compact&&<td data-label="Date">{row[1]}</td>}</tr>)}</tbody></table>
}
function NotFound(){return <main className="page-width not-found"><span>✦</span><h1>Oops, we lost that little star.</h1><p>This page has wandered off on an adventure.</p><Link className="button button-blue" to="/">Back to the playground <ArrowRight size={15}/></Link></main>}

function App() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'dummy-client-id.apps.googleusercontent.com'
  return <GoogleOAuthProvider clientId={clientId}><StoreProvider><BrowserRouter><AppRoutes/></BrowserRouter></StoreProvider></GoogleOAuthProvider>
}

function AppRoutes() {
  const { loading, apiError } = useStore()
  if (loading) return <main className="page-width not-found" role="status"><span>✦</span><h1>Opening the Little Star shop…</h1><p>Connecting to the live catalog and your saved bag.</p></main>
  if (apiError) return <main className="page-width not-found" role="alert"><span>✦</span><h1>The shop is temporarily unavailable.</h1><p>{apiError}</p><button className="button button-blue" onClick={()=>window.location.reload()}>Try again <ArrowRight size={15}/></button></main>
  return <Shell><Routes><Route path="/" element={<Home/>}/><Route path="/shop" element={<Shop/>}/><Route path="/product/:id" element={<ProductDetail/>}/><Route path="/cart" element={<Cart/>}/><Route path="/wishlist" element={<Wishlist/>}/><Route path="/checkout" element={<Checkout/>}/><Route path="/login" element={<AuthPage/>}/><Route path="/register" element={<AuthPage register/>}/><Route path="/account" element={<Account/>}/><Route path="/orders" element={<Orders/>}/><Route path="/about" element={<About/>}/><Route path="/contact" element={<Contact/>}/><Route path="/size-guide" element={<SizeGuide/>}/><Route path="*" element={<NotFound/>}/></Routes></Shell>
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)
