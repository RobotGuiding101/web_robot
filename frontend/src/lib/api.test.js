import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  apiFetch,
  authHeaders,
  clearToken,
  getToken,
  isTokenValid,
  redirectToLogin,
} from './api'

const b64url = (obj) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const makeToken = (payload) => `header.${b64url(payload)}.signature`

function stubLocation(pathname = '/dobot') {
  const replace = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname, replace },
  })
  return { replace }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('token storage', () => {
  it('getToken returns empty string when unset', () => {
    expect(getToken()).toBe('')
  })

  it('stores and clears the token', () => {
    localStorage.setItem('access_token', 'abc')
    expect(getToken()).toBe('abc')
    clearToken()
    expect(getToken()).toBe('')
  })
})

describe('isTokenValid', () => {
  it('is false with no token', () => {
    expect(isTokenValid()).toBe(false)
  })

  it('is true for a future exp', () => {
    localStorage.setItem('access_token', makeToken({ exp: Date.now() / 1000 + 3600 }))
    expect(isTokenValid()).toBe(true)
  })

  it('is false for an expired token', () => {
    localStorage.setItem('access_token', makeToken({ exp: Date.now() / 1000 - 10 }))
    expect(isTokenValid()).toBe(false)
  })

  it('treats a token with no exp as valid', () => {
    localStorage.setItem('access_token', makeToken({ sub: 'x' }))
    expect(isTokenValid()).toBe(true)
  })

  it('is false for a malformed token', () => {
    localStorage.setItem('access_token', 'not-a-jwt')
    expect(isTokenValid()).toBe(false)
  })
})

describe('authHeaders', () => {
  it('is empty without a token', () => {
    expect(authHeaders()).toEqual({})
  })

  it('adds a bearer header with a token', () => {
    localStorage.setItem('access_token', 'tok')
    expect(authHeaders()).toEqual({ Authorization: 'Bearer tok' })
  })
})

describe('redirectToLogin', () => {
  it('clears the token and navigates from a protected path', () => {
    const { replace } = stubLocation('/dobot')
    localStorage.setItem('access_token', 'tok')
    redirectToLogin()
    expect(getToken()).toBe('')
    expect(replace).toHaveBeenCalledWith('/login')
  })

  it('does not navigate when already on /login', () => {
    const { replace } = stubLocation('/login')
    redirectToLogin()
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('apiFetch', () => {
  it('attaches the stored token as a bearer header', async () => {
    localStorage.setItem('access_token', 'tok')
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true })
    globalThis.fetch = fetchMock

    await apiFetch('/api/map/status')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('does not override an explicit Authorization header', async () => {
    localStorage.setItem('access_token', 'tok')
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true })
    globalThis.fetch = fetchMock

    await apiFetch('/api/map/status', { headers: { Authorization: 'Bearer explicit' } })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer explicit')
  })

  it('retries a GET request once after a 5xx', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, ok: false })
      .mockResolvedValueOnce({ status: 200, ok: true })
    globalThis.fetch = fetchMock

    const pending = apiFetch('/api/map/status')
    await vi.advanceTimersByTimeAsync(1300)
    const res = await pending

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('dispatches api:server-error for a 5xx without retrying non-GET', async () => {
    stubLocation('/x')
    const fetchMock = vi.fn().mockResolvedValue({ status: 503, ok: false })
    globalThis.fetch = fetchMock
    const handler = vi.fn()
    window.addEventListener('api:server-error', handler)

    await apiFetch('/api/map/jog', { method: 'POST' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].detail).toEqual({ url: '/api/map/jog', status: 503 })
    window.removeEventListener('api:server-error', handler)
  })

  it('redirects to login on 401 for a protected endpoint and clears the token', async () => {
    const { replace } = stubLocation('/dobot')
    localStorage.setItem('access_token', 'tok')
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 401, ok: false })

    await apiFetch('/api/map/status')

    expect(replace).toHaveBeenCalledWith('/login')
    expect(getToken()).toBe('')
  })

  it('does not redirect on 401 from the auth endpoints', async () => {
    const { replace } = stubLocation('/login')
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 401, ok: false })

    await apiFetch('/api/auth/login', { method: 'POST' })

    expect(replace).not.toHaveBeenCalled()
  })
})
