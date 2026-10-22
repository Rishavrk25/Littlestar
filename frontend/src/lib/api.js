const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export function mediaUrl(path) {
  if (typeof path !== 'string' || !path) return ''
  if (!path.startsWith('/uploads/') || !/^https?:\/\//i.test(API_BASE)) return path
  return `${new URL(API_BASE).origin}${path}`
}

export class ApiError extends Error {
  constructor(message, status = 0, code = 'NETWORK_ERROR') { super(message); this.name = 'ApiError'; this.status = status; this.code = code }
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body !== undefined && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
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
