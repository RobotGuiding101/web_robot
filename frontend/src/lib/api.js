function decodePayload(token) {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
    return JSON.parse(atob(b64 + pad))
  } catch {
    return null
  }
}

export function getToken() {
  return localStorage.getItem('access_token') || ''
}

export function clearToken() {
  localStorage.removeItem('access_token')
}

export function isTokenValid() {
  const token = getToken()
  if (!token) return false
  const payload = decodePayload(token)
  if (!payload) return false
  if (typeof payload.exp !== 'number') return true
  return Date.now() < payload.exp * 1000
}

export function redirectToLogin() {
  clearToken()
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.replace('/login')
  }
}

export function authHeaders() {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function apiFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (!headers.Authorization && !headers.authorization) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const method = String(opts.method || 'GET').toUpperCase()
  let res = await fetch(url, { ...opts, headers })
  if (method === 'GET' && res.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    res = await fetch(url, { ...opts, headers })
  }
  if (res.status === 401 && !String(url).includes('/api/auth/')) {
    redirectToLogin()
  } else if (res.status >= 500 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('api:server-error', {
      detail: { url: String(url), status: res.status },
    }))
  }
  return res
}

export default apiFetch
