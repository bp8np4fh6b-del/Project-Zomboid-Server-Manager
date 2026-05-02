import { useState, useEffect } from 'react'
import { X, ExternalLink, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { CHANGELOG, type ChangelogEntry, type ChangelogSection } from '../changelog'

interface Props {
  open: boolean
  onClose: () => void
  // Optional version to show on open. If not provided, shows the latest.
  initialVersion?: string
}

const SECTION_ORDER: Array<{ key: keyof ChangelogSection; label: string; tone: string }> = [
  { key: 'added', label: 'Added', tone: 'text-blue-300 bg-blue-500/10 border-blue-500/30' },
  { key: 'fixed', label: 'Fixed', tone: 'text-green-300 bg-green-500/10 border-green-500/30' },
  { key: 'qol', label: 'Quality of Life', tone: 'text-purple-300 bg-purple-500/10 border-purple-500/30' },
  { key: 'notes', label: 'Notes', tone: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
]

export default function ChangelogModal({ open, onClose, initialVersion }: Props) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!open) return
    if (initialVersion) {
      const i = CHANGELOG.findIndex((c) => c.version === initialVersion)
      setIndex(i === -1 ? 0 : i)
    } else {
      setIndex(0)
    }
  }, [open, initialVersion])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index < CHANGELOG.length - 1) setIndex((i) => i + 1)
      if (e.key === 'ArrowRight' && index > 0) setIndex((i) => i - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, index, onClose])

  if (!open) return null

  const entry: ChangelogEntry = CHANGELOG[index] || CHANGELOG[0]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a1a] border border-[#333] rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#333]">
          <div className="flex items-center gap-3 min-w-0">
            <Sparkles size={18} className="text-amber-400 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-white">PZ Server Manager v{entry.version}</h2>
              <p className="text-xs text-[#888] font-mono">{entry.date}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#888] hover:text-white p-1"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {SECTION_ORDER.map((sec) => {
            const items = entry.sections[sec.key]
            if (!items || items.length === 0) return null
            return (
              <div key={sec.key}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded font-mono border ${sec.tone}`}>
                    {sec.label}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {items.map((item, i) => (
                    <li key={i} className="text-sm text-[#d0d0d0] flex gap-2">
                      <span className="text-[#666] shrink-0">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>

        {/* Footer: nav + GitHub link */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#333] bg-[#161616]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIndex((i) => Math.min(CHANGELOG.length - 1, i + 1))}
              disabled={index >= CHANGELOG.length - 1}
              className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-30"
              title="Older version"
            >
              <ChevronLeft size={14} /> Older
            </button>
            <button
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index <= 0}
              className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-30"
              title="Newer version"
            >
              Newer <ChevronRight size={14} />
            </button>
            <span className="text-xs text-[#666] ml-2">
              {index + 1} / {CHANGELOG.length}
            </span>
          </div>
          <button
            onClick={() => window.electronAPI.openExternal(entry.url)}
            className="btn-secondary text-xs flex items-center gap-1.5"
          >
            <ExternalLink size={12} />
            View on GitHub
          </button>
        </div>
      </div>
    </div>
  )
}
