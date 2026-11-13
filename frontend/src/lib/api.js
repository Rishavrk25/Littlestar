const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export function mediaUrl(path) {
  if (typeof path !== 'string' || !path) return ''
  if (!path.startsWith('/uploads/') || !/^https?:\/\//i.test(API_BASE)) return path
  return `${new URL(API_BASE).origin}${path}`
}

export class ApiError extends Error {
  constructor(message, status = 0, code = 'NETWORK_ERROR') { super(message); this.name = 'ApiError'; this.status = status; this.code = code }
}

export function getStoredToken() {
  try { return localStorage.getItem('ls_token') || '' } catch { return '' }
}
export function setStoredToken(token) {
  try {
    if (token) localStorage.setItem('ls_token', token)
    else localStorage.removeItem('ls_token')
  } catch {}
}

export function getStoredGuestId() {
  try {
    let id = localStorage.getItem('ls_guest_id')
    if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : ''
      if (id) localStorage.setItem('ls_guest_id', id)
    }
    return id
  } catch { return '' }
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body !== undefined && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const token = getStoredToken()
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  const guestId = getStoredGuestId()
  if (guestId && !headers.has('X-Guest-Id')) headers.set('X-Guest-Id', guestId)

  const response = await fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
    ...options,
    headers,
    credentials: 'include',
    body: options.body !== undefined && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
  })
  let payload
  try { payload = await response.json() } catch { throw new ApiError('The server returned an unreadable response.', response.status) }
  if (!response.ok || payload.success === false) throw new ApiError(payload.error?.message || 'The request could not be completed.', response.status, payload.error?.code)
  return payload.data
}

export const productList = (query = {}) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  return api(`/products${params.size ? `?${params}` : ''}`)
}
