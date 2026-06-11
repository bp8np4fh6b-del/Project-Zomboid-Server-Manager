import { useState, useEffect, useRef, useCallback, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Terminal, Send, Trash2, Users, Save, ArrowDownToLine, MessageSquare } from 'lucide-react'

interface LogLine {
  timestamp: string
  level: string
  line: string
}

const LEVEL_COLOR: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-amber-400',
  success: 'text-green-400',
  info: 'text-[#b8b8b8]',
}

function formatTs(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export default function Console() {
  const [logs, setLogs] = useState<LogLine[]>([])
  const [status, setStatus] = useState('offline')
  const [command, setCommand] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [stickToBottom, setStickToBottom] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    window.electronAPI.getServerLogs().then((initial: any) => {
      if (alive && Array.isArray(initial)) setLogs(initial.slice(-500))
    })
    window.electronAPI.getServerStatus().then((s: any) => { if (alive) setStatus(s.status) })
    const unsubStatus = window.electronAPI.onServerStatus((s: string) => { if (alive) setStatus(s) })
    const unsubLog = window.electronAPI.onServerLog((data: any) => {
      if (!alive || !data) return
      setLogs((prev) => [...prev.slice(-999), data])
    })
    return () => { alive = false; unsubStatus(); unsubLog() }
  }, [])

  // Stick-to-bottom: follow new output unless the user scrolled up.
  useEffect(() => {
    if (stickToBottom) endRef.current?.scrollIntoView({ block: 'end' })
  }, [logs, stickToBottom])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setStickToBottom(nearBottom)
  }, [])

  const online = status === 'online'

  const sendRaw = async (cmd: string) => {
    const c = cmd.trim()
    if (!c) return
    setSendError(null)
    const r = await window.electronAPI.consoleSend(c)
    if (!r?.success) {
      setSendError(r?.error || 'Could not send the command.')
    } else {
      // Echo what we sent into the local view so the flow reads like a terminal.
      setLogs((prev) => [...prev.slice(-999), { timestamp: new Date().toISOString(), level: 'info', line: `> ${c}` }])
    }
  }

  const handleSubmit = async () => {
    const c = command.trim()
    if (!c) return
    await sendRaw(c)
    setHistory((prev) => (prev[prev.length - 1] === c ? prev : [...prev.slice(-49), c]))
    setHistoryIdx(-1)
    setCommand('')
  }

  // ↑/↓ command history like a real terminal.
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { handleSubmit(); return }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHistoryIdx((idx) => {
        const next = idx === -1 ? history.length - 1 : Math.max(0, idx - 1)
        if (history[next] !== undefined) setCommand(history[next])
        return next
      })
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHistoryIdx((idx) => {
        if (idx === -1) return -1
        const next = idx + 1
        if (next >= history.length) { setCommand(''); return -1 }
        setCommand(history[next])
        return next
      })
    }
  }

  const handleBroadcast = async () => {
    const msg = prompt('Message to broadcast to all players:')
    if (!msg?.trim()) return
    const r = await window.electronAPI.consoleBroadcast(msg.trim())
    if (!r?.success) setSendError(r?.error || 'Broadcast failed.')
  }

  return (
    <div className="flex flex-col h-full">
      {/* The console owns the whole content area below the TopBar
          (Layout renders /console full-bleed with no padding). */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[#222] bg-[#161616] shrink-0">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-[#888]" />
          <h2 className="font-semibold text-sm">Server Console</h2>
          <span className="text-xs text-[#666]">({logs.length} lines)</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Quick commands */}
          <button
            onClick={() => sendRaw('players')}
            disabled={!online}
            className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-30"
            title="List connected players"
          >
            <Users size={12} /> Players
          </button>
          <button
            onClick={() => sendRaw('save')}
            disabled={!online}
            className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-30"
            title="Save the world now"
          >
            <Save size={12} /> Save World
          </button>
          <button
            onClick={handleBroadcast}
            disabled={!online}
            className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-30"
            title="Broadcast a message to all players"
          >
            <MessageSquare size={12} /> Broadcast
          </button>
          <button
            onClick={() => setLogs([])}
            className="btn-secondary text-xs flex items-center gap-1.5"
            title="Clear the view (does not affect the server)"
          >
            <Trash2 size={12} /> Clear
          </button>
        </div>
      </div>

      {/* Log body */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-[#0c0c0c] px-4 py-3 font-mono text-xs leading-5"
      >
        {logs.length === 0 ? (
          <p className="text-[#555] italic">
            No output yet. {online ? 'Server is online — output appears here as it happens.' : 'Start the server to see its console output.'}
          </p>
        ) : (
          logs.map((l, i) => (
            <div key={i} className="flex gap-2 hover:bg-[#161616] px-1 rounded">
              <span className="text-[#4a4a4a] shrink-0 select-none">[{formatTs(l.timestamp)}]</span>
              <span className={`break-all whitespace-pre-wrap ${LEVEL_COLOR[l.level] || LEVEL_COLOR.info} ${l.line?.startsWith('> ') ? 'text-blue-300' : ''}`}>
                {l.line}
              </span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* Jump-to-bottom helper when scrolled up */}
      {!stickToBottom && (
        <button
          onClick={() => { setStickToBottom(true); endRef.current?.scrollIntoView({ block: 'end' }) }}
          className="absolute bottom-20 right-8 bg-[#222] border border-[#444] rounded-full p-2 text-[#a0a0a0] hover:text-white shadow-lg"
          title="Jump to latest output"
        >
          <ArrowDownToLine size={16} />
        </button>
      )}

      {/* Command input pinned at the bottom */}
      <div className="px-4 py-3 border-t border-[#222] bg-[#161616] shrink-0">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555] font-mono text-sm select-none">&gt;</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!online}
              placeholder={online ? 'Type a server command (e.g. players, servermsg "hello", save)…' : 'Server is offline'}
              className="input w-full pl-7 font-mono text-sm disabled:opacity-50"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={!online || !command.trim()}
            className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
          >
            <Send size={14} /> Send
          </button>
        </div>
        {sendError && <p className="text-xs text-red-400 mt-1.5">{sendError}</p>}
        <p className="text-[10px] text-[#555] mt-1.5">
          Commands go to the server's stdin — same as typing into its console window. ↑/↓ recalls history.
        </p>
      </div>
    </div>
  )
}
