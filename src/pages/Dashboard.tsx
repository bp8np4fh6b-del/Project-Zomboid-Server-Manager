import { useState, useEffect, useRef } from 'react'
import { Play, Square, RotateCcw, Terminal, MessageSquare, Send, Wifi, WifiOff, UserX, Ban, ShieldAlert } from 'lucide-react'

function formatUptime(sec: number) {
  if (!sec || sec <= 0) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${sec % 60}s`
}

export default function Dashboard() {
  const [status, setStatus] = useState('offline')
  const [logs, setLogs] = useState<string[]>([])
  const [uptime, setUptime] = useState(0)
  const [isInstalled, setIsInstalled] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  // Header info
  const [serverName, setServerName] = useState('Project Zomboid Server')
  const [localIp, setLocalIp] = useState<string | null>(null)
  const [port, setPort] = useState<string>('16261')

  // Live console state (stdin-based, no RCON)
  const [consoleAvailable, setConsoleAvailable] = useState(false)
  const [livePlayers, setLivePlayers] = useState<Array<{ name: string }>>([])
  const [chatMessage, setChatMessage] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  // Admin state — kick/ban for online players (stdin-backed)
  const [rcon, setRcon] = useState<{ connected: boolean; hasPassword: boolean; serverOnline: boolean }>({ connected: false, hasPassword: false, serverOnline: false })
  const [adminAction, setAdminAction] = useState<{ name: string; kind: 'kick' | 'ban' } | null>(null)
  const [adminReason, setAdminReason] = useState('')
  const [adminBusy, setAdminBusy] = useState(false)
  const [adminToast, setAdminToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    checkInstall()
    refreshStatus()
    refreshHeaderInfo()
    const i = setInterval(refreshStatus, 2000)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.onServerLog((data: any) => {
      if (data && typeof data.line === 'string') {
        setLogs((prev) => [...prev.slice(-199), data.line])
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

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
          if (p?.success) setLivePlayers(p.players || [])
        }
        const r = await window.electronAPI.adminRconStatus()
        if (!cancelled && r?.success) {
          setRcon({ connected: r.connected, hasPassword: r.hasPassword, serverOnline: r.serverOnline })
        }
      } catch { /* ignore */ }
    }
    tick()
    const i = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(i) }
  }, [status])

  // Auto-dismiss admin toast
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
      } else {
        setAdminToast({ kind: 'error', text: r?.error || `Failed to ${adminAction.kind} ${adminAction.name}` })
      }
    } finally {
      setAdminBusy(false)
    }
  }

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
                      onClick={() => { setAdminAction({ name: p.name, kind: 'kick' }); setAdminReason('') }}
                      disabled={!adminAvailable}
                      title={adminAvailable ? `Kick ${p.name}` : adminTooltip}
                      className={`px-1 py-0.5 rounded-r ${open && adminAction?.kind === 'kick' ? 'bg-amber-500/40 text-amber-200' : 'hover:bg-amber-500/20 hover:text-amber-300'} disabled:opacity-30 disabled:hover:bg-transparent`}
                    >
                      <UserX size={11} />
                    </button>
                    <button
                      onClick={() => { setAdminAction({ name: p.name, kind: 'ban' }); setAdminReason('') }}
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
                  onClick={() => { setAdminAction(null); setAdminReason('') }}
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

      {/* Server Logs */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Terminal size={16} /> Server Logs
          </h3>
          <button
            onClick={() => setLogs([])}
            className="text-xs text-[#a0a0a0] hover:text-white"
          >
            Clear
          </button>
        </div>
        <div className="bg-[#0f0f0f] rounded-md p-3 h-64 overflow-y-auto font-mono text-xs space-y-1">
          {logs.length === 0 && (
            <p className="text-[#666] italic">No logs yet. Start the server to see output.</p>
          )}
          {logs.map((line, i) => (
            <div key={i} className="text-[#a0a0a0] truncate hover:text-white hover:whitespace-normal">
              {line || ''}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  )
}
