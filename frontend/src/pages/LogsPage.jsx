import React, { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

const REFRESH_MS = 5000

const DEVICE_COLORS = {
  robot: '#2563eb',
  align: '#7c3aed',
  align_icp: '#6366f1',
  draw: '#db2777',
  camera: '#0d9488',
  estop: '#dc2626',
  relay_v1: '#d97706',
}

const DEVICE_OPTIONS = ['', 'robot', 'align', 'align_icp', 'draw', 'camera', 'estop', 'relay_v1']

const fmtTime = (iso) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('th-TH', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch {
    return iso
  }
}

const DeviceBadge = ({ device }) => (
  <span
    style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '999px',
      fontSize: '11px',
      fontWeight: 700,
      color: '#fff',
      background: DEVICE_COLORS[device] || '#64748b',
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
    }}
  >
    {device || '—'}
  </span>
)

const LogsPage = () => {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [device, setDevice] = useState('')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(100)
  const [auto, setAuto] = useState(true)
  const [lastAt, setLastAt] = useState(null)

  const filtersRef = useRef({ device, search, limit })
  filtersRef.current = { device, search, limit }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { device, search, limit } = filtersRef.current
      const q = new URLSearchParams()
      q.set('limit', String(limit))
      if (device) q.set('device', device)
      if (search.trim()) q.set('search', search.trim())
      const res = await apiFetch('/api/devices/events?' + q.toString())
      if (!res.ok) throw new Error('stream unavailable')
      const data = await res.json()
      setEvents(Array.isArray(data.events) ? data.events : [])
      setError(false)
      setLastAt(new Date())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load, device, limit])

  useEffect(() => {
    if (!auto) return
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [auto, load])

  const handleEmergency = () => {
    apiFetch('/api/robot/emergency-stop', { method: 'POST' }).catch(() => {})
    alert('EMERGENCY STOP!')
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="Activity Log" onEmergency={handleEmergency} />
        <div className="page-content">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <select
                className="settings-input"
                style={{ maxWidth: '180px' }}
                value={device}
                onChange={(e) => setDevice(e.target.value)}
              >
                {DEVICE_OPTIONS.map((d) => (
                  <option key={d || 'all'} value={d}>{d ? d : 'ทุกอุปกรณ์'}</option>
                ))}
              </select>

              <input
                className="settings-input"
                style={{ maxWidth: '240px' }}
                placeholder="ค้นหาใน detail… (Enter)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') load() }}
              />

              <select
                className="settings-input"
                style={{ maxWidth: '120px' }}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n} แถว</option>)}
              </select>

              <button
                className={`settings-btn settings-btn--secondary ${loading ? 'loading' : ''}`}
                onClick={load}
                disabled={loading}
              >
                {loading ? '⏳ กำลังโหลด' : '↻ Refresh'}
              </button>

              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#334155' }}>
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
                auto {Math.round(REFRESH_MS / 1000)}s
              </label>

              <span style={{ marginLeft: 'auto', fontSize: '13px', color: '#475569' }}>
                {events.length} รายการ{lastAt ? ` · ${lastAt.toLocaleTimeString('th-TH')}` : ''}
              </span>
            </div>

            {error && (
              <div style={{ color: '#b91c1c', fontSize: '13px', fontWeight: 600 }}>โหลด log ไม่สำเร็จ (ต้องล็อกอินอยู่)</div>
            )}

            <div style={{
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              overflow: 'hidden',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                    <th style={th}>เวลา</th>
                    <th style={th}>ผู้ใช้</th>
                    <th style={th}>อุปกรณ์</th>
                    <th style={th}>การกระทำ</th>
                    <th style={th}>รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ ...td, textAlign: 'center', color: '#64748b', padding: '28px' }}>
                        {loading ? 'กำลังโหลด…' : 'ไม่มี log'}
                      </td>
                    </tr>
                  )}
                  {events.map((e, i) => (
                    <tr key={e.id} style={{ borderTop: '1px solid #e2e8f0', background: i % 2 ? '#f8fafc' : '#ffffff' }}>
                      <td style={{ ...td, whiteSpace: 'nowrap', color: '#475569' }}>{fmtTime(e.time)}</td>
                      <td style={{ ...td, fontWeight: 700, color: '#0f172a' }}>{e.user || '—'}</td>
                      <td style={td}><DeviceBadge device={e.device} /></td>
                      <td style={{ ...td, color: '#1e293b', fontWeight: 600 }}>{e.action || '—'}</td>
                      <td style={{ ...td, color: '#475569' }}>{e.detail || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

const th = {
  padding: '11px 14px',
  fontSize: '11px',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#334155',
  fontWeight: 800,
}

const td = {
  padding: '9px 14px',
  verticalAlign: 'top',
}

export default LogsPage
