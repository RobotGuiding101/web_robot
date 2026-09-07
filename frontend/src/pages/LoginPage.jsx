import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const LoginPage = () => {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [isRegister, setIsRegister] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const username = e.target.username.value
    const password = e.target.password.value

    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || (isRegister ? 'Registration failed' : 'Invalid credentials'))
        return
      }

      const data = await res.json()
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('username', data.username)
      navigate('/dashboard')
    } catch {
      setError('Cannot connect to server')
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
        <h1 className="login-title">Robot Arm System</h1>
        <p className="login-subtitle">
          {isRegister ? 'Create a new account' : 'Sign in to control the robot arm'}
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <input id="username" name="username" type="text" placeholder="Username" required minLength={2} />
          <input id="password" name="password" type="password" placeholder="Password" required minLength={4} />
          {error && <p className="login-error">{error}</p>}
          <button id="login-submit-btn" type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Loading...' : isRegister ? 'Register' : 'Sign in'}
          </button>
        </form>

        <p className="login-toggle" onClick={() => { setIsRegister(!isRegister); setError('') }}>
          {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register"}
        </p>
      </div>
    </div>
  )
}

export default LoginPage
