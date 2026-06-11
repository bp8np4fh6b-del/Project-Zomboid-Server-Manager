import { useState, useEffect } from 'react'

// Shared kick/ban state + flow used by both the Players tab and the
// Dashboard's Live Console. Both surfaces show the same "click → confirm
// with optional reason → toast" flow against the same stdin-backed admin
// commands, so the state lives in a single hook.

export type AdminToast = { kind: 'success' | 'error'; text: string }
export type AdminTarget = { name: string; kind: 'kick' | 'ban' }

export interface UseAdminActionsOptions {
  serverOnline: boolean
  onAfterSuccess?: () => void
}

export function useAdminActions({ serverOnline, onAfterSuccess }: UseAdminActionsOptions) {
  const [adminReady, setAdminReady] = useState(false)
  const [action, setAction] = useState<AdminTarget | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<AdminToast | null>(null)

  // Poll admin readiness every 5s while the server is online.
  useEffect(() => {
    if (!serverOnline) {
      setAdminReady(false)
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const r = await window.electronAPI.adminStatus()
        if (!cancelled && r?.success) setAdminReady(r.serverOnline)
      } catch { /* ignore */ }
    }
    tick()
    const i = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(i) }
  }, [serverOnline])

  // Auto-dismiss the action toast 3s after it appears.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  function open(name: string, kind: 'kick' | 'ban') {
    setAction({ name, kind })
    setReason('')
  }

  function close() {
    setAction(null)
    setReason('')
  }

  async function confirm(): Promise<boolean> {
    if (!action) return false
    setBusy(true)
    try {
      const trimmed = reason.trim() || undefined
      const r = action.kind === 'kick'
        ? await window.electronAPI.adminKick(action.name, trimmed)
        : await window.electronAPI.adminBan(action.name, trimmed)
      if (r?.success) {
        const verb = action.kind === 'kick' ? 'Kicked' : 'Banned'
        setToast({ kind: 'success', text: `${verb} ${action.name}` })
        setAction(null)
        setReason('')
        onAfterSuccess?.()
        return true
      }
      setToast({ kind: 'error', text: r?.error || `Failed to ${action.kind} ${action.name}` })
      return false
    } finally {
      setBusy(false)
    }
  }

  const tooltip = adminReady ? '' : 'Server is not online'

  return {
    adminReady,
    adminTooltip: tooltip,
    action,
    reason,
    setReason,
    busy,
    toast,
    open,
    close,
    confirm,
  }
}
