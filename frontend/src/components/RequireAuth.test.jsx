import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import RequireAuth from './RequireAuth'

const b64url = (obj) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const validToken = `h.${b64url({ sub: 'u1', exp: Date.now() / 1000 + 3600 })}.s`

const renderProtected = () =>
  render(
    <MemoryRouter initialEntries={['/secret']}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route
          path="/secret"
          element={
            <RequireAuth>
              <div>secret page</div>
            </RequireAuth>
          }
        />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  localStorage.clear()
})

describe('RequireAuth', () => {
  it('redirects to /login when there is no token', () => {
    renderProtected()
    expect(screen.getByText('login page')).toBeInTheDocument()
    expect(screen.queryByText('secret page')).toBeNull()
  })

  it('renders children when the token is valid', () => {
    localStorage.setItem('access_token', validToken)
    renderProtected()
    expect(screen.getByText('secret page')).toBeInTheDocument()
  })

  it('redirects when the token is expired', () => {
    localStorage.setItem(
      'access_token',
      `h.${b64url({ exp: Date.now() / 1000 - 10 })}.s`,
    )
    renderProtected()
    expect(screen.getByText('login page')).toBeInTheDocument()
  })
})
