# Little Star Kids Wear

Little Star is a React + Vite storefront backed by an Express, MongoDB, and Mongoose API. The storefront uses the shop's existing 24 product records as seed data and keeps stable IDs such as `g1`, `b1`, and `baby1` for product links.

## Local setup

Requirements: Node.js 20 or newer and a reachable MongoDB instance.

1. Install the frontend packages with `npm --prefix frontend install`.
2. Install the API packages with `npm --prefix backend install`.
3. Copy `backend/.env.example` to `backend/.env`. Set a private `JWT_SECRET` of at least 32 characters and the MongoDB URI for the database you intend to use.
4. (Optional) Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env` to create the initial shop administrator. Use a unique password with at least 12 characters. The seed command never changes the password of an existing account.
5. Seed the initial catalog with `npm --prefix backend run seed`.
6. Start the API with `npm --prefix backend run dev` and the storefront in a second terminal with `npm --prefix frontend run dev`.

Vite proxies `/api` to `http://127.0.0.1:5000` during development. Set `API_PROXY_TARGET` if the backend runs elsewhere. For a deployed frontend, either route `/api` through the web server to the API or set `VITE_API_URL` to the API origin. When using a separate origin, configure its exact origin in backend `CORS_ORIGINS`; the browser API client sends credentials.

The seed command upserts the 24 catalog products and three categories. It is repeatable and does not delete existing records. Do not use production databases for the integration test command.

Product images can be uploaded from the admin product form. The API accepts up to 8 JPEG, PNG, or WebP files per product, with a 5 MB limit per image, and stores them in `backend/uploads/`. Keep that directory on persistent storage when deploying the API; the frontend displays images from the API host.

## Run and verify

```sh
npm --prefix frontend run build
npm --prefix backend test
```

The integration suite uses `mongodb://127.0.0.1:27017/little_star_kids_wear_test` by default. It refuses to start unless `NODE_ENV=test` and the database name ends in `_test`, and it drops only that named test database before and after the run. To use another isolated test database, set `MONGODB_URI` to a database whose name also ends in `_test`.

The API can be checked at `GET /api/health`; it reports whether Mongoose is connected. Start the API with `npm --prefix backend run dev` and seed with `npm --prefix backend run seed`.

## API conventions

- Base path: `/api`.
- Success: `{ "success": true, "data": ... }`.
- Error: `{ "success": false, "error": { "code": "...", "message": "..." } }`.
- Authentication uses an HTTP-only `ls_session` cookie and also accepts `Authorization: Bearer <JWT>` for API clients. Browser requests use `credentials: include`.
- Guest carts and wishlists use a separate HTTP-only `ls_guest` cookie. Sign-in merges guest items into the account and respects current variant stock.
- Product JSON includes `id` (the old storefront ID when seeded), product display fields, active state, and stock totals. Search and list responses return `items` and pagination metadata.
- Product, cart, and order data is validated on the server. The order endpoint ignores client-side prices and totals, checks variant stock, decrements stock atomically, and accepts only COD until a real payment gateway is installed.

## Route reference

All success responses are wrapped in `data`. Protected routes require a signed-in customer; admin routes require a user with the `admin` role. Public routes are marked **public**. Query strings are optional unless noted.

| Method and path | Access | Request / query | Response data |
| --- | --- | --- | --- |
| `GET /health` | Public | — | `{ status, database, uptimeSeconds }` |
| `POST /auth/register` | Public | `{ name, email, password }` (password 8–72 UTF-8 bytes) | `{ user }`, sets session cookie |
| `POST /auth/login` | Public | `{ email, password }` | `{ user }`, sets session cookie |
| `POST /auth/logout` | Public | — | `{ loggedOut }`, clears session and returns account cart/wishlist to the guest session |
| `GET /auth/me` | Public | — | `{ user }`, where user is `null` when signed out |
| `PUT /auth/me` | Customer | `{ name, phone }` | `{ user }` |
| `GET /auth/addresses` | Customer | — | `{ addresses }` |
| `POST /auth/addresses` | Customer | `{ label?, fullName, phone, line1, city, postalCode, state?, line2?, country? }` | `{ addresses }` |
| `DELETE /auth/addresses/:addressId` | Customer | — | `{ addresses }` |
| `GET /categories` | Public | — | `{ items }` |
| `POST /categories` | Admin | `{ name, slug?, description?, sortOrder? }` | Category, `201` |
| `PUT /categories/:id` | Admin | Any of `{ name, slug, description, isActive }` | Updated category |
| `DELETE /categories/:id` | Admin | — | Deactivates category; `{ category }` |
| `GET /products` | Public | `search`, `category`, `age`, `size`, `color`, `occasion`, `price` (`under-1000`, `1000-1500`, `over-1500`), `minPrice`, `maxPrice`, `sort`, `page`, `limit` | `{ items, pagination }` |
| `GET /products/search` | Public | Same filters as product list | `{ items, pagination }` |
| `GET /products/category/:category` | Public | Product-list query options | `{ items, pagination }` |
| `GET /products/featured`, `/products/new-arrivals`, `/products/bestsellers` | Public | `limit` | `{ items }` |
| `GET /products/:id` | Public | Legacy ID, Mongo ID, or slug | `{ product }` |
| `POST /products` | Admin | Product fields: `name`, `category`, `price`; optional `description`, `subcategory`, `sizes`, `ageRange`, `colors`, `occasion`, `originalPrice`, `images`, `material`, `featured`, `newArrival`, `stock`, `variants`, `tags` | `{ product }`, `201` |
| `PUT/PATCH /products/:id` | Admin | Any supported product fields | `{ product }` |
| `POST /admin/uploads` | Admin | `multipart/form-data`, repeated `images` file fields (up to 8 JPEG, PNG, or WebP images; 5 MB each) | `{ images: ["/uploads/..."] }`, `201` |
| `DELETE /admin/uploads` | Admin | `{ images: ["/uploads/..."] }`; files still linked to any product are retained | `{ removed }` |
| `DELETE /products/:id` | Admin | — | Deactivates product; `{ product }` |
| `GET /cart` | Public | — | `{ items, subtotal, discount, shipping, total }` |
| `POST /cart` | Public | `{ productId, size, color, quantity }` | Updated cart |
| `PUT /cart/:itemId` | Public | `{ quantity }` | Updated cart |
| `DELETE /cart/:itemId` or `DELETE /cart` | Public | — | Updated or empty cart |
| `GET /wishlist` | Public | — | `{ items, ids }` |
| `POST /wishlist/:productId` | Public | — | `{ items, ids }` |
| `DELETE /wishlist/:productId` | Public | — | `{ items, ids }` |
| `POST /orders` | Public | `Idempotency-Key` header plus `{ name, email, phone, address: { fullName, line1, city, postalCode, state?, line2?, country?, landmark? }, paymentMethod: "cod" }` | `{ order, reused? }`, `201` for a new order |
| `GET /orders` | Customer | `page`, `limit` | `{ items, pagination }` |
| `GET /orders/:id` | Customer | — | `{ order }` (own orders only) |
| `PUT /orders/:id/cancel` | Customer | — | Cancels eligible unpaid orders and restores stock |
| `POST /contact` | Public | `{ name, email, phone, message }` | `{ message, id }`, `201` |
| `GET /admin/dashboard` | Admin | — | `{ totalOrders, totalSales, products, customers, recentOrders }` |
| `GET /admin/products` | Admin | `search`, `category`, `active`, `page`, `limit` | `{ items, pagination }` |
| `GET /admin/orders` | Admin | `search`, `status`, `page`, `limit` | `{ items, pagination }` |
| `PUT /admin/orders/:id/status` | Admin | `{ status }`: `confirmed`, `processing`, `shipped`, `delivered`, `cancelled` | `{ order }` |
| `GET /admin/customers` | Admin | `search`, `page`, `limit` | `{ items, pagination }`, includes order statistics |
| `GET /admin/contact-messages` | Admin | `status`, `page`, `limit` | `{ items, pagination }` |
| `PATCH /admin/contact-messages/:id` | Admin | `{ status }`: `new`, `read`, `resolved` | `{ message }` |

List pagination metadata is `{ page, limit, total, pages }`. Query parameters are allow-listed and never passed through as MongoDB operators. Public authentication, catalog, and general API traffic is rate-limited; sign-in and registration have a tighter limit. The API uses Helmet, exact-origin credentialed CORS, bounded JSON bodies, password hashing, and non-sensitive request logs.

## Models

- **User:** unique lowercase email, bcrypt password hash, `customer`/`admin` role, active status, profile, and saved addresses.
- **Product:** legacy storefront ID, slug, display/merchandising fields, size/color variant inventory, and active status.
- **Category:** unique name and slug with soft deactivation.
- **Cart / Wishlist:** unique account or random guest-cookie owner; server stores product references and recalculates prices.
- **Order:** immutable item/address/buyer snapshots, INR totals, COD payment state, order status, unique order number, and idempotency key.
- **ContactMessage:** validated contact details, message body, and admin review status.

## Checkout and external services

The current checkout UI has no payment SDK or server-side payment verification. The API therefore accepts COD only, returns a validation error for online-payment orders, and the UI marks UPI/online payment as unavailable. Google OAuth and customer-submitted reviews are not present. Configure a payment provider and verified callback/webhook before enabling online payments.
