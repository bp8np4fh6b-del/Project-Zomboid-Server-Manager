import { useState, useEffect, useRef, useCallback } from 'react'
import { Package, Plus, Trash2, Globe, Download, RefreshCw, ExternalLink, AlertCircle, CheckCircle2, Wrench, X, ListPlus } from 'lucide-react'
import type { ModItem, WorkshopItemInfo, ModsProgressEvent } from '../types'

function formatBytes(bytes?: number) {
  if (!bytes && bytes !== 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

function formatTimeAgo(unixSec?: number) {
  if (!unixSec) return '—'
  const ms = Date.now() - unixSec * 1000
  const days = Math.floor(ms / 86400000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}

// Extract every workshop ID from a paste blob. Accepts URLs, bare numeric IDs,
// and any combination separated by whitespace, commas, or semicolons. Dedupes.
function extractIds(input: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const push = (id: string) => {
    if (!seen.has(id)) { seen.add(id); ids.push(id) }
  }
  const idEqRegex = /[?&]id=(\d{6,12})/g
  let m: RegExpExecArray | null
  while ((m = idEqRegex.exec(input)) !== null) push(m[1])
  for (const tok of input.split(/[\s,;]+/)) {
    const t = tok.trim()
    if (/^\d{6,12}$/.test(t)) push(t)
  }
  return ids
}

type QueueStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

interface QueueItem {
  workshopId: string
  title?: string
  status: QueueStatus
  error?: string
}

export default function Mods() {
  const [mods, setMods] = useState<ModItem[]>([])
  const [needsRedetect, setNeedsRedetect] = useState(false)
  const [pasteValue, setPasteValue] = useState('')

  // Single-item preview (only shown when paste resolves to exactly one ID).
  const [preview, setPreview] = useState<WorkshopItemInfo | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [progress, setProgress] = useState<ModsProgressEvent | null>(null)

  const [updates, setUpdates] = useState<Record<string, WorkshopItemInfo>>({})
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)

  const [redetecting, setRedetecting] = useState(false)
  const [redetectMessage, setRedetectMessage] = useState<string | null>(null)

  // Queue state. We auto-process pending items one at a time.
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [processing, setProcessing] = useState(false)
  // Latest queue/mods refs so the auto-processor can read them without
  // restarting every state change.
  const queueRef = useRef<QueueItem[]>(queue)
  const modsRef = useRef<ModItem[]>(mods)
  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => { modsRef.current = mods }, [mods])

  const parsedIds = extractIds(pasteValue)

  useEffect(() => { refresh() }, [])

  // Stream progress events from the backend (download + scan + sync).
  useEffect(() => {
    const unsub = window.electronAPI.onModsProgress((data) => {
      setProgress(data)
    })
    return unsub
  }, [])

  async function refresh() {
    const result = await window.electronAPI.getMods()
    if (result?.success && Array.isArray(result.mods)) {
      setMods(result.mods)
      setNeedsRedetect(!!result.needsRedetect)
    } else {
      setMods([])
      setNeedsRedetect(false)
    }
  }

  // Single-id preview lookup (only when the paste resolves to exactly one ID).
  useEffect(() => {
    if (parsedIds.length !== 1) {
      setPreview(null)
      setPreviewError(null)
      return
    }
    const id = parsedIds[0]
    const t = setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError(null)
      const res = await window.electronAPI.workshopLookup(id)
      setPreviewLoading(false)
      if (res.success && res.item) {
        setPreview(res.item)
        if (!res.item.isForPZ) {
          setPreviewError('This workshop item is not for Project Zomboid (consumer_app_id mismatch).')
        }
      } else {
        setPreview(null)
        setPreviewError(res.error || 'Lookup failed.')
      }
    }, 400)
    return () => clearTimeout(t)
    // parsedIds is derived from pasteValue — joining the array stabilises the dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedIds.join(',')])

  // Process the next pending queue item. Re-entrant-safe via the processing flag.
  const processNext = useCallback(async () => {
    if (processing) return
    const next = queueRef.current.find((q) => q.status === 'pending')
    if (!next) return

    setProcessing(true)
    setQueue((prev) => prev.map((q) => q.workshopId === next.workshopId ? { ...q, status: 'running' } : q))
    setProgress({ phase: 'starting', workshopId: next.workshopId, message: 'Starting…' })

    const res = await window.electronAPI.addMod({ workshopId: next.workshopId })

    setQueue((prev) => prev.map((q) => {
      if (q.workshopId !== next.workshopId) return q
      return res.success
        ? { ...q, status: 'done', title: res.entry?.title || q.title }
        : { ...q, status: 'failed', error: res.error || 'Unknown error' }
    }))
    setProgress(null)
    setProcessing(false)
    refresh()
  }, [processing])

  // Auto-kick the queue whenever items become pending and we're idle.
  useEffect(() => {
    if (processing) return
    if (queue.some((q) => q.status === 'pending')) {
      processNext()
    }
  }, [queue, processing, processNext])

  const enqueue = (ids: string[]) => {
    setQueue((prev) => {
      const existing = new Set(prev.map((q) => q.workshopId))
      const installed = new Set(modsRef.current.map((m) => m.workshopId))
      const additions: QueueItem[] = []
      for (const id of ids) {
        if (existing.has(id)) continue
        if (installed.has(id)) {
          additions.push({ workshopId: id, status: 'skipped', error: 'Already installed.' })
        } else {
          additions.push({ workshopId: id, status: 'pending' })
        }
      }
      return [...prev, ...additions]
    })
  }

  const handleEnqueueCurrent = () => {
    if (parsedIds.length === 0) return
    enqueue(parsedIds)
    setPasteValue('')
    setPreview(null)
  }

  const handleRemoveQueueItem = (workshopId: string) => {
    setQueue((prev) => prev.filter((q) => q.workshopId !== workshopId))
  }

  const handleClearFinished = () => {
    setQueue((prev) => prev.filter((q) => q.status === 'pending' || q.status === 'running'))
  }

  const handleRetryFailed = () => {
    setQueue((prev) => prev.map((q) => q.status === 'failed' ? { ...q, status: 'pending', error: undefined } : q))
  }

  const handleRemove = async (id: string) => {
    await window.electronAPI.removeMod(id)
    setUpdates((prev) => {
      const { [id]: _drop, ...rest } = prev
      return rest
    })
    refresh()
  }

  const handleRedetectOne = async (workshopId: string) => {
    setRedetecting(true)
    setRedetectMessage(null)
    setProgress({ phase: 'starting', workshopId, message: 'Starting…' })
    const res = await window.electronAPI.redetectMod(workshopId)
    setRedetecting(false)
    if (!res.success) setRedetectMessage(`Re-detect failed: ${res.error || 'unknown error'}`)
    else setProgress(null)
    refresh()
  }

  const handleRedetectAll = async () => {
    setRedetecting(true)
    setRedetectMessage(null)
    const res = await window.electronAPI.redetectAllMissing()
    setRedetecting(false)
    setProgress(null)
    if (res.success) {
      setRedetectMessage(`Re-detected ${res.redetected ?? 0} of ${res.total ?? 0} mod${(res.total ?? 0) === 1 ? '' : 's'}.`)
    } else if (res.errors && res.errors.length) {
      setRedetectMessage(`Some items failed: ${res.errors.join('; ')}`)
    } else {
      setRedetectMessage(`Re-detect failed: ${res.error || 'unknown error'}`)
    }
    refresh()
  }

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true)
    setUpdateMessage(null)
    const res = await window.electronAPI.checkModUpdates()
    setCheckingUpdates(false)
    if (res.success) {
      const map: Record<string, WorkshopItemInfo> = {}
      for (const item of res.items) map[item.id] = item
      setUpdates(map)
      const updateCount = res.items.filter((i) => i.updateAvailable).length
      setUpdateMessage(
        updateCount > 0
          ? `${updateCount} mod${updateCount === 1 ? '' : 's'} have updates available. Restart the server to apply.`
          : `All ${res.items.length} mod${res.items.length === 1 ? '' : 's'} are up to date.`
      )
      setMods((prev) => prev.map((m) => {
        const info = map[m.workshopId]
        if (info?.title) return { ...m, name: info.title }
        return m
      }))
    } else {
      setUpdateMessage(`Error: ${res.error || 'Could not check for updates.'}`)
    }
  }

  const updatesAvailable = Object.values(updates).filter((i) => i.updateAvailable).length

  const queuePending = queue.filter((q) => q.status === 'pending').length
  const queueRunning = queue.filter((q) => q.status === 'running').length
  const queueDone = queue.filter((q) => q.status === 'done').length
  const queueFailed = queue.filter((q) => q.status === 'failed').length

  // Whether the current paste maps to a single addable item.
  const singleReady = parsedIds.length === 1 && preview && preview.isForPZ
  const alreadyHandled = (id: string) =>
    mods.some((m) => m.workshopId === id) || queue.some((q) => q.workshopId === id)

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Package size={20} />
            Workshop Mods
          </h2>
          <p className="text-sm text-[#a0a0a0] mt-1">
            Paste one or many Steam Workshop URLs / IDs. The manager downloads each via SteamCMD, reads mod.info, and writes the correct Mod IDs to your server config automatically.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCheckUpdates}
            disabled={checkingUpdates || mods.length === 0}
            className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-40"
          >
            <RefreshCw size={14} className={checkingUpdates ? 'animate-spin' : ''} />
            {checkingUpdates ? 'Checking...' : 'Check for Updates'}
          </button>
          <button
            onClick={() => window.electronAPI.openExternal('https://steamcommunity.com/workshop/browse/?appid=108600')}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <Globe size={14} />
            Browse Workshop
          </button>
        </div>
      </div>

      {updateMessage && (
        <div className={`card text-sm ${updatesAvailable > 0 ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-green-500/30 bg-green-500/10 text-green-400'}`}>
          <div className="flex items-center gap-2">
            {updatesAvailable > 0 ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            {updateMessage}
          </div>
        </div>
      )}

      {needsRedetect && (
        <div className="card border-amber-500/30 bg-amber-500/10 text-amber-400">
          <div className="flex items-start gap-3">
            <Wrench size={16} className="mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium">Mod IDs need re-detection</p>
              <p className="text-xs text-amber-300/80 mt-1">
                Some installed workshop items don't have their real Mod IDs detected yet. The server can't load them until this is fixed. Click below to download each item with SteamCMD and read its mod.info.
              </p>
              {redetectMessage && <p className="text-xs text-amber-300 mt-2">{redetectMessage}</p>}
              <button
                onClick={handleRedetectAll}
                disabled={redetecting}
                className="btn-secondary mt-3 flex items-center gap-2 text-xs disabled:opacity-40"
              >
                <RefreshCw size={12} className={redetecting ? 'animate-spin' : ''} />
                {redetecting ? 'Re-detecting…' : 'Re-detect missing Mod IDs'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paste box (single OR many) */}
      <div className="card">
        <h3 className="font-semibold mb-3">Add Mods</h3>
        <div className="space-y-3">
          <textarea
            placeholder={'Paste one or more Steam Workshop URLs or IDs.\nOne per line, or separated by spaces / commas.\n\ne.g.\nhttps://steamcommunity.com/sharedfiles/filedetails/?id=2392709985\n2613146550\n2566953935'}
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            rows={4}
            className="input w-full font-mono text-xs"
          />

          {/* Multi-paste summary */}
          {parsedIds.length > 1 && (
            <div className="bg-[#222] border border-[#333] rounded-md p-3 space-y-2">
              <p className="text-sm">
                <span className="font-semibold">{parsedIds.length}</span> workshop items detected
              </p>
              <p className="text-xs text-[#a0a0a0]">
                Already installed or queued items will be skipped. The queue auto-processes one at a time.
              </p>
              <div className="flex flex-wrap gap-1">
                {parsedIds.slice(0, 12).map((id) => (
                  <span
                    key={id}
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${alreadyHandled(id) ? 'bg-[#333] text-[#666] line-through' : 'bg-blue-500/15 text-blue-300'}`}
                  >
                    {id}
                  </span>
                ))}
                {parsedIds.length > 12 && (
                  <span className="text-[10px] px-1.5 py-0.5 text-[#666]">+{parsedIds.length - 12} more</span>
                )}
              </div>
              <button
                onClick={handleEnqueueCurrent}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                <ListPlus size={14} />
                Add {parsedIds.length} items to queue
              </button>
            </div>
          )}

          {/* Single-id preview */}
          {parsedIds.length === 1 && previewLoading && (
            <p className="text-sm text-[#666] italic flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin" /> Looking up…
            </p>
          )}

          {parsedIds.length === 1 && previewError && !previewLoading && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-center gap-2">
              <AlertCircle size={16} />
              {previewError}
            </div>
          )}

          {parsedIds.length === 1 && preview && !previewLoading && (
            <div className="bg-[#222] border border-[#333] rounded-md p-3 flex gap-3">
              {preview.previewUrl && (
                <img
                  src={preview.previewUrl}
                  alt=""
                  className="w-24 h-24 object-cover rounded-md bg-[#111]"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-semibold truncate">{preview.title || `Workshop Item ${preview.id}`}</h4>
                  <button
                    onClick={() => window.electronAPI.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${preview.id}`)}
                    className="text-[#666] hover:text-white"
                    title="Open on Workshop"
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-x-4 text-xs text-[#a0a0a0] mt-1">
                  <span>Workshop ID: <code>{preview.id}</code></span>
                  <span>Size: {formatBytes(preview.fileSize)}</span>
                  <span>Updated: {formatTimeAgo(preview.timeUpdated)}</span>
                </div>
                {preview.description && (
                  <p className="text-xs text-[#888] mt-2 line-clamp-3 whitespace-pre-wrap">
                    {preview.description.slice(0, 280)}{preview.description.length > 280 ? '…' : ''}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={handleEnqueueCurrent}
                    disabled={!singleReady || alreadyHandled(preview.id)}
                    className="btn-primary flex items-center gap-2 text-sm"
                  >
                    <Plus size={14} />
                    {alreadyHandled(preview.id) ? 'Already Added' : 'Add to Queue'}
                  </button>
                  {!preview.isForPZ && preview.appId && (
                    <span className="text-xs text-amber-400 self-center">
                      ⚠ App ID {preview.appId} (not PZ — won't load)
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Queue panel */}
      {queue.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Download size={16} />
              Download Queue
            </h3>
            <div className="text-xs text-[#a0a0a0] flex items-center gap-3">
              {queueRunning > 0 && <span className="flex items-center gap-1 text-blue-400"><RefreshCw size={12} className="animate-spin" /> {queueRunning} running</span>}
              {queuePending > 0 && <span>{queuePending} pending</span>}
              {queueDone > 0 && <span className="text-green-400">{queueDone} done</span>}
              {queueFailed > 0 && <span className="text-red-400">{queueFailed} failed</span>}
            </div>
          </div>

          <div className="space-y-1 max-h-72 overflow-auto">
            {queue.map((item) => {
              const tone =
                item.status === 'running' ? 'bg-blue-500/10 border-blue-500/30' :
                item.status === 'done' ? 'bg-green-500/10 border-green-500/30' :
                item.status === 'failed' ? 'bg-red-500/10 border-red-500/30' :
                item.status === 'skipped' ? 'bg-[#1a1a1a] border-[#333] opacity-60' :
                'bg-[#222] border-[#333]'
              return (
                <div key={item.workshopId} className={`flex items-center justify-between rounded-md px-3 py-2 border text-sm ${tone}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    {item.status === 'running' && <RefreshCw size={14} className="animate-spin text-blue-400 shrink-0" />}
                    {item.status === 'done' && <CheckCircle2 size={14} className="text-green-400 shrink-0" />}
                    {item.status === 'failed' && <AlertCircle size={14} className="text-red-400 shrink-0" />}
                    {item.status === 'pending' && <Download size={14} className="text-[#666] shrink-0" />}
                    {item.status === 'skipped' && <X size={14} className="text-[#666] shrink-0" />}
                    <div className="min-w-0">
                      <p className="truncate">
                        <span className="font-mono text-xs text-[#a0a0a0]">{item.workshopId}</span>
                        {item.title && <span className="ml-2">{item.title}</span>}
                      </p>
                      {item.status === 'running' && progress && progress.workshopId === item.workshopId && (
                        <p className="text-xs text-blue-300 truncate">{progress.message}</p>
                      )}
                      {item.status === 'failed' && item.error && (
                        <p className="text-xs text-red-400 break-words">{item.error}</p>
                      )}
                      {item.status === 'skipped' && item.error && (
                        <p className="text-xs text-[#666]">{item.error}</p>
                      )}
                    </div>
                  </div>
                  {(item.status === 'pending' || item.status === 'failed' || item.status === 'done' || item.status === 'skipped') && (
                    <button
                      onClick={() => handleRemoveQueueItem(item.workshopId)}
                      className="text-[#666] hover:text-white p-1 shrink-0"
                      title="Remove from queue"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex gap-2 mt-3">
            {queueFailed > 0 && (
              <button onClick={handleRetryFailed} className="btn-secondary text-xs flex items-center gap-2">
                <RefreshCw size={12} /> Retry failed ({queueFailed})
              </button>
            )}
            {(queueDone > 0 || queueFailed > 0 || queue.some((q) => q.status === 'skipped')) && (
              <button onClick={handleClearFinished} className="btn-secondary text-xs">Clear finished</button>
            )}
          </div>
        </div>
      )}

      {/* Mod list */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Installed Mods ({mods.length})</h3>
          {updatesAvailable > 0 && (
            <span className="text-xs text-amber-400 font-medium">
              {updatesAvailable} update{updatesAvailable === 1 ? '' : 's'} pending
            </span>
          )}
        </div>
        {mods.length === 0 ? (
          <p className="text-[#666] italic">No mods installed. Paste a Workshop URL above to add one.</p>
        ) : (
          <div className="space-y-2">
            {mods.map((mod) => {
              const info = updates[mod.workshopId]
              const hasUpdate = info?.updateAvailable
              const stub = mod.modIds.length === 0 || (mod.modIds.length === 1 && mod.modIds[0] === mod.workshopId)
              return (
                <div
                  key={mod.workshopId}
                  className={`flex items-center justify-between rounded-md px-3 py-2 border ${stub || hasUpdate ? 'bg-amber-500/10 border-amber-500/30' : 'bg-[#222] border-[#333]'}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Download size={16} className={stub || hasUpdate ? 'text-amber-400' : 'text-blue-400'} />
                    <div className="min-w-0">
                      <p className="font-medium text-sm flex items-center gap-2">
                        <span className="truncate">{info?.title || mod.name}</span>
                        {hasUpdate && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono">UPDATE</span>
                        )}
                      </p>
                      <p className="text-xs text-[#666] font-mono">
                        Workshop ID: {mod.workshopId}
                        {info?.timeUpdated && (
                          <span className="ml-3 text-[#888]">Updated {formatTimeAgo(info.timeUpdated)}</span>
                        )}
                        {info?.fileSize && (
                          <span className="ml-3 text-[#888]">{formatBytes(info.fileSize)}</span>
                        )}
                      </p>
                      {mod.modIds.length > 0 && !stub && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {mod.modIds.map((mid) => (
                            <span key={mid} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 font-mono">
                              {mid}
                            </span>
                          ))}
                        </div>
                      )}
                      {stub && (
                        <p className="text-xs text-amber-300 mt-1">
                          Mod ID not detected yet. Server can't load this until it's re-detected.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {stub && (
                      <button
                        onClick={() => handleRedetectOne(mod.workshopId)}
                        disabled={redetecting}
                        className="text-amber-400 hover:text-amber-300 p-1 disabled:opacity-40"
                        title="Re-detect mod IDs"
                      >
                        <Wrench size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => window.electronAPI.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`)}
                      className="text-[#666] hover:text-white p-1"
                      title="Open on Workshop"
                    >
                      <ExternalLink size={14} />
                    </button>
                    <button
                      onClick={() => handleRemove(mod.workshopId)}
                      className="text-red-500 hover:text-red-400 p-1"
                      title="Remove"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {redetecting && progress && (
          <div className="mt-3 bg-[#111] border border-[#333] rounded-md p-2 text-xs text-[#a0a0a0] flex items-center gap-2">
            <RefreshCw size={12} className="animate-spin" />
            <span className="truncate">{progress.message}</span>
          </div>
        )}
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3 text-sm text-amber-400">
        <strong>Note:</strong> Adding/removing/updating mods requires a server restart to take effect.
        Players must subscribe to the same mods on Steam Workshop before joining.
      </div>
    </div>
  )
}
