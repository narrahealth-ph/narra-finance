'use client'
import { useState } from 'react'
import { FileText, Search, AlertTriangle, Users, Sparkles } from 'lucide-react'

export default function AIInsights({ periodId, data }: { periodId: number; data: any }) {
  const [loading, setLoading] = useState<string | null>(null)
  const [results, setResults] = useState<{ narrative?: string; anomalies?: any[]; churn?: any[] }>({})

  async function generate(type: string) {
    setLoading(type)
    const res = await fetch('/api/ai-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId, type }),
    })
    const result = await res.json()
    setResults(prev => ({ ...prev, ...result }))
    setLoading(null)
  }

  const total = data?.pl
  const runway = total?.totalExpenses > 0
    ? Math.floor((data?.bs?.cashClosing || 0) / (total.totalExpenses))
    : null

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <h2 className="font-heading text-xl font-semibold text-narra-dark">AI Insights</h2>
        <p className="text-sm text-narra-muted mt-0.5">Powered by Claude — click to generate each insight</p>
      </div>

      {/* Quick stats */}
      {total && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Revenue', value: `$${(total.totalRevenue || 0).toLocaleString()}` },
            { label: 'Expenses', value: `$${(total.totalExpenses || 0).toLocaleString()}` },
            { label: 'Net', value: `${total.netProfit >= 0 ? '+' : ''}$${(total.netProfit || 0).toLocaleString()}`, color: total.netProfit >= 0 ? 'text-green-600' : 'text-red-500' },
            { label: 'Runway', value: runway ? `${runway}mo` : '—' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-narra-border rounded-xl p-4">
              <div className="text-xs text-narra-muted uppercase tracking-widest mb-1">{s.label}</div>
              <div className={`font-heading text-xl font-semibold ${s.color || 'text-narra-dark'}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Investor Narrative */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-narra-border flex items-center justify-between">
          <div>
            <h3 className="font-heading font-semibold text-narra-dark flex items-center gap-2"><FileText size={16} /> Monthly Investor Narrative</h3>
            <p className="text-xs text-narra-muted mt-0.5">AI-written summary for your investor update</p>
          </div>
          <button onClick={() => generate('narrative')} disabled={loading === 'narrative'}
            className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50 flex items-center gap-2">
            {loading === 'narrative' ? <><Sparkles size={14} className="inline mr-1 animate-pulse" />Writing…</> : <><Sparkles size={14} className="inline mr-1" />Generate</>}
          </button>
        </div>
        <div className="px-5 py-4">
          {results.narrative ? (
            <div className="prose prose-sm max-w-none">
              <p className="text-narra-ink leading-relaxed whitespace-pre-line font-body text-sm">{results.narrative}</p>
              <button onClick={() => navigator.clipboard.writeText(results.narrative || '')}
                className="mt-3 text-xs text-narra-muted hover:text-narra-dark border border-narra-border rounded px-2 py-1 transition-colors">
                Copy to clipboard
              </button>
            </div>
          ) : (
            <p className="text-narra-muted text-sm italic">Click Generate to write the investor narrative for this month.</p>
          )}
        </div>
      </div>

      {/* Anomaly Detection */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-narra-border flex items-center justify-between">
          <div>
            <h3 className="font-heading font-semibold text-narra-dark flex items-center gap-2"><Search size={16} /> Anomaly & Overspend Alerts</h3>
            <p className="text-xs text-narra-muted mt-0.5">Flags unusual transactions or categories</p>
          </div>
          <button onClick={() => generate('anomalies')} disabled={loading === 'anomalies'}
            className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50">
            {loading === 'anomalies' ? <><Sparkles size={14} className="inline mr-1 animate-pulse" />Analyzing…</> : <><Sparkles size={14} className="inline mr-1" />Analyze</>}
          </button>
        </div>
        <div className="px-5 py-4">
          {results.anomalies ? (
            results.anomalies.length === 0 ? (
              <p className="text-green-600 text-sm">✓ No anomalies detected this month.</p>
            ) : (
              <div className="space-y-3">
                {results.anomalies.map((a: any, i: number) => (
                  <div key={i} className={`rounded-lg p-3 text-sm flex items-start gap-3 ${
                    a.severity === 'high' ? 'bg-red-50 border border-red-200' :
                    a.severity === 'medium' ? 'bg-amber-50 border border-amber-200' :
                    'bg-blue-50 border border-blue-200'
                  }`}>
                    <span>{a.severity === 'high' ? '🔴' : a.severity === 'medium' ? '🟡' : '🔵'}</span>
                    <div>
                      <span className="font-medium capitalize">{a.type.replace(/_/g, ' ')}</span>
                      {a.amount && <span className="text-narra-muted ml-2">${Number(a.amount).toLocaleString()}</span>}
                      <p className="text-narra-muted mt-0.5">{a.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            <p className="text-narra-muted text-sm italic">Click Analyze to scan for unusual expenses or patterns.</p>
          )}
        </div>
      </div>

      {/* Churn Risk */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-narra-border flex items-center justify-between">
          <div>
            <h3 className="font-heading font-semibold text-narra-dark flex items-center gap-2"><Users size={16} /> Client Churn Risk</h3>
            <p className="text-xs text-narra-muted mt-0.5">Identifies at-risk clients based on payment patterns</p>
          </div>
          <button onClick={() => generate('churn')} disabled={loading === 'churn'}
            className="px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50">
            {loading === 'churn' ? <><Sparkles size={14} className="inline mr-1 animate-pulse" />Assessing…</> : <><Sparkles size={14} className="inline mr-1" />Assess</>}
          </button>
        </div>
        <div className="px-5 py-4">
          {results.churn ? (
            <div className="space-y-3">
              {results.churn.map((c: any, i: number) => (
                <div key={i} className="flex items-start gap-4 py-2 border-b border-narra-border last:border-0">
                  <span className={`text-xs font-body px-2 py-0.5 rounded-full mt-0.5 flex-shrink-0 ${
                    c.risk === 'high' ? 'bg-red-100 text-red-700' :
                    c.risk === 'medium' ? 'bg-amber-100 text-amber-700' :
                    'bg-green-100 text-green-700'
                  }`}>{c.risk}</span>
                  <div className="flex-1">
                    <p className="font-medium text-narra-dark text-sm">{c.client}</p>
                    <p className="text-narra-muted text-xs mt-0.5">{c.reason}</p>
                  </div>
                  <p className="text-narra-muted text-xs max-w-xs text-right italic">{c.recommendation}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-narra-muted text-sm italic">Click Assess to evaluate client payment health.</p>
          )}
        </div>
      </div>
    </div>
  )
}
