import assert from 'assert'

const API_URL = 'http://localhost:5000/api'

async function runE2E() {
  console.log('Starting E2E API tests...')

  // 1. Register a new customer
  console.log('1. Registering customer...')
  const email = `test.customer.${Date.now()}@example.com`
  const regRes = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Customer', email, password: 'password123' })
  })
  const regBody = await regRes.json()
  assert.equal(regRes.status, 201, 'Registration failed')
  const token = regRes.headers.get('set-cookie')?.split(';')[0].split('=')[1] || regBody.data.token
  assert.ok(token, 'No auth token received')
  
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }

  // 2. Fetch products
  console.log('2. Fetching products...')
  const prodRes = await fetch(`${API_URL}/products`)
  const prodBody = await prodRes.json()
  assert.ok(prodBody.data.items.length > 0, 'No products found')
  const product = prodBody.data.items[0]

  // 3. Add to Cart (Wishlist/Cart depends on local storage in frontend, but here we test checkout)
  console.log('3. Adding to Cart...')
  const addToCartRes = await fetch(`${API_URL}/cart`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: product.id, size: product.sizes[0], color: product.colors[0], quantity: 1 })
  })
  const cartBody = await addToCartRes.json()
  console.log('Cart Body:', JSON.stringify(cartBody, null, 2))
  assert.equal(addToCartRes.status, 201, 'Add to cart failed')

  const checkoutRes = await fetch(`${API_URL}/orders`, {
    method: 'POST',
    headers: { ...headers, 'Idempotency-Key': `e2e-${Date.now()}` },
    body: JSON.stringify({
      name: 'Test Customer',
      email,
      phone: '1234567890',
      address: {
        fullName: 'Test Customer',
        line1: '123 Test St',
        city: 'Testville',
        postalCode: '123456'
      },
      paymentMethod: 'cod'
    })
  })
  const checkoutBody = await checkoutRes.json()
  assert.equal(checkoutRes.status, 201, `Checkout failed: ${JSON.stringify(checkoutBody)}`)
  const orderId = checkoutBody.data.order._id

  // 4. Admin login
  console.log('4. Admin Login...')
  const adminRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@gmail.com', password: 'admin123admin' })
  })
  const adminBody = await adminRes.json()
  assert.equal(adminRes.status, 200, 'Admin login failed')
  const adminToken = adminRes.headers.get('set-cookie')?.split(';')[0].split('=')[1] || adminBody.data.token
  const adminHeaders = { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }

  // 5. Admin View Orders
  console.log('5. Admin fetching orders...')
  const ordersRes = await fetch(`${API_URL}/admin/orders`, { headers: adminHeaders })
  const ordersBody = await ordersRes.json()
  assert.equal(ordersRes.status, 200, 'Admin fetch orders failed')
  assert.ok(ordersBody.data.items.find(o => o.id === orderId || o._id === orderId), 'Newly created order not found in admin view')

  // 6. Admin Create Product
  console.log('6. Admin creating product...')
  const newProdRes = await fetch(`${API_URL}/products`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      name: 'E2E Test Product',
      category: 'Boys',
      price: 1500,
      stock: 50,
      colors: ['Red', 'Blue'],
      sizes: ['S', 'M', 'L']
    })
  })
  const newProdBody = await newProdRes.json()
  assert.equal(newProdRes.status, 201, `Create product failed: ${JSON.stringify(newProdBody)}`)
  const newProductId = newProdBody.data.product.id

  // 7. Admin Delete Product
  console.log('7. Admin deleting product...')
  const delProdRes = await fetch(`${API_URL}/products/${newProductId}`, {
    method: 'DELETE',
    headers: adminHeaders
  })
  assert.equal(delProdRes.status, 200, 'Delete product failed')

  console.log('All E2E API tests passed successfully!')
}

runE2E().catch(err => {
  console.error('Test Failed:', err)
  process.exit(1)
})
