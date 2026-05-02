import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Download,
  Settings,
  Package,
  Users,
  Activity,
  Server,
  Skull,
  Trash2,
  Sparkles,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import ChangelogModal from './ChangelogModal'

const navLinks = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Installer', path: '/install', icon: Download },
  { label: 'Settings', path: '/settings', icon: Settings },
  { label: 'Sandbox', path: '/sandbox', icon: Skull },
  { label: 'Mods', path: '/mods', icon: Package },
  { label: 'Players', path: '/players', icon: Users },
  { label: 'Monitoring', path: '/monitoring', icon: Activity },
  { label: 'Wipe', path: '/wipe', icon: Trash2 },
]

const statusColor: Record<string, string> = {
  offline: 'bg-red-500',
  starting: 'bg-amber-500',
  online: 'bg-green-500',
  stopping: 'bg-amber-500',
}

const LAST_SEEN_VERSION_KEY = 'pz-manager.lastSeenVersion'

export default function Sidebar() {
  const location = useLocation()
  const [status, setStatus] = useState('offline')
  const [version, setVersion] = useState('')
  const [changelogOpen, setChangelogOpen] = useState(false)

  useEffect(() => {
    const unsub = window.electronAPI.onServerStatus((s: string) => setStatus(s))
    window.electronAPI.getServerStatus().then((s: any) => setStatus(s.status))
    window.electronAPI.getAppVersion().then((v: string) => {
      setVersion(v)
      // Auto-open the changelog once when the manager version changes
      // (typical case: user just got an auto-update). Persists in localStorage
      // so it doesn't open every launch.
      try {
        const seen = localStorage.getItem(LAST_SEEN_VERSION_KEY)
        if (seen !== v) {
          setChangelogOpen(true)
          localStorage.setItem(LAST_SEEN_VERSION_KEY, v)
        }
      } catch { /* localStorage unavailable, fail silently */ }
    }).catch(() => {})
    return unsub
  }, [])

  return (
    <aside className="w-[240px] shrink-0 bg-[#1a1a1a] border-r border-[#333] flex flex-col h-full">
      <div className="h-14 flex items-center gap-2 px-4 border-b border-[#333]">
        <Server className="w-6 h-6 text-red-500" />
        <span className="font-bold text-sm tracking-wider text-white">PZ MANAGER</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navLinks.map((link) => {
          const isActive = location.pathname === link.path
          const Icon = link.icon
          return (
            <Link
              key={link.path}
              to={link.path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all ${
                isActive
                  ? 'bg-[#1f1f1f] text-white border-l-[3px] border-red-500'
                  : 'text-[#a0a0a0] hover:text-white hover:bg-[#2a2a2a]'
              }`}
            >
              <Icon size={18} />
              {link.label}
            </Link>
          )
        })}
      </nav>

      <div className="p-3 border-t border-[#333] space-y-2">
        <div className="bg-[#222] rounded-lg p-3 border border-[#333]">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full ${statusColor[status]} animate-pulse`} />
            <span className="text-xs font-medium text-[#a0a0a0] uppercase tracking-wider">
              {status}
            </span>
          </div>
          <p className="text-xs text-[#666] truncate">Build 42 Server</p>
        </div>

        {/* Version button — opens the in-app patch notes modal */}
        {version && (
          <button
            onClick={() => setChangelogOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-[#222] hover:bg-[#2a2a2a] border border-[#333] hover:border-[#444] text-[#a0a0a0] hover:text-white transition-colors"
            title="View patch notes"
          >
            <Sparkles size={12} className="text-amber-400" />
            <span className="text-xs font-mono">v{version}</span>
            <span className="text-[10px] text-[#666]">— what's new</span>
          </button>
        )}
      </div>

      <ChangelogModal
        open={changelogOpen}
        onClose={() => setChangelogOpen(false)}
        initialVersion={version}
      />
    </aside>
  )
}
