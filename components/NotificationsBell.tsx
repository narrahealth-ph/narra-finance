'use client'
import { useState, useEffect, useRef } from 'react'

interface Notification {
  month: string
  issues: string[]
  locked: boolean
}

const DISMISSED_KEY = 'narra-dismissed-notifications'

function getDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')) } catch { return new Set() }
}

function saveDismissed(set: Set<string>) {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(set)))
}

export default function NotificationsBell() {
  const [open, setOpen]         = useState(false)
  const [data, setData]         = useState<Notification[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [loading, setLoading]   = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  function fetchNotifications() {
    setLoading(true)
    fetch('/api/notifications', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const fresh = d.notifications || []
        setData(fresh)
        // Auto-clear dismissals for months that no longer have issues
        const freshMonths = new Set(fresh.map((n: Notification) => n.month))
        setDismissed(prev => {
          const next = new Set(Array.from(prev).filter(m => freshMonths.has(m)))
          saveDismissed(next)
          return next
        })
      })
      .finally(() => setLoading(false))
  }

  // Fetch on mount so badge count shows immediately
  useEffect(() => {
    setDismissed(getDismissed())
    fetchNotifications()
  }, [])

  // Re-fetch every time the bell is opened
  useEffect(() => {
    if (open) fetchNotifications()
  }, [open])

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function dismiss(month: string) {
    const next = new Set(dismissed)
    next.add(month)
    setDismissed(next)
    saveDismissed(next)
  }

  const visible = data.filter(n => !dismissed.has(n.month))
  const total   = visible.reduce((s, n) => s + n.issues.length, 0)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex items-center gap-1.5 text-white/40 hover:text-white text-xs transition-colors px-3 py-1.5 rounded-lg hover:bg-white/10"
      >
        <span className="text-base leading-none">🔔</span>
        {total > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-16px)] bg-white border border-narra-border rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-4 py-3 bg-narra-dark flex items-center justify-between">
            <span className="text-white font-heading text-sm font-semibold">Action Required</span>
            <span className="text-white/40 text-xs">{total} issue{total !== 1 ? 's' : ''} in last 6 months</span>
          </div>

          {loading && (
            <div className="px-4 py-6 text-center text-narra-muted text-sm animate-pulse">Checking…</div>
          )}

          {!loading && visible.length === 0 && (
            <div className="px-4 py-6 text-center">
              <div className="text-2xl mb-2">✓</div>
              <div className="text-sm font-medium text-green-700">All caught up!</div>
              <div className="text-xs text-narra-muted mt-1">No missing data in the last 6 months.</div>
            </div>
          )}

          {!loading && visible.length > 0 && (
            <div className="divide-y divide-narra-border max-h-96 overflow-y-auto">
              {visible.map((n, i) => (
                <div key={i} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-narra-dark font-heading">{n.month}</span>
                      {n.locked && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-body">Closed</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-body">
                        {n.issues.length} issue{n.issues.length !== 1 ? 's' : ''}
                      </span>
                      <button
                        onClick={() => dismiss(n.month)}
                        className="text-narra-muted hover:text-narra-dark transition-colors text-sm leading-none"
                        title="Dismiss"
                      >✕</button>
                    </div>
                  </div>
                  <ul className="space-y-1">
                    {n.issues.map((issue, j) => (
                      <li key={j} className="flex items-center gap-2 text-xs text-narra-muted">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <div className="px-4 py-2.5 border-t border-narra-border bg-narra-surface text-xs text-narra-muted text-center">
            Last 6 months · Closed months included
          </div>
        </div>
      )}
    </div>
  )
}
