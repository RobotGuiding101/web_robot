import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../lib/api'

const SOI = [0xff, 0xd8]
const EOI = [0xff, 0xd9]
const STALL_MS = 3000
const RECONNECT_MS = 500
const MAX_BUF = 4 * 1024 * 1024

let streamMode = null
const modeListeners = new Set()

export function setStreamMode(mode) {
  streamMode = mode || null
  modeListeners.forEach((fn) => fn(streamMode))
}

function findSeq(buf, seq, from) {
  const n = seq.length
  const limit = buf.length - n
  for (let i = from; i <= limit; i++) {
    let ok = true
    for (let j = 0; j < n; j++) {
      if (buf[i + j] !== seq[j]) { ok = false; break }
    }
    if (ok) return i
  }
  return -1
}

function concat(a, b) {
  if (a.length === 0) return b
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

const CameraStream = ({ id, src = '/api/map/video_feed', withMode = true, mode: fixedMode, onError, onFrame }) => {
  const canvasRef = useRef(null)
  const [sharedMode, setSharedMode] = useState(streamMode)
  const mode = fixedMode !== undefined ? fixedMode : sharedMode
  const cbRef = useRef({ onError, onFrame })
  cbRef.current = { onError, onFrame }

  useEffect(() => {
    const fn = (m) => setSharedMode(m)
    modeListeners.add(fn)
    return () => { modeListeners.delete(fn) }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    let stopped = false
    let controller = null
    let reconnectTimer = null
    let pending = null
    let gotFrame = false
    let lastFrameAt = performance.now()

    const buildUrl = () => {
      const q = new URLSearchParams()
      if (withMode && mode) q.set('mode', mode)
      q.set('_t', String(Date.now()))
      const base = src || '/api/map/video_feed'
      return `${base}${base.includes('?') ? '&' : '?'}${q.toString()}`
    }

    async function renderLoop() {
      while (!stopped) {
        if (pending) {
          const jpeg = pending
          pending = null
          try {
            const bmp = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))
            if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
              canvas.width = bmp.width
              canvas.height = bmp.height
            }
            ctx.drawImage(bmp, 0, 0)
            bmp.close()
            if (!gotFrame) { gotFrame = true; if (cbRef.current.onFrame) cbRef.current.onFrame() }
          } catch { /* skip malformed frame */ }
        } else {
          await new Promise((r) => requestAnimationFrame(r))
        }
      }
    }

    async function readLoop() {
      if (!localStorage.getItem('access_token')) {
        if (!stopped) reconnectTimer = setTimeout(readLoop, 2000)
        return
      }
      controller = new AbortController()
      const signal = controller.signal
      lastFrameAt = performance.now()
      try {
        const res = await apiFetch(buildUrl(), { signal, cache: 'no-store' })
        if (!res.ok || !res.body) throw new Error('stream unavailable')
        const reader = res.body.getReader()
        let buf = new Uint8Array(0)
        while (!stopped && !signal.aborted) {
          const { value, done } = await reader.read()
          if (done) break
          buf = concat(buf, value)
          let pos = 0
          for (;;) {
            const soi = findSeq(buf, SOI, pos)
            if (soi < 0) { pos = Math.max(0, buf.length - 1); break }
            const eoi = findSeq(buf, EOI, soi + 2)
            if (eoi < 0) { pos = soi; break }
            pending = buf.slice(soi, eoi + 2)
            lastFrameAt = performance.now()
            pos = eoi + 2
          }
          if (pos > 0) buf = buf.slice(pos)
          if (buf.length > MAX_BUF) buf = new Uint8Array(0)
        }
      } catch { if (cbRef.current.onError) cbRef.current.onError() }
      if (!stopped) reconnectTimer = setTimeout(readLoop, RECONNECT_MS)
    }

    const watchdog = setInterval(() => {
      if (performance.now() - lastFrameAt > STALL_MS) {
        try { if (controller) controller.abort() } catch { /* ignore */ }
      }
    }, 1000)

    renderLoop()
    readLoop()

    return () => {
      stopped = true
      clearInterval(watchdog)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      try { if (controller) controller.abort() } catch { /* ignore */ }
    }
  }, [mode, src, withMode])

  return (
    <canvas
      ref={canvasRef}
      id={id}
      width={640}
      height={360}
      style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
    />
  )
}

export default CameraStream
