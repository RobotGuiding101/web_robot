import React, { useEffect, useState } from 'react'

const VISIBLE_MS = 8000

const ApiErrorBanner = () => {
  const [err, setErr] = useState(null)

  useEffect(() => {
    let timer = null
    const onServerError = (e) => {
      setErr(e.detail || {})
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setErr(null), VISIBLE_MS)
    }
    window.addEventListener('api:server-error', onServerError)
    return () => {
      window.removeEventListener('api:server-error', onServerError)
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (!err) return null

  return (
    <div className="api-err-banner" role="alert">
      <span>เซิร์ฟเวอร์ตอบผิดพลาด ({err.status || '5xx'}) — ระบบกำลังลองใหม่ กรุณารอสักครู่</span>
      <button className="api-err-close" onClick={() => setErr(null)} title="ปิด">✕</button>
    </div>
  )
}

export default ApiErrorBanner
