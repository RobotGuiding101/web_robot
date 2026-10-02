import { useEffect, useState } from 'react'

let ws = null
let timer = null
let refCount = 0
const subs = new Set()
let latest = null

function connect() {
  const token = localStorage.getItem('access_token') || ''
  if (!token) { timer = setTimeout(connect, 2000); return }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  try {
    ws = new WebSocket(proto + '//' + location.host + '/ws/joints?token=' + encodeURIComponent(token))
  } catch {
    timer = setTimeout(connect, 2000)
    return
  }
  ws.onmessage = (ev) => {
    let d
    try { d = JSON.parse(ev.data) } catch { return }
    latest = d
    subs.forEach((fn) => fn(d))
  }
  ws.onclose = () => {
    ws = null
    if (refCount > 0) timer = setTimeout(connect, 1000)
  }
}

function ensure() {
  if (ws || timer) return
  connect()
}

function release() {
  if (refCount > 0) return
  if (timer) { clearTimeout(timer); timer = null }
  if (ws) { try { ws.close() } catch { /* ignore */ } ws = null }
}

/** One shared /ws/joints connection per page; returns the latest
 * {angles, pose?, connected} pushed by the backend (null until first message). */
export function useJointsSocket() {
  const [data, setData] = useState(latest)
  useEffect(() => {
    refCount += 1
    subs.add(setData)
    if (latest) setData(latest)
    ensure()
    return () => {
      subs.delete(setData)
      refCount -= 1
      release()
    }
  }, [])
  return data
}

export default useJointsSocket
