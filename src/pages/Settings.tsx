import { useState, useEffect } from 'react'
import { Save, FileText, Timer, Plus, Trash2, AlertCircle } from 'lucide-react'
import type { PzSettings } from '../types'

interface ScheduleEntry {
  id: string
  time: string
  enabled: boolean
  warningMinutes?: number[]
  nextFireAt: number | null
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']

function formatTime(t: string) {
  const m = /^(\d{2}):(\d{2})$/.exec(t)
  if (!m) return t
  const h = parseInt(m[1], 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m[2]} ${ampm}`
}

function timeUntil(ms: number) {
  const diff = ms - Date.now()
  if (diff <= 0) return 'now'
  const hrs = Math.floor(diff / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (hrs >= 24) {
    const days = Math.floor(hrs / 24)
    return `${days}d ${hrs % 24}h`
  }
  if (hrs > 0) return `${hrs}h ${mins}m`
  return `${mins}m`
}

export default function Settings() {
  const [settings, setSettings] = useState<PzSettings>({})
  const [iniContent, setIniContent] = useState('')
  const [tab, setTab] = useState<'form' | 'ini' | 'schedules'>('form')
  const [saved, setSaved] = useState(false)

  // Schedules
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([])
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [newHour, setNewHour] = useState('02')
  const [newMinute, setNewMinute] = useState('30')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    load()
  }, [])

  // Tick every minute so the "next fire in" countdown stays roughly accurate.
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(i)
  }, [])

  async function load() {
    const s = await window.electronAPI.getSettings()
    setSettings(s || {})
    const ini = await window.electronAPI.getServerIni()
    if (ini.success) setIniContent(ini.content || '')
    refreshSchedules()
  }

  async function refreshSchedules() {
    const r = await window.electronAPI.listSchedules()
    if (r?.success) setSchedules(r.schedules)
  }

  const handleChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handleSaveForm = async () => {
    await window.electronAPI.saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveIni = async () => {
    await window.electronAPI.saveServerIni(iniContent)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    load()
  }

  const handleAddSchedule = async () => {
    setScheduleError(null)
    const time = `${newHour}:${newMinute}`
    if (schedules.some((s) => s.time === time)) {
      setScheduleError(`A schedule for ${time} already exists.`)
      return
    }
    const next = [...schedules, { id: '', time, enabled: true, warningMinutes: [5, 1], nextFireAt: null }]
    const r = await window.electronAPI.saveSchedules(next)
    if (r?.success) setSchedules(r.schedules)
  }

  const handleToggle = async (id: string) => {
    const next = schedules.map((s) => s.id === id ? { ...s, enabled: !s.enabled } : s)
    const r = await window.electronAPI.saveSchedules(next)
    if (r?.success) setSchedules(r.schedules)
  }

  const handleDelete = async (id: string) => {
    const r = await window.electronAPI.deleteSchedule(id)
    if (r?.success) refreshSchedules()
  }

  const fields = [
    { key: 'PublicName', label: 'Server Name', type: 'text' },
    { key: 'PublicDescription', label: 'Description', type: 'text' },
    { key: 'MaxPlayers', label: 'Max Players', type: 'number' },
    { key: 'Password', label: 'Server Password', type: 'password' },
    { key: 'DefaultPort', label: 'Port', type: 'number' },
    { key: 'SaveWorldEveryMinutes', label: 'Auto-save Interval (min)', type: 'number' },
  ]

  const toggles = [
    { key: 'Public', label: 'Public Server' },
    { key: 'PVP', label: 'PvP Enabled' },
    { key: 'PauseEmpty', label: 'Pause When Empty' },
    { key: 'GlobalChat', label: 'Global Chat' },
    { key: 'SteamVAC', label: 'VAC Anti-Cheat' },
    { key: 'VoiceEnable', label: 'Voice Chat' },
  ]

  const sortedSchedules = [...schedules].sort((a, b) => a.time.localeCompare(b.time))

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-semibold">Server Settings</h2>
        <div className="flex bg-[#222] rounded-md p-0.5">
          <button
            onClick={() => setTab('form')}
            className={`px-3 py-1 rounded text-sm ${tab === 'form' ? 'bg-[#333] text-white' : 'text-[#a0a0a0]'}`}
          >
            Form
          </button>
          <button
            onClick={() => setTab('ini')}
            className={`px-3 py-1 rounded text-sm ${tab === 'ini' ? 'bg-[#333] text-white' : 'text-[#a0a0a0]'}`}
          >
            <FileText size={14} className="inline mr-1" />
            INI Editor
          </button>
          <button
            onClick={() => setTab('schedules')}
            className={`px-3 py-1 rounded text-sm ${tab === 'schedules' ? 'bg-[#333] text-white' : 'text-[#a0a0a0]'}`}
          >
            <Timer size={14} className="inline mr-1" />
            Schedules
          </button>
        </div>
      </div>

      {tab === 'form' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {fields.map((f) => (
              <div key={f.key}>
                <label className="block text-sm text-[#a0a0a0] mb-1">{f.label}</label>
                <input
                  type={f.type}
                  value={settings[f.key] || ''}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                  className="input w-full"
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {toggles.map((t) => (
              <label key={t.key} className="flex items-center gap-2 bg-[#222] rounded-md p-3 border border-[#333] cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings[t.key] === 'true'}
                  onChange={(e) => handleChange(t.key, e.target.checked ? 'true' : 'false')}
                  className="accent-green-500"
                />
                <span className="text-sm">{t.label}</span>
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={handleSaveForm} className="btn-primary flex items-center gap-2">
              <Save size={16} /> Save Settings
            </button>
            {saved && <span className="text-green-500 text-sm self-center">Saved!</span>}
          </div>
        </div>
      )}

      {tab === 'ini' && (
        <div className="space-y-4">
          <textarea
            value={iniContent}
            onChange={(e) => setIniContent(e.target.value)}
            className="textarea w-full h-[500px]"
          />
          <div className="flex gap-2">
            <button onClick={handleSaveIni} className="btn-primary flex items-center gap-2">
              <Save size={16} /> Save INI
            </button>
            {saved && <span className="text-green-500 text-sm self-center">Saved!</span>}
          </div>
        </div>
      )}

      {tab === 'schedules' && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-semibold flex items-center gap-2 mb-1">
              <Timer size={16} />
              Restart Schedules
            </h3>
            <p className="text-xs text-[#888] mb-4">
              Schedules fire at the chosen time every day while the manager is running and the server is online.
              The server is restarted cleanly via save → quit → relaunch, with broadcast warnings 5 minutes and 1 minute before each fire.
              Schedules persist across manager restarts.
            </p>

            {/* Add new schedule */}
            <div className="bg-[#222] border border-[#333] rounded-md p-3 mb-4">
              <p className="text-xs text-[#a0a0a0] mb-2">Add a daily restart at</p>
              <div className="flex gap-2 items-center">
                <select
                  value={newHour}
                  onChange={(e) => setNewHour(e.target.value)}
                  className="input text-sm"
                >
                  {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
                <span className="text-[#666]">:</span>
                <select
                  value={newMinute}
                  onChange={(e) => setNewMinute(e.target.value)}
                  className="input text-sm"
                >
                  {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <span className="text-xs text-[#666]">({formatTime(`${newHour}:${newMinute}`)})</span>
                <button
                  onClick={handleAddSchedule}
                  className="btn-primary flex items-center gap-2 text-sm ml-2"
                >
                  <Plus size={14} /> Add schedule
                </button>
              </div>
              {scheduleError && (
                <div className="mt-2 text-xs text-red-400 flex items-center gap-2">
                  <AlertCircle size={12} /> {scheduleError}
                </div>
              )}
            </div>

            {/* List */}
            {sortedSchedules.length === 0 ? (
              <p className="text-sm text-[#666] italic">No schedules yet. Add one above to set a daily restart time.</p>
            ) : (
              <div className="space-y-2">
                {sortedSchedules.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between rounded-md px-3 py-2 border ${s.enabled ? 'bg-[#222] border-[#333]' : 'bg-[#1a1a1a] border-[#222] opacity-60'}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Timer size={16} className={s.enabled ? 'text-amber-400' : 'text-[#555]'} />
                      <div className="min-w-0">
                        <p className="font-mono text-sm">
                          {s.time} <span className="text-[#888] text-xs">({formatTime(s.time)})</span>
                        </p>
                        <p className="text-xs text-[#666]">
                          {s.enabled
                            ? (s.nextFireAt ? `Next fire: ${timeUntil(s.nextFireAt)}` : 'Pending — server must be online to arm')
                            : 'Disabled'}
                          {' · '}warns {s.warningMinutes?.length ? s.warningMinutes.map((w) => `${w}m`).join(', ') : '5m, 1m'} before
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={() => handleToggle(s.id)}
                          className="accent-green-500"
                        />
                        <span className="text-xs text-[#a0a0a0]">{s.enabled ? 'On' : 'Off'}</span>
                      </label>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="text-red-500 hover:text-red-400 p-1"
                        title="Delete schedule"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Suppress unused-state warning when no schedules — `now` is used in the render above. */}
          <span className="hidden">{now}</span>
        </div>
      )}
    </div>
  )
}
