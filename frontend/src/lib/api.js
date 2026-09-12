export function authHeaders() {
  const token = localStorage.getItem('access_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function apiFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (!headers.Authorization && !headers.authorization) {
    const token = localStorage.getItem('access_token')
    if (token) headers.Authorization = `Bearer ${token}`
  }
  return fetch(url, { ...opts, headers })
}

export default apiFetch
