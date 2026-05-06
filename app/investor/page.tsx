'use client'
import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useRouter } from 'next/navigation'

const MRR_HISTORY = [
  { month: 'Mar 25', mrr: 3805 }, { month: 'Apr 25', mrr: 3977 },
  { month: 'May 25', mrr: 3977 }, { month: 'Jun 25', mrr: 5589 },
  { month: 'Jul 25', mrr: 5589 }, { month: 'Aug 25', mrr: 5589 },
  { month: 'Sep 25', mrr: 6212 }, { month: 'Oct 25', mrr: 7640 },
  { month: 'Nov 25', mrr: 7640 }, { month: 'Dec 25', mrr: 7640 },
  { month: 'Jan 26', mrr: 8185 }, { month: 'Feb 26', mrr: 7682 },
  { month: 'Mar 26', mrr: 7776 },
]

const CLIENTS = [
  { name: 'RAYOMAR',          mrr: 3640, pct: 44 },
  { name: 'KRBS',             mrr: 1838, pct: 22 },
  { name: 'OFII',             mrr: 1316, pct: 16 },
  { name: 'RIB / KLMSI-UK',  mrr: 533,  pct: 6  },
  { name: 'KLLP',             mrr: 500,  pct: 6  },
  { name: 'Other clients',    mrr: 358,  pct: 4  },
]

export default function InvestorPage() {
  const router = useRouter()
  const [narrative, setNarrative] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const totalMrr = CLIENTS.reduce((s, c) => s + c.mrr, 0)

  async function loadNarrative() {
    setLoading(true)
    // Try to get cached narrative from latest period
    const periodsRes = await fetch('/api/periods')
    const periodsData = await periodsRes.json()
    if (periodsData.periods?.length > 0) {
      const latestPeriod = periodsData.periods[0]
      const res = await fetch(`/api/ai-insights?periodId=${latestPeriod.id}`)
      const data = await res.json()
      const narrativeInsight = data.insights?.find((i: any) => i.type === 'narrative')
      if (narrativeInsight) setNarrative(narrativeInsight.content)
    }
    setLoading(false)
  }

  useEffect(() => { loadNarrative() }, [])

  async function signOut() {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-narra-dark">
      {/* Header */}
      <header className="border-b border-white/10 px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-light text-white">
            narra<span className="text-narra-green font-semibold">.</span>
          </h1>
          <p className="text-white/30 text-xs tracking-widest uppercase mt-0.5">Investor Dashboard</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-white/30 text-xs">Narra Health PTE. LTD. · Confidential</span>
          <button onClick={signOut} className="text-white/30 hover:text-white text-xs transition-colors">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-8 py-10 space-y-8">

        {/* Period label */}
        <div className="animate-fade-up">
          <h2 className="font-heading text-3xl font-light text-white">January 2026</h2>
          <p className="text-white/40 text-sm mt-1">Monthly financial summary</p>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-4 animate-fade-up delay-1">
          {[
            { label: 'MRR', value: `$${totalMrr.toLocaleString()}`, sub: '+7.2% MoM', pos: true },
            { label: 'ARR', value: `$${(totalMrr * 12).toLocaleString()}`, sub: 'Annualised' },
            { label: 'Active Clients', value: '12', sub: 'Paying accounts' },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <div className="text-white/40 text-xs uppercase tracking-widest font-body mb-2">{kpi.label}</div>
              <div className="font-heading text-3xl font-light text-white">{kpi.value}</div>
              <div className={`text-xs mt-1 ${kpi.pos ? 'text-narra-green' : 'text-white/30'}`}>{kpi.sub}</div>
            </div>
          ))}
        </div>

        {/* MRR chart */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 animate-fade-up delay-2">
          <h3 className="font-heading text-lg font-light text-white mb-5">MRR Growth</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={MRR_HISTORY}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.3)' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: any) => [`$${Number(v).toLocaleString()}`, 'MRR']}
                contentStyle={{ background: '#0d2b30', border: '1px solid rgba(199,233,149,0.2)', borderRadius: 8, color: 'white', fontSize: 12 }}
                labelStyle={{ color: '#c7e995' }}
              />
              <Line type="monotone" dataKey="mrr" stroke="#c7e995" strokeWidth={2.5} dot={{ fill: '#c7e995', r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Client breakdown */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 animate-fade-up delay-3">
          <h3 className="font-heading text-lg font-light text-white mb-5">Revenue by Client</h3>
          <div className="space-y-3">
            {CLIENTS.map(c => (
              <div key={c.name} className="flex items-center gap-4">
                <span className="text-white/60 text-sm font-body w-36 truncate">{c.name}</span>
                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-narra-green rounded-full transition-all" style={{ width: `${c.pct}%` }} />
                </div>
                <span className="text-white/40 text-xs w-8 text-right">{c.pct}%</span>
                <span className="text-white font-body text-sm w-20 text-right">${c.mrr.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-white/10 flex justify-between">
            <span className="text-white/40 text-sm font-body">Total MRR</span>
            <span className="text-narra-green font-heading font-semibold">${totalMrr.toLocaleString()}</span>
          </div>
        </div>

        {/* AI Narrative */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 animate-fade-up delay-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading text-lg font-light text-white">Monthly Update</h3>
            <span className="text-white/20 text-xs">AI-generated · Confidential</span>
          </div>
          {loading ? (
            <p className="text-white/30 text-sm animate-pulse-soft">Loading narrative…</p>
          ) : narrative ? (
            <p className="text-white/70 text-sm leading-relaxed font-body whitespace-pre-line">{narrative}</p>
          ) : (
            <p className="text-white/30 text-sm italic">The finance team hasn't generated this month's narrative yet.</p>
          )}
        </div>

        <p className="text-center text-white/20 text-xs pb-6">
          This information is confidential and intended solely for Narra Health investors. Do not distribute.
        </p>
      </main>
    </div>
  )
}
