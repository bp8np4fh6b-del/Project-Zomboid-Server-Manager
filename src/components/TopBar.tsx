import { useState, useEffect } from 'react'
import { Power, Download, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react'

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; percent: number; version?: string }
  | { kind: 'downloaded'; version: string }
  | { kind: 'upToDate' }
  | { kind: 'error'; message: string }

export default function TopBar({ title }: { title: string }) {
  const [status, setStatus] = useState('offline')
  const [update, setUpdate] = useState<UpdateState>({ kind: 'idle' })

  useEffect(() => {
    const unsub = window.electronAPI.onServerStatus((s: string) => setStatus(s))
    window.electronAPI.getServerStatus().then((s: any) => setStatus(s.status))
    return unsub
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.onUpdateEvent((kind, data) => {
      switch (kind) {
        case 'update:checking': setUpdate({ kind: 'checking' }); break
        case 'update:available': setUpdate({ kind: 'available', version: data?.version || '?' }); break
        case 'update:not-available': setUpdate({ kind: 'upToDate' }); break
        case 'update:download-progress': setUpdate((prev) => ({
          kind: 'downloading',
          percent: Math.round(data?.percent || 0),
          version: prev.kind === 'available' ? prev.version : prev.kind === 'downloading' ? prev.version : undefined,
        })); break
        case 'update:downloaded': setUpdate({ kind: 'downloaded', version: data?.version || '?' }); break
        case 'update:error': setUpdate({ kind: 'error', message: data?.message || 'Update error' }); break
      }
    })
    return unsub
  }, [])

  const statusColor: Record<string, string> = {
    offline: 'text-red-500',
    starting: 'text-amber-500',
    online: 'text-green-500',
    stopping: 'text-amber-500',
  }

  // Auto-clear the "Up to date" pill after a few seconds so the manual-check
  // button comes back without forcing the user to look at it.
  useEffect(() => {
    if (update.kind !== 'upToDate') return
    const t = setTimeout(() => setUpdate({ kind: 'idle' }), 4000)
    return () => clearTimeout(t)
  }, [update])

  // Single source of truth: the autoUpdater events drive every state
  // transition. We just kick off a check and let the events flow back.
  const checkInFlight = update.kind === 'checking' || update.kind === 'downloading'
  const handleManualCheck = async () => {
    if (checkInFlight) return  // debounce — prevents double pills on rapid clicks
    setUpdate({ kind: 'checking' })
    try {
      const res = await window.electronAPI.checkForUpdate()
      if (!res?.success) {
        setUpdate({ kind: 'error', message: res?.error || 'Check failed' })
      }
      // Fallback: if 6s pass and no autoUpdater event came back to flip us
      // out of 'checking', assume up-to-date so the UI doesn't get stuck.
      setTimeout(() => {
        setUpdate((prev) => prev.kind === 'checking' ? { kind: 'upToDate' } : prev)
      }, 6000)
    } catch (err: any) {
      setUpdate({ kind: 'error', message: err?.message || String(err) })
    }
  }

  const updatePill = () => {
    if (update.kind === 'idle') return null
    if (update.kind === 'checking') return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#222] border border-[#333] text-[#a0a0a0] text-xs">
        <RefreshCw size={14} className="animate-spin" />
        <span>Checking for updates…</span>
      </div>
    )
    if (update.kind === 'upToDate') return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-500/10 border border-green-500/30 text-green-300 text-xs">
        <CheckCircle2 size={14} />
        <span>Up to date</span>
      </div>
    )
    if (update.kind === 'available') return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs">
        <Download size={14} />
        <span>Update {update.version} available — downloading…</span>
      </div>
    )
    if (update.kind === 'downloading') return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs">
        <RefreshCw size={14} className="animate-spin" />
        <span>Downloading update{update.version ? ` ${update.version}` : ''} — {update.percent}%</span>
      </div>
    )
    if (update.kind === 'downloaded') return (
      <button
        onClick={() => window.electronAPI.installUpdateNow()}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-500/15 border border-green-500/40 text-green-300 hover:bg-green-500/25 text-xs"
        title="Restart and install the update"
      >
        <Download size={14} />
        <span>Update {update.version} ready — Restart to install</span>
      </button>
    )
    if (update.kind === 'error') return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-500/10 border border-red-500/30 text-red-300 text-xs max-w-md" title={update.message}>
        <AlertCircle size={14} />
        <span className="truncate">Update error: {update.message}</span>
      </div>
    )
    return null
  }

  return (
    <header className="h-14 bg-[#1a1a1a] border-b border-[#333] flex items-center justify-between px-6 shrink-0">
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      <div className="flex items-center gap-3">
        {/* Single update element: when idle, the manual-check button. When
            anything else (checking / available / downloading / downloaded /
            upToDate / error), the pill replaces it — never two at once. */}
        {update.kind === 'idle' ? (
          <button
            onClick={handleManualCheck}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#222] border border-[#333] hover:bg-[#2a2a2a] text-[#a0a0a0] hover:text-white text-xs"
            title="Check GitHub for a newer release"
          >
            <RefreshCw size={14} />
            <span>Check for Updates</span>
          </button>
        ) : (
          updatePill()
        )}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#222] border border-[#333]">
          <Power size={14} className={statusColor[status]} />
          <span className="text-xs font-medium text-[#a0a0a0] uppercase">{status}</span>
        </div>
      </div>
    </header>
  )
}
