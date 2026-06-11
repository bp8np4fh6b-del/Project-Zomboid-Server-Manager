import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Package, Plus, Trash2, Globe, Download, RefreshCw, ExternalLink, AlertCircle,
  CheckCircle2, Wrench, X, ListPlus, Search, KeyRound, Layers, ThumbsUp, Users, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ModItem, WorkshopItemInfo, ModsProgressEvent, WorkshopSearchItem, InstalledModDetail } from '../types'

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

function formatCount(n?: number) {
  if (!n && n !== 0) return '—'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}K`
  return String(n)
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

type Tab = 'browse' | 'installed' | 'paste'
type SortKey = 'relevance' | 'popular' | 'trend' | 'recent'

const SORT_LABELS: Record<SortKey, string> = {
  relevance: 'Relevance',
  popular: 'Most subscribed',
  trend: 'Trending',
  recent: 'Newest',
}

export default function Mods() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('browse')

  const [mods, setMods] = useState<InstalledModDetail[]>([])
  const [needsRedetect, setNeedsRedetect] = useState(false)
  const [pasteValue, setPasteValue] = useState('')

  const [progress, setProgress] = useState<ModsProgressEvent | null>(null)

  const [updates, setUpdates] = useState<Record<string, WorkshopItemInfo>>({})
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updateMessage, setUpdateMessage] = useState<string | null>(null)
  const [updatingAll, setUpdatingAll] = useState(false)

  const [redetecting, setRedetecting] = useState(false)
  const [redetectMessage, setRedetectMessage] = useState<string | null>(null)

  // Browse (workshop search)
  const [searchText, setSearchText] = useState('')
  const [searchSort, setSearchSort] = useState<SortKey>('relevance')
  const [searchPage, setSearchPage] = useState(1)
  const [searchResults, setSearchResults] = useState<WorkshopSearchItem[]>([])
  const [searchTotal, setSearchTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [needsKey, setNeedsKey] = useState(false)
  const [searched, setSearched] = useState(false)

  // Collection resolver
  const [collectionInput, setCollectionInput] = useState('')
  const [collection, setCollection] = useState<{ id: string; title: string } | null>(null)
  const [collectionItems, setCollectionItems] = useState<WorkshopSearchItem[]>([])
  const [collectionLoading, setCollectionLoading] = useState(false)
  const [collectionError, setCollectionError] = useState<string | null>(null)

  // Queue state. We auto-process pending items one at a time.
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [processing, setProcessing] = useState(false)
  const queueRef = useRef<QueueItem[]>(queue)
  const modsRef = useRef<ModItem[]>(mods)
  useEffect(() => { queueRef.current = queue }, [queue])
  useEffect(() => { modsRef.current = mods }, [mods])

  const parsedIds = extractIds(pasteValue)

  useEffect(() => { refresh() }, [])

  useEffect(() => {
    const unsub = window.electronAPI.onModsProgress((data) => {
      setProgress(data)
    })
    return unsub
  }, [])

  async function refresh() {
    const result = await window.electronAPI.getInstalledModsDetails()
    if (result?.success && Array.isArray(result.mods)) {
      setMods(result.mods)
      setNeedsRedetect(!!result.needsRedetect)
    } else {
      setMods([])
      setNeedsRedetect(false)
    }
  }

  // ── Workshop search ────────────────────────────────────────────

  const runSearch = useCallback(async (page = 1) => {
    setSearching(true)
    setSearchError(null)
    setNeedsKey(false)
    const r = await window.electronAPI.workshopSearch({ query: searchText, sort: searchSort, page })
    setSearching(false)
    setSearched(true)
    if (r?.success) {
      setSearchResults(r.items)
      setSearchTotal(r.total)
      setSearchPage(page)
    } else {
      setSearchResults([])
      setSearchTotal(0)
      if (r?.needsKey) setNeedsKey(true)
      setSearchError(r?.error || 'Search failed.')
    }
  }, [searchText, searchSort])

  // Load a default "most popular" listing when the Browse tab first opens.
  useEffect(() => {
    if (tab === 'browse' && !searched && !searching) {
      runSearch(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // ── Queue ──────────────────────────────────────────────────────

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

  useEffect(() => {
    if (processing) return
    if (queue.some((q) => q.status === 'pending')) {
      processNext()
    }
  }, [queue, processing, processNext])

  const enqueue = (ids: string[], titles?: Record<string, string>) => {
    setQueue((prev) => {
      const existing = new Set(prev.map((q) => q.workshopId))
      const installed = new Set(modsRef.current.map((m) => m.workshopId))
      const additions: QueueItem[] = []
      for (const id of ids) {
        if (existing.has(id)) continue
        if (installed.has(id)) {
          additions.push({ workshopId: id, title: titles?.[id], status: 'skipped', error: 'Already installed.' })
        } else {
          additions.push({ workshopId: id, title: titles?.[id], status: 'pending' })
        }
      }
      return [...prev, ...additions]
    })
  }

  const isQueuedOrInstalled = (id: string) =>
    mods.some((m) => m.workshopId === id) ||
    queue.some((q) => q.workshopId === id && (q.status === 'pending' || q.status === 'running' || q.status === 'done'))

  const handleEnqueuePaste = () => {
    if (parsedIds.length === 0) return
    enqueue(parsedIds)
    setPasteValue('')
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

  // ── Installed actions ──────────────────────────────────────────

  const handleRemove = async (id: string) => {
    if (!confirm('Remove this mod? Its WorkshopItems/Mods lines are cleaned from the INI and the downloaded files are deleted from disk.')) return
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
          ? `${updateCount} mod${updateCount === 1 ? '' : 's'} have updates available.`
          : `All ${res.items.length} mod${res.items.length === 1 ? '' : 's'} are up to date.`
      )
    } else {
      setUpdateMessage(`Error: ${res.error || 'Could not check for updates.'}`)
    }
  }

  // Re-download every mod with a pending update (SteamCMD pulls the newest
  // content; manifest + INI re-sync along the way).
  const handleUpdateAll = async () => {
    const targets = Object.values(updates).filter((i) => i.updateAvailable).map((i) => i.id)
    if (targets.length === 0) return
    setUpdatingAll(true)
    for (const id of targets) {
      setProgress({ phase: 'starting', workshopId: id, message: `Updating ${id}…` })
      await window.electronAPI.redetectMod(id)
    }
    setProgress(null)
    setUpdatingAll(false)
    setUpdateMessage(`Updated ${targets.length} mod${targets.length === 1 ? '' : 's'}. Restart the server to apply.`)
    setUpdates((prev) => {
      const next: Record<string, WorkshopItemInfo> = {}
      for (const [k, v] of Object.entries(prev)) next[k] = { ...v, updateAvailable: false }
      return next
    })
    refresh()
  }

  // ── Collections ────────────────────────────────────────────────

  const handleResolveCollection = async () => {
    if (!collectionInput.trim()) return
    setCollectionLoading(true)
    setCollectionError(null)
    setCollection(null)
    setCollectionItems([])
    const r = await window.electronAPI.workshopGetCollection(collectionInput.trim())
    setCollectionLoading(false)
    if (r?.success && r.collection && r.items) {
      setCollection(r.collection)
      setCollectionItems(r.items)
    } else {
      setCollectionError(r?.error || 'Could not resolve that collection.')
    }
  }

  const handleInstallCollection = () => {
    const titles: Record<string, string> = {}
    for (const it of collectionItems) if (it.title) titles[it.id] = it.title
    enqueue(collectionItems.map((i) => i.id), titles)
  }

  // ── Derived ────────────────────────────────────────────────────

  const updatesAvailable = Object.values(updates).filter((i) => i.updateAvailable).length
  const queuePending = queue.filter((q) => q.status === 'pending').length
  const queueRunning = queue.filter((q) => q.status === 'running').length
  const queueDone = queue.filter((q) => q.status === 'done').length
  const queueFailed = queue.filter((q) => q.status === 'failed').length
  const totalPages = Math.max(1, Math.ceil(Math.min(searchTotal, 1000) / 20))

  // Shared "Install" button for browse/collection cards.
  const InstallButton = ({ item }: { item: WorkshopSearchItem }) => {
    const added = isQueuedOrInstalled(item.id)
    return (
      <button
        onClick={() => enqueue([item.id], item.title ? { [item.id]: item.title } : undefined)}
        disabled={added}
        className={`text-xs px-3 py-1.5 rounded font-medium flex items-center gap-1.5 shrink-0 ${
          added
            ? 'bg-[#2a2a2a] text-[#666] cursor-default'
            : 'bg-accent-green/20 text-accent-green hover:bg-accent-green/30'
        }`}
      >
        {added ? <CheckCircle2 size={12} /> : <Plus size={12} />}
        {added ? 'Added' : 'Install'}
      </button>
    )
  }

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Package size={20} />
            Workshop Mods
          </h2>
          <p className="text-sm text-[#a0a0a0] mt-1">
            Search the Steam Workshop, install with one click, and the manager handles SteamCMD downloads and Mod ID detection automatically.
          </p>
        </div>
        <button
          onClick={() => window.electronAPI.openExternal('https://steamcommunity.com/workshop/browse/?appid=108600')}
          className="btn-secondary flex items-center gap-2 text-sm"
        >
          <Globe size={14} />
          Open Workshop site
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex bg-[#222] rounded-md p-0.5 w-fit">
        <button
          onClick={() => setTab('browse')}
          className={`px-4 py-1.5 rounded text-sm flex items-center gap-2 ${tab === 'browse' ? 'bg-[#333] text-white' : 'text-[#a0a0a0]'}`}
        >
          <Search size={14} /> Browse
        </button>
        <button
          onClick={() => setTab('installed')}
          className={`px-4 py-1.5 rounded text-sm flex items-center gap-2 ${tab === 'installed' ? 'bg-[#333] text-white' : 'text-[#a0a0a0]'}`}
        >
          <Download size={14} /> Installed ({mods.length})
        </button>
        <button
          onClick={() => setTab('paste')}
          className={`px-4 py-1.5 rounded text-sm flex items-center gap-2 ${tab === 'paste' ? 'bg-[#333] text-white' : 'text-[#a0a0a0]'}`}
        >
          <Layers size={14} /> Paste / Collections
        </button>
      </div>

      {/* Queue panel — visible from any tab while active */}
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

          <div className="space-y-1 max-h-60 overflow-auto">
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
                  {item.status !== 'running' && (
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

      {/* ── BROWSE TAB ─────────────────────────────────────────── */}
      {tab === 'browse' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666]" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch(1) }}
                placeholder="Search the Project Zomboid Workshop…"
                className="input w-full pl-9"
              />
            </div>
            <select
              value={searchSort}
              onChange={(e) => setSearchSort(e.target.value as SortKey)}
              className="input text-sm"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>{SORT_LABELS[k]}</option>
              ))}
            </select>
            <button
              onClick={() => runSearch(1)}
              disabled={searching}
              className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
            >
              {searching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
              Search
            </button>
          </div>

          {needsKey && (
            <div className="card border-amber-500/30 bg-amber-500/5">
              <div className="flex items-start gap-3">
                <KeyRound size={18} className="text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-300">Workshop search needs a Steam Web API key</p>
                  <p className="text-xs text-[#a0a0a0] mt-1">
                    Add a free key in Settings → App to enable in-app search. Until then you can still install
                    mods from the Paste / Collections tab.
                  </p>
                  <button onClick={() => navigate('/settings')} className="btn-secondary text-xs mt-2">
                    Open Settings
                  </button>
                </div>
              </div>
            </div>
          )}

          {searchError && !needsKey && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-center gap-2">
              <AlertCircle size={14} /> {searchError}
            </div>
          )}

          {!needsKey && !searchError && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {searchResults.map((item) => (
                  <div key={item.id} className="card flex gap-3 !p-3">
                    {item.previewUrl ? (
                      <img
                        src={item.previewUrl}
                        alt=""
                        loading="lazy"
                        className="w-20 h-20 object-cover rounded-md bg-[#111] shrink-0"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-md bg-[#111] flex items-center justify-center shrink-0">
                        <Package size={22} className="text-[#444]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-medium text-sm leading-tight line-clamp-2">{item.title || `Workshop ${item.id}`}</h4>
                        <button
                          onClick={() => window.electronAPI.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${item.id}`)}
                          className="text-[#555] hover:text-white shrink-0"
                          title="Open on Workshop"
                        >
                          <ExternalLink size={13} />
                        </button>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-[#888] mt-1">
                        <span className="flex items-center gap-1" title="Subscribers"><Users size={11} /> {formatCount(item.subscriptions)}</span>
                        {typeof item.votesUp === 'number' && (
                          <span className="flex items-center gap-1" title="Upvotes"><ThumbsUp size={11} /> {formatCount(item.votesUp)}</span>
                        )}
                        <span title="Last updated">{formatTimeAgo(item.timeUpdated)}</span>
                        {item.fileSize ? <span>{formatBytes(item.fileSize)}</span> : null}
                      </div>
                      {item.description && (
                        <p className="text-[11px] text-[#777] mt-1 line-clamp-2">{item.description}</p>
                      )}
                      <div className="mt-auto pt-2">
                        <InstallButton item={item} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {searching && searchResults.length === 0 && (
                <p className="text-sm text-[#666] italic flex items-center gap-2">
                  <RefreshCw size={14} className="animate-spin" /> Searching…
                </p>
              )}

              {!searching && searched && searchResults.length === 0 && (
                <p className="text-sm text-[#666] italic">No results. Try a different search.</p>
              )}

              {searchResults.length > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-[#666]">{formatCount(searchTotal)} results · page {searchPage} of {totalPages}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => runSearch(searchPage - 1)}
                      disabled={searching || searchPage <= 1}
                      className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-30"
                    >
                      <ChevronLeft size={12} /> Prev
                    </button>
                    <button
                      onClick={() => runSearch(searchPage + 1)}
                      disabled={searching || searchPage >= totalPages}
                      className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-30"
                    >
                      Next <ChevronRight size={12} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── INSTALLED TAB ──────────────────────────────────────── */}
      {tab === 'installed' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button
                onClick={handleCheckUpdates}
                disabled={checkingUpdates || updatingAll || mods.length === 0}
                className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-40"
              >
                <RefreshCw size={14} className={checkingUpdates ? 'animate-spin' : ''} />
                {checkingUpdates ? 'Checking…' : 'Check for Updates'}
              </button>
              {updatesAvailable > 0 && (
                <button
                  onClick={handleUpdateAll}
                  disabled={updatingAll}
                  className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
                >
                  <Download size={14} className={updatingAll ? 'animate-pulse' : ''} />
                  {updatingAll ? 'Updating…' : `Update All (${updatesAvailable})`}
                </button>
              )}
            </div>
            {updateMessage && (
              <span className={`text-xs ${updatesAvailable > 0 ? 'text-amber-400' : 'text-green-400'}`}>{updateMessage}</span>
            )}
          </div>

          {needsRedetect && (
            <div className="card border-amber-500/30 bg-amber-500/10 text-amber-400">
              <div className="flex items-start gap-3">
                <Wrench size={16} className="mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Mod IDs need re-detection</p>
                  <p className="text-xs text-amber-300/80 mt-1">
                    Some installed workshop items don't have their real Mod IDs detected yet. The server can't load them until this is fixed.
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

          {mods.length === 0 ? (
            <div className="card text-center py-10">
              <Package size={32} className="mx-auto text-[#444] mb-3" />
              <p className="text-[#a0a0a0]">No mods installed yet. Find some in the Browse tab.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {mods.map((mod) => {
                const info = updates[mod.workshopId]
                const hasUpdate = info?.updateAvailable
                const stub = mod.modIds.length === 0 || (mod.modIds.length === 1 && mod.modIds[0] === mod.workshopId)
                return (
                  <div
                    key={mod.workshopId}
                    className={`flex gap-3 rounded-md p-3 border ${stub || hasUpdate ? 'bg-amber-500/10 border-amber-500/30' : 'bg-[#1a1a1a] border-[#333]'}`}
                  >
                    {mod.previewUrl ? (
                      <img
                        src={mod.previewUrl}
                        alt=""
                        loading="lazy"
                        className="w-16 h-16 object-cover rounded-md bg-[#111] shrink-0"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-md bg-[#111] flex items-center justify-center shrink-0">
                        <Package size={20} className="text-[#444]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm flex items-center gap-2">
                        <span className="truncate">{info?.title || mod.name}</span>
                        {hasUpdate && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono shrink-0">UPDATE</span>
                        )}
                      </p>
                      <p className="text-xs text-[#666] font-mono mt-0.5">
                        {mod.workshopId}
                        <span className="ml-3 text-[#888]">{formatBytes(mod.fileSize ?? info?.fileSize)}</span>
                        <span className="ml-3 text-[#888]">Updated {formatTimeAgo(mod.timeUpdated ?? info?.timeUpdated)}</span>
                      </p>
                      {mod.modIds.length > 0 && !stub && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
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
                    <div className="flex items-center gap-1 shrink-0">
                      {stub && (
                        <button
                          onClick={() => handleRedetectOne(mod.workshopId)}
                          disabled={redetecting}
                          className="text-amber-400 hover:text-amber-300 p-1.5 disabled:opacity-40"
                          title="Re-detect mod IDs"
                        >
                          <Wrench size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => window.electronAPI.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.workshopId}`)}
                        className="text-[#666] hover:text-white p-1.5"
                        title="Open on Workshop"
                      >
                        <ExternalLink size={14} />
                      </button>
                      <button
                        onClick={() => handleRemove(mod.workshopId)}
                        className="text-red-500 hover:text-red-400 p-1.5"
                        title="Remove mod (cleans INI + deletes files)"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {(redetecting || updatingAll) && progress && (
            <div className="bg-[#111] border border-[#333] rounded-md p-2 text-xs text-[#a0a0a0] flex items-center gap-2">
              <RefreshCw size={12} className="animate-spin" />
              <span className="truncate">{progress.message}</span>
            </div>
          )}

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3 text-sm text-amber-400">
            <strong>Note:</strong> Adding, removing, or updating mods requires a server restart to take effect.
            Players must subscribe to the same mods on Steam Workshop before joining.
          </div>
        </div>
      )}

      {/* ── PASTE / COLLECTIONS TAB ────────────────────────────── */}
      {tab === 'paste' && (
        <div className="space-y-4">
          {/* Multi-paste */}
          <div className="card">
            <h3 className="font-semibold mb-1">Paste Workshop URLs or IDs</h3>
            <p className="text-xs text-[#888] mb-3">
              One per line or separated by spaces / commas. Already-installed items are skipped automatically.
            </p>
            <textarea
              placeholder={'https://steamcommunity.com/sharedfiles/filedetails/?id=2392709985\n2613146550\n2566953935'}
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              rows={4}
              className="input w-full font-mono text-xs"
            />
            {parsedIds.length > 0 && (
              <div className="mt-3 flex items-center gap-3">
                <button onClick={handleEnqueuePaste} className="btn-primary flex items-center gap-2 text-sm">
                  <ListPlus size={14} />
                  Add {parsedIds.length} item{parsedIds.length === 1 ? '' : 's'} to queue
                </button>
                <div className="flex flex-wrap gap-1">
                  {parsedIds.slice(0, 8).map((id) => (
                    <span
                      key={id}
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${isQueuedOrInstalled(id) ? 'bg-[#333] text-[#666] line-through' : 'bg-blue-500/15 text-blue-300'}`}
                    >
                      {id}
                    </span>
                  ))}
                  {parsedIds.length > 8 && (
                    <span className="text-[10px] px-1.5 py-0.5 text-[#666]">+{parsedIds.length - 8} more</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Collection resolver */}
          <div className="card">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <Layers size={16} /> Install a Collection
            </h3>
            <p className="text-xs text-[#888] mb-3">
              Paste a Workshop collection URL — the manager lists everything in it so you can install all or pick individually.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={collectionInput}
                onChange={(e) => setCollectionInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleResolveCollection() }}
                placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=…"
                className="input flex-1 font-mono text-xs"
              />
              <button
                onClick={handleResolveCollection}
                disabled={collectionLoading || !collectionInput.trim()}
                className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40"
              >
                {collectionLoading ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                Resolve
              </button>
            </div>

            {collectionError && (
              <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-md p-2 text-xs text-red-400 flex items-center gap-2">
                <AlertCircle size={12} /> {collectionError}
              </div>
            )}

            {collection && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">
                    {collection.title} <span className="text-[#666] text-xs">({collectionItems.length} items)</span>
                  </p>
                  <button onClick={handleInstallCollection} className="btn-primary text-xs flex items-center gap-2">
                    <ListPlus size={12} /> Install all
                  </button>
                </div>
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {collectionItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 bg-[#1a1a1a] border border-[#222] rounded-md px-3 py-2">
                      <div className="flex items-center gap-3 min-w-0">
                        {item.previewUrl ? (
                          <img src={item.previewUrl} alt="" loading="lazy" className="w-8 h-8 object-cover rounded bg-[#111] shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-[#111] shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm truncate">{item.title || `Workshop ${item.id}`}</p>
                          <p className="text-[10px] text-[#666] font-mono">{item.id} · {formatBytes(item.fileSize)}</p>
                        </div>
                      </div>
                      <InstallButton item={item} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
