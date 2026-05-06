'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })

    const data = await res.json()

    if (data.role === 'finance') {
      router.push('/finance')
    } else if (data.role === 'investor') {
      router.push('/investor')
    } else {
      setError('Incorrect password. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-narra-dark px-4">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-5"
        style={{ backgroundImage: 'radial-gradient(circle at 25% 50%, #c7e995 0%, transparent 50%), radial-gradient(circle at 75% 50%, #c7e995 0%, transparent 50%)' }} />

      <div className="relative w-full max-w-sm animate-fade-up">
        {/* Logo */}
        <div className="text-center mb-10">
          <h1 className="font-heading text-4xl font-light text-white tracking-tight">
            narra<span className="text-narra-green font-semibold">.</span>
          </h1>
          <p className="text-white/40 text-sm mt-2 font-body tracking-widest uppercase">Finance Platform</p>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8">
          <h2 className="font-heading text-xl text-white font-medium mb-1">Welcome back</h2>
          <p className="text-white/40 text-sm mb-8">Enter your team password to continue</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-white/40 uppercase tracking-widest mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/20
                           focus:outline-none focus:border-narra-green/60 focus:bg-white/15 transition-all text-sm"
              />
            </div>

            {error && (
              <p className="text-red-400 text-xs bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-narra-green text-narra-dark font-heading font-semibold rounded-xl py-3 text-sm
                         hover:bg-narra-green/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed
                         tracking-wide"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-white/20 text-xs mt-8">
          Narra Health PTE. LTD. · Confidential
        </p>
      </div>
    </div>
  )
}
