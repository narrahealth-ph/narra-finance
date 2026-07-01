'use client'
import { useState } from 'react'
import { FileText, Search, Users, Sparkles, MessageCircle, SendHorizonal } from 'lucide-react'


export default function AIInsights({ periodId, data, selectedMonth }: { periodId: number; data: any; selectedMonth?: string }) {
  const [loading, setLoading] = useState<string | null>(null)
  const [results, setResults] = useState<{ narrative?: string; anomalies?: any[]; churn?: any[]; answer?: string }>({})
  const [question, setQuestion] = useState('')
  const [viewMode, setViewMode] = useState<'period' | 'annual'>('period')

  async function generate(type: string) {
    setLoading(type)

    // For the narrative, fetch pipeline + pending from the MRR sheet first
    let pipelineDeals: { clientName: string; amount: number; billingType: string; notes?: string }[] = []
    let pendingCollection: { clientName: string; amount: number; daysOutstanding: number }[] = []
    if (type === 'narrative') {
      try {
        const [histRes, pendRes] = await Promise.all([
          fetch(`/api/mrr/history?month=${encodeURIComponent(selectedMonth || '')}&yearView=false`, { credentials: 'include' }),
          fetch(`/api/mrr/pending?periodId=${periodId}`, { credentials: 'include' }),
        ])
        const histJson = await histRes.json()
        const pendJson = await pendRes.json()
        if (histJson.pipelineFromSheet) pipelineDeals      = histJson.pipelineFromSheet
        if (pendJson.pending)           pendingCollection   = pendJson.pending
      } catch { /* non-fatal — AI will just omit these fields */ }
    }

    const res = await fetch('/api/ai-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId, type, pipelineDeals, pendingCollection, viewMode }),
    })
    const result = await res.json()
    setResults(prev => ({ ...prev, ...result }))
    setLoading(null)
  }

  async function ask(q: string) {
    if (!q.trim()) return
    setLoading('ask')
    setResults(prev => ({ ...prev, answer: undefined }))
    const res = await fetch('/api/ai-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId, type: 'ask', question: q, viewMode }),
    })
    const result = await res.json()
    setResults(prev => ({ ...prev, answer: result.answer }))
    setLoading(null)
  }

  const total = data?.pl
  const runway = total?.totalExpenses > 0
    ? Math.floor((data?.bs?.cashClosing || 0) / (total.totalExpenses))
    : null

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold text-narra-dark">AI Insights</h2>
          <p className="text-sm text-narra-muted mt-0.5">Powered by Claude — click to generate each insight</p>
        </div>
        <div className="flex items-center gap-1 bg-narra-surface border border-narra-border rounded-lg p-1 self-start sm:self-auto">
          <button
            onClick={() => { setViewMode('period'); setResults({}) }}
            className={`px-3 py-1.5 rounded text-sm font-body transition-all ${viewMode === 'period' ? 'bg-narra-dark text-narra-green shadow-sm' : 'text-narra-muted hover:text-narra-dark'}`}
          >
            This Period
          </button>
          <button
            onClick={() => { setViewMode('annual'); setResults({}) }}
            className={`px-3 py-1.5 rounded text-sm font-body transition-all ${viewMode === 'annual' ? 'bg-narra-dark text-narra-green shadow-sm' : 'text-narra-muted hover:text-narra-dark'}`}
          >
            Annual
          </button>
        </div>
      </div>
      {viewMode === 'annual' && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span>Responses will aggregate data across all months in the same calendar year as the selected period.</span>
        </div>
      )}

      {/* Quick stats */}
      {total && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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

      {/* Financial Q&A */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-narra-border">
          <h3 className="font-heading font-semibold text-narra-dark flex items-center gap-2"><MessageCircle size={16} /> Ask a Financial Question</h3>
          <p className="text-xs text-narra-muted mt-0.5">Ask anything about your finances — or use a quick question below</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* Question input */}
          <div className="flex gap-2">
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { ask(question); setQuestion('') } }}
              placeholder="e.g. If we pursue a new marketing campaign at $5,000/month, can we cover it?"
              className="flex-1 border border-narra-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-narra-green/30"
              disabled={loading === 'ask'}
            />
            <button
              onClick={() => { ask(question); setQuestion('') }}
              disabled={loading === 'ask' || !question.trim()}
              className="px-3 py-2 bg-narra-dark text-narra-green rounded-lg hover:bg-narra-mid transition-all disabled:opacity-40 flex items-center gap-1.5 text-sm"
            >
              {loading === 'ask' ? <Sparkles size={14} className="animate-pulse" /> : <SendHorizonal size={14} />}
              {loading === 'ask' ? 'Thinking…' : 'Ask'}
            </button>
          </div>

          {/* Answer */}
          {results.answer && (
            <div className="bg-narra-surface border border-narra-border rounded-xl p-4">
              <p className="text-sm text-narra-ink leading-relaxed whitespace-pre-line font-body">{results.answer}</p>
            </div>
          )}
          {!results.answer && loading !== 'ask' && (
            <p className="text-narra-muted text-sm italic">Click a quick question or type your own.</p>
          )}
        </div>
      </div>

      {/* Investor Narrative */}
      <div className="bg-white border border-narra-border rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-narra-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-heading font-semibold text-narra-dark flex items-center gap-2"><FileText size={16} /> Monthly Investor Narrative</h3>
            <p className="text-xs text-narra-muted mt-0.5">AI-written summary for your investor update</p>
          </div>
          <button onClick={() => generate('narrative')} disabled={loading === 'narrative'}
            className="shrink-0 px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50 flex items-center gap-2">
            {loading === 'narrative' ? <><Sparkles size={14} className="animate-pulse" />Writing…</> : <><Sparkles size={14} />Generate</>}
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
        <div className="px-5 py-4 border-b border-narra-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-heading font-semibold text-narra-dark flex items-center gap-2"><Search size={16} /> Anomaly & Overspend Alerts</h3>
            <p className="text-xs text-narra-muted mt-0.5">Flags unusual transactions or categories</p>
          </div>
          <button onClick={() => generate('anomalies')} disabled={loading === 'anomalies'}
            className="shrink-0 px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50 flex items-center gap-2">
            {loading === 'anomalies' ? <><Sparkles size={14} className="animate-pulse" />Analyzing…</> : <><Sparkles size={14} />Analyze</>}
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
        <div className="px-5 py-4 border-b border-narra-border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-heading font-semibold text-narra-dark flex items-center gap-2"><Users size={16} /> Client Churn Risk</h3>
            <p className="text-xs text-narra-muted mt-0.5">Identifies at-risk clients based on payment patterns</p>
          </div>
          <button onClick={() => generate('churn')} disabled={loading === 'churn'}
            className="shrink-0 px-4 py-2 bg-narra-dark text-narra-green rounded-lg text-sm font-body hover:bg-narra-mid transition-all disabled:opacity-50 flex items-center gap-2">
            {loading === 'churn' ? <><Sparkles size={14} className="animate-pulse" />Assessing…</> : <><Sparkles size={14} />Assess</>}
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
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-narra-dark text-sm">{c.client}</p>
                    <p className="text-narra-muted text-xs mt-0.5">{c.reason}</p>
                    <p className="text-narra-muted text-xs mt-1 italic sm:hidden">{c.recommendation}</p>
                  </div>
                  <p className="text-narra-muted text-xs max-w-xs text-right italic hidden sm:block">{c.recommendation}</p>
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
