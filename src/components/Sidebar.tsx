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
  Terminal,
  Cog,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import ChangelogModal from './ChangelogModal'
import AppSettingsModal from './AppSettingsModal'

// Grouped like established server panels: day-to-day server operation up
// top, content/config in the middle, rare system actions at the bottom.
const navGroups = [
  {
    label: 'Server',
    links: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard },
      { label: 'Console', path: '/console', icon: Terminal },
      { label: 'Players', path: '/players', icon: Users },
      { label: 'Monitoring', path: '/monitoring', icon: Activity },
    ],
  },
  {
    label: 'Content',
    links: [
      { label: 'Mods', path: '/mods', icon: Package },
      { label: 'Sandbox', path: '/sandbox', icon: Skull },
      { label: 'Settings', path: '/settings', icon: Settings },
    ],
  },
  {
    label: 'System',
    links: [
      { label: 'Installer', path: '/install', icon: Download },
      { label: 'Wipe', path: '/wipe', icon: Trash2 },
    ],
  },
]

const LAST_SEEN_VERSION_KEY = 'pz-manager.lastSeenVersion'

export default function Sidebar() {
  const location = useLocation()
  const [version, setVersion] = useState('')
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)

  useEffect(() => {
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
  }, [])

  return (
    <aside className="w-[240px] shrink-0 bg-[#1a1a1a] border-r border-[#333] flex flex-col h-full">
      <div className="h-14 flex items-center gap-2 px-4 border-b border-[#333]">
        <Server className="w-6 h-6 text-red-500" />
        <span className="font-bold text-sm tracking-wider text-white">PZ MANAGER</span>
      </div>

      <nav className="flex-1 px-3 py-3 space-y-3 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.label}>
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-[#666] select-none">
              {group.label}
            </p>
            <div className="mt-1 space-y-0.5">
              {group.links.map((link) => {
                const isActive = location.pathname === link.path
                const Icon = link.icon
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-[#1f1f1f] text-white border-l-[3px] border-red-500'
                        : 'text-[#a0a0a0] hover:text-white hover:bg-[#2a2a2a]'
                    }`}
                  >
                    <Icon size={17} />
                    {link.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: version (patch notes) + app-settings cog */}
      <div className="p-3 border-t border-[#333]">
        <div className="flex gap-1.5">
          {version && (
            <button
              onClick={() => setChangelogOpen(true)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-[#222] hover:bg-[#2a2a2a] border border-[#333] hover:border-[#444] text-[#a0a0a0] hover:text-white transition-colors"
              title="View patch notes"
            >
              <Sparkles size={12} className="text-amber-400" />
              <span className="text-xs font-mono">v{version}</span>
              <span className="text-[10px] text-[#666]">— what's new</span>
            </button>
          )}
          <button
            onClick={() => setAppSettingsOpen(true)}
            className="px-2.5 py-2 rounded-md bg-[#222] hover:bg-[#2a2a2a] border border-[#333] hover:border-[#444] text-[#a0a0a0] hover:text-white transition-colors"
            title="App settings (tray, Steam API key)"
          >
            <Cog size={14} />
          </button>
        </div>
      </div>

      <ChangelogModal
        open={changelogOpen}
        onClose={() => setChangelogOpen(false)}
        initialVersion={version}
      />
      <AppSettingsModal
        open={appSettingsOpen}
        onClose={() => setAppSettingsOpen(false)}
      />
    </aside>
  )
}
