// Render smoke test for the Draw page.
//
// The page is ~2,300 lines and had no render coverage at all, which let a
// temporal-dead-zone bug through: a useCallback dependency array referenced a
// const declared further down the file, so the component threw on mount while
// `npm run build` and `oxlint` both stayed green — neither executes a render.
// Anything that throws while mounting will fail here.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../lib/api', () => ({ apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })) }))
vi.mock('../components/Sidebar', () => ({ default: () => <div data-testid="sidebar" /> }))
vi.mock('../components/TopBar', () => ({ default: ({ title }) => <div>{title}</div> }))
vi.mock('../components/CameraStream', () => ({
  default: () => <div data-testid="camera" />,
  setStreamMode: vi.fn(),
}))
vi.mock('../lib/useJointsSocket', () => ({
  useJointsSocket: () => ({ angles: [], pose: null, connected: false }),
}))
vi.mock('fabric', () => {
  const Point = class {
    constructor(x = 0, y = 0) { this.x = x; this.y = y }
  }
  // The Draw page wires a long list of canvas events, so enumerating the
  // surface it touches would be brittle. Anything not modelled explicitly
  // answers as a no-op instead.
  const surface = () => new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined
      return () => surface()
    },
  })
  class FabricStub {
    constructor() { return surface() }
  }
  return {
    Canvas: FabricStub,
    PencilBrush: FabricStub,
    Line: FabricStub,
    Polyline: FabricStub,
    Point,
  }
})

import DrawingModePage from './DrawingModePage'

describe('DrawingModePage renders', () => {
  beforeEach(() => {
    localStorage.clear()
    // jsdom does not implement scrollIntoView, which the log panel calls on mount.
    Element.prototype.scrollIntoView = vi.fn()
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })

  it('mounts without throwing', () => {
    expect(() => render(<DrawingModePage />)).not.to.throw()
  })

  it('renders the panel shell', () => {
    render(<DrawingModePage />)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
  })
})