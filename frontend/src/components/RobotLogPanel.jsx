// Robot Log panel — the controller's TCP conversation translated into plain
// language.
//
// Extracted from the Dobot page so the polling/pause/clear logic has one
// home instead of living inside a page component. The raw line is kept on
// every row's `title` so a developer can still see exactly what went over
// the wire.
import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import { formatRobotLogLines } from '../lib/robotLogFormat'

const LOG_MAX = 200
const POLL_MS = 2000

export default function RobotLogPanel({ title = 'Robot Log', accentClass = '' }) {
  const [lines, setLines] = useState([])
  const [paused, setPaused] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const bottomRef = useRef(null)
  const pausedRef = useRef(false)
  const pendingRef = useRef([])

  pausedRef.current = paused

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, paused])

  useEffect(() => {
    let dead = false
    let lastId = 0

    const apply = (data) => {
      if (dead || !Array.isArray(data.entries)) return
      if (typeof data.latest === 'number') lastId = data.latest
      const fresh = formatRobotLogLines(data.entries)
      if (fresh.length === 0) return
      if (pausedRef.current) {
        pendingRef.current.push(...fresh)
        setPendingCount(pendingRef.current.length)
        return
      }
      setLines((prev) => {
        const next = [...prev, ...fresh]
        return next.length > LOG_MAX ? next.slice(-LOG_MAX) : next
      })
    }

    const load = (url) => apiFetch(url).then((r) => r.json()).then(apply).catch(() => {})

    load('/api/map/robot_logs')
    const poll = setInterval(() => {
      if (dead || pausedRef.current) return
      load(`/api/map/robot_logs?since=${lastId}`)
    }, POLL_MS)

    return () => { dead = true; clearInterval(poll) }
  }, [])

  const handleResume = useCallback(() => {
    setPaused(false)
    if (pendingRef.current.length) {
      const incoming = pendingRef.current
      pendingRef.current = []
      setPendingCount(0)
      setLines((prev) => {
        const next = [...prev, ...incoming]
        return next.length > LOG_MAX ? next.slice(-LOG_MAX) : next
      })
    }
  }, [])

  const handleClear = useCallback(() => {
    setLines([])
    pendingRef.current = []
    setPendingCount(0)
  }, [])

  return (
    <div className={`log-panel-box ${accentClass}`}>
      <div className="log-panel-header">
        <span className="log-panel-title">{title}</span>
        <div className="log-panel-actions">
          {paused
            ? <button className="log-btn log-btn--resume" onClick={handleResume}>Resume</button>
            : <button className="log-btn log-btn--pause" onClick={() => setPaused(true)}>Pause</button>}
          <button className="log-btn log-btn--clear" onClick={handleClear}>Clear</button>
        </div>
      </div>
      <div className="log-panel-body" id="log-robot">
        {lines.length === 0
          ? <span className="log-empty">No log entries yet…</span>
          : lines.map((l, i) => (
            <div key={i} className={`log-line log-line--${l.kind}`} title={l.raw || l.text}>
              <span className="log-time">{l.t}</span>
              <span className="log-msg">{l.text}</span>
            </div>
          ))
        }
        <div ref={bottomRef} />
      </div>
      {paused && pendingCount > 0 && (
        <div className="log-paused-banner">
          Paused — {pendingCount} new line{pendingCount > 1 ? 's' : ''} waiting
        </div>
      )}
    </div>
  )
}