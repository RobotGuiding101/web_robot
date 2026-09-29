import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ApiErrorBanner from './ApiErrorBanner'

const dispatchServerError = (detail) =>
  act(() => {
    window.dispatchEvent(new CustomEvent('api:server-error', { detail }))
  })

afterEach(() => {
  vi.useRealTimers()
})

describe('ApiErrorBanner', () => {
  it('renders nothing until an error event arrives', () => {
    render(<ApiErrorBanner />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the status code from the event', () => {
    render(<ApiErrorBanner />)
    dispatchServerError({ status: 503, url: '/api/map/status' })
    expect(screen.getByRole('alert')).toHaveTextContent('503')
  })

  it('falls back to a generic 5xx label when no status is given', () => {
    render(<ApiErrorBanner />)
    dispatchServerError({})
    expect(screen.getByRole('alert')).toHaveTextContent('5xx')
  })

  it('can be dismissed manually', () => {
    render(<ApiErrorBanner />)
    dispatchServerError({ status: 500 })
    fireEvent.click(screen.getByTitle('ปิด'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('auto-hides after the visible window', () => {
    vi.useFakeTimers()
    render(<ApiErrorBanner />)
    dispatchServerError({ status: 500 })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(8000)
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
