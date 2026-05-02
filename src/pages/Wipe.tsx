import { useState, useEffect } from 'react'
import { AlertTriangle, Trash2, ShieldAlert, Globe, Database, ScrollText, Users, Settings as SettingsIcon } from 'lucide-react'

interface WipeOption {
  key: 'world' | 'players' | 'logs' | 'history' | 'config'
  label: string
  description: string
  icon: any
  destructiveness: 'low' | 'medium' | 'high'
}

const options: WipeOption[] = [
  {
    key: 'world',
    label: 'World Save',
    description: 'Deletes the multiplayer world (~/Zomboid/Saves/Multiplayer/<server>/). All built bases, vehicles, dropped loot, and zombie spawns reset. New world generates on next start.',
    icon: Globe,
    destructiveness: 'high',
  },
  {
    key: 'players',
    label: 'Player Database',
    description: 'Deletes the SQLite player DB. Characters, skills, inventories, and admin permissions reset. Whitelist is preserved if `AutoCreateUserInWhiteList=false`.',
    icon: Database,
    destructiveness: 'high',
  },
  {
    key: 'config',
    label: 'Server Config',
    description: 'Deletes servertest.ini, SandboxVars.lua, and spawnregions.lua. They will regenerate from defaults on next server start.',
    icon: SettingsIcon,
    destructiveness: 'medium',
  },
  {
    key: 'logs',
    label: 'Server Logs',
    description: 'Deletes ~/Zomboid/Logs/. Existing chat / debug / connection logs are gone. Useful for freeing disk space.',
    icon: ScrollText,
    destructiveness: 'low',
  },
  {
    key: 'history',
    label: 'Player History (manager-only)',
    description: 'Clears the manager\'s connect/disconnect history. Does not affect the server itself.',
    icon: Users,
    destructiveness: 'low',
  },
]

export default function Wipe() {
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [createBackup, setCreateBackup] = useState(true)
  const [confirmText, setConfirmText] = useState('')
  const [serverStatus, setServerStatus] = useState('offline')
  const [wiping, setWiping] = useState(false)
  const [result, setResult] = useState<{ success: boolean; removed?: string[]; failed?: string[]; message?: string; error?: string } | null>(null)

  useEffect(() => {
    let alive = true
    window.electronAPI.getServerStatus().then((s: any) => { if (alive) setServerStatus(s.status) })
    const unsub = window.electronAPI.onServerStatus((s: string) => { if (alive) setServerStatus(s) })
    return () => { alive = false; unsub() }
  }, [])

  const anySelected = Object.values(selected).some(Boolean)
  const confirmRequired = 'WIPE'
  const canWipe = anySelected && confirmText === confirmRequired && serverStatus === 'offline' && !wiping

  const toggle = (k: string) =>
    setSelected((prev) => ({ ...prev, [k]: !prev[k] }))

  const selectAll = () => {
    const all: Record<string, boolean> = {}
    for (const o of options) all[o.key] = true
    setSelected(all)
  }

  const clearSelection = () => {
    setSelected({})
    setConfirmText('')
  }

  const handleWipe = async () => {
    if (!canWipe) return
    setWiping(true)
    setResult(null)
    const scope: any = {
      ...selected,
      backup: createBackup,
    }
    const res = await window.electronAPI.wipeServer(scope)
    setWiping(false)
    setResult(res)
    if (res.success) {
      setSelected({})
      setConfirmText('')
    }
  }

  const destructivenessColor = (d: WipeOption['destructiveness']) =>
    d === 'high' ? 'text-red-400 border-red-500/30' :
    d === 'medium' ? 'text-amber-400 border-amber-500/30' :
    'text-blue-400 border-blue-500/30'

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <ShieldAlert size={20} className="text-red-500" />
          Server Wipe
        </h2>
        <p className="text-sm text-[#a0a0a0] mt-1">
          Permanently delete server data. <strong className="text-red-400">This cannot be undone</strong> unless a backup is created.
        </p>
      </div>

      {/* Server-must-be-offline gate */}
      {serverStatus !== 'offline' && (
        <div className="card bg-amber-500/10 border-amber-500/30">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-amber-400" />
            <div>
              <p className="font-semibold text-amber-400">Server is currently {serverStatus}</p>
              <p className="text-sm text-[#a0a0a0]">Stop the server before wiping any data.</p>
            </div>
          </div>
        </div>
      )}

      {/* Options */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">What to wipe</h3>
          <div className="flex gap-2 text-xs">
            <button onClick={selectAll} className="text-[#a0a0a0] hover:text-white">Select All</button>
            <span className="text-[#444]">|</span>
            <button onClick={clearSelection} className="text-[#a0a0a0] hover:text-white">Clear</button>
          </div>
        </div>
        <div className="space-y-2">
          {options.map((o) => {
            const Icon = o.icon
            const isSelected = selected[o.key]
            return (
              <label
                key={o.key}
                className={`flex items-start gap-3 rounded-md p-3 border cursor-pointer transition-colors ${
                  isSelected ? `bg-[#1f1f1f] ${destructivenessColor(o.destructiveness)}` : 'bg-[#222] border-[#333] hover:bg-[#262626]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={!!isSelected}
                  onChange={() => toggle(o.key)}
                  className="mt-1 accent-red-500"
                />
                <Icon size={18} className={`mt-0.5 ${isSelected ? destructivenessColor(o.destructiveness).split(' ')[0] : 'text-[#666]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{o.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono uppercase ${
                      o.destructiveness === 'high' ? 'bg-red-500/20 text-red-400' :
                      o.destructiveness === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {o.destructiveness}
                    </span>
                  </div>
                  <p className="text-xs text-[#a0a0a0] mt-1">{o.description}</p>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {/* Confirmation */}
      {anySelected && (
        <div className="card border-red-500/30 bg-red-500/5">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle size={20} className="text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-red-400">This action is permanent.</p>
              <p className="text-sm text-[#a0a0a0]">
                {createBackup
                  ? 'A backup will be created in ~/PZ-Server-Manager/backups before deletion. You can use the Backup → Restore feature to recover.'
                  : 'No backup will be created. Once you click Wipe, the data is gone.'}
              </p>
            </div>
          </div>

          <label className="flex items-center gap-2 mb-4">
            <input
              type="checkbox"
              checked={createBackup}
              onChange={(e) => setCreateBackup(e.target.checked)}
              className="accent-green-500"
            />
            <span className="text-sm">Create a backup first (recommended)</span>
          </label>

          <div className="space-y-2 mb-4">
            <label className="block text-sm text-[#a0a0a0]">
              Type <code className="text-red-400 font-mono bg-[#1a1a1a] px-1.5 py-0.5 rounded">{confirmRequired}</code> to confirm:
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmRequired}
              className={`input w-full font-mono ${confirmText === confirmRequired ? 'border-red-500/50' : ''}`}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <button
            onClick={handleWipe}
            disabled={!canWipe}
            className="w-full px-4 py-3 rounded-md font-semibold flex items-center justify-center gap-2 transition-all bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/40 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-red-500/20"
          >
            <Trash2 size={18} />
            {wiping ? 'Wiping...' : 'WIPE SELECTED DATA'}
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`card ${result.success ? 'border-green-500/30 bg-green-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
          <h3 className={`font-semibold mb-2 ${result.success ? 'text-green-400' : 'text-red-400'}`}>
            {result.success ? 'Wipe complete' : 'Wipe failed'}
          </h3>
          {result.message && <p className="text-sm text-[#a0a0a0] mb-2">{result.message}</p>}
          {result.error && <p className="text-sm text-red-400 mb-2 font-mono">{result.error}</p>}
          {result.removed && result.removed.length > 0 && (
            <div className="text-sm text-[#a0a0a0] space-y-1 mt-2">
              <p className="font-medium">Removed:</p>
              {result.removed.map((r, i) => (
                <div key={i} className="font-mono text-xs text-green-400">✓ {r}</div>
              ))}
            </div>
          )}
          {result.failed && result.failed.length > 0 && (
            <div className="text-sm space-y-1 mt-2">
              <p className="font-medium text-red-400">Failed:</p>
              {result.failed.map((f, i) => (
                <div key={i} className="font-mono text-xs text-red-400">✗ {f}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
