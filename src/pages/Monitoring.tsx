import { useState, useEffect, useRef } from 'react'
import { Activity, Clock, Users, LogIn, LogOut, Server, RotateCw, AlertCircle, MessageSquare, Trash2 } from 'lucide-react'

interface ActivityEvent {
  at: string
  kind: string
  message: string
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

function formatUptime(sec: number) {
  if (!sec || sec < 0) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function kindIcon(kind: string) {
  switch (kind) {
    case 'connect': return <LogIn size={14} className="text-green-400" />
    case 'disconnect': return <LogOut size={14} className="text-amber-400" />
    case 'server': return <Server size={14} className="text-blue-400" />
    case 'restart': return <RotateCw size={14} className="text-purple-400" />
    case 'error': return <AlertCircle size={14} className="text-red-400" />
    default: return <Activity size={14} className="text-[#888]" />
  }
}

interface ChatMessage { at: string; username: string; text: string }

function formatChatTime(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function Monitoring() {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [status, setStatus] = useState('offline')
  const [uptime, setUptime] = useState(0)
  const [onlineCount, setOnlineCount] = useState(0)
  const [consoleAvailable, setConsoleAvailable] = useState(false)
  const [chat, setChat] = useState<ChatMessage[]>([])
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const [stRes, evRes, st, chatRes] = await Promise.all([
          window.electronAPI.getServerStatus(),
          window.electronAPI.getActivity(),
          window.electronAPI.consoleStatus(),
          window.electronAPI.getChatLog(),
        ])
        if (cancelled) return
        setStatus(stRes.status)
        setUptime(stRes.uptime || 0)
        if (evRes.success) setEvents(evRes.events)
        if (chatRes?.success) setChat(chatRes.messages || [])
        setConsoleAvailable(!!st?.connected)
        if (stRes.status === 'online' && st?.connected) {
          const p = await window.electronAPI.consolePlayers()
          if (!cancelled && p?.success) setOnlineCount(p.players.length)
        } else {
          setOnlineCount(0)
        }
      } catch { /* ignore */ }
    }
    tick()
    const i = setInterval(tick, 3000)
    return () => { cancelled = true; clearInterval(i) }
  }, [])

  // Auto-scroll the chat panel to bottom on new messages.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chat])

  const handleClearChat = async () => {
    await window.electronAPI.clearChatLog()
    setChat([])
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Activity size={20} />
          Server Activity
        </h2>
        <p className="text-sm text-[#a0a0a0] mt-1">
          Live feed of player joins, leaves, restart events, and server state changes. Pulled from the server console.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${
            status === 'online' ? 'bg-green-500 animate-pulse' :
            status === 'starting' || status === 'stopping' ? 'bg-amber-500 animate-pulse' :
            'bg-red-500'
          }`} />
          <div>
            <p className="text-xs text-[#a0a0a0]">Status</p>
            <p className="text-lg font-semibold capitalize">{status}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <Users size={20} className="text-blue-400" />
          <div>
            <p className="text-xs text-[#a0a0a0]">Online players</p>
            <p className="text-lg font-semibold">
              {status === 'online' ? (consoleAvailable ? onlineCount : '…') : '—'}

            </p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <Clock size={20} className="text-purple-400" />
          <div>
            <p className="text-xs text-[#a0a0a0]">Uptime</p>
            <p className="text-lg font-semibold">{status === 'online' ? formatUptime(uptime) : '—'}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Recent events ({events.length})</h3>
          {!consoleAvailable && status === 'online' && (
            <span className="text-xs text-amber-400">Console connecting…</span>
          )}
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-[#666] italic">No events yet. Start the server, connect a player, or schedule a restart — they'll appear here in real time.</p>
        ) : (
          <div className="space-y-1 max-h-[28rem] overflow-y-auto">
            {events.map((ev, i) => (
              <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-md bg-[#1a1a1a] border border-[#222] hover:border-[#333]">
                <div className="mt-0.5 shrink-0">{kindIcon(ev.kind)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{ev.message}</p>
                </div>
                <div className="text-xs text-[#666] font-mono shrink-0">{formatRelative(ev.at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* In-game chat feed — public messages parsed from the server log. */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <MessageSquare size={16} />
            Server Chat ({chat.length})
          </h3>
          {chat.length > 0 && (
            <button
              onClick={handleClearChat}
              className="text-xs text-[#a0a0a0] hover:text-white flex items-center gap-1"
              title="Clear local chat history"
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
        {chat.length === 0 ? (
          <p className="text-sm text-[#666] italic">
            No chat messages captured yet. Public chat from connected players will appear here as it happens.
            {' '}If you're sure players are chatting in-game and nothing shows here, the parser may not match Build 42's exact format — open a bug with sample log lines.
          </p>
        ) : (
          <div className="bg-[#0f0f0f] rounded-md border border-[#222] max-h-[24rem] overflow-y-auto p-3 space-y-1 font-mono text-xs">
            {chat.map((m, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-[#555] shrink-0">[{formatChatTime(m.at)}]</span>
                <span className="text-blue-300 shrink-0">{m.username}:</span>
                <span className="text-[#d0d0d0] break-words">{m.text}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>
    </div>
  )
}
