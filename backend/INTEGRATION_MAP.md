# Frontend → backend integration map

This records the original frontend contract that the implementation preserves.

## Existing frontend facts

- React + Vite SPA; routes are `/`, `/shop`, `/product/:id`, `/cart`, `/wishlist`, `/checkout`, `/login`, `/register`, `/account`, `/orders`, `/about`, `/contact`, `/size-guide`, and `/admin/*`.
- `frontend/src/data/products.js` contains 24 static catalog items with stable IDs (`g1`, `b1`, `baby1`, etc.), `name`, `description`, `category`, `subcategory`, `sizes`, `ageRange`, `colors`, `occasion`, `price`, `originalPrice`, `discount`, `images`, `material`, `rating`, `reviews`, `featured`, `newArrival`, `stock`, and `tags`.
- The shop filters and sorting operate on that array and query parameters. Product routes use the static `id` field.
- Cart lines are `{ id, size, color, quantity }`; totals are currently computed in the browser.
- Cart, wishlist, and mock account state use localStorage. Checkout clears the cart and shows a fixed demo order number.
- Registration and login only write a mock user. There is no password verification or role check.
- Contact submission only changes local component state.
- Admin product creation writes one localStorage entry. Dashboard counts, customers, and orders are hard-coded. The original product form has name/category/price/stock only; there is no image upload control.
- Checkout displays UPI/online and COD radio options, but has no payment SDK, gateway calls, or payment result verification. Google OAuth is also absent.
- No `fetch`, Axios, `/api/*`, or external API calls exist in the current frontend.

## API/data contract

| Frontend area | Backend contract | Frontend integration |
| --- | --- | --- |
| Startup/catalog | `GET /api/products?limit=100`, `GET /api/categories`, `GET /api/auth/me`, `GET /api/cart`, `GET /api/wishlist` | Bootstrap the existing context from the server; retain product `id` values and field names. |
| Shop search/filter/sort | `GET /api/products` with `search`, `category`, `age`, `size`, `color`, `occasion`, `minPrice`, `maxPrice`, `sort`, `page`, `limit` | Send query parameters; keep the current URL/filter controls and result cards. |
| Product detail | `GET /api/products/:id` | Resolve legacy IDs and Mongo IDs; keep size/color choice in the current UI. |
| Cart | `GET/POST /api/cart`, `PUT/DELETE /api/cart/:itemId`, `DELETE /api/cart` | Server-backed guest cart cookie and authenticated cart; send only product/variant/quantity, render server prices/totals. |
| Wishlist | `GET /api/wishlist`, `POST/DELETE /api/wishlist/:productId` | Persist by guest cookie or user; return unique product IDs. |
| Register/login/logout/account | `POST /api/auth/register`, `/login`, `/logout`; `GET /api/auth/me` | Use credentialed requests and HttpOnly JWT cookie; route admins to admin pages and customers to account. |
| Checkout/order history | `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id`, `PUT /api/orders/:id/cancel` | Submit contact/address/payment method only; server loads cart and computes all amounts. Require COD until a real payment integration exists. |
| Contact | `POST /api/contact` | Persist validated contact messages; show success only after API success. |
| Admin dashboard | `/api/admin/dashboard`, `/products`, `/customers`, `/orders`, `/orders/:id/status` | Replace mock data and local product creation. All API routes require an admin JWT. |
| Categories | `GET /api/categories`; protected create/update/deactivate routes | Populate the existing shop category select and admin form. |

## Models and security boundaries

- `User`: customer/admin role, password hash, profile and saved addresses.
- `Product`: preserves frontend fields and legacy ID, plus variant-specific stock for each size/color.
- `Category`: active category labels/slugs.
- `Cart`: user or random HttpOnly guest-cookie owner; cart amounts are always recalculated from current database prices.
- `Wishlist`: user or guest-cookie owner; product references are unique.
- `Order`: item/product snapshots, buyer/address snapshots, server totals, COD payment state, status, idempotency key.
- `ContactMessage`: validated public contact submissions for admin review.

Product images can be uploaded by admins through `POST /api/admin/uploads`. The API validates JPEG, PNG, and WebP signatures, limits uploads to 8 images at 5 MB each, and stores them in `backend/uploads/`; persist that directory in deployments. `DELETE /api/admin/uploads` removes unreferenced uploaded files and leaves product-linked images intact. No Razorpay, online-payment success flow, Google OAuth, or review submission is wired into the current frontend, so these are not fabricated. Online checkout must remain unavailable until a gateway and signature verification are configured.

## Implementation status

- Storefront catalog, search/filter/sort, cart, wishlist, account sessions, contact form, checkout, order history, and admin screens now call the API. Browser `localStorage` demo state has been removed.
- The API is under `backend/`, and `backend/.env.example` plus `frontend/README.md` describe setup, routes, configuration, and safe local testing.
- Checkout is server-priced and COD-only. Online payment, OAuth, file uploads, and review submission still require services or frontend controls that are not present in this shop.
