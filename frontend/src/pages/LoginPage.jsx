import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const API_URL = ''  // nginx proxy จัดการ /api/ → backend:8000 ให้แล้ว

const LoginPage = () => {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const username = e.target.username.value
    const password = e.target.password.value

    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
        return
      }

      const data = await res.json()
      localStorage.setItem('access_token', data.access_token)
      navigate('/dashboard')
    } catch {
      setError('ไม่สามารถเชื่อมต่อ server ได้ กรุณาลองใหม่')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-icon">
          <img src="assets/images/robot-arm.png" alt="Robot Arm" className="login-icon-img" />
        </div>
        <h1 className="login-title">Robot Arm System Login</h1>
        <p className="login-subtitle">เข้าสู่ระบบเพื่อเริ่มควบคุมแขนกล</p>

        <form className="login-form" onSubmit={handleLogin}>
          <input id="username" name="username" type="text" placeholder="Username" required />
          <input id="password" name="password" type="password" placeholder="Password" required />
          {error && <p className="login-error">{error}</p>}
          <button id="login-submit-btn" type="submit" className="login-btn" disabled={loading}>
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default LoginPage
