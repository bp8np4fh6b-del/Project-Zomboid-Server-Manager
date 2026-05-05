import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Download, Check, Loader, FolderOpen, HardDrive, AlertCircle, RotateCw,
  Sparkles, Wand2, ChevronRight, ChevronDown, Server, ArrowRight, RefreshCw,
} from 'lucide-react'

// One-button setup wizard flow:
//   idle → choose ('fresh' | 'existing') → installing-steam → installing-pz → done
// When everything is already installed the page collapses to a compact summary
// with reinstall / move-to-different-drive controls.

interface ManagerPaths {
  basePath: string
  serverPath: string
  zomboidPath: string
}

type Phase =
  | 'idle'              // Decide based on install status
  | 'choose'            // Wizard step 1 — fresh vs existing
  | 'configure-fresh'   // Wizard step 2 — confirm install location for fresh install
  | 'installing-steam'  // Running SteamCMD install
  | 'installing-pz'     // Running PZ server install
  | 'pick-existing'     // Folder picker for existing-install path
  | 'done'              // Just-finished success view

interface ScanCandidate {
  path: string
  source: string
  launchers: string[]
}

export default function Installer() {
  const navigate = useNavigate()

  const [status, setStatus] = useState<any>({ steamcmd: false, pzServer: false })
  const [paths, setPaths] = useState<ManagerPaths | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [progressLabel, setProgressLabel] = useState<string | null>(null)

  // Scan results — populated on mount when neither steamcmd nor pz are installed.
  const [scanCandidates, setScanCandidates] = useState<ScanCandidate[]>([])
  const [scanning, setScanning] = useState(false)

  // Advanced path overrides — exposed via a disclosure on the configure-fresh step.
  const [pathsDirty, setPathsDirty] = useState<Partial<ManagerPaths>>({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [applyingPaths, setApplyingPaths] = useState(false)
  const [pathsError, setPathsError] = useState<string | null>(null)

  useEffect(() => {
    refresh()
    const unsub = window.electronAPI.onServerLog((data: any) => {
      if (data && typeof data.line === 'string') {
        setLogs((prev) => [...prev.slice(-99), data.line])
      }
    })
    return unsub
  }, [])

  // First-load: when nothing's installed, scan the Steam libraries to see if
  // the user already downloaded the dedicated server outside the manager.
  useEffect(() => {
    if (status.pzServer) return
    let cancelled = false
    setScanning(true)
    window.electronAPI.scanForExistingPzServer()
      .then((r) => {
        if (cancelled) return
        if (r?.success) setScanCandidates(r.candidates || [])
      })
      .finally(() => { if (!cancelled) setScanning(false) })
    return () => { cancelled = true }
  }, [status.pzServer])

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

  // Apply pending path overrides without restarting — used when the user
  // adjusted advanced paths inline before kicking off the install. We skip
  // the manager relaunch here so the install can run continuously; the
  // values persist via setManagerPaths for next launch too.
  const applyPendingPaths = async (): Promise<boolean> => {
    if (Object.keys(pathsDirty).length === 0) return true
    setApplyingPaths(true)
    setPathsError(null)
    try {
      const r = await window.electronAPI.setManagerPaths(pathsDirty)
      if (!r.success) {
        setPathsError(r.error || 'Failed to apply path changes.')
        return false
      }
      // Backend returns updated paths; refresh local state.
      if (r.paths) setPaths(r.paths)
      setPathsDirty({})
      return true
    } finally {
      setApplyingPaths(false)
    }
  }

  // Run SteamCMD install, then PZ server install, with combined progress.
  const runFreshInstall = async () => {
    setError(null)
    setLogs([])

    // Apply any inline path overrides first so the install lands where the
    // user wanted. setManagerPaths normally relaunches; here it just persists
    // since we want to continue inline.
    if (Object.keys(pathsDirty).length > 0) {
      const ok = await applyPendingPaths()
      if (!ok) return
    }

    // Phase 1 — SteamCMD (skip if already installed).
    if (!status.steamcmd) {
      setPhase('installing-steam')
      setProgressLabel('Step 1 of 2 — Downloading SteamCMD…')
      const r1 = await window.electronAPI.installSteamCmd()
      if (!r1.success) {
        setError(r1.error || 'SteamCMD install failed.')
        setPhase('choose')
        return
      }
      await refresh()
    }

    // Phase 2 — PZ Dedicated Server.
    setPhase('installing-pz')
    setProgressLabel('Step 2 of 2 — Downloading Project Zomboid Dedicated Server (~2-3 GB)…')
    const r2 = await window.electronAPI.installPzServer()
    if (!r2.success) {
      setError(r2.error || 'PZ Dedicated Server install failed.')
      setPhase('choose')
      return
    }

    await refresh()
    setProgressLabel(null)
    setPhase('done')
  }

  const useScanCandidate = async (candidate: ScanCandidate) => {
    setError(null)
    setApplyingPaths(true)
    try {
      const r = await window.electronAPI.setManagerPaths({ serverPath: candidate.path })
      if (!r.success) {
        setError(r.error || 'Could not register the existing install.')
        setApplyingPaths(false)
        return
      }
      // setManagerPaths triggers a relaunch — UI will freeze here.
    } catch (err: any) {
      setError(err?.message || String(err))
      setApplyingPaths(false)
    }
  }

  const useExistingFolder = async () => {
    setError(null)
    const folder = await window.electronAPI.selectFolder()
    if (!folder) return
    const det = await window.electronAPI.detectExistingServer(folder)
    if (!det.success) {
      setError(det.error || 'Folder is not a PZ server install.')
      return
    }
    await useScanCandidate({ path: folder, source: 'Picked folder', launchers: det.launchers || [] })
  }

  const startReinstall = () => {
    setPhase('choose')
    setError(null)
    setLogs([])
  }

  // Path-change-only flow for the "Move to a different drive" link in the
  // installed-summary view. Triggers a relaunch.
  const moveToDifferentDrive = async () => {
    const folder = await window.electronAPI.selectFolder()
    if (!folder) return
    const r = await window.electronAPI.setManagerPaths({ serverPath: folder })
    if (!r.success) {
      setError(r.error || 'Could not save the new server path.')
    }
    // Relaunch on success.
  }

  // ─────────────────────────────────────────────────────────────────────
  // Renderers
  // ─────────────────────────────────────────────────────────────────────

  const installing = phase === 'installing-steam' || phase === 'installing-pz'
  const fullyInstalled = status.steamcmd && status.pzServer && phase === 'idle'

  // Compact "installed" view — what the tab shows once the server is set up.
  if (fullyInstalled) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center">
            <Check size={20} className="text-green-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Server installed</h2>
            <p className="text-sm text-[#a0a0a0]">Everything's in place — head to the Dashboard to start the server.</p>
          </div>
        </div>

        <div className="card space-y-3">
          <div className="flex items-start gap-3">
            <Server size={18} className="text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[#a0a0a0]">PZ server install</p>
              <p className="font-mono text-sm break-all">{paths?.serverPath || status.serverPath || '—'}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <FolderOpen size={18} className="text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[#a0a0a0]">Manager data</p>
              <p className="font-mono text-sm break-all">{paths?.basePath || '—'}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <FolderOpen size={18} className="text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[#a0a0a0]">Zomboid user folder</p>
              <p className="font-mono text-sm break-all">{paths?.zomboidPath || '—'}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigate('/')}
            className="btn-primary flex items-center gap-2"
          >
            Go to Dashboard <ArrowRight size={16} />
          </button>
          <button
            onClick={moveToDifferentDrive}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <HardDrive size={14} /> Move to a different drive
          </button>
          <button
            onClick={startReinstall}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} /> Reinstall / repair
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}
      </div>
    )
  }

  // Mid-install view: combined progress bar + live log tail.
  if (installing) {
    return (
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <Loader size={22} className="animate-spin text-amber-400" />
          <div>
            <h2 className="text-xl font-semibold">Setting up your server</h2>
            <p className="text-sm text-[#a0a0a0]">Sit tight — this can take several minutes on a slower connection.</p>
          </div>
        </div>

        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${phase === 'installing-steam' ? 'bg-amber-400 animate-pulse' : 'bg-green-500'}`} />
            <span className={`text-sm ${phase === 'installing-steam' ? 'text-white' : 'text-[#a0a0a0]'}`}>SteamCMD</span>
            {phase !== 'installing-steam' && <Check size={14} className="text-green-500" />}
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${phase === 'installing-pz' ? 'bg-amber-400 animate-pulse' : 'bg-[#444]'}`} />
            <span className={`text-sm ${phase === 'installing-pz' ? 'text-white' : 'text-[#a0a0a0]'}`}>Project Zomboid Dedicated Server</span>
          </div>
          {progressLabel && (
            <p className="text-xs text-[#888] font-mono pt-2 border-t border-[#222]">{progressLabel}</p>
          )}
        </div>

        <div className="card">
          <h3 className="font-semibold mb-2 text-sm">Live install log</h3>
          <div className="bg-[#0f0f0f] rounded-md p-3 h-64 overflow-y-auto font-mono text-xs space-y-1">
            {logs.length === 0
              ? <p className="text-[#666] italic">Waiting for output…</p>
              : logs.slice(-100).map((line, i) => (
                  <div key={i} className="text-[#a0a0a0] truncate">{line}</div>
                ))
            }
          </div>
        </div>
      </div>
    )
  }

  // Just-finished view (covers the case where the user kicked off install and
  // it succeeded; before refresh ticks `fullyInstalled` true).
  if (phase === 'done') {
    return (
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center">
            <Check size={20} className="text-green-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">All set</h2>
            <p className="text-sm text-[#a0a0a0]">SteamCMD and the PZ Dedicated Server are installed and ready.</p>
          </div>
        </div>

        <div className="card text-sm space-y-1">
          <p className="text-[#a0a0a0]">Installed at:</p>
          <p className="font-mono text-xs break-all">{paths?.serverPath || status.serverPath}</p>
        </div>

        <button
          onClick={() => navigate('/')}
          className="btn-primary flex items-center gap-2"
        >
          Go to Dashboard <ArrowRight size={16} />
        </button>
      </div>
    )
  }

  // Wizard step 2 — confirm install location for a fresh install.
  if (phase === 'configure-fresh') {
    return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <button
            onClick={() => setPhase('choose')}
            className="text-xs text-[#888] hover:text-white mb-2 flex items-center gap-1"
          >
            <ChevronRight size={12} className="rotate-180" /> Back
          </button>
          <h2 className="text-xl font-semibold">Where should we install?</h2>
          <p className="text-sm text-[#a0a0a0] mt-1">
            We'll install SteamCMD and the dedicated server into the same data folder by default.
            You can split the paths later if you need to.
          </p>
        </div>

        <div className="card space-y-2">
          <label className="block text-sm font-medium">Manager data folder</label>
          <p className="text-xs text-[#888]">Holds SteamCMD, the dedicated server files, mod cache, and backups.</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={effectivePath('basePath')}
              readOnly
              className="input flex-1 font-mono text-xs"
            />
            <button
              onClick={() => handlePickPath('basePath')}
              className="btn-secondary text-xs flex items-center gap-2"
            >
              <FolderOpen size={14} /> Browse…
            </button>
          </div>
          <p className="text-xs text-[#666] mt-1">
            <span className="text-[#888]">Server folder will be:</span>{' '}
            <span className="font-mono">{effectivePath('serverPath')}</span>
          </p>
        </div>

        {/* Advanced — exposes the 3 separate path knobs. */}
        <div className="card">
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="w-full flex items-center justify-between text-left text-sm"
          >
            <span className="font-medium flex items-center gap-2">
              <Wand2 size={14} className="text-purple-400" /> Advanced paths
            </span>
            {showAdvanced ? <ChevronDown size={14} className="text-[#666]" /> : <ChevronRight size={14} className="text-[#666]" />}
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-3">
              {([
                { key: 'serverPath' as const, label: 'PZ server install folder', help: 'Where the dedicated server (.bat / .exe) lives.' },
                { key: 'zomboidPath' as const, label: 'Zomboid user folder', help: 'PZ user data: servertest.ini, sandbox vars, saves.' },
              ]).map((row) => (
                <div key={row.key}>
                  <label className="block text-sm font-medium">{row.label}</label>
                  <p className="text-xs text-[#888] mb-1">{row.help}</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={effectivePath(row.key)}
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
              ))}
            </div>
          )}
        </div>

        {(error || pathsError) && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-center gap-2">
            <AlertCircle size={14} /> {error || pathsError}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={runFreshInstall}
            disabled={applyingPaths}
            className="btn-primary flex items-center gap-2"
          >
            <Download size={16} />
            {applyingPaths ? 'Saving paths…' : 'Install now'}
          </button>
          <button
            onClick={() => { setPhase('choose'); setPathsDirty({}) }}
            className="btn-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // Wizard step 1 — choose: fresh vs existing.
  if (phase === 'choose') {
    return (
      <div className="space-y-6 max-w-3xl">
        <div>
          <h2 className="text-xl font-semibold">Set up your server</h2>
          <p className="text-sm text-[#a0a0a0] mt-1">Pick how you want to get going.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => setPhase('configure-fresh')}
            className="card text-left hover:border-green-500/50 hover:bg-green-500/5 transition-colors"
          >
            <Sparkles size={22} className="text-green-400 mb-3" />
            <h3 className="font-semibold mb-1">Fresh install</h3>
            <p className="text-sm text-[#a0a0a0]">
              The manager downloads SteamCMD and the Project Zomboid Dedicated Server for you. Roughly 2–3 GB.
            </p>
            <p className="text-xs text-[#666] mt-3">Recommended if this is your first time.</p>
          </button>

          <button
            onClick={useExistingFolder}
            className="card text-left hover:border-blue-500/50 hover:bg-blue-500/5 transition-colors"
          >
            <HardDrive size={22} className="text-blue-400 mb-3" />
            <h3 className="font-semibold mb-1">I already have one</h3>
            <p className="text-sm text-[#a0a0a0]">
              Point at an existing dedicated server folder — installed via Steam, copied from another machine, or moved to a new drive.
            </p>
            <p className="text-xs text-[#666] mt-3">No files get moved or copied; the manager just registers the location.</p>
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <button
          onClick={() => setPhase('idle')}
          className="text-xs text-[#888] hover:text-white"
        >
          Cancel
        </button>
      </div>
    )
  }

  // Default landing — `idle`. Big "Set up Server" button + auto-scan banner.
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold">Server Installation</h2>
        <p className="text-sm text-[#a0a0a0] mt-1">
          One-click setup for the Project Zomboid Build 42 Dedicated Server. You must own Project Zomboid on Steam — the dedicated server itself downloads anonymously.
        </p>
      </div>

      {/* Auto-scan banner — shown when we found existing installs in Steam libraries. */}
      {scanCandidates.length > 0 && (
        <div className="card border-blue-500/40 bg-blue-500/5">
          <div className="flex items-start gap-3">
            <HardDrive size={20} className="text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm">
                Found {scanCandidates.length === 1 ? 'an existing install' : `${scanCandidates.length} existing installs`}
              </h3>
              <p className="text-xs text-[#a0a0a0] mt-1">
                Use one of these instead of redownloading {scanCandidates.length === 1 ? 'it' : 'them'}.
              </p>
              <div className="mt-3 space-y-2">
                {scanCandidates.map((c) => (
                  <div key={c.path} className="flex items-center justify-between gap-3 bg-[#1a1a1a] border border-[#333] rounded-md px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs text-[#888]">{c.source}</p>
                      <p className="font-mono text-xs text-[#d0d0d0] truncate">{c.path}</p>
                    </div>
                    <button
                      onClick={() => useScanCandidate(c)}
                      className="btn-primary text-xs shrink-0"
                    >
                      Use this
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Big primary CTA. */}
      <div className="card">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center shrink-0">
            <Sparkles size={22} className="text-green-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg">Set up server</h3>
            <p className="text-sm text-[#a0a0a0] mt-1">
              We'll fetch SteamCMD, then download the dedicated server (~2–3 GB) — no manual steps.
            </p>
            <button
              onClick={() => setPhase('choose')}
              className="btn-primary mt-4 flex items-center gap-2"
            >
              <Download size={16} /> Get started <ChevronRight size={16} />
            </button>
            {scanning && (
              <p className="text-xs text-[#666] mt-3 flex items-center gap-1">
                <RotateCw size={11} className="animate-spin" /> Scanning Steam libraries for an existing install…
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Status row — shows current state without bombarding with cards. */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="card flex items-center gap-2">
          {status.steamcmd
            ? <Check size={16} className="text-green-500" />
            : <span className="w-2 h-2 rounded-full bg-[#555]" />}
          <span className={status.steamcmd ? 'text-[#d0d0d0]' : 'text-[#888]'}>
            SteamCMD {status.steamcmd ? 'installed' : 'not installed'}
          </span>
        </div>
        <div className="card flex items-center gap-2">
          {status.pzServer
            ? <Check size={16} className="text-green-500" />
            : <span className="w-2 h-2 rounded-full bg-[#555]" />}
          <span className={status.pzServer ? 'text-[#d0d0d0]' : 'text-[#888]'}>
            PZ Dedicated Server {status.pzServer ? 'installed' : 'not installed'}
          </span>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}
    </div>
  )
}
