import { useState, useEffect } from 'react'
import { X, AppWindow, KeyRound, Check, Trash2, Download } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
}

// App-level settings (manager behaviour, not game-server config). Opened from
// the cog next to the version number in the sidebar footer.
//
// Security note: the Steam Web API key is write-only. The backend never sends
// the stored key to the renderer — we only know whether one exists and its
// last 3 characters for recognition.
export default function AppSettingsModal({ open, onClose }: Props) {
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [autoUpdateGame, setAutoUpdateGame] = useState(false)
  const [autoUpdateMods, setAutoUpdateMods] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [keyHint, setKeyHint] = useState('')
  const [editingKey, setEditingKey] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!open) return
    setEditingKey(false)
    setNewKey('')
    window.electronAPI.getAppPrefs().then((p) => {
      if (p?.success) {
        setMinimizeToTray(p.prefs.minimizeToTray)
        setAutoUpdateGame(p.prefs.autoUpdateGame)
        setAutoUpdateMods(p.prefs.autoUpdateMods)
        setHasKey(p.prefs.hasSteamApiKey)
        setKeyHint(p.prefs.steamApiKeyHint)
      }
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const flashSaved = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const applyPrefs = async (partial: { minimizeToTray?: boolean; autoUpdateGame?: boolean; autoUpdateMods?: boolean; steamApiKey?: string }) => {
    const r = await window.electronAPI.setAppPrefs(partial)
    if (r?.success) {
      setMinimizeToTray(r.prefs.minimizeToTray)
      setAutoUpdateGame(r.prefs.autoUpdateGame)
      setAutoUpdateMods(r.prefs.autoUpdateMods)
      setHasKey(r.prefs.hasSteamApiKey)
      setKeyHint(r.prefs.steamApiKeyHint)
      flashSaved()
    }
  }

  const handleSaveKey = async () => {
    const k = newKey.trim()
    if (!k) return
    await applyPrefs({ steamApiKey: k })
    setNewKey('')
    setEditingKey(false)
  }

  const handleRemoveKey = async () => {
    if (!confirm('Remove the saved Steam Web API key? Workshop search will stop working until a new one is added.')) return
    await applyPrefs({ steamApiKey: '' })
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a1a] border border-[#333] rounded-lg w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#333]">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <AppWindow size={16} className="text-[#888]" />
            App Settings
          </h2>
          <button onClick={onClose} className="text-[#888] hover:text-white p-1" title="Close (Esc)">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Tray behaviour */}
          <label className="flex items-start gap-3 bg-[#222] rounded-md p-3 border border-[#333] cursor-pointer">
            <input
              type="checkbox"
              checked={minimizeToTray}
              onChange={(e) => applyPrefs({ minimizeToTray: e.target.checked })}
              className="accent-green-500 mt-0.5"
            />
            <span>
              <span className="text-sm block">Minimize to system tray</span>
              <span className="text-xs text-[#888] block mt-0.5">
                Closing or minimizing hides the manager to the tray and the server keeps running.
                Quit from the tray menu.
              </span>
            </span>
          </label>

          {/* Auto-updates */}
          <div>
            <p className="text-sm font-medium flex items-center gap-2 mb-1">
              <Download size={14} className="text-[#888]" />
              Automatic Updates
            </p>
            <p className="text-xs text-[#888] mb-2">
              Updates are applied on restart — the server never gets patched out from under a live session.
            </p>
            <div className="space-y-2">
              <label className="flex items-start gap-3 bg-[#222] rounded-md p-3 border border-[#333] cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoUpdateGame}
                  onChange={(e) => applyPrefs({ autoUpdateGame: e.target.checked })}
                  className="accent-green-500 mt-0.5"
                />
                <span>
                  <span className="text-sm block">Zomboid patch updates</span>
                  <span className="text-xs text-[#888] block mt-0.5">
                    Checks Steam for new dedicated-server builds and applies them automatically before
                    the server starts. You can also check and update manually from the Installer tab.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 bg-[#222] rounded-md p-3 border border-[#333] cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoUpdateMods}
                  onChange={(e) => applyPrefs({ autoUpdateMods: e.target.checked })}
                  className="accent-green-500 mt-0.5"
                />
                <span>
                  <span className="text-sm block">Workshop mod updates</span>
                  <span className="text-xs text-[#888] block mt-0.5">
                    Checks your installed mods for updates when the manager opens. Updated versions are
                    downloaded by the game server itself the next time it starts.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {/* Steam Web API key — optional, write-only */}
          <div>
            <p className="text-sm font-medium flex items-center gap-2 mb-1">
              <KeyRound size={14} className="text-[#888]" />
              Steam Web API Key <span className="text-[10px] font-normal text-[#666] uppercase tracking-wider">optional</span>
            </p>
            <p className="text-xs text-[#888] mb-2">
              Workshop search and mod updates work without one, via Steam's public workshop pages.
              Adding your own key upgrades search to Steam's official API (adds vote counts and
              slightly richer results). Stored only on this machine, never shown again after saving,
              and only ever sent to Steam itself.
            </p>

            {hasKey && !editingKey ? (
              <div className="flex items-center justify-between bg-[#222] border border-[#333] rounded-md px-3 py-2">
                <span className="text-sm text-green-300 flex items-center gap-2">
                  <Check size={14} /> Key saved <span className="font-mono text-[#888]">{keyHint}</span>
                </span>
                <div className="flex gap-1.5">
                  <button onClick={() => setEditingKey(true)} className="btn-secondary text-xs">Replace</button>
                  <button onClick={handleRemoveKey} className="text-red-400 hover:text-red-300 p-1.5" title="Remove key">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey() }}
                  placeholder="Paste your 32-character key"
                  className="input flex-1 font-mono text-sm"
                  autoComplete="off"
                />
                <button onClick={handleSaveKey} disabled={!newKey.trim()} className="btn-primary text-xs disabled:opacity-40">
                  Save
                </button>
                {hasKey && (
                  <button onClick={() => { setEditingKey(false); setNewKey('') }} className="btn-secondary text-xs">
                    Cancel
                  </button>
                )}
              </div>
            )}

            <button
              onClick={() => window.electronAPI.openExternal('https://steamcommunity.com/dev/apikey')}
              className="text-[11px] text-[#666] hover:text-blue-400 hover:underline mt-1.5"
            >
              Get a free key at steamcommunity.com/dev/apikey
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#333] bg-[#161616]">
          <span className={`text-xs text-green-400 transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`}>Saved ✓</span>
          <button onClick={onClose} className="btn-secondary text-xs">Close</button>
        </div>
      </div>
    </div>
  )
}
