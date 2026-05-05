import { useState, useEffect } from 'react'
import { Users, Clock, RefreshCw, Trash2, ChevronDown, ChevronRight, Search, AlertCircle, UserX, Ban, ShieldAlert } from 'lucide-react'
import type { PlayerRecord } from '../types'

function formatDuration(ms: number) {
  if (!ms || ms < 0) return '0m'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function formatRelative(iso: string) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return 'just now'
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`
  if (ms < 30 * 86400000) return `${Math.floor(ms / 86400000)}d ago`
  return new Date(iso).toLocaleDateString()
}

function formatDateTime(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export default function Players() {
  const [serverStatus, setServerStatus] = useState('offline')
  const [players, setPlayers] = useState<PlayerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [unmatched, setUnmatched] = useState<Array<{ line: string; at: string }>>([])
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [liveNames, setLiveNames] = useState<string[]>([])
  const [consoleAvailable, setConsoleAvailable] = useState(false)
  const [rcon, setRcon] = useState<{ connected: boolean; hasPassword: boolean; serverOnline: boolean }>({ connected: false, hasPassword: false, serverOnline: false })
  // Per-player open action: which row has kick/ban inline form expanded
  const [adminAction, setAdminAction] = useState<{ name: string; kind: 'kick' | 'ban' } | null>(null)
  const [adminReason, setAdminReason] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [adminToast, setAdminToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    window.electronAPI.getServerStatus().then((s: any) => { if (alive) setServerStatus(s.status) })
    const unsubStatus = window.electronAPI.onServerStatus((s: string) => { if (alive) setServerStatus(s) })
    refresh()
    // Auto-refresh history when log lines come in (likely a player event)
    const unsubLog = window.electronAPI.onServerLog((data: any) => {
      if (data?.line && /(connected|disconnected|joined|left|logged in|lost connection)/i.test(data.line)) {
        refresh()
      }
    })
    // Periodic safety refresh
    const i = setInterval(refresh, 10000)
    return () => { alive = false; unsubStatus(); unsubLog(); clearInterval(i) }
  }, [])

  // RCON live poll — actual online players when server is up.
  useEffect(() => {
    if (serverStatus !== 'online') {
      setLiveNames([])
      setConsoleAvailable(false)
      setRcon({ connected: false, hasPassword: false, serverOnline: false })
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const st = await window.electronAPI.consoleStatus()
        if (cancelled) return
        setConsoleAvailable(!!st?.connected)
        if (st?.connected) {
          const p = await window.electronAPI.consolePlayers()
          if (cancelled) return
          if (p?.success) setLiveNames(p.players.map((x) => x.name))
        }
        const r = await window.electronAPI.adminRconStatus()
        if (!cancelled && r?.success) {
          setRcon({ connected: r.connected, hasPassword: r.hasPassword, serverOnline: r.serverOnline })
        }
      } catch { /* ignore */ }
    }
    tick()
    const int = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(int) }
  }, [serverStatus])

  // Auto-dismiss admin toast after 3s
  useEffect(() => {
    if (!adminToast) return
    const t = setTimeout(() => setAdminToast(null), 3000)
    return () => clearTimeout(t)
  }, [adminToast])

  const adminAvailable = rcon.serverOnline
  const adminTooltip = !rcon.serverOnline ? 'Server is not online' : ''

  async function handleAdminConfirm() {
    if (!adminAction) return
    setAdminBusy(true)
    try {
      const reason = adminReason.trim() || undefined
      const fn = adminAction.kind === 'kick' ? window.electronAPI.adminKick : window.electronAPI.adminBan
      const verb = adminAction.kind === 'kick' ? 'Kicked' : 'Banned'
      const r = await fn(adminAction.name, reason)
      if (r?.success) {
        setAdminToast({ kind: 'success', text: `${verb} ${adminAction.name}` })
        setAdminAction(null)
        setAdminReason('')
        refresh()
      } else {
        setAdminToast({ kind: 'error', text: r?.error || `Failed to ${adminAction.kind} ${adminAction.name}` })
      }
    } finally {
      setAdminBusy(false)
    }
  }

  function openAction(name: string, kind: 'kick' | 'ban') {
    setAdminAction({ name, kind })
    setAdminReason('')
  }

  async function refresh() {
    try {
      const res = await window.electronAPI.getPlayerHistory()
      if (res.success) setPlayers(res.players)
      const u = await window.electronAPI.getUnmatchedEvents()
      if (u.success) setUnmatched(u.events)
    } finally {
      setLoading(false)
    }
  }

  async function handleClear() {
    if (!confirm('Clear all player history? This will not affect the server itself, only the manager\'s record of who connected.')) return
    await window.electronAPI.clearPlayerHistory()
    refresh()
  }

  async function handleClearDiagnostics() {
    await window.electronAPI.clearUnmatchedEvents()
    refresh()
  }

  // Source of truth for "online now" while the server is running:
  //   1. Live list from the in-house console (`players` command)  ← authoritative
  //   2. Fallback to log-parsed `currentlyOnline` flags when console isn't ready
  const liveSet = new Set(liveNames.map((n) => n.toLowerCase()))
  const isOnlineLive = (username: string) => liveSet.has(username.toLowerCase())

  // Synthesize a stub PlayerRecord for live names that haven't been written to
  // history yet. The backend persists these every 5s via recordLivePlayers, but
  // we synthesize too so they show up instantly without a poll-cycle delay.
  const knownNames = new Set(players.map((p) => p.username.toLowerCase()))
  const synthetic: PlayerRecord[] = liveNames
    .filter((n) => !knownNames.has(n.toLowerCase()))
    .map((name) => ({
      username: name,
      firstSeen: '',
      lastSeen: '',
      totalSessions: 1,
      totalPlayMs: 0,
      currentlyOnline: true,
      sessions: [],
    }))
  const allPlayers = [...synthetic, ...players]

  const filtered = allPlayers.filter((p) => {
    const live = serverStatus === 'online' && consoleAvailable ? isOnlineLive(p.username) : p.currentlyOnline
    if (filter === 'online' && !live) return false
    if (filter === 'offline' && live) return false
    if (search && !p.username.toLowerCase().includes(search.toLowerCase()) &&
        !(p.steamId || '').includes(search)) return false
    return true
  })

  const onlineCount = serverStatus === 'online' && consoleAvailable
    ? liveNames.length
    : players.filter((p) => p.currentlyOnline).length

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Users size={20} />
            Players
          </h2>
          <p className="text-sm text-[#a0a0a0] mt-1">
            Live + history. Detected from server log lines while the server is running through this manager.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={refresh} className="btn-secondary text-sm flex items-center gap-2">
            <RefreshCw size={14} />
            Refresh
          </button>
          <button onClick={handleClear} className="btn-secondary text-sm flex items-center gap-2 text-red-400 hover:text-red-300">
            <Trash2 size={14} />
            Clear History
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
          <div>
            <p className="text-xs text-[#a0a0a0]">Online Now</p>
            <p className="text-lg font-semibold">{onlineCount}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <Users size={20} className="text-blue-400" />
          <div>
            <p className="text-xs text-[#a0a0a0]">Unique Players</p>
            <p className="text-lg font-semibold">{players.length}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <Clock size={20} className="text-amber-400" />
          <div>
            <p className="text-xs text-[#a0a0a0]">Total Sessions</p>
            <p className="text-lg font-semibold">{players.reduce((sum, p) => sum + p.totalSessions, 0)}</p>
          </div>
        </div>
      </div>

      {/* Admin status chip + transient action toast */}
      {serverStatus === 'online' && (
        <div className="flex items-center gap-2">
          <span className={`text-[11px] px-2 py-0.5 rounded font-mono inline-flex items-center gap-1.5 border ${
            adminAvailable
              ? 'border-green-500/40 bg-green-500/10 text-green-300'
              : 'border-[#444] bg-[#1f1f1f] text-[#a0a0a0]'
          }`}>
            <ShieldAlert size={11} />
            Admin {adminAvailable ? 'ready' : 'unavailable'}
          </span>
        </div>
      )}
      {adminToast && (
        <div className={`text-sm px-3 py-2 rounded-md border ${
          adminToast.kind === 'success'
            ? 'border-green-500/40 bg-green-500/10 text-green-300'
            : 'border-red-500/40 bg-red-500/10 text-red-300'
        }`}>
          {adminToast.text}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        <div className="flex bg-[#222] rounded-md p-0.5">
          {(['all', 'online', 'offline'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-sm capitalize ${filter === f ? 'bg-[#333] text-white' : 'text-[#a0a0a0]'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search by username or Steam ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input flex-1"
        />
      </div>

      {/* Player list */}
      {loading ? (
        <p className="text-[#a0a0a0]">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-10">
          <Users size={32} className="mx-auto text-[#444] mb-3" />
          <p className="text-[#a0a0a0]">
            {players.length === 0
              ? serverStatus === 'online'
                ? 'No players have connected yet. As they join, they\'ll appear here.'
                : 'No players have ever connected. Start the server and have someone join.'
              : 'No players match the current filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const isExpanded = expanded === p.username
            const liveOnline = serverStatus === 'online' && consoleAvailable ? isOnlineLive(p.username) : p.currentlyOnline
            const isSynthetic = !p.firstSeen
            const showAdminButtons = liveOnline
            const actionOpen = adminAction?.name === p.username ? adminAction : null
            return (
              <div
                key={p.username}
                className={`bg-[#1a1a1a] border rounded-md overflow-hidden ${liveOnline ? 'border-green-500/40' : 'border-[#333]'}`}
              >
                <div
                  onClick={() => setExpanded(isExpanded ? null : p.username)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#222] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isExpanded ? <ChevronDown size={16} className="text-[#666]" /> : <ChevronRight size={16} className="text-[#666]" />}
                    <div className={`w-2 h-2 rounded-full shrink-0 ${liveOnline ? 'bg-green-500 animate-pulse' : 'bg-[#444]'}`} />
                    <div className="text-left min-w-0">
                      <p className="font-medium truncate flex items-center gap-2">
                        <span>{p.username}</span>
                        {isSynthetic && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono uppercase">live</span>
                        )}
                      </p>
                      <p className="text-xs text-[#888] font-mono truncate">
                        {p.steamId ? `Steam ${p.steamId}` : 'no steam id captured'}
                        {p.lastIp && ` · ${p.lastIp}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-right text-xs shrink-0">
                    <div>
                      <p className="text-[#a0a0a0]">Last seen</p>
                      <p className="font-medium">{liveOnline ? <span className="text-green-400">Online</span> : formatRelative(p.lastSeen)}</p>
                    </div>
                    <div>
                      <p className="text-[#a0a0a0]">Sessions</p>
                      <p className="font-medium">{p.totalSessions}</p>
                    </div>
                    <div>
                      <p className="text-[#a0a0a0]">Total time</p>
                      <p className="font-medium">{formatDuration(p.totalPlayMs)}</p>
                    </div>
                    {showAdminButtons && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); openAction(p.username, 'kick') }}
                          disabled={!adminAvailable}
                          title={adminAvailable ? `Kick ${p.username}` : adminTooltip}
                          className="p-1.5 rounded hover:bg-amber-500/20 text-amber-400 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                        >
                          <UserX size={14} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openAction(p.username, 'ban') }}
                          disabled={!adminAvailable}
                          title={adminAvailable ? `Ban ${p.username}` : adminTooltip}
                          className="p-1.5 rounded hover:bg-red-500/20 text-red-400 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                        >
                          <Ban size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {actionOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`px-4 py-3 border-t ${actionOpen.kind === 'ban' ? 'border-red-500/40 bg-red-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {actionOpen.kind === 'ban'
                        ? <Ban size={14} className="text-red-400" />
                        : <UserX size={14} className="text-amber-400" />}
                      <p className="text-sm font-medium">
                        {actionOpen.kind === 'ban' ? 'Ban' : 'Kick'} {p.username}?
                      </p>
                    </div>
                    {actionOpen.kind === 'ban' && (
                      <p className="text-xs text-red-300 mb-2 flex items-start gap-1">
                        <ShieldAlert size={12} className="mt-0.5 shrink-0" />
                        <span>This is permanent until manually unbanned via the server console.</span>
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={adminReason}
                        onChange={(e) => setAdminReason(e.target.value)}
                        placeholder="Reason (optional)"
                        className="input flex-1 text-sm"
                      />
                      <button
                        onClick={handleAdminConfirm}
                        disabled={adminBusy}
                        className={`text-xs px-3 py-2 rounded font-medium disabled:opacity-50 ${actionOpen.kind === 'ban' ? 'bg-red-500/80 hover:bg-red-500 text-white' : 'bg-amber-500/80 hover:bg-amber-500 text-black'}`}
                      >
                        {adminBusy ? '…' : `Confirm ${actionOpen.kind}`}
                      </button>
                      <button
                        onClick={() => { setAdminAction(null); setAdminReason('') }}
                        className="btn-secondary text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-[#333] bg-[#0f0f0f]">
                    <div className="grid grid-cols-2 gap-4 mt-3 text-sm">
                      <div>
                        <p className="text-xs text-[#a0a0a0]">First seen</p>
                        <p className="font-mono">{formatDateTime(p.firstSeen)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[#a0a0a0]">Last seen</p>
                        <p className="font-mono">{formatDateTime(p.lastSeen)}</p>
                      </div>
                    </div>
                    {p.sessions && p.sessions.length > 0 && (
                      <div className="mt-4">
                        <p className="text-xs text-[#a0a0a0] mb-2">Recent sessions ({Math.min(p.sessions.length, 10)} of {p.sessions.length})</p>
                        <div className="bg-[#1a1a1a] rounded-md border border-[#333] divide-y divide-[#222] max-h-60 overflow-y-auto">
                          {p.sessions.slice(-10).reverse().map((s, i) => (
                            <div key={i} className="px-3 py-2 flex items-center justify-between text-xs">
                              <div className="font-mono text-[#a0a0a0]">
                                {formatDateTime(s.start)}
                                {s.end && (
                                  <span className="text-[#666]"> → {new Date(s.end).toLocaleTimeString()}</span>
                                )}
                                {!s.end && <span className="text-green-400 ml-2">(active)</span>}
                              </div>
                              <div className="flex items-center gap-3 text-[#888]">
                                {s.ip && <span className="font-mono">{s.ip}</span>}
                                {s.durationMs !== undefined && <span>{formatDuration(s.durationMs)}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Diagnostics: log lines that contained connect/disconnect keywords but
          didn't match the parser. Useful for tuning the regex against real
          Build 42 output. */}
      <div className="card">
        <button
          onClick={() => setShowDiagnostics((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <Search size={16} className="text-[#888]" />
            <h3 className="font-semibold text-sm">Parser Diagnostics</h3>
            {unmatched.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono">
                {unmatched.length} unmatched
              </span>
            )}
          </div>
          {showDiagnostics ? <ChevronDown size={16} className="text-[#666]" /> : <ChevronRight size={16} className="text-[#666]" />}
        </button>

        {showDiagnostics && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-[#888]">
              Server log lines that mentioned a connect / disconnect / join / leave but didn't yield a username.
              If your players' connections aren't being recorded, paste these lines in a bug report and we can teach the parser what they look like.
            </p>
            {unmatched.length === 0 ? (
              <p className="text-xs text-[#666] italic">No unmatched lines. Either everything is being parsed correctly, or no player events have happened yet.</p>
            ) : (
              <>
                <div className="bg-[#0f0f0f] rounded-md border border-[#333] max-h-60 overflow-y-auto divide-y divide-[#222]">
                  {unmatched.map((u, i) => (
                    <div key={i} className="px-3 py-2 font-mono text-[11px]">
                      <p className="text-[#666] text-[10px]">{new Date(u.at).toLocaleTimeString()}</p>
                      <p className="text-[#a0a0a0] break-all">{u.line}</p>
                    </div>
                  ))}
                </div>
                <button onClick={handleClearDiagnostics} className="btn-secondary text-xs flex items-center gap-2">
                  <AlertCircle size={12} /> Clear diagnostics
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
