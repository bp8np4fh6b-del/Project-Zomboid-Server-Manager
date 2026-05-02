import { useState, useEffect, useRef } from 'react'
import { Play, Square, RotateCcw, Terminal, MessageSquare, Send, Wifi, WifiOff } from 'lucide-react'

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
          <p className="text-xs text-[#a0a0a0] mb-1">Online players ({livePlayers.length})</p>
          {livePlayers.length === 0 ? (
            <p className="text-xs text-[#666] italic">{consoleAvailable ? 'No one connected.' : '—'}</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {livePlayers.map((p) => (
                <span key={p.name} className="text-xs px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 font-mono">{p.name}</span>
              ))}
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
