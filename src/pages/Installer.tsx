import { useState, useEffect } from 'react'
import { Download, Check, Loader, FolderOpen, HardDrive, AlertCircle, RotateCw } from 'lucide-react'

interface ManagerPaths {
  basePath: string
  serverPath: string
  zomboidPath: string
}

export default function Installer() {
  const [status, setStatus] = useState<any>({ steamcmd: false, pzServer: false })
  const [installingSteam, setInstallingSteam] = useState(false)
  const [installingPz, setInstallingPz] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  // Manager paths (basePath / serverPath / zomboidPath)
  const [paths, setPaths] = useState<ManagerPaths | null>(null)
  const [pathsDirty, setPathsDirty] = useState<Partial<ManagerPaths>>({})
  const [pathsError, setPathsError] = useState<string | null>(null)
  const [applyingPaths, setApplyingPaths] = useState(false)

  useEffect(() => {
    refresh()
    const unsub = window.electronAPI.onServerLog((data: any) => {
      if (data && typeof data.line === 'string') {
        setLogs((prev) => [...prev.slice(-49), data.line])
      }
    })
    return unsub
  }, [])

  async function refresh() {
    const s = await window.electronAPI.getInstallStatus()
    setStatus(s)
    const p = await window.electronAPI.getManagerPaths()
    if (p.success) setPaths(p.paths)
  }

  const effectivePath = (key: keyof ManagerPaths): string =>
    pathsDirty[key] !== undefined ? (pathsDirty[key] as string) : (paths?.[key] || '')

  const handlePickPath = async (key: keyof ManagerPaths) => {
    const folder = await window.electronAPI.selectFolder()
    if (!folder) return
    setPathsDirty((prev) => ({ ...prev, [key]: folder }))
  }

  const handleApplyPaths = async () => {
    if (Object.keys(pathsDirty).length === 0) return
    setApplyingPaths(true)
    setPathsError(null)
    const r = await window.electronAPI.setManagerPaths(pathsDirty)
    if (!r.success) {
      setApplyingPaths(false)
      setPathsError(r.error || 'Failed to apply paths.')
      return
    }
    // App will relaunch shortly; UI freezes here intentionally.
  }

  const handleRevertPaths = () => {
    setPathsDirty({})
    setPathsError(null)
  }

  const handleInstallSteam = async () => {
    setInstallingSteam(true)
    setLogs([])
    const result = await window.electronAPI.installSteamCmd()
    setInstallingSteam(false)
    await refresh()
    if (!result.success) {
      setLogs((prev) => [...prev, `ERROR: ${result.error}`])
    }
  }

  const handleInstallPz = async () => {
    setInstallingPz(true)
    setLogs([])
    const result = await window.electronAPI.installPzServer()
    setInstallingPz(false)
    await refresh()
    if (!result.success) {
      setLogs((prev) => [...prev, `ERROR: ${result.error}`])
    }
  }

  const openFolder = async () => {
    const p = status.serverPath || ''
    if (p) window.electronAPI.openExternal(`file:///${p}`)
  }

  const handleImportExisting = async () => {
    setImporting(true)
    setImportMessage(null)
    setImportError(null)
    try {
      const folder = await window.electronAPI.selectFolder()
      if (!folder) {
        setImporting(false)
        return
      }
      const detect = await window.electronAPI.detectExistingServer(folder)
      if (!detect.success) {
        setImportError(detect.error || 'Folder is not a PZ server install.')
        setImporting(false)
        return
      }
      // Apply the new serverPath. App will relaunch.
      const apply = await window.electronAPI.setManagerPaths({ serverPath: folder })
      if (!apply.success) {
        setImportError(apply.error || 'Could not save server path.')
        setImporting(false)
        return
      }
      setImportMessage(`Importing ${folder} — restarting…`)
    } catch (err: any) {
      setImportError(err?.message || String(err))
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-xl font-semibold">Server Installation</h2>
      <p className="text-[#a0a0a0]">
        Install SteamCMD and the Project Zomboid Build 42 Dedicated Server.
        You must own Project Zomboid on Steam to download the dedicated server.
      </p>

      {/* Current Install — choose where SteamCMD + PZ server install BEFORE running install */}
      <div className="card">
        <h3 className="font-semibold flex items-center gap-2 mb-1">
          <FolderOpen size={18} />
          Current Install
        </h3>
        <p className="text-xs text-[#888] mb-4">
          The manager remembers three folders. Change them <strong>before</strong> running the installs below if you want SteamCMD or the PZ server on a different drive.
          Already moved your install to a new drive? Point the PZ server folder at the new location — the manager picks up the existing files. Path changes restart the manager.
        </p>

        <div className="space-y-3">
          {([
            { key: 'basePath' as const, label: 'Manager data folder', help: 'SteamCMD, mod cache, backups, player history.' },
            { key: 'serverPath' as const, label: 'PZ server install folder', help: 'Where the dedicated server (.bat / .exe) lives. Point at an existing PZ install to import it.' },
            { key: 'zomboidPath' as const, label: 'Zomboid user folder', help: 'PZ user data: servertest.ini, sandbox vars, saves.' },
          ]).map((row) => {
            const value = effectivePath(row.key)
            const dirty = pathsDirty[row.key] !== undefined
            return (
              <div key={row.key}>
                <label className="block text-sm font-medium text-[#e0e0e0] mb-0.5">
                  {row.label}
                  {dirty && <span className="ml-2 text-[10px] text-amber-400 font-mono uppercase">changed</span>}
                </label>
                <p className="text-xs text-[#888] mb-1.5">{row.help}</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={value}
                    readOnly
                    className="input flex-1 font-mono text-xs"
                  />
                  <button
                    onClick={() => handlePickPath(row.key)}
                    className="btn-secondary text-xs flex items-center gap-2"
                  >
                    <FolderOpen size={14} /> Browse…
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {pathsError && (
          <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-md p-2 text-xs text-red-400 flex items-center gap-2">
            <AlertCircle size={14} />
            {pathsError}
          </div>
        )}

        {Object.keys(pathsDirty).length > 0 && (
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleApplyPaths}
              disabled={applyingPaths}
              className="btn-primary flex items-center gap-2 disabled:opacity-40"
            >
              <RotateCw size={14} className={applyingPaths ? 'animate-spin' : ''} />
              {applyingPaths ? 'Applying & restarting…' : 'Apply & restart'}
            </button>
            <button onClick={handleRevertPaths} className="btn-secondary">
              Revert
            </button>
          </div>
        )}
      </div>

      {/* Step 1 — SteamCMD */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Download size={18} />
              Step 1 — SteamCMD
            </h3>
            <p className="text-sm text-[#a0a0a0] mt-1">
              Valve's command-line tool for downloading Steam content.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {status.steamcmd ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <Check size={16} /> Installed
              </span>
            ) : (
              <button
                onClick={handleInstallSteam}
                disabled={installingSteam}
                className="btn-primary flex items-center gap-2"
              >
                {installingSteam ? <Loader size={16} className="animate-spin" /> : <Download size={16} />}
                {installingSteam ? 'Downloading...' : 'Install SteamCMD'}
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-[#666] font-mono">
          {status.steamcmd ? 'Installed at: ' : 'Will install to: '}
          {status.steamCmdPath || effectivePath('basePath') + '\\steamcmd\\steamcmd.exe'}
        </p>
      </div>

      {/* Step 2 — PZ Server */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Download size={18} />
              Step 2 — Project Zomboid Dedicated Server
            </h3>
            <p className="text-sm text-[#a0a0a0] mt-1">
              Build 42 multiplayer server files (~2-3 GB). Requires owning PZ on Steam.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {status.pzServer ? (
              <span className="flex items-center gap-1 text-green-500 text-sm">
                <Check size={16} /> Installed
              </span>
            ) : (
              <button
                onClick={handleInstallPz}
                disabled={installingPz || !status.steamcmd}
                className="btn-primary flex items-center gap-2"
              >
                {installingPz ? <Loader size={16} className="animate-spin" /> : <Download size={16} />}
                {installingPz ? 'Installing...' : 'Install PZ Server'}
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-[#666] font-mono">
          {status.pzServer ? 'Installed at: ' : 'Will install to: '}
          {status.serverPath || effectivePath('serverPath')}
        </p>
        {status.pzServer && (
          <button onClick={openFolder} className="btn-secondary mt-3 flex items-center gap-2 text-sm">
            <FolderOpen size={14} /> Open Server Folder
          </button>
        )}
      </div>

      {/* Move existing install — replaces a fresh install when the server is
          already on disk (e.g. on a different drive after a manual move). */}
      <div className="card">
        <div className="flex items-start gap-3">
          <HardDrive size={20} className="text-blue-400 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold">Already have a server installed elsewhere?</h3>
            <p className="text-sm text-[#a0a0a0] mt-1">
              Point the manager at an existing dedicated server folder. Use this if you've moved your install to a new drive (copy the folder yourself, then update the path here) or if you installed PZ Server manually with SteamCMD outside the manager.
            </p>
            <p className="text-xs text-[#666] mt-2">
              The manager won't move or copy any files — it just remembers the new location and uses it from then on.
            </p>
            {importMessage && (
              <div className="mt-3 bg-blue-500/10 border border-blue-500/30 rounded-md p-2 text-xs text-blue-300 flex items-center gap-2">
                <RotateCw size={14} className="animate-spin" />
                {importMessage}
              </div>
            )}
            {importError && (
              <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-md p-2 text-xs text-red-400 flex items-center gap-2">
                <AlertCircle size={14} />
                {importError}
              </div>
            )}
            <button
              onClick={handleImportExisting}
              disabled={importing}
              className="btn-secondary mt-3 flex items-center gap-2 text-sm disabled:opacity-40"
            >
              <FolderOpen size={14} />
              {importing ? 'Working…' : 'Pick existing server folder'}
            </button>
          </div>
        </div>
      </div>

      {/* Install Logs */}
      {(installingSteam || installingPz || logs.length > 0) && (
        <div className="card">
          <h3 className="font-semibold mb-2">Installation Log</h3>
          <div className="bg-[#0f0f0f] rounded-md p-3 h-48 overflow-y-auto font-mono text-xs space-y-1">
            {logs.map((line, i) => (
              <div key={i} className="text-[#a0a0a0] truncate">{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
