import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Square, RotateCcw, Terminal, MessageSquare, Send, Wifi, WifiOff, UserX, Ban, ShieldAlert, Cpu, MemoryStick, Users, Activity, LogIn, LogOut, Server, RotateCw, AlertCircle } from 'lucide-react'
import { useAdminActions } from '../hooks/useAdminActions'
import Sparkline from '../components/Sparkline'

function formatUptime(sec: number) {
  if (!sec || sec <= 0) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${sec % 60}s`
}

function formatRam(bytes: number) {
  if (!bytes) return '—'
  return `${(bytes / 1073741824).toFixed(1)} GB`
}

function formatRelative(iso: string) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 5000) return 'just now'
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`
  return new Date(iso).toLocaleString()
}

function eventIcon(kind: string) {
  switch (kind) {
    case 'connect': return <LogIn size={13} className="text-green-400" />
    case 'disconnect': return <LogOut size={13} className="text-amber-400" />
    case 'server': return <Server size={13} className="text-blue-400" />
    case 'restart': return <RotateCw size={13} className="text-purple-400" />
    case 'admin': return <ShieldAlert size={13} className="text-red-300" />
    case 'error': return <AlertCircle size={13} className="text-red-400" />
    default: return <Activity size={13} className="text-[#888]" />
  }
}

interface MetricsState {
  cpuPercent: number
  memoryBytes: number
  history: Array<{ t: number; cpuPercent: number; memoryBytes: number; onlineCount: number }>
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('offline')
  const [uptime, setUptime] = useState(0)
  const [isInstalled, setIsInstalled] = useState(false)
  const [metrics, setMetrics] = useState<MetricsState | null>(null)
  const [events, setEvents] = useState<Array<{ at: string; kind: string; message: string }>>([])

  // Header info
  const [serverName, setServerName] = useState('Project Zomboid Server')
  const [localIp, setLocalIp] = useState<string | null>(null)
  const [port, setPort] = useState<string>('16261')

  // Live console state (stdin-backed)
  const [consoleAvailable, setConsoleAvailable] = useState(false)
  const [livePlayers, setLivePlayers] = useState<Array<{ name: string }>>([])
  const [chatMessage, setChatMessage] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  // Admin state — kick/ban for online players (stdin-backed). Shared hook
  // also drives the same flow on the Players tab.
  const {
    adminReady,
    adminTooltip,
    action: adminAction,
    reason: adminReason,
    setReason: setAdminReason,
    busy: adminBusy,
    toast: adminToast,
    open: openAdminAction,
    close: closeAdminAction,
    confirm: handleAdminConfirm,
  } = useAdminActions({ serverOnline: status === 'online' })

  useEffect(() => {
    checkInstall()
    refreshStatus()
    refreshHeaderInfo()
    const i = setInterval(refreshStatus, 2000)
    return () => clearInterval(i)
  }, [])

  // Metrics + recent-events poll — drives the graphs and the activity card.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const [m, ev] = await Promise.all([
          window.electronAPI.getServerMetrics(),
          window.electronAPI.getActivity(),
        ])
        if (cancelled) return
        if (m?.success) setMetrics({ cpuPercent: m.cpuPercent, memoryBytes: m.memoryBytes, history: m.history || [] })
        if (ev?.success) setEvents(ev.events.slice(0, 8))
      } catch { /* ignore */ }
    }
    tick()
    const i = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(i) }
  }, [])

  async function checkInstall() {
    const s = await window.electronAPI.getInstallStatus()
    setIsInstalled(s.pzServer)
  }

  async function refreshStatus() {
    const s = await window.electronAPI.getServerStatus()
    setStatus(s.status)
    setUptime(s.uptime)
  }

  async function refreshHeaderInfo() {
    try {
      const [settings, ip] = await Promise.all([
        window.electronAPI.getSettings(),
        window.electronAPI.getLocalIp(),
      ])
      if (settings?.PublicName) setServerName(settings.PublicName)
      if (settings?.DefaultPort) setPort(settings.DefaultPort)
      if (ip?.success && ip.ip) setLocalIp(ip.ip)
    } catch { /* ignore */ }
  }

  // Live console poll: when server is online, query live player list every 5s.
  useEffect(() => {
    if (status !== 'online') {
      setConsoleAvailable(false)
      setLivePlayers([])
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
          if (p?.success) setLivePlayers(p.players || [])
        }
      } catch { /* ignore */ }
    }
    tick()
    const i = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(i) }
  }, [status])

  const adminAvailable = adminReady

  // Refresh server name when status flips so newly-saved settings get picked up.
  useEffect(() => { refreshHeaderInfo() }, [status])

  const handleStart = async () => {
    setStatus('starting')
    await window.electronAPI.startServer({})
    refreshStatus()
  }

  const handleStop = async () => {
    setStatus('stopping')
    await window.electronAPI.stopServer()
    refreshStatus()
  }

  const handleRestart = async () => {
    setStatus('stopping')
    await window.electronAPI.restartServer()
    refreshStatus()
  }

  const handleSendChat = async () => {
    const msg = chatMessage.trim()
    if (!msg) return
    setChatSending(true)
    setChatError(null)
    const r = await window.electronAPI.consoleBroadcast(msg)
    setChatSending(false)
    if (r?.success) {
      setChatMessage('')
    } else {
      setChatError(r?.error || 'Send failed')
    }
  }

  const statusLabel = status === 'online' ? 'Online' : status === 'starting' ? 'Starting' : status === 'stopping' ? 'Stopping' : 'Offline'
  const statusColor = status === 'online' ? 'text-green-500' : status === 'starting' || status === 'stopping' ? 'text-amber-500' : 'text-red-500'

  if (!isInstalled) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-4">
        <Terminal size={48} className="text-[#666]" />
        <h2 className="text-xl font-semibold">Server Not Installed</h2>
        <p className="text-[#a0a0a0] max-w-md">
          Go to the Installer page to download SteamCMD and install the Project Zomboid Dedicated Server.
        </p>
        <button
          onClick={() => window.location.hash = '#/install'}
          className="btn-primary"
        >
          Go to Installer
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Slim status header — matches user's concept sketch.
          Left: status + IP / players / uptime
          Center: server name
          Right: Start / Restart / Stop */}
      <div className="card flex items-center gap-6">
        <div className="shrink-0 min-w-[180px]">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${
              status === 'online' ? 'bg-green-500 animate-pulse' :
              status === 'starting' || status === 'stopping' ? 'bg-amber-500 animate-pulse' :
              'bg-red-500'
            }`} />
            <h2 className={`text-2xl font-bold ${statusColor}`}>{statusLabel}</h2>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#888] font-mono mt-1">
            <span title="Local LAN IP">{localIp || '—'}{port ? `:${port}` : ''}</span>
            <span className="text-[#444]">·</span>
            <span title="Players online">{status === 'online' ? livePlayers.length : '—'} {status === 'online' && livePlayers.length === 1 ? 'player' : 'players'}</span>
            <span className="text-[#444]">·</span>
            <span title="Uptime">{status === 'online' ? formatUptime(uptime) : '—'}</span>
          </div>
        </div>

        <div className="flex-1 min-w-0 text-center">
          <p className="text-lg font-semibold text-white truncate" title={serverName}>{serverName}</p>
        </div>

        <div className="shrink-0 flex gap-2">
          <button
            onClick={handleStart}
            disabled={status !== 'offline'}
            className="btn-primary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play size={14} /> Start
          </button>
          <button
            onClick={handleRestart}
            disabled={status !== 'online'}
            className="btn-secondary flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw size={14} /> Restart
          </button>
          <button
            onClick={handleStop}
            disabled={status === 'offline'}
            className="btn-danger flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            title={status === 'stopping' ? 'If stop is taking too long, click again to force-kill' : ''}
          >
            <Square size={14} /> {status === 'stopping' ? 'Force Stop' : 'Stop'}
          </button>
        </div>
      </div>

      {/* Metric graphs — CPU / RAM / players over the last ~10 minutes. */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card !p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-[#a0a0a0] flex items-center gap-1.5"><Cpu size={12} /> CPU</p>
            <p className="text-sm font-semibold">{status === 'online' && metrics ? `${metrics.cpuPercent.toFixed(0)}%` : '—'}</p>
          </div>
          <Sparkline
            points={(metrics?.history || []).map((h) => h.cpuPercent)}
            max={100}
            stroke="#3498db"
            fill="rgba(52, 152, 219, 0.12)"
          />
        </div>
        <div className="card !p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-[#a0a0a0] flex items-center gap-1.5"><MemoryStick size={12} /> RAM</p>
            <p className="text-sm font-semibold">{status === 'online' && metrics ? formatRam(metrics.memoryBytes) : '—'}</p>
          </div>
          <Sparkline
            points={(metrics?.history || []).map((h) => h.memoryBytes)}
            stroke="#9b59b6"
            fill="rgba(155, 89, 182, 0.12)"
          />
        </div>
        <div className="card !p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-[#a0a0a0] flex items-center gap-1.5"><Users size={12} /> Players</p>
            <p className="text-sm font-semibold">{status === 'online' ? livePlayers.length : '—'}</p>
          </div>
          <Sparkline
            points={(metrics?.history || []).map((h) => h.onlineCount)}
            max={Math.max(4, ...(metrics?.history || []).map((h) => h.onlineCount))}
            stroke="#2ecc71"
            fill="rgba(46, 204, 113, 0.12)"
          />
        </div>
      </div>

      {/* Live Console — visible always; controls activate when the server
          is online. Sends commands via the spawned process's stdin. */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <MessageSquare size={16} />
            Live Console
          </h3>
          <span className={`flex items-center gap-1.5 text-xs ${consoleAvailable ? 'text-green-400' : 'text-[#666]'}`}>
            {consoleAvailable ? <Wifi size={12} /> : <WifiOff size={12} />}
            {consoleAvailable ? 'Online' : status === 'starting' ? 'Connecting…' : 'Server offline'}
          </span>
        </div>

        {!consoleAvailable && (
          <p className="text-xs text-[#666] italic">
            Start the server above to enable broadcast chat and the live player list. Schedule recurring restarts in Settings → Schedules.
          </p>
        )}

        {/* Live players */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-[#a0a0a0]">Online players ({livePlayers.length})</p>
            {consoleAvailable && (
              <span
                title={adminAvailable ? 'Admin actions ready — click a player to Kick/Ban' : adminTooltip}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-1 ${
                  adminAvailable
                    ? 'text-green-300 bg-green-500/10 border border-green-500/30'
                    : 'text-[#888] bg-[#1f1f1f] border border-[#333]'
                }`}
              >
                <ShieldAlert size={10} />
                Admin {adminAvailable ? 'ready' : 'unavailable'}
              </span>
            )}
          </div>
          {livePlayers.length === 0 ? (
            <p className="text-xs text-[#666] italic">{consoleAvailable ? 'No one connected.' : '—'}</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {livePlayers.map((p) => {
                const open = adminAction?.name === p.name
                return (
                  <div key={p.name} className="inline-flex items-center gap-0.5 bg-blue-500/15 text-blue-300 rounded font-mono">
                    <span className="text-xs px-2 py-0.5">{p.name}</span>
                    <button
                      onClick={() => openAdminAction(p.name, 'kick')}
                      disabled={!adminAvailable}
                      title={adminAvailable ? `Kick ${p.name}` : adminTooltip}
                      className={`px-1 py-0.5 rounded-r ${open && adminAction?.kind === 'kick' ? 'bg-amber-500/40 text-amber-200' : 'hover:bg-amber-500/20 hover:text-amber-300'} disabled:opacity-30 disabled:hover:bg-transparent`}
                    >
                      <UserX size={11} />
                    </button>
                    <button
                      onClick={() => openAdminAction(p.name, 'ban')}
                      disabled={!adminAvailable}
                      title={adminAvailable ? `Ban ${p.name}` : adminTooltip}
                      className={`px-1 py-0.5 rounded-r ${open && adminAction?.kind === 'ban' ? 'bg-red-500/40 text-red-200' : 'hover:bg-red-500/20 hover:text-red-300'} disabled:opacity-30 disabled:hover:bg-transparent`}
                    >
                      <Ban size={11} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {adminAction && (
            <div className={`mt-2 px-3 py-2 rounded-md border ${adminAction.kind === 'ban' ? 'border-red-500/40 bg-red-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
              <p className="text-sm font-medium flex items-center gap-2 mb-1">
                {adminAction.kind === 'ban'
                  ? <Ban size={14} className="text-red-400" />
                  : <UserX size={14} className="text-amber-400" />}
                {adminAction.kind === 'ban' ? 'Ban' : 'Kick'} {adminAction.name}?
              </p>
              {adminAction.kind === 'ban' && (
                <p className="text-xs text-red-300 mb-2">
                  This is permanent until manually unbanned via the server console.
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
                  className={`text-xs px-3 py-2 rounded font-medium disabled:opacity-50 ${adminAction.kind === 'ban' ? 'bg-red-500/80 hover:bg-red-500 text-white' : 'bg-amber-500/80 hover:bg-amber-500 text-black'}`}
                >
                  {adminBusy ? '…' : `Confirm ${adminAction.kind}`}
                </button>
                <button
                  onClick={closeAdminAction}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {adminToast && (
            <div className={`mt-2 text-sm px-3 py-2 rounded-md border ${
              adminToast.kind === 'success'
                ? 'border-green-500/40 bg-green-500/10 text-green-300'
                : 'border-red-500/40 bg-red-500/10 text-red-300'
            }`}>
              {adminToast.text}
            </div>
          )}
        </div>

        {/* Broadcast chat */}
        <div>
          <p className="text-xs text-[#a0a0a0] mb-1">Send a message to all players</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSendChat() }}
              placeholder="Server restarting in 5 minutes — save your progress!"
              disabled={!consoleAvailable || chatSending}
              className="input flex-1 text-sm disabled:opacity-50"
            />
            <button
              onClick={handleSendChat}
              disabled={!consoleAvailable || chatSending || !chatMessage.trim()}
              className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
            >
              <Send size={14} />
              Send
            </button>
          </div>
          {chatError && <p className="text-xs text-red-400 mt-1">{chatError}</p>}
        </div>
      </div>

      {/* Recent events — compact activity feed; full feed lives on Monitoring,
          raw output lives on the Console page. */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Activity size={16} /> Recent Events
          </h3>
          <div className="flex gap-2">
            <button onClick={() => navigate('/monitoring')} className="text-xs text-[#a0a0a0] hover:text-white">
              Full feed →
            </button>
            <button onClick={() => navigate('/console')} className="text-xs text-[#a0a0a0] hover:text-white flex items-center gap-1">
              <Terminal size={11} /> Console →
            </button>
          </div>
        </div>
        {events.length === 0 ? (
          <p className="text-xs text-[#666] italic">Nothing yet. Server starts, player joins, restarts, and admin actions show up here.</p>
        ) : (
          <div className="space-y-1">
            {events.map((ev, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-1.5 rounded bg-[#1a1a1a] text-sm">
                <span className="shrink-0">{eventIcon(ev.kind)}</span>
                <span className="flex-1 min-w-0 truncate">{ev.message}</span>
                <span className="text-xs text-[#666] font-mono shrink-0">{formatRelative(ev.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
