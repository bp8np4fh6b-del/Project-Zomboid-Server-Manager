const { spawn, exec } = require('child_process')
const fs = require('fs')
const path = require('path')
const https = require('https')
const nodeCrypto = require('crypto')
const { promisify } = require('util')
const execAsync = promisify(exec)

// ═══════════════════════════════════════════════════════════════
// CONFIG — Project Zomboid Build 42 Dedicated Server
// ═══════════════════════════════════════════════════════════════

// Steam app id for the PZ Dedicated Server
const APP_ID = '380870'
// Build 42 went STABLE with 42.20 on 2026-07-29: the default public branch
// of app 380870 now serves Build 42, so no -beta flag is passed. The old
// `unstable` branch is retired; Build 41 lives on as the `legacy41` branch.
// Set PZ_BRANCH to a branch name to pin the server to it (empty = stable).
const PZ_BRANCH = ''
const DEFAULT_PORT = 16261
const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'

// Default admin credentials — used non-interactively on first launch.
const DEFAULT_ADMIN_USER = 'admin'
const DEFAULT_ADMIN_PASS = 'changeme'

const HOME = require('os').homedir()

// User-configurable paths persist in a JSON file at the standard Electron
// userData location. We compute that path manually (matches app.getPath()
// without needing the Electron app object, which isn't available here).
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
const configPath = path.join(APPDATA, 'PZ Server Manager', 'manager-config.json')

const defaultPaths = {
  basePath: path.join(HOME, 'PZ-Server-Manager'),
  serverPath: path.join(HOME, 'PZ-Server-Manager', 'server-files'),
  zomboidPath: path.join(HOME, 'Zomboid'),
}

interface PathsConfig {
  basePath: string
  serverPath: string
  zomboidPath: string
}

// manager-config.json holds both the install paths and app preferences
// (tray behaviour, Steam Web API key). Reads/writes merge so writers of
// one group never clobber the other.
function readConfigFile(): any {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch { /* corrupted file → treat as empty */ }
  return {}
}

function writeConfigFile(patch: Record<string, any>) {
  const merged = { ...readConfigFile(), ...patch }
  if (!fs.existsSync(path.dirname(configPath))) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
  }
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

function loadPathsConfig(): PathsConfig {
  const parsed = readConfigFile()
  return {
    basePath: parsed.basePath || defaultPaths.basePath,
    serverPath: parsed.serverPath || defaultPaths.serverPath,
    zomboidPath: parsed.zomboidPath || defaultPaths.zomboidPath,
  }
}

function writePathsConfig(p: PathsConfig) {
  writeConfigFile(p)
}

// ── App preferences ───────────────────────────────────────────────
// minimizeToTray: close/minimize hides to the system tray instead of quitting.
// autoUpdateGame / autoUpdateMods: when set, updates are checked for and
// applied automatically (game patches apply on server start, mod updates
// are pulled by the game server itself on launch — we surface what's
// pending). steamApiKey: Steam Web API key for Workshop search. Lives ONLY
// in this local config file — never in the repo or the INI, and NEVER sent
// back to the renderer. The UI only learns whether a key exists (plus its
// last 3 chars so the user can recognise which key is saved); setting is
// write-only.

function getSteamApiKeyInternal(): string {
  const c = readConfigFile()
  return typeof c.steamApiKey === 'string' ? c.steamApiKey : ''
}

function getAppPrefs() {
  const c = readConfigFile()
  const key = getSteamApiKeyInternal()
  return {
    success: true,
    prefs: {
      minimizeToTray: !!c.minimizeToTray,
      autoUpdateGame: !!c.autoUpdateGame,
      autoUpdateMods: !!c.autoUpdateMods,
      hasSteamApiKey: key.length > 0,
      steamApiKeyHint: key.length >= 4 ? `····${key.slice(-3)}` : '',
    },
  }
}

function setAppPrefs(partial: { minimizeToTray?: boolean; autoUpdateGame?: boolean; autoUpdateMods?: boolean; steamApiKey?: string }) {
  const patch: Record<string, any> = {}
  if (typeof partial.minimizeToTray === 'boolean') patch.minimizeToTray = partial.minimizeToTray
  if (typeof partial.autoUpdateGame === 'boolean') patch.autoUpdateGame = partial.autoUpdateGame
  if (typeof partial.autoUpdateMods === 'boolean') patch.autoUpdateMods = partial.autoUpdateMods
  // Write-only: a non-empty string replaces the key, an empty string removes it.
  if (typeof partial.steamApiKey === 'string') patch.steamApiKey = partial.steamApiKey.trim()
  if (Object.keys(patch).length > 0) writeConfigFile(patch)
  return getAppPrefs()
}

// Loaded once at module load. Path changes require an app relaunch (handled
// in main.ts) so we never need to mutate these mid-run.
const loadedPaths = loadPathsConfig()

let basePath = loadedPaths.basePath
let serverPath = loadedPaths.serverPath
let zomboidPath = loadedPaths.zomboidPath
let steamCmdPath = path.join(basePath, 'steamcmd', 'steamcmd.exe')
let serverIniPath = path.join(zomboidPath, 'Server', 'servertest.ini')
let sandboxVarsPath = path.join(zomboidPath, 'Server', 'servertest_SandboxVars.lua')
let spawnRegionsPath = path.join(zomboidPath, 'Server', 'servertest_spawnregions.lua')
let backupsPath = path.join(basePath, 'backups')
let playerHistoryPath = path.join(basePath, 'player-history.json')
let modCachePath = path.join(basePath, 'mod-cache.json')
let modsManifestPath = path.join(basePath, 'mods-manifest.json')
let workshopCachePath = path.join(basePath, 'workshop-cache')
const PZ_GAME_APP_ID = '108600'

// Server process tracking
let serverProcess: any = null
let serverStatus: 'offline' | 'starting' | 'online' | 'stopping' = 'offline'
let serverUptime = 0
const logBuffer: any[] = []
let settingsCache: any = null
let modsCache: any = null

// Event callbacks (set by main.ts)
const callbacks: {
  onStatus: ((s: string) => void) | null
  onLog: ((d: any) => void) | null
  onModsProgress: ((d: any) => void) | null
} = {
  onStatus: null,
  onLog: null,
  onModsProgress: null,
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function broadcastStatus() {
  if (callbacks.onStatus) callbacks.onStatus(serverStatus)
}

function broadcastLog(line: string, level: string = 'info') {
  const entry = { timestamp: new Date().toISOString(), level, line }
  logBuffer.push(entry)
  if (logBuffer.length > 1000) logBuffer.shift()
  if (callbacks.onLog) callbacks.onLog(entry)
}

// Streams progress for mod-detection operations (download / scan / write).
// `phase` is one of: 'starting' | 'downloading' | 'scanning' | 'done' | 'error'.
function broadcastModsProgress(payload: { phase: string; workshopId?: string; message: string }) {
  if (callbacks.onModsProgress) callbacks.onModsProgress(payload)
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const handleResponse = (res: any) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        https.get(res.headers.location, { timeout: 30000 }, handleResponse).on('error', reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    }
    https.get(url, { timeout: 30000 }, handleResponse).on('error', reject)
    file.on('error', reject)
  })
}

function fileExists(p: string): boolean {
  try { fs.accessSync(p); return true } catch { return false }
}

// ═══════════════════════════════════════════════════════════════
// PATHS — user-configurable install locations
// ═══════════════════════════════════════════════════════════════

function getPaths() {
  return {
    success: true,
    paths: { basePath, serverPath, zomboidPath },
    defaults: defaultPaths,
    configFile: configPath,
  }
}

function setPaths(partial: Partial<PathsConfig>) {
  // Refuse to mutate while the server is running. The relaunch flow handles
  // the cleanup; live-mutating paths under an active process is risky.
  if (serverStatus !== 'offline') {
    return { success: false, error: 'Stop the server before changing paths.' }
  }
  const next: PathsConfig = {
    basePath: (partial.basePath || basePath).trim(),
    serverPath: (partial.serverPath || serverPath).trim(),
    zomboidPath: (partial.zomboidPath || zomboidPath).trim(),
  }
  if (!next.basePath || !next.serverPath || !next.zomboidPath) {
    return { success: false, error: 'All three paths must be non-empty.' }
  }
  try {
    writePathsConfig(next)
  } catch (err: any) {
    return { success: false, error: `Could not write config: ${err.message}` }
  }
  // The new values won't take effect until the app relaunches; main.ts handles that.
  return { success: true, paths: next }
}

// Used by the "Use existing PZ server" import flow. Verifies the picked
// folder actually contains a PZ dedicated server before treating it as one.
function detectExistingServer(folder: string) {
  try {
    if (!folder || !fileExists(folder)) {
      return { success: false, error: 'Folder does not exist.' }
    }
    const candidates = ['StartServer64.bat', 'ProjectZomboid64.exe', 'StartServer64_nosteam.bat']
    const found = candidates.filter((c) => fileExists(path.join(folder, c)))
    if (found.length === 0) {
      return { success: false, error: 'No PZ launcher found in that folder. Expected StartServer64.bat or ProjectZomboid64.exe.' }
    }
    return { success: true, folder, launchers: found }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// Walk the user's Steam libraries to find an existing "Project Zomboid
// Dedicated Server" install. Lets the Installer offer "Use this install"
// in one click instead of redownloading a 2-3 GB game.
function scanForExistingPzServer() {
  const PZ_FOLDER = 'Project Zomboid Dedicated Server'
  const seen = new Set<string>()
  const candidates: Array<{ path: string; source: string; launchers: string[] }> = []

  // Common Steam install roots — we'll read libraryfolders.vdf from each to
  // discover additional libraries on other drives.
  const steamRoots = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Steam'),
  ]

  // Library roots to actually probe for the PZ folder.
  const libraryRoots: string[] = []
  for (const root of steamRoots) {
    libraryRoots.push(root)
    try {
      const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf')
      if (!fileExists(vdf)) continue
      const text = fs.readFileSync(vdf, 'utf-8')
      // Match every `"path" "<value>"` line. Backslashes in the VDF are doubled.
      const pathRegex = /"path"\s+"([^"]+)"/g
      let m: RegExpExecArray | null
      while ((m = pathRegex.exec(text)) !== null) {
        const lib = m[1].replace(/\\\\/g, '\\')
        if (lib && !libraryRoots.includes(lib)) libraryRoots.push(lib)
      }
    } catch { /* ignore unreadable VDF */ }
  }

  // Also include the manager's currently-configured serverPath in case the
  // user already pointed at an external install.
  try {
    const cfg = loadPathsConfig()
    if (cfg.serverPath) libraryRoots.push(cfg.serverPath)
  } catch { /* ignore */ }

  for (const root of libraryRoots) {
    // Two shapes: `<lib>\steamapps\common\<PZ_FOLDER>` (Steam library) or
    // `<root>` itself being the PZ folder (manager-configured serverPath).
    const probes = [
      { dir: path.join(root, 'steamapps', 'common', PZ_FOLDER), source: `Steam library: ${root}` },
      { dir: root, source: 'Manager-configured server folder' },
    ]
    for (const probe of probes) {
      if (!probe.dir || seen.has(probe.dir.toLowerCase())) continue
      const det = detectExistingServer(probe.dir)
      if (det.success) {
        seen.add(probe.dir.toLowerCase())
        candidates.push({ path: probe.dir, source: probe.source, launchers: det.launchers || [] })
      }
    }
  }

  return { success: true, candidates }
}

// ═══════════════════════════════════════════════════════════════
// IN-HOUSE SERVER CONSOLE — admin commands via the spawned process's stdin
//
// PZ Build 42 reads admin commands from stdin (the same way you'd type into
// the server console window). Writing to `serverProcess.stdin` is functionally
// equivalent to typing into that window — no RCON port, no password, no
// firewall surface. We use it for:
//   - Live player list (`players` command, response parsed from log stream)
//   - Broadcast chat (`servermsg "..."`)
//   - Save + Quit (for clean restarts)
// ═══════════════════════════════════════════════════════════════

// In-memory live player list, refreshed by periodically sending `players` and
// parsing the response from the log stream (handleLine in startServer).
let livePlayers: Array<{ name: string }> = []
let livePlayersUpdatedAt = 0
let liveCollecting = false               // true while we're absorbing `Players connected (N):` output
let livePlayersBuffer: Array<{ name: string }> = []
let livePollTimer: any = null
let lastConsoleError: string | null = null

// Send a raw command to the server process via stdin. Returns true if written.
function sendServerCommand(cmd: string): boolean {
  if (!serverProcess || serverProcess.killed) {
    lastConsoleError = 'Server is not running.'
    return false
  }
  try {
    if (!serverProcess.stdin || serverProcess.stdin.destroyed || serverProcess.stdin.writableEnded) {
      lastConsoleError = 'Server stdin is not writable (server may be shutting down).'
      return false
    }
    serverProcess.stdin.write(cmd + '\r\n')
    lastConsoleError = null
    return true
  } catch (err: any) {
    lastConsoleError = err?.message || String(err)
    broadcastLog(`[CONSOLE] write failed: ${lastConsoleError}`, 'warn')
    return false
  }
}

// Called from startServer's handleLine when a log line arrives. Lets us
// detect the start, body, and end of a `players` response.
//   "Players connected (3):\n-Alice\n-Bob\n-Charlie"
// followed by an unrelated line that ends the list.
function ingestLogLineForPlayersParser(line: string) {
  const trimmed = line.trim()
  // Start of response
  const start = trimmed.match(/Players connected\s*\((\d+)\)\s*:?$/i)
  if (start) {
    liveCollecting = true
    livePlayersBuffer = []
    return
  }
  if (liveCollecting) {
    // Continue collecting `-Name` rows
    const m = trimmed.match(/^[-*]\s*(.+)$/)
    if (m) {
      livePlayersBuffer.push({ name: m[1].trim() })
      return
    }
    // Any non-dash, non-empty line ends the response. Commit the buffer.
    if (trimmed.length > 0) {
      liveCollecting = false
      livePlayers = livePlayersBuffer
      livePlayersBuffer = []
      livePlayersUpdatedAt = Date.now()
      // Reflect the live list into the persistent player history so the
      // Players tab populates even when our connect/disconnect log regex
      // can't capture the username from Build 42's connection lines.
      try { recordLivePlayers(livePlayers.map((p) => p.name)) } catch {}
    }
  }
}

// Reflect the live `players` snapshot into playerHistoryCache. Names that
// appear in liveNames but aren't in cache get a fresh record. Names already
// in cache flip currentlyOnline based on whether they're still in liveNames.
// Steam ID and IP backfill happen later via recordPlayerEvent if a connect
// log line ever matches.
function recordLivePlayers(liveNames: string[]) {
  if (!playerHistoryCache) playerHistoryCache = readPlayerHistory()
  const history = playerHistoryCache
  const now = new Date().toISOString()
  const liveSet = new Set(liveNames.map((n) => n.toLowerCase()))
  let dirty = false

  // Add/refresh records for live names.
  for (const name of liveNames) {
    let rec = history[name]
    if (!rec) {
      rec = {
        username: name,
        firstSeen: now,
        lastSeen: now,
        totalSessions: 1,
        totalPlayMs: 0,
        currentlyOnline: true,
        sessions: [{ start: now }],
      }
      history[name] = rec
      dirty = true
      pushActivity({ at: now, kind: 'connect', message: `${name} connected (live)` })
      broadcastLog(`Player connected (live): ${name}`, 'success')
    } else if (!rec.currentlyOnline) {
      rec.currentlyOnline = true
      rec.totalSessions++
      rec.lastSeen = now
      rec.sessions.push({ start: now })
      if (rec.sessions.length > 100) rec.sessions.splice(0, rec.sessions.length - 100)
      dirty = true
      pushActivity({ at: now, kind: 'connect', message: `${name} connected (live)` })
      broadcastLog(`Player connected (live): ${name}`, 'success')
    } else {
      rec.lastSeen = now
    }
  }

  // Flip-to-offline for any cached record that's currentlyOnline but
  // isn't in the live snapshot.
  for (const rec of Object.values(history)) {
    if (rec.currentlyOnline && !liveSet.has(rec.username.toLowerCase())) {
      rec.currentlyOnline = false
      rec.lastSeen = now
      const last = rec.sessions[rec.sessions.length - 1]
      if (last && !last.end) {
        last.end = now
        last.durationMs = Math.max(0, new Date(now).getTime() - new Date(last.start).getTime())
        rec.totalPlayMs += last.durationMs
      }
      dirty = true
      pushActivity({ at: now, kind: 'disconnect', message: `${rec.username} disconnected (live)` })
      broadcastLog(`Player disconnected (live): ${rec.username}`, 'info')
    }
  }

  if (dirty) writePlayerHistory(history)
}

// Periodic poll: while server is online, send `players` every 5s so the
// in-memory list stays fresh. The response gets ingested by the log parser.
function startLivePlayersPoll() {
  if (livePollTimer) return
  const tick = () => {
    if (serverStatus === 'online' && serverProcess && !serverProcess.killed) {
      sendServerCommand('players')
    }
  }
  // Fire once immediately so the UI is populated quickly after server-online.
  tick()
  livePollTimer = setInterval(tick, 5000)
}

function stopLivePlayersPoll() {
  if (livePollTimer) { clearInterval(livePollTimer); livePollTimer = null }
  livePlayers = []
  livePlayersBuffer = []
  liveCollecting = false
  livePlayersUpdatedAt = 0
}

// Public API used by IPC handlers.

function consoleStatus() {
  // "Available" means the server is running AND we have a writable stdin to
  // talk to it. Mirrors the connected/disconnected concept the UI expects.
  const available = !!(serverProcess && !serverProcess.killed && serverStatus === 'online')
  return { success: true, connected: available, error: lastConsoleError }
}

function consoleGetPlayers() {
  if (serverStatus !== 'online') {
    return { success: false, players: [] as Array<{ name: string }>, error: 'Server is not running.' }
  }
  // Return whatever was last parsed. Empty list with updatedAt=0 means we
  // haven't gotten a response yet (server still warming up).
  return { success: true, players: livePlayers.slice(), updatedAt: livePlayersUpdatedAt }
}

function consoleBroadcast(message: string) {
  if (!message || !message.trim()) return { success: false, error: 'Empty message.' }
  if (serverStatus !== 'online') return { success: false, error: 'Server is not running.' }
  // PZ's stdin command for broadcast chat is `servermsg "..."`.
  const escaped = message.trim().replace(/"/g, '\\"')
  if (!sendServerCommand(`servermsg "${escaped}"`)) {
    return { success: false, error: lastConsoleError || 'Could not send command.' }
  }
  broadcastLog(`[CHAT] ${message}`, 'success')
  return { success: true }
}

// ═══════════════════════════════════════════════════════════════
// CHAT FEED — public chat messages parsed from the log stream
// ═══════════════════════════════════════════════════════════════

interface ChatMessage {
  at: string         // ISO
  username: string
  text: string
}
const chatBuffer: ChatMessage[] = []
const CHAT_BUFFER_SIZE = 200

// Capture in-game chat. Build 42 chat lines arrive on the server log in
// several shapes — match the most common ones. False positives on connect /
// disconnect lines are avoided by checking for those keywords first.
const CHAT_NEGATIVE_RE = /\b(?:connected|disconnected|joined|has left|left the server|logged in|logged out|fully connected|signed (?:in|out))\b/i
const CHAT_PATTERNS: RegExp[] = [
  // "[ChatMessage] PlayerName: hello"
  /\[ChatMessage\]\s*(?:[^:\]]*?:\s*)?([A-Za-z0-9_\-\.]{1,32})\s*:\s*(.+)$/i,
  // "LocalChat:" / "GlobalChat:" / "ServerChat:" prefixes
  /\b(?:LocalChat|GlobalChat|ServerChat|RadioChat)\s*:\s*([A-Za-z0-9_\-\.]{1,32})\s*:\s*(.+)$/i,
  // "User Bob said: ..."
  /\bUser\s+([A-Za-z0-9_\-\.]{1,32})\s+said\s*[:\-]\s*(.+)$/i,
  // Generic angle-bracket "<Bob> hello"
  /<([A-Za-z0-9_\-\.]{1,32})>\s+(.+)$/,
]

function pushChat(msg: ChatMessage) {
  chatBuffer.push(msg)
  if (chatBuffer.length > CHAT_BUFFER_SIZE) {
    chatBuffer.splice(0, chatBuffer.length - CHAT_BUFFER_SIZE)
  }
}

function ingestLogLineForChat(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return
  // Skip lines that look like connection events — avoid double-classifying.
  if (CHAT_NEGATIVE_RE.test(trimmed) && !trimmed.includes(':')) return
  for (const re of CHAT_PATTERNS) {
    const m = trimmed.match(re)
    if (m) {
      const username = m[1].trim()
      const text = m[2].trim()
      if (!username || !text) return
      // Drop our own broadcast echoes that show up in the log as `[CHAT] msg`.
      if (text.startsWith('[CHAT]')) return
      pushChat({ at: new Date().toISOString(), username, text })
      return
    }
  }
}

function getChatLog() {
  return { success: true, messages: chatBuffer.slice() }
}

function clearChatLog() {
  chatBuffer.length = 0
  return { success: true }
}

// Generic console-command passthrough — used by the restart flow for save/quit.
function consoleSendCommand(cmd: string) {
  if (serverStatus !== 'online') return { success: false, error: 'Server is not running.' }
  if (!sendServerCommand(cmd)) {
    return { success: false, error: lastConsoleError || 'Could not send command.' }
  }
  return { success: true }
}

// ═══════════════════════════════════════════════════════════════
// ADMIN ACTIONS — kick / ban via the in-house stdin console.
//
// Build 42's RCON path is unreliable in practice (it returned "RCONERROR"
// on the user's setup even with a valid password). Stdin is the channel
// the rest of the manager already uses for `players`, `servermsg`,
// `save`, and `quit` — `kickuser` and `banuser` are accepted on the same
// channel, so we route admin actions through it too. Trade-off: stdin
// is fire-and-forget, so success here means "we wrote the command";
// the player list poll and Activity feed confirm the effect.
// ═══════════════════════════════════════════════════════════════

function adminEscape(s: string): string {
  // Strip embedded double-quotes; PZ doesn't accept escaped quotes inside
  // the quoted username argument. Names with quotes are extremely rare.
  return s.replace(/"/g, '')
}

function adminSendCommand(cmd: string): { success: boolean; error?: string } {
  if (serverStatus !== 'online') return { success: false, error: 'Server is not running.' }
  if (!sendServerCommand(cmd)) {
    return { success: false, error: lastConsoleError || 'Could not send command to the server console.' }
  }
  return { success: true }
}

async function adminKick(name: string, reason?: string) {
  const safeName = adminEscape(name)
  const safeReason = reason ? adminEscape(reason) : ''
  const cmd = safeReason
    ? `kickuser "${safeName}" -r "${safeReason}"`
    : `kickuser "${safeName}"`
  const r = adminSendCommand(cmd)
  if (r.success) {
    pushActivity({
      at: new Date().toISOString(),
      kind: 'admin',
      message: safeReason ? `Kicked ${safeName} — ${safeReason}` : `Kicked ${safeName}`,
    })
  }
  return r
}

async function adminBan(name: string, reason?: string) {
  const safeName = adminEscape(name)
  const safeReason = reason ? adminEscape(reason) : ''
  const cmd = safeReason
    ? `banuser "${safeName}" -r "${safeReason}"`
    : `banuser "${safeName}"`
  const r = adminSendCommand(cmd)
  if (r.success) {
    pushActivity({
      at: new Date().toISOString(),
      kind: 'admin',
      message: safeReason ? `Banned ${safeName} — ${safeReason}` : `Banned ${safeName}`,
    })
  }
  return r
}

async function adminCommand(cmd: string) {
  return adminSendCommand(cmd)
}

function adminStatus() {
  // Admin actions ride on the same stdin channel as broadcast / players
  // poll. Availability simply mirrors `serverStatus === 'online'`.
  const ready = serverStatus === 'online'
  return {
    success: true,
    serverOnline: ready,
    error: ready ? null : (lastConsoleError || null),
  }
}

// ═══════════════════════════════════════════════════════════════
// RESTART SEQUENCE — clean save → quit → relaunch.
// Used by the daily Schedules subsystem (see rescheduleAll below).
// ═══════════════════════════════════════════════════════════════

function broadcastActivity(kind: string, message: string) {
  pushActivity({ at: new Date().toISOString(), kind, message })
}

async function executeScheduledRestart(opts: any) {
  broadcastActivity('restart', 'Executing scheduled restart…')
  try { sendServerCommand('save') } catch {}
  await new Promise<void>((r) => setTimeout(r, 2500))
  try { sendServerCommand('quit') } catch {}
  await new Promise<void>((r) => setTimeout(r, 4000))
  if (serverStatus !== 'offline') {
    await stopServer()
  }
  // Wait for sockets/files to release before relaunching.
  await new Promise<void>((r) => setTimeout(r, 3000))
  await startServer(opts || {})
}

// ═══════════════════════════════════════════════════════════════
// DAILY SCHEDULES — recurring restarts at HH:MM, persisted to disk
// ═══════════════════════════════════════════════════════════════

interface DailySchedule {
  id: string
  time: string            // "HH:MM" 24-hour
  enabled: boolean
  warningMinutes?: number[]
}

interface SchedulesFile {
  schedules: DailySchedule[]
}

function schedulesFilePath() {
  return path.join(basePath, 'schedules.json')
}

function loadSchedules(): SchedulesFile {
  try {
    const fp = schedulesFilePath()
    if (!fileExists(fp)) return { schedules: [] }
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf-8'))
    if (!parsed || !Array.isArray(parsed.schedules)) return { schedules: [] }
    return parsed
  } catch {
    return { schedules: [] }
  }
}

function saveSchedules(file: SchedulesFile) {
  ensureDir(basePath)
  fs.writeFileSync(schedulesFilePath(), JSON.stringify(file, null, 2), 'utf-8')
}

// Compute the next millis-epoch this schedule will fire (today at HH:MM if
// in the future, otherwise tomorrow at HH:MM).
function computeNextFire(s: DailySchedule, from = Date.now()): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.time)
  if (!m) return from + 24 * 3600 * 1000   // garbage time string — push out a day
  const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)))
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)))
  const now = new Date(from)
  const target = new Date(now)
  target.setHours(hh, mm, 0, 0)
  if (target.getTime() <= from) target.setDate(target.getDate() + 1)
  return target.getTime()
}

// Active timers per schedule — reset whenever the schedule list changes.
interface ScheduleTimers {
  fireTimer: any
  warningTimers: any[]
}
const scheduleTimers: Map<string, ScheduleTimers> = new Map()

function clearAllScheduleTimers() {
  for (const t of scheduleTimers.values()) {
    if (t.fireTimer) clearTimeout(t.fireTimer)
    for (const w of t.warningTimers) clearTimeout(w)
  }
  scheduleTimers.clear()
}

function rescheduleAll() {
  clearAllScheduleTimers()
  const file = loadSchedules()
  for (const s of file.schedules) {
    if (!s.enabled) continue
    const fireAt = computeNextFire(s)
    const fireMs = fireAt - Date.now()
    if (fireMs <= 0) continue

    const warnings = s.warningMinutes && s.warningMinutes.length > 0 ? s.warningMinutes : [5, 1]
    const warningTimers: any[] = []
    for (const w of warnings) {
      const wMs = fireMs - w * 60 * 1000
      if (wMs <= 0) continue
      const t = setTimeout(() => {
        const msg = `Server restart in ${w} minute${w === 1 ? '' : 's'}.`
        consoleBroadcast(msg)
        pushActivity({ at: new Date().toISOString(), kind: 'restart', message: msg })
      }, wMs)
      warningTimers.push(t)
    }

    const fireTimer = setTimeout(async () => {
      pushActivity({ at: new Date().toISOString(), kind: 'restart', message: `Scheduled restart firing (${s.time}).` })
      try { await executeScheduledRestart({}) } catch {}
      // Schedule rolls forward to tomorrow.
      rescheduleAll()
    }, fireMs)

    scheduleTimers.set(s.id, { fireTimer, warningTimers })
  }
}

// Public API used by IPC.
function listSchedules() {
  const file = loadSchedules()
  return {
    success: true,
    schedules: file.schedules.map((s) => ({
      ...s,
      nextFireAt: s.enabled ? computeNextFire(s) : null,
    })),
  }
}

function saveSchedulesList(schedules: DailySchedule[]) {
  // Validate / normalize.
  const cleaned: DailySchedule[] = []
  for (const s of schedules) {
    if (!s || typeof s !== 'object') continue
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.time || '')
    if (!m) continue
    const hh = parseInt(m[1], 10)
    const mm = parseInt(m[2], 10)
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) continue
    cleaned.push({
      id: s.id || nodeCrypto.randomBytes(6).toString('hex'),
      time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
      enabled: s.enabled !== false,
      warningMinutes: Array.isArray(s.warningMinutes) ? s.warningMinutes.filter((n) => typeof n === 'number' && n > 0) : [5, 1],
    })
  }
  saveSchedules({ schedules: cleaned })
  rescheduleAll()
  return { success: true, schedules: cleaned.map((s) => ({ ...s, nextFireAt: s.enabled ? computeNextFire(s) : null })) }
}

function deleteSchedule(id: string) {
  const file = loadSchedules()
  const next = file.schedules.filter((s) => s.id !== id)
  if (next.length === file.schedules.length) return { success: false, error: 'Schedule not found.' }
  saveSchedules({ schedules: next })
  rescheduleAll()
  return { success: true }
}

// ═══════════════════════════════════════════════════════════════
// ACTIVITY FEED — significant events for the Monitoring tab
// ═══════════════════════════════════════════════════════════════

interface ActivityEvent {
  at: string
  kind: 'connect' | 'disconnect' | 'server' | 'restart' | 'error' | string
  message: string
}
const activityBuffer: ActivityEvent[] = []
const ACTIVITY_BUFFER_SIZE = 100

function pushActivity(ev: ActivityEvent) {
  activityBuffer.push(ev)
  if (activityBuffer.length > ACTIVITY_BUFFER_SIZE) {
    activityBuffer.splice(0, activityBuffer.length - ACTIVITY_BUFFER_SIZE)
  }
}

function getActivity() {
  return { success: true, events: [...activityBuffer].reverse() }
}

// ═══════════════════════════════════════════════════════════════
// STEAMCMD
// ═══════════════════════════════════════════════════════════════

async function installSteamCmd() {
  ensureDir(path.dirname(steamCmdPath))

  if (fileExists(steamCmdPath)) {
    return { success: true, message: 'SteamCMD already installed', path: steamCmdPath }
  }

  try {
    broadcastLog('Downloading SteamCMD...', 'info')
    const zipPath = path.join(path.dirname(steamCmdPath), 'steamcmd.zip')
    await downloadFile(STEAMCMD_URL, zipPath)

    broadcastLog('Extracting SteamCMD...', 'info')
    await execAsync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${path.dirname(steamCmdPath)}' -Force"`)
    try { fs.unlinkSync(zipPath) } catch {}

    if (!fileExists(steamCmdPath)) {
      return { success: false, error: 'SteamCMD executable not found after extraction' }
    }

    // First run of steamcmd downloads & updates itself — do it now so the user
    // doesn't see a long stall the first time they install the PZ server.
    broadcastLog('Initializing SteamCMD (first-run self-update)...', 'info')
    await new Promise<void>((resolve) => {
      const child = spawn(steamCmdPath, ['+quit'], { cwd: path.dirname(steamCmdPath), windowsHide: true })
      child.stdout.on('data', (d: Buffer) => {
        const line = d.toString().trim()
        if (line) broadcastLog(line, 'info')
      })
      child.stderr.on('data', (d: Buffer) => {
        const line = d.toString().trim()
        if (line) broadcastLog(line, 'error')
      })
      child.on('exit', () => resolve())
      child.on('error', () => resolve())
    })

    broadcastLog('SteamCMD installed successfully', 'success')
    return { success: true, path: steamCmdPath }
  } catch (err: any) {
    broadcastLog(`SteamCMD install failed: ${err.message}`, 'error')
    return { success: false, error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════════
// PZ SERVER INSTALL
// ═══════════════════════════════════════════════════════════════

// Run a SteamCMD script and return { code, output }.
function runSteamCmd(scriptLines: string[]): Promise<{ code: number; output: string }> {
  const scriptPath = path.join(path.dirname(steamCmdPath), 'install_pz.txt')
  fs.writeFileSync(scriptPath, scriptLines.join('\n'), 'ascii')

  return new Promise((resolve) => {
    const child = spawn(steamCmdPath, ['+runscript', scriptPath], {
      cwd: path.dirname(steamCmdPath),
      windowsHide: true,
    })

    let output = ''
    child.stdout.on('data', (d: Buffer) => {
      const text = d.toString()
      output += text
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line) continue
        broadcastLog(line, 'info')
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      const line = d.toString().trim()
      if (line) {
        output += line + '\n'
        broadcastLog(line, 'error')
      }
    })

    child.on('error', (err: any) => {
      broadcastLog(`SteamCMD failed to start: ${err.message}`, 'error')
      resolve({ code: -1, output: err.message })
    })

    child.on('exit', (code: number) => {
      resolve({ code: code ?? -1, output })
    })
  })
}

// Make sure SteamCMD has fully self-updated. SteamCMD's first real run downloads
// and unpacks its own binaries; running app_update before that finishes returns
// "Missing configuration". We force a no-op login+quit until SteamCMD reports it
// is up-to-date (or we've tried a couple of times).
async function ensureSteamCmdUpdated() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    broadcastLog(`Updating SteamCMD (attempt ${attempt})...`, 'info')
    const { output } = await runSteamCmd([
      '@ShutdownOnFailedCommand 0',
      '@NoPromptForPassword 1',
      'login anonymous',
      'quit',
    ])
    // Once SteamCMD is fully bootstrapped we see "Loading Steam API...OK" AND
    // "Waiting for user info...OK" without a self-update in the same run.
    if (output.includes('Waiting for user info...OK') &&
        !output.includes('Update Job ') &&
        !output.includes('Steam Console Client Update')) {
      return
    }
  }
}

// Free bytes on the drive containing dirPath, or null if it can't be
// determined. Used to fail fast with a clear message instead of letting
// SteamCMD die with the cryptic exit code 8 on a full disk.
async function getFreeDiskSpaceBytes(dirPath: string): Promise<number | null> {
  try {
    const driveLetter = path.parse(path.resolve(dirPath)).root.replace(/[:\\/]/g, '')
    if (!driveLetter) return null
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "(Get-PSDrive -Name '${driveLetter}').Free"`
    )
    const bytes = parseInt(stdout.trim(), 10)
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : null
  } catch {
    return null
  }
}

async function installPzServer() {
  if (!fileExists(steamCmdPath)) {
    return { success: false, error: 'SteamCMD not installed. Install it first.' }
  }

  ensureDir(serverPath)

  // Pre-flight disk space check: the server download is ~6.5 GB and SteamCMD
  // preallocates before downloading, so bail early with a human-readable
  // message when the target drive clearly can't fit it.
  const PZ_INSTALL_MIN_BYTES = 8 * 1024 * 1024 * 1024 // 6.5 GB download + headroom
  const freeBytes = await getFreeDiskSpaceBytes(serverPath)
  if (freeBytes !== null && freeBytes < PZ_INSTALL_MIN_BYTES) {
    const freeGb = (freeBytes / 1024 ** 3).toFixed(1)
    const drive = path.parse(path.resolve(serverPath)).root
    broadcastLog(`Only ${freeGb} GB free on ${drive} — the PZ server needs ~6.5 GB.`, 'error')
    return {
      success: false,
      error: `Not enough disk space on ${drive}: ${freeGb} GB free, but the PZ server download needs ~6.5 GB (8 GB with headroom). Free up space or change the install path in Settings, then try again.`,
    }
  }

  // SteamCMD requires forward slashes in force_install_dir on Windows —
  // backslashes are treated as escape characters and produce
  // "ERROR! Failed to install app '380870' (Missing configuration)".
  const installDir = serverPath.replace(/\\/g, '/')

  broadcastLog('Installing Project Zomboid Build 42 Dedicated Server...', 'info')
  broadcastLog('This may take 10-30 minutes depending on your connection.', 'info')

  // Step 1: make sure SteamCMD itself is fully updated. The very first run
  // after a fresh install just self-updates and exits, so doing the app
  // install in the same invocation can fail with "Missing configuration".
  await ensureSteamCmdUpdated()

  // Step 2: run the actual install. Retry once if we hit the well-known
  // "Missing configuration" race — typically a stale Steam app cache.
  const buildScript = () => [
    '@ShutdownOnFailedCommand 1',
    '@NoPromptForPassword 1',
    'force_install_dir "' + installDir + '"',
    'login anonymous',
    // Stable public branch serves Build 42 — no -beta flag needed.
    'app_update ' + APP_ID + (PZ_BRANCH ? ' -beta ' + PZ_BRANCH : '') + ' validate',
    'quit',
  ]

  let attempt = 0
  while (attempt < 2) {
    attempt++
    broadcastLog(`Running SteamCMD install (attempt ${attempt})...`, 'info')
    const { code, output } = await runSteamCmd(buildScript())

    if (code === 0 && fileExists(getServerLauncher())) {
      broadcastLog('PZ Build 42 Dedicated Server installed successfully', 'success')
      ensureDefaultConfig()
      return { success: true, path: serverPath }
    }

    const missingConfig = /Missing configuration/i.test(output)
    if (missingConfig && attempt < 2) {
      broadcastLog('Got "Missing configuration" — refreshing SteamCMD app cache and retrying...', 'warn')
      // Clearing the appcache forces SteamCMD to re-fetch app metadata.
      try {
        const cacheDir = path.join(path.dirname(steamCmdPath), 'appcache')
        if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true })
      } catch {}
      await ensureSteamCmdUpdated()
      continue
    }

    broadcastLog(`SteamCMD exited with code ${code}`, 'error')
    // Exit code 8 is SteamCMD's generic app_update failure — surface the real
    // reason when it's one we recognise (e.g. "Not enough disk space").
    const noSpace = /Not enough disk space/i.test(output)
    if (noSpace) {
      const drive = path.parse(path.resolve(serverPath)).root
      return {
        success: false,
        error: `Not enough disk space on ${drive}. The PZ server download needs ~6.5 GB free. Free up space or change the install path in Settings, then try again.`,
      }
    }
    return {
      success: false,
      error: missingConfig
        ? 'SteamCMD reports "Missing configuration" for app 380870. This usually means SteamCMD failed to refresh its app metadata. Try again, or delete C:\\Users\\<you>\\PZ-Server-Manager\\steamcmd and reinstall SteamCMD.'
        : `SteamCMD exited with code ${code}. Check logs above.`,
    }
  }

  return { success: false, error: 'Install failed after retries.' }
}

// Returns the canonical launcher for the dedicated server.
// PZ Build 42 ships StartServer64.bat which sets up Java memory and JVM flags.
// We prefer it; if missing we fall back to the bare exe.
function getServerLauncher(): string {
  const bat = path.join(serverPath, 'StartServer64.bat')
  if (fileExists(bat)) return bat
  return path.join(serverPath, 'ProjectZomboid64.exe')
}

function getInstallStatus() {
  const launcher = getServerLauncher()
  return {
    steamcmd: fileExists(steamCmdPath),
    pzServer: fileExists(launcher),
    steamCmdPath,
    serverPath,
    launcherPath: launcher,
  }
}

// ═══════════════════════════════════════════════════════════════
// GAME SERVER UPDATES
// ═══════════════════════════════════════════════════════════════

// buildid of the installed server, read from Steam's appmanifest.
function getInstalledBuildId(): string | null {
  try {
    const acf = path.join(serverPath, 'steamapps', `appmanifest_${APP_ID}.acf`)
    if (!fileExists(acf)) return null
    const m = fs.readFileSync(acf, 'utf-8').match(/"buildid"\s*"(\d+)"/)
    return m ? m[1] : null
  } catch { return null }
}

// app_info_print is slow (SteamCMD has to log in), so the latest-build
// answer is cached in the local config and reused for a few hours.
const GAME_UPDATE_CACHE_TTL = 6 * 60 * 60 * 1000

async function fetchLatestBuildId(): Promise<string | null> {
  const { output } = await runSteamCmd([
    '@ShutdownOnFailedCommand 0',
    '@NoPromptForPassword 1',
    'login anonymous',
    'app_info_print ' + APP_ID,
    'quit',
  ])
  // VDF shape: "branches" { "public" { "buildid" "123456" ... } }
  const m = output.match(/"branches"[\s\S]*?"public"[\s\S]*?"buildid"\s*"(\d+)"/)
  return m ? m[1] : null
}

async function checkGameUpdate(force = false) {
  if (!fileExists(steamCmdPath)) {
    return { success: false, error: 'SteamCMD is not installed yet.', installed: false }
  }
  const installedBuildId = getInstalledBuildId()
  if (!installedBuildId) {
    return { success: false, error: 'PZ server is not installed yet.', installed: false }
  }

  const cache = readConfigFile().gameUpdateCache
  const cacheFresh = !force && cache && typeof cache.latestBuildId === 'string' &&
    (Date.now() - (cache.checkedAt || 0)) < GAME_UPDATE_CACHE_TTL

  let latestBuildId: string | null = cacheFresh ? cache.latestBuildId : null
  if (!latestBuildId) {
    broadcastLog('Checking Steam for the latest PZ Dedicated Server build...', 'info')
    latestBuildId = await fetchLatestBuildId()
    if (latestBuildId) writeConfigFile({ gameUpdateCache: { latestBuildId, checkedAt: Date.now() } })
  }
  if (!latestBuildId) {
    return { success: false, error: 'Could not determine the latest build from Steam. Try again in a moment.', installed: true, installedBuildId }
  }

  return {
    success: true,
    installed: true,
    installedBuildId,
    latestBuildId,
    updateAvailable: latestBuildId !== installedBuildId,
    checkedAt: Date.now(),
  }
}

// Applies the latest patch via SteamCMD (the same app_update path as the
// initial install — SteamCMD only downloads what changed). Refuses while
// the server is running: updating live files would corrupt the instance.
async function updateGameServer() {
  if (serverProcess && !serverProcess.killed) {
    return { success: false, error: 'Stop the server before updating.' }
  }
  if (!fileExists(steamCmdPath)) return { success: false, error: 'SteamCMD is not installed yet.' }
  broadcastLog('Updating PZ Dedicated Server via SteamCMD...', 'info')
  const r = await installPzServer()
  if (r.success) {
    // Invalidate the cached latest-build so the next check re-reads reality.
    const cache = readConfigFile().gameUpdateCache
    if (cache) writeConfigFile({ gameUpdateCache: { ...cache, checkedAt: 0 } })
  }
  return r
}

// ═══════════════════════════════════════════════════════════════
// SERVER PROCESS MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// Returns the PID of any process currently bound to UDP 16261, or null.
// Used to detect orphan PZ servers that survived a manager crash/quit.
async function findPortHolder(port: number = DEFAULT_PORT): Promise<number | null> {
  try {
    const { stdout } = await execAsync(`netstat -ano -p UDP`)
    for (const line of stdout.split(/\r?\n/)) {
      // Lines look like:  UDP    0.0.0.0:16261    *:*    13520
      const match = line.match(new RegExp(`\\bUDP\\b\\s+\\S+:${port}\\s+\\S+\\s+(\\d+)`))
      if (match) return parseInt(match[1], 10)
    }
  } catch {}
  return null
}

async function killOrphanServers() {
  const holder = await findPortHolder(DEFAULT_PORT)
  if (!holder) return false
  broadcastLog(`Found orphan server holding UDP ${DEFAULT_PORT} (PID ${holder}) — terminating it.`, 'warn')
  await new Promise<void>((resolve) => {
    exec(`taskkill /F /T /PID ${holder}`, () => resolve())
  })
  // Give the kernel a moment to release the UDP socket
  await new Promise((r) => setTimeout(r, 1500))
  return true
}

async function startServer(opts: any = {}) {
  const launcher = getServerLauncher()
  if (!fileExists(launcher)) {
    return { success: false, error: 'Server not installed. Run Install first.' }
  }

  if (serverProcess && !serverProcess.killed) {
    return { success: false, error: 'Server is already running.' }
  }

  // Pre-flight: a manager restart can leave a previous PZ server running and
  // bound to UDP 16261. Starting another would fail with RakNet
  // "Connection Startup Failed. Code: 5". Detect and clean that up.
  const orphanPid = await findPortHolder(DEFAULT_PORT)
  if (orphanPid) {
    broadcastLog(`Port ${DEFAULT_PORT} is already in use by PID ${orphanPid}.`, 'warn')
    if (opts.killOrphan !== false) {
      await killOrphanServers()
      const stillHeld = await findPortHolder(DEFAULT_PORT)
      if (stillHeld) {
        return {
          success: false,
          error: `UDP port ${DEFAULT_PORT} is still in use by PID ${stillHeld} after cleanup. Stop that process manually (Task Manager) or change DefaultPort in Settings.`,
        }
      }
    } else {
      return {
        success: false,
        error: `UDP port ${DEFAULT_PORT} is in use by PID ${orphanPid}. Stop the existing server first.`,
      }
    }
  }

  // Auto-update: when enabled in App Settings, a pending game patch is
  // applied before the server comes up, so every restart lands on the
  // latest stable build. Mod updates need no action here — the PZ server
  // re-syncs its workshop items against Steam on every launch by itself.
  try {
    const prefs = readConfigFile()
    if (prefs.autoUpdateGame && fileExists(steamCmdPath) && opts.skipAutoUpdate !== true) {
      const chk = await checkGameUpdate(false)
      if (chk.success && chk.updateAvailable) {
        broadcastLog(`Auto-update: new server build available (${chk.installedBuildId} → ${chk.latestBuildId}). Updating before start...`, 'info')
        const up = await updateGameServer()
        if (!up.success) {
          broadcastLog(`Auto-update failed (${up.error}) — starting the existing build instead.`, 'warn')
        }
      }
    }
  } catch (err: any) {
    broadcastLog(`Auto-update check failed (${err.message}) — starting anyway.`, 'warn')
  }

  const serverName = opts.serverName || 'servertest'
  const adminUser = opts.adminUsername || DEFAULT_ADMIN_USER
  const adminPass = opts.adminPassword || DEFAULT_ADMIN_PASS

  // Build 42 server args:
  //   -servername <name>           pick which servertest.ini variant to load
  //   -adminusername <name>        non-interactive admin name
  //   -adminpassword <pw>          non-interactive admin password
  //   -cachedir=<path>             where Zomboid/ data lives (defaults to ~/Zomboid)
  // The leading "--" separates JVM flags (handled by the .bat) from server args
  // when invoked through StartServer64.bat. The .bat already inserts -- itself,
  // so we just pass server args directly.
  const args = [
    '-servername', serverName,
    '-adminusername', adminUser,
    '-adminpassword', adminPass,
    '-cachedir=' + zomboidPath,
  ]

  ensureDefaultConfig()
  ensureDir(zomboidPath)
  // Stale "currentlyOnline" flags from a previous (uncleanly stopped) session
  // would otherwise mis-report players as still on. Clear them at start.
  resetOnlineFlags()

  broadcastLog(`Starting PZ Build 42 server "${serverName}"...`, 'info')
  broadcastLog(`Launcher: ${launcher}`, 'info')
  serverStatus = 'starting'
  broadcastStatus()

  try {
    const isBat = launcher.toLowerCase().endsWith('.bat')
    if (isBat) {
      // .bat must be invoked through cmd.exe on Windows. We need stdin to be
      // a real pipe (not "ignore") so we can answer Build 41's interactive
      // password prompts, and so that the Java Scanner doesn't immediately
      // throw NoSuchElementException on an EOF stdin.
      //
      // Quoting: Steam's default install path ("Project Zomboid Dedicated
      // Server") contains spaces. Node's auto-escaping for `spawn(cmd.exe,
      // [/c, launcher, ...args])` interacts badly with cmd's /c quote
      // rules and the path ends up split at the first space:
      //   'C:\…\common\Project' is not recognized as an internal or external command
      // Fix: use `cmd /d /s /c "<full quoted command>"` with
      // windowsVerbatimArguments so we control quoting end-to-end. The /s
      // flag tells cmd to treat the outer quotes as a wrapper and execute
      // exactly what's inside, preserving inner quoting.
      const quote = (s: string) => /[\s"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      const inner = [quote(launcher), ...args.map(quote)].join(' ')
      serverProcess = spawn('cmd.exe', ['/d', '/s', '/c', `"${inner}"`], {
        cwd: serverPath,
        windowsHide: true,
        windowsVerbatimArguments: true,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } else {
      serverProcess = spawn(launcher, args, {
        cwd: serverPath,
        windowsHide: true,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    }

    // Track which password prompts we've already answered so we don't double-fire
    // on the same prompt, but also so a second distinct prompt (e.g. "Confirm the
    // password") still gets answered when PZ flushes both prompts in the same chunk.
    const answeredPrompts = new Set<string>()
    const sendPassword = (which: string) => {
      if (answeredPrompts.has(which)) return
      if (!serverProcess || !serverProcess.stdin || serverProcess.stdin.destroyed) return
      try {
        serverProcess.stdin.write(`${adminPass}\r\n`)
        answeredPrompts.add(which)
        broadcastLog(`(auto-replied to "${which}" prompt)`, 'info')
      } catch {}
    }

    const handleLine = (line: string, level: string) => {
      if (!line) return
      broadcastLog(line, level)

      // Watch for player connect/disconnect events and persist to history.
      // Done first because the line may also match other patterns below.
      try { recordPlayerEvent(line) } catch {}
      try { ingestLogLineForPlayersParser(line) } catch {}
      try { ingestLogLineForChat(line) } catch {}

      // Server is genuinely ready: prints "SERVER STARTED" or
      // announces the listening UDP port.
      if (line.includes('SERVER STARTED') ||
          line.includes('Server Steam ID') ||
          /Listening on port \d+/i.test(line)) {
        if (serverStatus !== 'online') {
          serverStatus = 'online'
          serverUptime = Date.now()
          broadcastStatus()
          broadcastLog('Server is ONLINE and accepting connections', 'success')
          pushActivity({ at: new Date().toISOString(), kind: 'server', message: 'Server is online' })
          // Start polling the live player list via stdin `players` command.
          setTimeout(() => { startLivePlayersPoll() }, 1500)
          // Start CPU/RAM sampling of the Java process.
          startMetricsPoll()
          // Activate scheduled-restart timers now that the server is up.
          rescheduleAll()
        }
      }

      // First-run password prompts (Build 41 always; Build 42 if the admin
      // row doesn't exist yet in the SQLite db).
      //   "Enter new administrator password:"  → send password
      //   "Confirm the password:"              → send password again
      //   "Enter password for admin:"          → send password (subsequent runs)
      // Each prompt is keyed independently so we DO answer the confirm prompt
      // even when it arrives in the same stdout chunk as the first prompt.
      if (/Enter new administrator password/i.test(line)) sendPassword('new-password')
      else if (/Confirm (the )?password/i.test(line))      sendPassword('confirm-password')
      else if (/Enter password for admin/i.test(line))     sendPassword('login-password')
    }

    serverProcess.stdout.on('data', (d: Buffer) => {
      const text = d.toString()
      for (const raw of text.split(/\r?\n/)) handleLine(raw.trim(), 'info')
    })

    serverProcess.stderr.on('data', (d: Buffer) => {
      const text = d.toString()
      for (const raw of text.split(/\r?\n/)) handleLine(raw.trim(), 'error')
    })

    serverProcess.on('error', (err: any) => {
      broadcastLog(`Server process error: ${err.message}`, 'error')
      serverStatus = 'offline'
      serverProcess = null
      broadcastStatus()
    })

    serverProcess.on('exit', (code: number) => {
      broadcastLog(`Server process exited with code ${code}`, code === 0 ? 'info' : 'error')
      serverStatus = 'offline'
      serverProcess = null
      stopMetricsPoll()
      broadcastStatus()
    })

    // No 90s false "online" anymore — we only flip to online when we see a
    // genuine ready signal. If the server takes a long time to come up the
    // user can read the live logs to see what's happening.

    return { success: true, pid: serverProcess.pid }
  } catch (err: any) {
    serverStatus = 'offline'
    broadcastStatus()
    return { success: false, error: err.message }
  }
}

async function stopServer() {
  // Identify everything that needs killing:
  //  - The cmd.exe wrapper we spawned (if any).
  //  - The actual Java server (whatever's bound to UDP 16261).
  // On Windows, signal-based kill on the cmd.exe wrapper does NOT take down
  // its grandchild Java process — we have to use `taskkill /F /T` to walk
  // the whole tree.
  const orphanPid = await findPortHolder(DEFAULT_PORT)
  const tracked = serverProcess && !serverProcess.killed ? serverProcess.pid : null

  if (!tracked && !orphanPid) {
    serverStatus = 'offline'
    broadcastStatus()
    return { success: false, error: 'Server is not running.' }
  }

  serverStatus = 'stopping'
  broadcastStatus()
  broadcastLog('Stopping server...', 'info')
  pushActivity({ at: new Date().toISOString(), kind: 'server', message: 'Server stopping' })
  clearAllScheduleTimers()
  stopLivePlayersPoll()
  stopMetricsPoll()

  // Kill IMMEDIATELY — no 10 second delay. PZ doesn't have a graceful
  // SIGTERM path on Windows anyway; the in-game `quit` console command is
  // the only "graceful" stop and we don't have a hook to it from out here.
  const pidsToKill = new Set<number>()
  if (tracked) pidsToKill.add(tracked)
  if (orphanPid) pidsToKill.add(orphanPid)

  for (const pid of pidsToKill) {
    broadcastLog(`taskkill /F /T /PID ${pid}`, 'info')
    exec(`taskkill /F /T /PID ${pid}`, () => {})
  }

  // Poll until the port is actually free, then declare the server offline.
  // The spawn 'exit' handler will also fire for the tracked process, but it
  // doesn't fire for orphans — so we drive status from port state, which is
  // the ground-truth signal anyway.
  const startedAt = Date.now()
  const pollInterval = setInterval(async () => {
    const stillHolding = await findPortHolder(DEFAULT_PORT)
    const elapsed = Date.now() - startedAt
    if (!stillHolding) {
      clearInterval(pollInterval)
      serverStatus = 'offline'
      serverProcess = null
      serverUptime = 0
      // Mark everyone offline in history; we won't see disconnect lines now.
      try { resetOnlineFlags() } catch {}
      broadcastStatus()
      broadcastLog('Server stopped.', 'success')
    } else if (elapsed > 15000) {
      clearInterval(pollInterval)
      // Last-resort: kill -anything- still bound to the port
      exec(`taskkill /F /T /PID ${stillHolding}`, () => {})
      broadcastLog(`Force-killing PID ${stillHolding} (still holding port after 15s)...`, 'warn')
      // After this, next poll cycle of getServerStatus will see port free.
    }
  }, 500)

  return { success: true }
}

async function restartServer() {
  await stopServer()
  // Wait for the port to actually free up (up to 20s) instead of guessing.
  for (let i = 0; i < 40; i++) {
    const holder = await findPortHolder(DEFAULT_PORT)
    if (!holder) break
    await new Promise((r) => setTimeout(r, 500))
  }
  return startServer()
}

async function getServerStatus() {
  // Self-correct: if we think we're 'stopping' but the port is actually free,
  // we missed an exit somewhere — we're really offline.
  if (serverStatus === 'stopping') {
    const stillHolding = await findPortHolder(DEFAULT_PORT)
    if (!stillHolding) {
      serverStatus = 'offline'
      serverProcess = null
      serverUptime = 0
      broadcastStatus()
    }
  }

  // If we don't think anything is running but something is bound to 16261,
  // that's an orphan from a previous manager session. Surface it as "online"
  // so the user can see and Stop it from the UI.
  if (!serverProcess && serverStatus === 'offline') {
    const orphan = await findPortHolder(DEFAULT_PORT)
    if (orphan) {
      serverStatus = 'online'
      if (serverUptime === 0) serverUptime = Date.now()
      return {
        status: serverStatus,
        pid: orphan,
        uptime: Math.floor((Date.now() - serverUptime) / 1000),
        port: DEFAULT_PORT,
        installPath: serverPath,
        orphan: true,
      }
    }
  }

  const uptime = serverStatus === 'online' && serverUptime > 0
    ? Math.floor((Date.now() - serverUptime) / 1000)
    : 0

  return {
    status: serverStatus,
    pid: serverProcess ? serverProcess.pid : null,
    uptime,
    port: DEFAULT_PORT,
    installPath: serverPath,
  }
}

function getRecentLogs() {
  return logBuffer.slice(-200)
}

// ═══════════════════════════════════════════════════════════════
// SETTINGS / INI MANAGEMENT — PZ Build 42 servertest.ini
// ═══════════════════════════════════════════════════════════════

function ensureDefaultConfig() {
  ensureDir(path.dirname(serverIniPath))

  if (fileExists(serverIniPath)) return

  // Build 42 servertest.ini defaults.
  // The Build 42 server will fill in any missing keys on first launch, so this
  // covers the most commonly edited ones for new server admins.
  const defaults = [
    'PVP=true',
    'PauseEmpty=true',
    'GlobalChat=true',
    'ChatStreams=s,r,a,w,y,sh,f,all',
    'Open=true',
    'ServerWelcomeMessage=Welcome to Project Zomboid Build 42 Server!',
    'LogLocalChat=false',
    'AutoCreateUserInWhiteList=false',
    'DisplayUserName=true',
    'ShowFirstAndLastName=false',
    'SpawnPoint=0,0,0',
    'SafetySystem=true',
    'ShowSafety=true',
    'SafetyToggleTimer=2',
    'SafetyCooldownTimer=3',
    'SpawnItems=',
    'DefaultPort=16261',
    'ResetID=572058526',
    'Mods=',
    'Map=Muldraugh, KY',
    'DoLuaChecksum=true',
    'DenyLoginOnOverloadedServer=true',
    'Public=false',
    'PublicName=My PZ Build 42 Server',
    'PublicDescription=Project Zomboid Build 42 Multiplayer Server',
    'MaxPlayers=16',
    'PingFrequency=10',
    'PingLimit=400',
    'HoursForLootRespawn=0',
    'MaxItemsForLootRespawn=4',
    'ConstructionPreventsLootRespawn=true',
    'DropOffWhiteListAfterDeath=false',
    'NoFireSpread=false',
    'NoFire=false',
    'AnnounceDeath=false',
    'MinutesPerPage=1.0',
    'SaveWorldEveryMinutes=15',
    'PlayerSafehouse=false',
    'AdminSafehouse=false',
    'SafehouseAllowTrepass=true',
    'SafehouseAllowFire=true',
    'SafehouseAllowLoot=true',
    'SafehouseAllowRespawn=false',
    'SafehouseDaySurvivedToClaim=0',
    'SafeHouseRemovalTime=144',
    'SafehouseAllowNonResidential=false',
    'AllowDestructionBySledgehammer=true',
    'KickFastPlayers=false',
    'ServerPlayerID=',
    'DiscordEnable=false',
    'DiscordToken=',
    'DiscordChannel=',
    'DiscordChannelID=',
    'Password=',
    'MaxAccountsPerUser=0',
    'AllowCoop=true',
    'AllowNonAsciiUsername=false',
    'BanKickGlobalSound=true',
    'RemovePlayerCorpsesOnCorpseRemoval=false',
    'TrashDeleteAll=false',
    'PVPMeleeWhileHitReaction=false',
    'MouseOverToSeeDisplayName=true',
    'HidePlayersBehindYou=true',
    'PVPMeleeDamageModifier=30.0',
    'PVPFirearmDamageModifier=50.0',
    'CarEngineAttractionModifier=0.5',
    'PlayerBumpPlayer=false',
    'MapRemotePlayerVisibility=1',
    'BackupsCount=5',
    'BackupsOnStart=true',
    'BackupsOnVersionChange=true',
    'BackupsPeriod=0',
    'AntiCheatProtectionType1=true',
    'AntiCheatProtectionType2=true',
    'AntiCheatProtectionType3=true',
    'AntiCheatProtectionType4=true',
    'AntiCheatProtectionType5=true',
    'AntiCheatProtectionType6=true',
    'AntiCheatProtectionType7=true',
    'AntiCheatProtectionType8=true',
    'AntiCheatProtectionType9=true',
    'AntiCheatProtectionType10=true',
    'AntiCheatProtectionType11=true',
    'AntiCheatProtectionType12=true',
    'AntiCheatProtectionType13=true',
    'AntiCheatProtectionType14=true',
    'AntiCheatProtectionType15=true',
    'AntiCheatProtectionType16=true',
    'AntiCheatProtectionType17=true',
    'AntiCheatProtectionType18=true',
    'AntiCheatProtectionType19=true',
    'AntiCheatProtectionType20=true',
    'AntiCheatProtectionType21=true',
    'AntiCheatProtectionType22=true',
    'AntiCheatProtectionType23=true',
    'AntiCheatProtectionType24=true',
    'AntiCheatProtectionType2ThresholdMultiplier=3.0',
    'AntiCheatProtectionType3ThresholdMultiplier=1.0',
    'AntiCheatProtectionType4ThresholdMultiplier=1.0',
    'AntiCheatProtectionType9ThresholdMultiplier=1.0',
    'AntiCheatProtectionType15ThresholdMultiplier=1.0',
    'AntiCheatProtectionType20ThresholdMultiplier=1.0',
    'AntiCheatProtectionType22ThresholdMultiplier=1.0',
    'AntiCheatProtectionType24ThresholdMultiplier=6.0',
    'WorkshopItems=',
    'SteamPort1=8766',
    'SteamPort2=8767',
    'WorldItemRemovalList=Base.Hat,Base.Glasses,Base.Maggots',
    'HoursForWorldItemRemoval=24.0',
    'ItemRemovalListBlacklistToggle=false',
    'TimeSinceApocalypse=1',
    'KnownMediaForNewPlayers=true',
    'PlayerRespawnWithSelf=false',
    'PlayerRespawnWithOther=false',
    'FastForwardMultiplier=40.0',
    'DisableSafehouseWhenPlayerConnected=false',
    'Faction=true',
    'FactionDaySurvivedToCreate=0',
    'FactionPlayersRequiredForTag=1',
    'DisableRadioStaff=false',
    'DisableRadioAdmin=true',
    'DisableRadioGM=true',
    'DisableRadioOverseer=false',
    'DisableRadioModerator=false',
    'DisableRadioInvisible=true',
    'BanKickGlobalSound=true',
    'UPnP=true',
    'VoiceEnable=true',
    'VoiceMinDistance=10.0',
    'VoiceMaxDistance=100.0',
    'Voice3D=true',
    'speedLimit=70.0',
    'LoginQueueEnabled=false',
    'LoginQueueConnectTimeout=60',
    'ServerBrowserAnnouncedIP=',
    'PlayerRespawnWithSelf=false',
    'PlayerRespawnWithOther=false',
    'FastForwardMultiplier=40.0',
    'StreamingEnabled=true',
    'SteamScoreboard=true',
    'WorkshopItems=',
  ].join('\r\n')

  fs.writeFileSync(serverIniPath, defaults, 'utf-8')
}

function parseIni(content: string) {
  const settings: any = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    settings[key] = val
  }
  return settings
}

function buildIni(settings: any) {
  // Preserve ALL keys (PZ Build 42 cares about many of them) — write them
  // back in their natural order rather than dropping anything.
  const lines: string[] = []
  for (const [key, val] of Object.entries(settings)) {
    lines.push(`${key}=${val}`)
  }
  return lines.join('\r\n')
}

function getSettings() {
  if (settingsCache) return settingsCache

  try {
    if (!fileExists(serverIniPath)) {
      ensureDefaultConfig()
    }
    const content = fs.readFileSync(serverIniPath, 'utf-8')
    settingsCache = parseIni(content)
    return settingsCache
  } catch (err) {
    return {}
  }
}

function saveSettings(settings: any) {
  try {
    // Merge with existing on disk so we don't drop keys not shown in the form.
    let existing: any = {}
    if (fileExists(serverIniPath)) {
      existing = parseIni(fs.readFileSync(serverIniPath, 'utf-8'))
    } else {
      ensureDefaultConfig()
      existing = parseIni(fs.readFileSync(serverIniPath, 'utf-8'))
    }
    const merged = { ...existing, ...settings }
    const content = buildIni(merged)
    fs.writeFileSync(serverIniPath, content, 'utf-8')
    settingsCache = merged
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

function getServerIni() {
  try {
    if (!fileExists(serverIniPath)) ensureDefaultConfig()
    return { success: true, content: fs.readFileSync(serverIniPath, 'utf-8') }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

function saveServerIni(content: string) {
  try {
    ensureDir(path.dirname(serverIniPath))
    fs.writeFileSync(serverIniPath, content, 'utf-8')
    settingsCache = parseIni(content)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════════
// SANDBOX VARS — servertest_SandboxVars.lua
// ═══════════════════════════════════════════════════════════════

// Build 42 default SandboxVars. PZ generates this on first server run, but we
// pre-seed it so the Sandbox tab has something to edit before the first launch.
function ensureDefaultSandbox() {
  ensureDir(path.dirname(sandboxVarsPath))
  if (fileExists(sandboxVarsPath)) return

  const lua = `SandboxVars = {
    VERSION = 5,
    Zombies = 3,
    Distribution = 1,
    DayLength = 3,
    StartYear = 1,
    StartMonth = 7,
    StartDay = 9,
    StartTime = 2,
    WaterShut = 2,
    ElecShut = 2,
    WaterShutModifier = 14,
    ElecShutModifier = 14,
    FoodLoot = 2,
    WeaponLoot = 2,
    OtherLoot = 2,
    Temperature = 3,
    Rain = 3,
    ErosionSpeed = 3,
    ErosionDays = 0,
    XpMultiplier = 1.0,
    XpMultiplierAffectsPassive = false,
    ZombieAttractionMultiplier = 1.0,
    VehicleEasyUse = false,
    Farming = 3,
    CompostTime = 2,
    StatsDecrease = 3,
    NatureAbundance = 3,
    Alarm = 4,
    LockedHouses = 6,
    StarterKit = false,
    Nutrition = true,
    FoodRotSpeed = 3,
    FridgeFactor = 3,
    LootRespawn = 1,
    SeenHoursPreventLootRespawn = 0,
    WorldItemRemovalList = "Base.Hat,Base.Glasses,Base.Maggots",
    HoursForWorldItemRemoval = 24.0,
    ItemRemovalListBlacklistToggle = false,
    TimeSinceApocalypse = 1,
    PlaneCrashFrequency = 1,
    GeneratorSpawning = 3,
    GeneratorFuelConsumption = 1.0,
    RandomizedZoneStory = 3,
    RandomizedHouseChance = 5,
    RandomizedSafehouseChance = 25,
    RandomizedVehicleStoryChance = 20,
    RandomizedZombieStoryChance = 10,
    AnnotatedMapChance = 4,
    CharacterFreePoints = 5,
    ConstructionBonusPoints = 3,
    NightDarkness = 3,
    NightLength = 4,
    InjurySeverity = 2,
    BoneFracture = true,
    HoursForCorpseRemoval = 216,
    DecayingCorpseHealthImpact = 3,
    BloodLevel = 3,
    ClothingDegradation = 3,
    FireSpread = true,
    DaysForRottenFoodRemoval = -1,
    AllowExteriorGenerator = true,
    MaxFogIntensity = 1,
    MaxRainFxIntensity = 1,
    EnableSnowOnGround = true,
    MultiHitZombies = false,
    RearVulnerability = 3,
    AttackBlockMovements = true,
    AllClothesUnlocked = false,
    CarSpawnRate = 3,
    ChanceHasGas = 1,
    InitialGasoline = 2,
    FuelConsumption = 1.0,
    LockedCar = 4,
    CarGeneralCondition = 3,
    CarDamageOnImpact = 3,
    DamageToPlayerFromHitByACar = 1,
    TrafficJam = true,
    CarAlarm = 3,
    PlayerDamageFromCrash = true,
    SirenShutoffHours = 0.0,
    RecoveredEnergyOnRest = 3,
    EnableVehicles = true,
    EnableTaintedWaterText = true,
    FastForwardMultiplier = 40.0,
    DisableSafehouseWhenPlayerConnected = false,
    Faction = true,
    FactionDaySurvivedToCreate = 0.0,
    FactionPlayersRequiredForTag = 1,
    AllowTents = true,
    AllowSnowOnGround = true,
    SafehouseAllowTrepass = true,
    SafehouseAllowFire = true,
    SafehouseAllowLoot = true,
    SafehouseAllowRespawn = false,
    SafehouseDaySurvivedToClaim = 0.0,
    SafeHouseRemovalTime = 144,
    SafehouseAllowNonResidential = false,
    AllowDestructionBySledgehammer = true,
    SledgehammerOnlyInSafehouse = false,
    KickFastPlayers = false,
    ZombieLore = {
        Speed = 2,
        Strength = 2,
        Toughness = 2,
        Transmission = 1,
        Mortality = 5,
        Reanimate = 3,
        Cognition = 3,
        CrawlUnderVehicle = 3,
        Memory = 2,
        Sight = 2,
        Hearing = 2,
        ThumpNoChasing = false,
        ThumpOnConstruction = true,
        ActiveOnly = 1,
        TriggerHouseAlarm = false,
        ZombiesDragDown = true,
        ZombiesFenceLunge = true,
        DisableFakeDead = 1,
    },
    ZombieConfig = {
        PopulationMultiplier = 1.0,
        PopulationStartMultiplier = 1.0,
        PopulationPeakMultiplier = 1.5,
        PopulationPeakDay = 28,
        RespawnHours = 72.0,
        RespawnUnseenHours = 16.0,
        RespawnMultiplier = 0.1,
        RedistributeHours = 12.0,
        FollowSoundDistance = 100,
        RallyGroupSize = 20,
        RallyTravelDistance = 20,
        RallyGroupSeparation = 15,
        RallyGroupRadius = 3,
    },
}
`
  fs.writeFileSync(sandboxVarsPath, lua, 'utf-8')
}

// Lua "table to JSON-ish" parser: extracts SandboxVars = { ... } including
// nested ZombieLore = { ... } / ZombieConfig = { ... }. Returns a flat
// dot-notation map: { "Zombies": "3", "ZombieLore.Speed": "2", ... }.
function parseSandbox(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  // Strip Lua comments
  const text = content.replace(/--\[\[[\s\S]*?]]/g, '').replace(/--[^\n]*/g, '')

  // Simple state machine: walk through and capture assignments.
  // We support nesting by tracking the current path stack.
  const pathStack: string[] = []
  const len = text.length
  let i = 0

  const skipWs = () => { while (i < len && /[\s,]/.test(text[i])) i++ }
  const readIdent = () => {
    skipWs()
    let s = i
    while (i < len && /[A-Za-z0-9_]/.test(text[i])) i++
    return text.slice(s, i)
  }

  while (i < len) {
    skipWs()
    if (i >= len) break

    if (text[i] === '}') {
      pathStack.pop()
      i++
      continue
    }

    const ident = readIdent()
    if (!ident) { i++; continue }

    skipWs()
    if (text[i] !== '=') { continue }
    i++ // consume '='
    skipWs()

    if (text[i] === '{') {
      // nested table
      pathStack.push(ident)
      i++
      continue
    }

    // value: number, string, true/false, until ',' or '\n' or '}'
    let s = i
    let depth = 0
    let inStr = false
    let strChar = ''
    while (i < len) {
      const c = text[i]
      if (inStr) {
        if (c === '\\') { i += 2; continue }
        if (c === strChar) inStr = false
      } else {
        if (c === '"' || c === "'") { inStr = true; strChar = c }
        else if (c === '{') depth++
        else if (c === '}') { if (depth === 0) break; depth-- }
        else if (c === ',' && depth === 0) break
        else if (c === '\n' && depth === 0) break
      }
      i++
    }
    let val = text.slice(s, i).trim()
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    const fullKey = [...pathStack, ident].join('.')
    // Skip the SandboxVars wrapper itself
    if (fullKey === 'SandboxVars') continue
    const stripped = fullKey.startsWith('SandboxVars.') ? fullKey.slice('SandboxVars.'.length) : fullKey
    out[stripped] = val
  }

  return out
}

// Build a Lua SandboxVars block from a flat dot-notation map. Nested keys
// (e.g. "ZombieLore.Speed") are grouped into sub-tables. Order is preserved
// based on the order keys appear in the input map.
function buildSandbox(flat: Record<string, string>): string {
  // Group by top-level prefix
  const top: Array<[string, string]> = []
  const groups: Record<string, Array<[string, string]>> = {}
  for (const [k, v] of Object.entries(flat)) {
    const dot = k.indexOf('.')
    if (dot === -1) {
      top.push([k, v])
    } else {
      const head = k.slice(0, dot)
      const tail = k.slice(dot + 1)
      if (!groups[head]) groups[head] = []
      groups[head].push([tail, v])
    }
  }

  const fmt = (val: string): string => {
    if (val === 'true' || val === 'false') return val
    if (/^-?\d+(\.\d+)?$/.test(val)) return val
    // strings — escape quotes
    return `"${val.replace(/"/g, '\\"')}"`
  }

  const lines: string[] = ['SandboxVars = {']
  for (const [k, v] of top) {
    lines.push(`    ${k} = ${fmt(v)},`)
  }
  for (const [group, kvs] of Object.entries(groups)) {
    lines.push(`    ${group} = {`)
    for (const [k, v] of kvs) {
      lines.push(`        ${k} = ${fmt(v)},`)
    }
    lines.push(`    },`)
  }
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

function getSandbox() {
  try {
    if (!fileExists(sandboxVarsPath)) ensureDefaultSandbox()
    const content = fs.readFileSync(sandboxVarsPath, 'utf-8')
    return { success: true, vars: parseSandbox(content), raw: content }
  } catch (err: any) {
    return { success: false, error: err.message, vars: {}, raw: '' }
  }
}

function saveSandbox(vars: Record<string, string>) {
  try {
    ensureDir(path.dirname(sandboxVarsPath))
    const content = buildSandbox(vars)
    fs.writeFileSync(sandboxVarsPath, content, 'utf-8')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

function saveSandboxRaw(content: string) {
  try {
    ensureDir(path.dirname(sandboxVarsPath))
    fs.writeFileSync(sandboxVarsPath, content, 'utf-8')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════════
// MODS
//
// Workshop ID (numeric, e.g. "2392709985") and Mod ID (folder name from
// mod.info, e.g. "truemusic") are NOT the same value — and a single workshop
// item can ship multiple mods. The PZ ini's `WorkshopItems=` and `Mods=` lines
// can't represent that 1-to-many on their own, so we keep a manifest at
// `mods-manifest.json` as the source of truth for the UI and rewrite both ini
// keys from it on every change.
// ═══════════════════════════════════════════════════════════════

interface ManifestEntry {
  workshopId: string
  title: string
  modIds: string[]
  mapNames: string[]
  detectedAt: number
}

interface ModsManifest {
  items: ManifestEntry[]
}

function readManifest(): ModsManifest {
  try {
    if (!fileExists(modsManifestPath)) return { items: [] }
    const parsed = JSON.parse(fs.readFileSync(modsManifestPath, 'utf-8'))
    if (!parsed || !Array.isArray(parsed.items)) return { items: [] }
    return parsed
  } catch {
    return { items: [] }
  }
}

function writeManifest(m: ModsManifest) {
  ensureDir(path.dirname(modsManifestPath))
  fs.writeFileSync(modsManifestPath, JSON.stringify(m, null, 2), 'utf-8')
}

// Parse a mod.info file — line-oriented `key=value`. Comments start with `//`.
// Whitespace around keys/values is trimmed. Returns the keys we care about.
function parseModInfo(content: string): { id?: string; name?: string; maps: string[] } {
  const result: { id?: string; name?: string; maps: string[] } = { maps: [] }
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('//')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const val = line.slice(eq + 1).trim()
    if (!val) continue
    if (key === 'id' && !result.id) result.id = val
    else if (key === 'name' && !result.name) result.name = val
    else if (key === 'map') result.maps.push(val)
  }
  return result
}

// Run `workshop_download_item 108600 <id>` and verify content lands on disk.
// Pull a meaningful one-liner out of SteamCMD output. SteamCMD prints
// `ERROR! Download item <id> failed (<reason>).` when a workshop download
// fails — the reason is what the user actually needs to see.
function summarizeSteamCmdOutput(output: string, workshopId: string): string {
  const dl = new RegExp(`Download item ${workshopId} failed \\(([^)]+)\\)`, 'i').exec(output)
  if (dl) return `Steam reported: ${dl[1]}`
  const generic = /ERROR!?\s*([^\r\n]+)/i.exec(output)
  if (generic) return generic[1].trim()
  return 'See the Logs panel for full SteamCMD output.'
}

// Sleep helper for retry backoff.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function downloadWorkshopItem(workshopId: string): Promise<{ success: boolean; error?: string; contentDir?: string }> {
  if (!fileExists(steamCmdPath)) {
    return { success: false, error: 'SteamCMD is not installed. Open the Installer page and install SteamCMD first.' }
  }
  ensureDir(workshopCachePath)
  // SteamCMD on Windows requires forward slashes in force_install_dir.
  const cacheDirArg = workshopCachePath.replace(/\\/g, '/')
  const contentDir = path.join(workshopCachePath, 'steamapps', 'workshop', 'content', PZ_GAME_APP_ID, workshopId)

  // First-time SteamCMD self-update can race with workshop_download_item and
  // produce "Failure" with no useful output. Get the self-update done first.
  await ensureSteamCmdUpdated()

  // Retry on transient `Failure` results. Steam frequently returns Failure for
  // anonymous workshop downloads under load; retrying with a short backoff
  // succeeds in the vast majority of cases. Permanent errors (No subscription,
  // File not found) won't be retried — we detect them and bail.
  const MAX_ATTEMPTS = 3
  let lastOutput = ''
  let lastCode = -1

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    broadcastModsProgress({
      phase: 'downloading',
      workshopId,
      message: attempt === 1
        ? `Downloading workshop item ${workshopId}…`
        : `Retrying download (attempt ${attempt}/${MAX_ATTEMPTS})…`,
    })

    const { code, output } = await runSteamCmd([
      '@ShutdownOnFailedCommand 1',
      '@NoPromptForPassword 1',
      'force_install_dir "' + cacheDirArg + '"',
      'login anonymous',
      'workshop_download_item ' + PZ_GAME_APP_ID + ' ' + workshopId,
      'quit',
    ])
    lastOutput = output
    lastCode = code

    // Success: SteamCMD prints `Success. Downloaded item <id> ...` and exits 0.
    if (code === 0 && fileExists(contentDir) && /Success\.?\s+Downloaded item/i.test(output)) {
      return { success: true, contentDir }
    }

    // Some valid downloads exit 0 without the success banner if cached — accept
    // the existence of the content directory as ground truth.
    if (code === 0 && fileExists(contentDir)) {
      return { success: true, contentDir }
    }

    // Permanent errors — don't retry.
    const permanent = /(No subscription|File not found|Access is denied|Banned)/i.exec(output)
    if (permanent) {
      return { success: false, error: `Steam refused this download: ${permanent[1]}. The workshop item may be private, deleted, or restricted.` }
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(1500 * attempt)
    }
  }

  return {
    success: false,
    error: `Download failed after ${MAX_ATTEMPTS} attempts (exit ${lastCode}). ${summarizeSteamCmdOutput(lastOutput, workshopId)}`,
  }
}

// Walk the downloaded workshop content and return every mod folder's parsed
// mod.info. A workshop item normally has `<workshopId>/mods/<modId>/mod.info`;
// some items also nest `mods/` directly at the workshop root. We check both.
function scanWorkshopContent(contentDir: string): { modIds: string[]; mapNames: string[] } {
  const modIds: string[] = []
  const mapNames: string[] = []

  const candidates = [
    path.join(contentDir, 'mods'),
    path.join(contentDir, 'Contents', 'mods'),
  ]
  for (const modsDir of candidates) {
    if (!fileExists(modsDir)) continue
    let entries: string[]
    try {
      entries = fs.readdirSync(modsDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const modDir = path.join(modsDir, entry)
      try {
        if (!fs.statSync(modDir).isDirectory()) continue
      } catch {
        continue
      }
      const infoPath = path.join(modDir, 'mod.info')
      if (!fileExists(infoPath)) continue
      try {
        const parsed = parseModInfo(fs.readFileSync(infoPath, 'utf-8'))
        // Folder name is the canonical mod ID. mod.info `id=` should match,
        // but if it differs we trust the folder name (that's what PZ uses).
        const modId = entry
        if (modId && !modIds.includes(modId)) modIds.push(modId)
        for (const m of parsed.maps) {
          if (m && !mapNames.includes(m)) mapNames.push(m)
        }
      } catch {
        // Skip mods with unreadable mod.info.
      }
    }
  }

  return { modIds, mapNames }
}

// Write WorkshopItems= and Mods= back to servertest.ini from the manifest.
// This is the only place that touches those two keys; the manifest is canonical.
function syncModsToIni(manifest: ModsManifest) {
  const settings = getSettings() || {}
  const workshopIds: string[] = []
  const flatModIds: string[] = []
  for (const item of manifest.items) {
    if (item.workshopId && !workshopIds.includes(item.workshopId)) {
      workshopIds.push(item.workshopId)
    }
    for (const m of item.modIds) {
      if (m && !flatModIds.includes(m)) flatModIds.push(m)
    }
  }
  settings.WorkshopItems = workshopIds.join(';')
  settings.Mods = flatModIds.join(';')
  return saveSettings(settings)
}

// Fetch a fresh title from the Steam API. Best-effort; falls back to a
// "Workshop Item <id>" placeholder if the lookup fails.
async function fetchWorkshopTitle(workshopId: string): Promise<string> {
  try {
    const items = await fetchWorkshopItems([workshopId])
    return items[0]?.title || `Workshop Item ${workshopId}`
  } catch {
    return `Workshop Item ${workshopId}`
  }
}

// Detect mod IDs for a single workshop item. Used by both add and re-detect.
async function detectAndUpsertWorkshopItem(workshopId: string): Promise<{ success: boolean; error?: string; entry?: ManifestEntry }> {
  broadcastModsProgress({ phase: 'starting', workshopId, message: `Looking up ${workshopId}…` })

  const dl = await downloadWorkshopItem(workshopId)
  if (!dl.success || !dl.contentDir) {
    broadcastModsProgress({ phase: 'error', workshopId, message: dl.error || 'Download failed' })
    return { success: false, error: dl.error }
  }

  broadcastModsProgress({ phase: 'scanning', workshopId, message: 'Reading mod.info files…' })
  const { modIds, mapNames } = scanWorkshopContent(dl.contentDir)

  if (modIds.length === 0) {
    const msg = 'No mod folders found inside this workshop item (it may be map-only or malformed).'
    broadcastModsProgress({ phase: 'error', workshopId, message: msg })
    return { success: false, error: msg }
  }

  const title = await fetchWorkshopTitle(workshopId)
  const entry: ManifestEntry = { workshopId, title, modIds, mapNames, detectedAt: Date.now() }

  const manifest = readManifest()
  const idx = manifest.items.findIndex((i) => i.workshopId === workshopId)
  if (idx === -1) manifest.items.push(entry)
  else manifest.items[idx] = entry

  writeManifest(manifest)
  syncModsToIni(manifest)

  broadcastModsProgress({
    phase: 'done',
    workshopId,
    message: `Detected ${modIds.length} mod${modIds.length === 1 ? '' : 's'}: ${modIds.join(', ')}`,
  })
  return { success: true, entry }
}

// ── PUBLIC API ────────────────────────────────────────────────

// Reconcile the manifest with whatever's actually in servertest.ini. Returns
// the unified mod list plus a flag indicating whether the user should be
// prompted to re-detect (any workshop ID present in ini but missing from the
// manifest, or whose manifest entry looks like a legacy stub where the only
// mod ID equals the workshop ID).
function getMods() {
  try {
    const settings = getSettings() || {}
    const iniWorkshopIds = (settings.WorkshopItems || '').split(';').map((s: string) => s.trim()).filter(Boolean)
    const manifest = readManifest()
    const byId = new Map<string, ManifestEntry>(manifest.items.map((i) => [i.workshopId, i]))

    let needsRedetect = false
    const mods = iniWorkshopIds.map((wid: string) => {
      const entry = byId.get(wid)
      if (!entry) {
        needsRedetect = true
        return {
          id: wid,
          workshopId: wid,
          name: `Workshop Item ${wid}`,
          enabled: true,
          modIds: [] as string[],
          mapNames: [] as string[],
        }
      }
      // Legacy stub: a manifest entry whose only mod ID is the workshop ID
      // itself (which can't be a real folder name). Force a re-detect prompt.
      if (entry.modIds.length === 1 && entry.modIds[0] === wid) needsRedetect = true
      return {
        id: entry.modIds[0] || wid,
        workshopId: wid,
        name: entry.title || `Workshop Item ${wid}`,
        enabled: true,
        modIds: entry.modIds,
        mapNames: entry.mapNames,
      }
    })

    modsCache = mods
    return { success: true, mods, needsRedetect }
  } catch (err: any) {
    return { success: false, error: err.message, mods: [], needsRedetect: false }
  }
}

async function addMod(mod: any) {
  try {
    const workshopId = (mod && mod.workshopId) ? String(mod.workshopId).trim() : ''
    if (!workshopId) return { success: false, error: 'Missing workshopId.' }

    const manifest = readManifest()
    if (manifest.items.some((i) => i.workshopId === workshopId)) {
      return { success: false, error: 'That workshop item is already added.' }
    }

    return await detectAndUpsertWorkshopItem(workshopId)
  } catch (err: any) {
    broadcastModsProgress({ phase: 'error', message: err.message || String(err) })
    return { success: false, error: err.message }
  }
}

async function redetectMod(workshopId: string) {
  try {
    const wid = String(workshopId || '').trim()
    if (!wid) return { success: false, error: 'Missing workshopId.' }
    return await detectAndUpsertWorkshopItem(wid)
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

async function redetectAllMissing() {
  try {
    const settings = getSettings() || {}
    const iniWorkshopIds = (settings.WorkshopItems || '').split(';').map((s: string) => s.trim()).filter(Boolean)
    const manifest = readManifest()
    const byId = new Map<string, ManifestEntry>(manifest.items.map((i) => [i.workshopId, i]))

    const targets = iniWorkshopIds.filter((wid: string) => {
      const entry = byId.get(wid)
      if (!entry) return true
      // Legacy stub
      if (entry.modIds.length === 1 && entry.modIds[0] === wid) return true
      return false
    })

    if (targets.length === 0) return { success: true, redetected: 0 }

    let redetected = 0
    const errors: string[] = []
    for (const wid of targets) {
      const r = await detectAndUpsertWorkshopItem(wid)
      if (r.success) redetected++
      else if (r.error) errors.push(`${wid}: ${r.error}`)
    }
    return { success: errors.length === 0, redetected, total: targets.length, errors }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

function removeMod(id: string) {
  try {
    const wid = String(id || '').trim()
    if (!wid) return { success: false, error: 'Missing workshopId.' }

    // Delete the downloaded workshop content from disk too — removing a mod
    // should fully clean up, not just edit the INI. Guard the path: only
    // delete when wid is purely numeric so a malformed id can't escape the
    // content directory.
    if (/^\d+$/.test(wid)) {
      const contentDir = path.join(workshopCachePath, 'steamapps', 'workshop', 'content', PZ_GAME_APP_ID, wid)
      try { fs.rmSync(contentDir, { recursive: true, force: true }) } catch { /* best-effort */ }
    }

    const manifest = readManifest()
    const before = manifest.items.length
    manifest.items = manifest.items.filter((i) => i.workshopId !== wid)
    const removed = before !== manifest.items.length
    writeManifest(manifest)

    // Even if the manifest didn't have it (legacy ini-only entry), we still
    // want the ini line cleared. Read iniWorkshopIds, drop wid, then sync.
    const settings = getSettings() || {}
    const iniWorkshopIds = (settings.WorkshopItems || '').split(';').map((s: string) => s.trim()).filter(Boolean)
    const remaining = iniWorkshopIds.filter((x: string) => x !== wid)
    // If the removal exists in the ini but not in the manifest, build a
    // synthetic manifest from `remaining` so the sync produces clean output.
    if (!removed && remaining.length !== iniWorkshopIds.length) {
      // Anything not in the manifest gets a legacy stub entry so it survives the sync.
      const m = readManifest()
      for (const w of remaining) {
        if (!m.items.some((i) => i.workshopId === w)) {
          m.items.push({ workshopId: w, title: `Workshop Item ${w}`, modIds: [w], mapNames: [], detectedAt: 0 })
        }
      }
      // Strip the one we're removing (already filtered above by being absent).
      writeManifest(m)
      return syncModsToIni(m)
    }

    return syncModsToIni(manifest)
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════════
// BACKUP / RESTORE
// ═══════════════════════════════════════════════════════════════

async function listBackups() {
  try {
    ensureDir(backupsPath)
    const files = fs.readdirSync(backupsPath)
      .filter((f: string) => f.endsWith('.zip'))
      .map((f: string) => {
        const stat = fs.statSync(path.join(backupsPath, f))
        return {
          name: f,
          size: stat.size,
          date: stat.mtime.toISOString(),
        }
      })
      .sort((a: any, b: any) => +new Date(b.date) - +new Date(a.date))

    return { success: true, backups: files }
  } catch (err: any) {
    return { success: false, error: err.message, backups: [] }
  }
}

async function createBackup() {
  try {
    ensureDir(backupsPath)
    if (!fileExists(zomboidPath)) {
      return { success: false, error: 'No Zomboid data folder yet. Run the server at least once.' }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupName = `zomboid-backup-${timestamp}.zip`
    const backupPath = path.join(backupsPath, backupName)

    broadcastLog(`Creating backup: ${backupName}...`, 'info')

    await execAsync(`powershell -NoProfile -Command "Compress-Archive -Path '${zomboidPath}\\*' -DestinationPath '${backupPath}' -Force"`)

    broadcastLog('Backup created successfully', 'success')
    return { success: true, name: backupName }
  } catch (err: any) {
    broadcastLog(`Backup failed: ${err.message}`, 'error')
    return { success: false, error: err.message }
  }
}

async function restoreBackup(name: string) {
  try {
    const backupPath = path.join(backupsPath, name)
    if (!fileExists(backupPath)) {
      return { success: false, error: 'Backup not found' }
    }

    broadcastLog(`Restoring backup: ${name}...`, 'info')

    // Pre-restore safety backup
    const preRestore = path.join(backupsPath, `pre-restore-${Date.now()}.zip`)
    if (fileExists(zomboidPath)) {
      await execAsync(`powershell -NoProfile -Command "Compress-Archive -Path '${zomboidPath}\\*' -DestinationPath '${preRestore}' -Force"`)
    }

    // Extract over the existing folder
    ensureDir(zomboidPath)
    await execAsync(`powershell -NoProfile -Command "Expand-Archive -Path '${backupPath}' -DestinationPath '${zomboidPath}' -Force"`)

    broadcastLog('Backup restored successfully', 'success')
    return { success: true }
  } catch (err: any) {
    broadcastLog(`Restore failed: ${err.message}`, 'error')
    return { success: false, error: err.message }
  }
}

async function deleteBackup(name: string) {
  try {
    const backupPath = path.join(backupsPath, name)
    if (fileExists(backupPath)) {
      fs.unlinkSync(backupPath)
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ═══════════════════════════════════════════════════════════════
// STEAM WORKSHOP — metadata fetch + update check
// ═══════════════════════════════════════════════════════════════

const PZ_APP_ID_GAME = 108600 // Project Zomboid (game) — workshop items are children of this app
const STEAM_WS_API = 'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/'

interface WorkshopItem {
  id: string
  title?: string
  description?: string
  appId?: number
  fileSize?: number
  timeCreated?: number    // unix seconds
  timeUpdated?: number    // unix seconds
  visibility?: number
  banned?: number
  subscriptions?: number
  previewUrl?: string
  result?: number         // 1 = success, 9 = file not found
  isForPZ?: boolean
}

// Extract a Workshop ID from a paste — accepts:
//   - plain numeric ID:               "2392709985"
//   - sharedfiles URL:                "https://steamcommunity.com/sharedfiles/filedetails/?id=2392709985"
//   - filedetails URL with extra:     "...?id=2392709985&searchtext=..."
//   - workshop URL variant:           "https://steamcommunity.com/workshop/filedetails/?id=2392709985"
function extractWorkshopId(input: string): string | null {
  if (!input) return null
  const trimmed = input.trim()
  // Direct ID
  if (/^\d{6,12}$/.test(trimmed)) return trimmed
  // URL ?id=
  const m = trimmed.match(/[?&]id=(\d{6,12})/)
  if (m) return m[1]
  // any 8-12 digit sequence (last resort)
  const m2 = trimmed.match(/(\d{8,12})/)
  if (m2) return m2[1]
  return null
}

function httpsPostForm(url: string, formBody: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const opts: any = {
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formBody),
        'User-Agent': 'PZ-Server-Manager/1.0',
      },
      timeout: 10000,
    }
    const req = https.request(opts, (res: any) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode || 0, body }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('Request timed out')) })
    req.write(formBody)
    req.end()
  })
}

async function fetchWorkshopItems(ids: string[]): Promise<WorkshopItem[]> {
  if (!ids.length) return []
  // Build form body: itemcount=N&publishedfileids[0]=ID&publishedfileids[1]=ID...
  const params: string[] = [`itemcount=${ids.length}`]
  ids.forEach((id, i) => {
    params.push(`publishedfileids%5B${i}%5D=${encodeURIComponent(id)}`)
  })
  const body = params.join('&')

  try {
    const res = await httpsPostForm(STEAM_WS_API, body)
    if (res.status !== 200) {
      throw new Error(`Steam API HTTP ${res.status}`)
    }
    const json = JSON.parse(res.body)
    const details = json?.response?.publishedfiledetails
    if (!Array.isArray(details)) throw new Error('Unexpected Steam API response shape')

    return details.map((d: any): WorkshopItem => ({
      id: String(d.publishedfileid),
      title: d.title,
      description: d.description,
      appId: d.consumer_app_id,
      fileSize: d.file_size ? Number(d.file_size) : undefined,
      timeCreated: d.time_created,
      timeUpdated: d.time_updated,
      visibility: d.visibility,
      banned: d.banned,
      subscriptions: d.subscriptions,
      previewUrl: d.preview_url,
      result: d.result,
      isForPZ: d.consumer_app_id === PZ_APP_ID_GAME,
    }))
  } catch (err: any) {
    broadcastLog(`Workshop fetch failed: ${err.message}`, 'error')
    throw err
  }
}

// Mod cache: stores last-known Workshop metadata per ID so we can detect updates
// without hitting the API every render. Persisted to disk.
function readModCache(): Record<string, WorkshopItem & { checkedAt: number }> {
  try {
    if (!fileExists(modCachePath)) return {}
    return JSON.parse(fs.readFileSync(modCachePath, 'utf-8')) || {}
  } catch { return {} }
}
function writeModCache(cache: Record<string, any>) {
  try { fs.writeFileSync(modCachePath, JSON.stringify(cache, null, 2), 'utf-8') } catch {}
}

async function checkAllModUpdates() {
  try {
    const settings = getSettings() || {}
    const ids = (settings.WorkshopItems || '')
      .split(';')
      .map((s: string) => s.trim())
      .filter(Boolean)

    if (!ids.length) return { success: true, items: [], message: 'No workshop mods configured.' }

    broadcastLog(`Checking updates for ${ids.length} workshop mod(s)...`, 'info')
    // Steam allows multiple IDs in one request — chunk in batches of 50 to be safe
    const cache = readModCache()
    const results: Array<WorkshopItem & { previousTimeUpdated?: number; updateAvailable?: boolean }> = []

    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50)
      const items = await fetchWorkshopItems(chunk)
      for (const item of items) {
        const previous = cache[item.id]
        const updateAvailable = !!(previous && item.timeUpdated && previous.timeUpdated && item.timeUpdated > previous.timeUpdated)
        results.push({ ...item, previousTimeUpdated: previous?.timeUpdated, updateAvailable })
      }
    }

    // Update cache to current values
    const newCache: Record<string, any> = { ...cache }
    for (const r of results) {
      newCache[r.id] = { ...r, checkedAt: Date.now() }
    }
    writeModCache(newCache)

    return { success: true, items: results }
  } catch (err: any) {
    return { success: false, error: err.message, items: [] }
  }
}

// ── Workshop browser: search, collections, installed metadata ──────
// Item details, update checks, and collections all use Steam's KEYLESS
// ISteamRemoteStorage endpoints. Search works two ways:
//   1. Anonymous (default): the public Workshop browse pages are read
//      directly and each result is enriched through the same keyless
//      details endpoint. No key anywhere in the app or its config.
//   2. If the user voluntarily adds their OWN Steam Web API key (App
//      Settings), search upgrades to the official QueryFiles API, which
//      adds vote data. The key never leaves their machine except to
//      Steam itself, and is never sent back to the renderer.
// No key is bundled with the app, and every request goes straight from
// the user's machine to Steam — nothing is proxied, so no traffic or
// credential is traceable to the developer.

function httpsGetJson(url: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'PZ-Server-Manager/1.0' }, timeout: 10000 }, (res: any) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => { body += c })
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 0, json: JSON.parse(body) }) }
        catch { resolve({ status: res.statusCode || 0, json: null }) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('Request timed out')) })
  })
}

// EPublishedFileQueryType values used below:
//   1 = RankedByPublicationDate, 3 = RankedByTrend,
//   9 = RankedByTotalUniqueSubscriptions, 12 = RankedByTextSearch
const WORKSHOP_SORTS: Record<string, number> = {
  relevance: 12,
  popular: 9,
  trend: 3,
  recent: 1,
}

// ── Anonymous keyless search via the public Workshop browse pages ────
// The browse page is server-rendered: each grid card is
//   <a href=".../sharedfiles/filedetails/?id=N" ...><img src="..." alt="TITLE">
// and the filtered result count appears as "N entries matching filters".
// Steam serves 30 cards per page while our UI paginates by 20, so we map
// the requested UI page onto the Steam page(s) covering that window.

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const SEARCH_PAGE_SIZE = 20

const BROWSE_SORTS: Record<string, string> = {
  relevance: 'textsearch',
  popular: 'totaluniquesubscribers',
  trend: 'trend',
  recent: 'mostrecent',
}

function httpsGetText(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': BROWSER_UA }, timeout: 15000 }, (res: any) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode || 0, body }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(new Error('Request timed out')) })
  })
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// Strip Workshop BBCode from descriptions and keep them short for cards.
function cleanDescription(desc?: string): string {
  if (!desc) return ''
  return desc
    .replace(/\[\/?[a-zA-Z0-9=:;,.+\-_"'\s]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)
}

interface BrowsePageData {
  ids: string[]
  titles: Map<string, string>
  previews: Map<string, string>
  total: number | null
  perPage: number
}

function parseBrowsePage(html: string): BrowsePageData {
  const ids: string[] = []
  const titles = new Map<string, string>()
  const previews = new Map<string, string>()
  const re = /filedetails\/\?id=(\d+)"[^>]*>\s*<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (!titles.has(m[1])) {
      ids.push(m[1])
      titles.set(m[1], decodeHtmlEntities(m[3]))
      previews.set(m[1], m[2].replace(/&amp;/g, '&'))
    }
  }
  const totalM = html.match(/([\d,]+) entries matching filters/)
  const total = totalM ? Number(totalM[1].replace(/,/g, '')) : null
  // Page size is embedded (escaped) in the SSR payload: num_per_page\":30
  const nppM = html.match(/num_per_page\\?":(\d+)/)
  const perPage = nppM ? Math.max(1, Number(nppM[1])) : 30
  return { ids, titles, previews, total, perPage }
}

async function fetchBrowsePage(query: string, browseSort: string, steamPage: number): Promise<BrowsePageData> {
  const params = new URLSearchParams({
    appid: String(PZ_APP_ID_GAME),
    browsesort: browseSort,
    section: 'readytouseitems',
    p: String(steamPage),
  })
  if (query) params.set('searchtext', query)
  const r = await httpsGetText(`https://steamcommunity.com/workshop/browse/?${params.toString()}`)
  if (r.status === 429) throw new Error('Steam is rate-limiting page requests — wait a minute and try again.')
  if (r.status !== 200) throw new Error(`Steam Workshop returned HTTP ${r.status}.`)
  return parseBrowsePage(r.body)
}

async function workshopSearchKeyless(opts: { query: string; sort: string; page: number }) {
  let browseSort = BROWSE_SORTS[opts.sort] || 'totaluniquesubscribers'
  // Text-search ranking with no text returns nothing useful — browse popular.
  if (browseSort === 'textsearch' && !opts.query) browseSort = 'totaluniquesubscribers'

  const start = (opts.page - 1) * SEARCH_PAGE_SIZE

  // Steam's grid page size (30 today) is detected from the response; if it
  // ever changes, redo the mapping with the detected size.
  let steamNpp = 30
  let steamPage = Math.floor(start / steamNpp) + 1
  let first = await fetchBrowsePage(opts.query, browseSort, steamPage)
  if (first.perPage !== steamNpp && first.perPage > 0) {
    steamNpp = first.perPage
    steamPage = Math.floor(start / steamNpp) + 1
    first = await fetchBrowsePage(opts.query, browseSort, steamPage)
  }

  const offset = start - (steamPage - 1) * steamNpp
  const titles = new Map(first.titles)
  const previews = new Map(first.previews)
  let windowIds = first.ids.slice(offset, offset + SEARCH_PAGE_SIZE)
  let total = first.total

  // The 20-item window can straddle two Steam pages (offset > 10).
  if (windowIds.length < SEARCH_PAGE_SIZE && (total === null || start + windowIds.length < total)) {
    try {
      const second = await fetchBrowsePage(opts.query, browseSort, steamPage + 1)
      for (const [k, v] of second.titles) titles.set(k, v)
      for (const [k, v] of second.previews) previews.set(k, v)
      windowIds = windowIds.concat(second.ids.slice(0, SEARCH_PAGE_SIZE - windowIds.length))
      if (total === null) total = second.total
    } catch { /* partial page is fine */ }
  }

  // Enrich with keyless metadata (subs/size/updated). Best-effort — if the
  // details call fails, the scraped titles/previews still render.
  let detailsById = new Map<string, WorkshopItem>()
  try {
    detailsById = new Map((await fetchWorkshopItems(windowIds)).map((d) => [d.id, d]))
  } catch { /* scraped data only */ }

  const installed = new Set(readManifest().items.map((i) => i.workshopId))
  const items = windowIds.map((id) => {
    const d = detailsById.get(id)
    return {
      id,
      title: d?.title || titles.get(id) || `Workshop ${id}`,
      description: cleanDescription(d?.description),
      previewUrl: d?.previewUrl || previews.get(id),
      fileSize: d?.fileSize,
      timeUpdated: d?.timeUpdated,
      subscriptions: d?.subscriptions,
      installed: installed.has(id),
    }
  })
  return { success: true, items, total: total ?? (start + items.length), page: opts.page }
}

// ── Optional keyed search via the official Web API ───────────────────
// Only used when the user supplied their own key. Adds vote data.
async function workshopSearchKeyed(opts: { query: string; sort: string; page: number; key: string }) {
  const query = opts.query
  const page = opts.page
  let queryType = WORKSHOP_SORTS[opts.sort] ?? (query ? 12 : 9)
  if (!query && queryType === 12) queryType = 9

  const params = new URLSearchParams({
    key: opts.key,
    appid: String(PZ_APP_ID_GAME),
    query_type: String(queryType),
    page: String(page),
    numperpage: String(SEARCH_PAGE_SIZE),
    search_text: query,
    return_vote_data: 'true',
    return_short_description: 'true',
    format: 'json',
  })
  try {
    const r = await httpsGetJson(`https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/?${params.toString()}`)
    if (r.status === 403) {
      // Bad/revoked key — fall back to anonymous search so the panel keeps working.
      return workshopSearchKeyless({ query, sort: opts.sort, page })
    }
    if (r.status !== 200 || !r.json) {
      return { success: false, error: `Steam API HTTP ${r.status}`, items: [], total: 0 }
    }
    const resp = r.json.response || {}
    const details: any[] = Array.isArray(resp.publishedfiledetails) ? resp.publishedfiledetails : []
    const installed = new Set(readManifest().items.map((i) => i.workshopId))
    const items = details.map((d: any) => ({
      id: String(d.publishedfileid),
      title: d.title,
      description: d.short_description || '',
      previewUrl: d.preview_url,
      fileSize: d.file_size ? Number(d.file_size) : undefined,
      timeUpdated: d.time_updated,
      subscriptions: d.subscriptions,
      voteScore: d.vote_data?.score,
      votesUp: d.vote_data?.votes_up,
      installed: installed.has(String(d.publishedfileid)),
    }))
    return { success: true, items, total: Number(resp.total) || items.length, page }
  } catch (err: any) {
    return { success: false, error: err.message, items: [], total: 0 }
  }
}

async function workshopSearch(opts: { query?: string; sort?: string; page?: number }) {
  const query = (opts?.query || '').trim()
  const page = Math.max(1, Number(opts?.page) || 1)
  const sort = opts?.sort || ''
  const key = getSteamApiKeyInternal()
  try {
    if (key) return await workshopSearchKeyed({ query, sort, page, key })
    return await workshopSearchKeyless({ query, sort, page })
  } catch (err: any) {
    return { success: false, error: err.message, items: [], total: 0 }
  }
}

// Resolve a collection URL/ID to its title + member items (with metadata).
async function workshopGetCollection(input: string) {
  const id = extractWorkshopId(input)
  if (!id) return { success: false, error: 'Could not parse a collection ID from that input.' }
  try {
    const body = `collectioncount=1&publishedfileids%5B0%5D=${encodeURIComponent(id)}`
    const res = await httpsPostForm('https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/', body)
    if (res.status !== 200) return { success: false, error: `Steam API HTTP ${res.status}` }
    const json = JSON.parse(res.body)
    const col = json?.response?.collectiondetails?.[0]
    if (!col || col.result !== 1 || !Array.isArray(col.children)) {
      return { success: false, error: 'That item is not a public collection (or it has no entries).' }
    }
    // filetype 0 = workshop item; skip nested collections / other types.
    const childIds: string[] = col.children
      .filter((c: any) => c.filetype === 0)
      .sort((a: any, b: any) => (a.sortorder || 0) - (b.sortorder || 0))
      .map((c: any) => String(c.publishedfileid))
    if (childIds.length === 0) return { success: false, error: 'Collection has no workshop items.' }

    // Title of the collection itself + details of members (chunks of 50).
    const [meta] = await fetchWorkshopItems([id]).catch(() => [undefined as any])
    const installed = new Set(readManifest().items.map((i) => i.workshopId))
    const items: any[] = []
    for (let i = 0; i < childIds.length; i += 50) {
      const chunk = await fetchWorkshopItems(childIds.slice(i, i + 50))
      for (const it of chunk) {
        items.push({
          id: it.id,
          title: it.title,
          previewUrl: it.previewUrl,
          fileSize: it.fileSize,
          timeUpdated: it.timeUpdated,
          subscriptions: it.subscriptions,
          installed: installed.has(it.id),
        })
      }
    }
    return { success: true, collection: { id, title: meta?.title || `Collection ${id}` }, items }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// Metadata for the installed-mods cards: manifest entries enriched with
// Workshop details (thumbnail, size, updated). Steam fetch is best-effort —
// offline we fall back to the on-disk mod cache.
async function getInstalledModsDetails() {
  try {
    const base = getMods()
    if (!base.success) return { success: false, error: base.error, mods: [] }
    const ids = base.mods.map((m: any) => m.workshopId)
    let detailsById = new Map<string, WorkshopItem>()
    if (ids.length) {
      try {
        const fresh: WorkshopItem[] = []
        for (let i = 0; i < ids.length; i += 50) {
          fresh.push(...await fetchWorkshopItems(ids.slice(i, i + 50)))
        }
        detailsById = new Map(fresh.map((d) => [d.id, d]))
      } catch {
        const cache = readModCache()
        detailsById = new Map(Object.entries(cache))
      }
    }
    const mods = base.mods.map((m: any) => {
      const d = detailsById.get(m.workshopId)
      return {
        ...m,
        previewUrl: d?.previewUrl,
        fileSize: d?.fileSize,
        timeUpdated: d?.timeUpdated,
        subscriptions: d?.subscriptions,
      }
    })
    return { success: true, mods, needsRedetect: base.needsRedetect }
  } catch (err: any) {
    return { success: false, error: err.message, mods: [] }
  }
}

// ═══════════════════════════════════════════════════════════════
// SERVER WIPE
// ═══════════════════════════════════════════════════════════════

type WipeScope = {
  world?: boolean      // ~/Zomboid/Saves/Multiplayer/<servername>/
  players?: boolean    // ~/Zomboid/db/<servername>.db
  logs?: boolean       // ~/Zomboid/Logs/
  history?: boolean    // ~/PZ-Server-Manager/player-history.json
  config?: boolean     // ~/Zomboid/Server/<servername>.ini + sandbox + spawnregions
  backup?: boolean     // create a safety backup before wiping
  serverName?: string  // defaults to "servertest"
}

async function wipeServer(scope: WipeScope) {
  // Hard guard: server must be offline. Wiping while files are open will
  // either fail or corrupt the running state.
  if (serverProcess && !serverProcess.killed) {
    return { success: false, error: 'Stop the server before wiping.' }
  }
  const portHolder = await findPortHolder(DEFAULT_PORT)
  if (portHolder) {
    return { success: false, error: `Server still running (PID ${portHolder}). Stop it first.` }
  }

  const name = scope.serverName || 'servertest'
  const removed: string[] = []
  const failed: string[] = []

  // Optional safety backup first
  if (scope.backup) {
    try {
      await createBackup()
    } catch (err: any) {
      broadcastLog(`Pre-wipe backup failed: ${err.message}`, 'warn')
    }
  }

  const tryRemove = (pathToRemove: string, label: string) => {
    try {
      if (fileExists(pathToRemove)) {
        fs.rmSync(pathToRemove, { recursive: true, force: true })
        removed.push(label)
        broadcastLog(`Wiped: ${label}`, 'success')
      } else {
        broadcastLog(`Skipped (not found): ${label}`, 'info')
      }
    } catch (err: any) {
      failed.push(`${label}: ${err.message}`)
      broadcastLog(`Failed to wipe ${label}: ${err.message}`, 'error')
    }
  }

  if (scope.world) {
    tryRemove(path.join(zomboidPath, 'Saves', 'Multiplayer', name), `World save (${name})`)
  }
  if (scope.players) {
    tryRemove(path.join(zomboidPath, 'db', `${name}.db`), `Player database (${name}.db)`)
    tryRemove(path.join(zomboidPath, 'db', `${name}.db-shm`), `Player database SHM`)
    tryRemove(path.join(zomboidPath, 'db', `${name}.db-wal`), `Player database WAL`)
  }
  if (scope.logs) {
    tryRemove(path.join(zomboidPath, 'Logs'), 'Server logs')
  }
  if (scope.history) {
    tryRemove(playerHistoryPath, 'Player history')
  }
  if (scope.config) {
    tryRemove(path.join(zomboidPath, 'Server', `${name}.ini`), `Server INI (${name}.ini)`)
    tryRemove(path.join(zomboidPath, 'Server', `${name}_SandboxVars.lua`), `Sandbox vars`)
    tryRemove(path.join(zomboidPath, 'Server', `${name}_spawnregions.lua`), `Spawn regions`)
    settingsCache = null  // force reload next time
  }

  return {
    success: failed.length === 0,
    removed,
    failed,
    message: `Wiped ${removed.length} target(s)${failed.length ? `, ${failed.length} failed` : ''}.`,
  }
}

// ═══════════════════════════════════════════════════════════════
// PLAYER HISTORY — parse log lines, persist sessions
// ═══════════════════════════════════════════════════════════════

interface PlayerSession {
  start: string         // ISO
  end?: string          // ISO (undefined while online)
  durationMs?: number
  ip?: string
  steamId?: string
}

interface PlayerRecord {
  username: string
  firstSeen: string
  lastSeen: string
  totalSessions: number
  totalPlayMs: number
  currentlyOnline: boolean
  steamId?: string
  lastIp?: string
  sessions: PlayerSession[]   // newest last; capped to 100
}

function readPlayerHistory(): Record<string, PlayerRecord> {
  try {
    if (!fileExists(playerHistoryPath)) return {}
    const raw = JSON.parse(fs.readFileSync(playerHistoryPath, 'utf-8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch { return {} }
}

function writePlayerHistory(history: Record<string, PlayerRecord>) {
  try {
    ensureDir(path.dirname(playerHistoryPath))
    fs.writeFileSync(playerHistoryPath, JSON.stringify(history, null, 2), 'utf-8')
  } catch (err: any) {
    broadcastLog(`Could not save player history: ${err.message}`, 'warn')
  }
}

let playerHistoryCache: Record<string, PlayerRecord> | null = null

// Lines that look like player events but weren't successfully parsed. Kept in
// memory only (50 most recent). The Players page surfaces these as a
// diagnostic so we can iterate the regex against real Build 42 output.
const unmatchedEvents: Array<{ line: string; at: string }> = []

// Word-class for usernames — letters, digits, underscore, hyphen, period.
// Length 2-32. Build 42 doesn't allow spaces in names so this stays tight.
const NAME = `[A-Za-z0-9_\\-\\.]{2,32}`

// Try a list of connect/disconnect patterns. First match wins. New shapes for
// Build 42 added in front; older Build 41 patterns kept for backward compat.
const CONNECT_PATTERNS: RegExp[] = [
  // Build 42 ZNet variants
  new RegExp(`\\[ZNet\\][^\\[\\]]*?\\b(${NAME})\\s+(?:has joined|fully connected|connected|joined the game|joined the server)`, 'i'),
  new RegExp(`\\b(${NAME})\\s+connected as\\s+\\d+`, 'i'),
  new RegExp(`'(${NAME})'\\s+(?:has signed in|has joined|connected)`, 'i'),
  // Build 41 / generic
  new RegExp(`\\bUser\\s+(${NAME})\\s+(?:is connecting|has joined|logged in|fully connected|connected|joined the game|joined the server|joined)`, 'i'),
  new RegExp(`\\bConnectionManager:\\s*['"]?(${NAME})['"]?\\s+(?:connected|has joined)`, 'i'),
  new RegExp(`\\bconnection[^:]*:\\s*['"]?(${NAME})['"]?\\s+(?:connected|has joined)`, 'i'),
]

const DISCONNECT_PATTERNS: RegExp[] = [
  new RegExp(`\\[ZNet\\][^\\[\\]]*?\\b(${NAME})\\s+(?:has left|disconnected|lost connection|left the server|left the game|logged out)`, 'i'),
  new RegExp(`\\bUser\\s+(${NAME})\\s+(?:disconnected|has left|left the server|left the game|lost connection|logged out)`, 'i'),
  new RegExp(`\\bConnectionManager:\\s*['"]?(${NAME})['"]?\\s+(?:disconnected|has left)`, 'i'),
  new RegExp(`'(${NAME})'\\s+(?:has signed out|has left|disconnected)`, 'i'),
  new RegExp(`\\b(${NAME})\\s+(?:disconnected from the server|left the game)`, 'i'),
]

// Keyword that suggests the line is about a player connection event. Used to
// detect "we should have parsed this" candidates for the diagnostic buffer.
const PLAYER_KEYWORD_RE = /\b(?:is connecting|connected|disconnected|has joined|has left|left the server|left the game|logged in|logged out|fully connected|signed (?:in|out))\b/i

function tryMatchPatterns(line: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = line.match(p)
    if (m && m[1]) return m[1]
  }
  return null
}

function pushUnmatched(line: string) {
  unmatchedEvents.push({ line: line.slice(0, 500), at: new Date().toISOString() })
  if (unmatchedEvents.length > 50) unmatchedEvents.splice(0, unmatchedEvents.length - 50)
}

function recordPlayerEvent(line: string) {
  if (!line) return
  if (!playerHistoryCache) playerHistoryCache = readPlayerHistory()
  const history = playerHistoryCache
  const now = new Date().toISOString()
  let dirty = false

  const connectName = tryMatchPatterns(line, CONNECT_PATTERNS)
  const disconnectName = !connectName ? tryMatchPatterns(line, DISCONNECT_PATTERNS) : null

  // Sometimes Steam ID appears on the same or next line; capture if present
  const steamIdMatch = line.match(/\b(7656119\d{10})\b/)
  const ipMatch = line.match(/\bfrom\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i)

  // If neither connect nor disconnect captured but the line looks like one,
  // record it as a diagnostic candidate so we can iterate the regex.
  if (!connectName && !disconnectName && PLAYER_KEYWORD_RE.test(line)) {
    pushUnmatched(line)
  }

  if (connectName) {
    const name = connectName
    if (!history[name]) {
      history[name] = {
        username: name,
        firstSeen: now,
        lastSeen: now,
        totalSessions: 0,
        totalPlayMs: 0,
        currentlyOnline: false,
        sessions: [],
      }
    }
    const rec = history[name]
    // Avoid double-recording if connect appears multiple times in succession
    const lastSession = rec.sessions[rec.sessions.length - 1]
    if (!rec.currentlyOnline) {
      rec.currentlyOnline = true
      rec.totalSessions++
      rec.lastSeen = now
      const session: PlayerSession = { start: now }
      if (steamIdMatch) { session.steamId = steamIdMatch[1]; rec.steamId = steamIdMatch[1] }
      if (ipMatch) { session.ip = ipMatch[1]; rec.lastIp = ipMatch[1] }
      rec.sessions.push(session)
      if (rec.sessions.length > 100) rec.sessions.splice(0, rec.sessions.length - 100)
      dirty = true
      broadcastLog(`Player connected: ${name}`, 'success')
      pushActivity({ at: now, kind: 'connect', message: `${name} connected` })
    } else if (lastSession && (steamIdMatch || ipMatch)) {
      if (steamIdMatch && !lastSession.steamId) { lastSession.steamId = steamIdMatch[1]; rec.steamId = steamIdMatch[1]; dirty = true }
      if (ipMatch && !lastSession.ip) { lastSession.ip = ipMatch[1]; rec.lastIp = ipMatch[1]; dirty = true }
    }
  } else if (disconnectName) {
    const name = disconnectName
    const rec = history[name]
    if (rec && rec.currentlyOnline) {
      rec.currentlyOnline = false
      rec.lastSeen = now
      const session = rec.sessions[rec.sessions.length - 1]
      if (session && !session.end) {
        session.end = now
        session.durationMs = Math.max(0, new Date(now).getTime() - new Date(session.start).getTime())
        rec.totalPlayMs += session.durationMs
      }
      dirty = true
      broadcastLog(`Player disconnected: ${name}`, 'info')
      pushActivity({ at: now, kind: 'disconnect', message: `${name} disconnected` })
    }
  }

  if (dirty) writePlayerHistory(history)
}

// On server start, mark everyone as offline (we don't know their state from
// before the manager was running). On stop, do the same.
function resetOnlineFlags() {
  if (!playerHistoryCache) playerHistoryCache = readPlayerHistory()
  const now = new Date().toISOString()
  let dirty = false
  for (const rec of Object.values(playerHistoryCache)) {
    if (rec.currentlyOnline) {
      rec.currentlyOnline = false
      rec.lastSeen = now
      const last = rec.sessions[rec.sessions.length - 1]
      if (last && !last.end) {
        last.end = now
        last.durationMs = Math.max(0, new Date(now).getTime() - new Date(last.start).getTime())
        rec.totalPlayMs += last.durationMs
      }
      dirty = true
    }
  }
  if (dirty) writePlayerHistory(playerHistoryCache)
}

function getPlayerHistory() {
  if (!playerHistoryCache) playerHistoryCache = readPlayerHistory()
  // If we're not actively running a server through this manager session, any
  // "currentlyOnline=true" flags are stale (left over from a previous manager
  // crash). Clear them lazily on read so the UI doesn't lie.
  if (!serverProcess && serverStatus !== 'online' && serverStatus !== 'starting') {
    resetOnlineFlags()
  }
  const list = Object.values(playerHistoryCache).sort((a, b) =>
    new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
  )
  return { success: true, players: list, count: list.length }
}

function clearPlayerHistory() {
  playerHistoryCache = {}
  writePlayerHistory({})
  return { success: true }
}

function getOnlineCount() {
  if (!playerHistoryCache) playerHistoryCache = readPlayerHistory()
  // Same lazy-cleanup logic as getPlayerHistory: stale online flags should
  // never be reported when the server isn't actually running.
  if (!serverProcess && serverStatus !== 'online' && serverStatus !== 'starting') {
    return { success: true, count: 0 }
  }
  let count = 0
  for (const rec of Object.values(playerHistoryCache)) if (rec.currentlyOnline) count++
  return { success: true, count }
}

function getUnmatchedEvents() {
  return { success: true, events: [...unmatchedEvents].reverse() }
}

function clearUnmatchedEvents() {
  unmatchedEvents.length = 0
  return { success: true }
}

// First non-internal IPv4 address available locally. Used by the Dashboard
// header to show the LAN IP that other machines on the network can connect
// to. Returns null when no usable interface is found.
function getLocalIp() {
  try {
    const nets = require('os').networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const iface of nets[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return { success: true, ip: iface.address as string, iface: name }
        }
      }
    }
  } catch {}
  return { success: true, ip: null as string | null, iface: null as string | null }
}

// ═══════════════════════════════════════════════════════════════
// SERVER METRICS — CPU% + RAM of the actual Java server process.
//
// serverProcess is a cmd.exe wrapper; the interesting process is the Java
// grandchild. We resolve it via the UDP port holder (same trick stopServer
// uses), then sample TotalProcessorTime + WorkingSet64 with PowerShell every
// 5s while online. CPU% is the delta of processor time over wall time,
// normalised by core count. History keeps the last 120 points (~10 min).
// ═══════════════════════════════════════════════════════════════

const METRICS_INTERVAL_MS = 5000
const METRICS_HISTORY_MAX = 120
const NUM_CORES = Math.max(1, require('os').cpus().length)

let metricsHistory: Array<{ t: number; cpuPercent: number; memoryBytes: number; onlineCount: number }> = []
let metricsTimer: any = null
let metricsJavaPid: number | null = null
let lastCpuSample: { wallMs: number; cpuMs: number } | null = null
let metricsSampling = false

async function sampleMetricsOnce() {
  if (metricsSampling || serverStatus !== 'online') return
  metricsSampling = true
  try {
    if (!metricsJavaPid) {
      metricsJavaPid = await findPortHolder(DEFAULT_PORT)
      lastCpuSample = null
    }
    if (!metricsJavaPid) return

    const pid = metricsJavaPid
    const out = await new Promise<string>((resolve) => {
      exec(
        `powershell -NoProfile -Command "$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { Write-Output ([string]$p.TotalProcessorTime.TotalMilliseconds + '|' + [string]$p.WorkingSet64) }"`,
        { timeout: 8000 },
        (_err: any, stdout: string) => resolve((stdout || '').trim())
      )
    })
    const m = out.match(/^([\d.]+)\|(\d+)$/)
    if (!m) {
      // Process is gone (restart in flight?) — drop the cached pid and retry next tick.
      metricsJavaPid = null
      lastCpuSample = null
      return
    }
    const cpuMs = parseFloat(m[1])
    const memoryBytes = parseInt(m[2], 10)
    const wallMs = Date.now()

    let cpuPercent = 0
    if (lastCpuSample && wallMs > lastCpuSample.wallMs) {
      cpuPercent = ((cpuMs - lastCpuSample.cpuMs) / (wallMs - lastCpuSample.wallMs)) * 100 / NUM_CORES
      cpuPercent = Math.max(0, Math.min(100, cpuPercent))
    }
    lastCpuSample = { wallMs, cpuMs }

    metricsHistory.push({
      t: wallMs,
      cpuPercent: Math.round(cpuPercent * 10) / 10,
      memoryBytes,
      onlineCount: getOnlineCount().count,
    })
    if (metricsHistory.length > METRICS_HISTORY_MAX) {
      metricsHistory.splice(0, metricsHistory.length - METRICS_HISTORY_MAX)
    }
  } catch { /* sampling is best-effort */ }
  finally { metricsSampling = false }
}

function startMetricsPoll() {
  stopMetricsPoll()
  metricsHistory = []
  metricsJavaPid = null
  lastCpuSample = null
  metricsTimer = setInterval(() => { sampleMetricsOnce() }, METRICS_INTERVAL_MS)
  sampleMetricsOnce()
}

function stopMetricsPoll() {
  if (metricsTimer) { clearInterval(metricsTimer); metricsTimer = null }
  metricsJavaPid = null
  lastCpuSample = null
}

async function getServerMetrics() {
  const isRunning = !!(serverProcess && !serverProcess.killed && serverStatus === 'online')
  const latest = metricsHistory[metricsHistory.length - 1]
  return {
    success: true,
    running: isRunning,
    cpuPercent: isRunning && latest ? latest.cpuPercent : 0,
    memoryBytes: isRunning && latest ? latest.memoryBytes : 0,
    uptime: isRunning && serverUptime ? Date.now() - serverUptime : 0,
    onlineCount: getOnlineCount().count,
    history: isRunning ? metricsHistory.slice() : [],
  }
}


// ═══════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════

function cleanup() {
  // Best-effort: kill our tracked process AND anything bound to 16261.
  // Synchronous-ish because the app is exiting; we fire-and-forget the kills.
  const pid = serverProcess && !serverProcess.killed ? serverProcess.pid : null
  if (pid) {
    try { exec(`taskkill /F /T /PID ${pid}`, () => {}) } catch {}
  }
  // Spawn a non-blocking netstat check + kill. We can't await here because
  // Electron is already in window-all-closed.
  exec('netstat -ano -p UDP', (err: any, stdout: string) => {
    if (err || !stdout) return
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(new RegExp(`\\bUDP\\b\\s+\\S+:${DEFAULT_PORT}\\s+\\S+\\s+(\\d+)`))
      if (m) exec(`taskkill /F /T /PID ${m[1]}`, () => {})
    }
  })
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  // Config / wiring
  cleanup,
  setOnStatus: (cb: (s: string) => void) => { callbacks.onStatus = cb },
  setOnLog: (cb: (d: any) => void) => { callbacks.onLog = cb },
  // Back-compat property setters used by main.ts (`backend.onStatus = ...`)
  get onStatus() { return callbacks.onStatus },
  set onStatus(cb: any) { callbacks.onStatus = cb },
  get onLog() { return callbacks.onLog },
  set onLog(cb: any) { callbacks.onLog = cb },
  get onModsProgress() { return callbacks.onModsProgress },
  set onModsProgress(cb: any) { callbacks.onModsProgress = cb },

  // Paths config
  getPaths,
  setPaths,
  detectExistingServer,
  scanForExistingPzServer,

  // App preferences (tray, Steam API key)
  getAppPrefs,
  setAppPrefs,

  // Install
  installSteamCmd,
  installPzServer,
  getInstallStatus,
  checkGameUpdate,
  updateGameServer,

  // Metrics
  getServerMetrics,

  // Live server console (stdin-based)
  consoleStatus,
  consoleGetPlayers,
  consoleBroadcast,
  consoleSendCommand,

  // Admin actions (kick / ban / arbitrary command / status)
  adminKick,
  adminBan,
  adminCommand,
  adminStatus,

  // Chat feed (parsed from log)
  getChatLog,
  clearChatLog,

  // Daily schedules
  listSchedules,
  saveSchedulesList,
  deleteSchedule,

  // Misc helpers
  getLocalIp,
  getActivity,

  // Server
  startServer,
  stopServer,
  restartServer,
  getServerStatus,
  getRecentLogs,

  // Settings
  getSettings,
  saveSettings,
  getServerIni,
  saveServerIni,

  // Sandbox vars (gameplay: zombies/loot/world)
  getSandbox,
  saveSandbox,
  saveSandboxRaw,

  // Mods
  getMods,
  addMod,
  removeMod,
  redetectMod,
  redetectAllMissing,

  // Backup
  listBackups,
  createBackup,
  restoreBackup,
  deleteBackup,

  // Workshop
  checkAllModUpdates,
  workshopSearch,
  workshopGetCollection,
  getInstalledModsDetails,

  // Wipe
  wipeServer,

  // Player history
  getPlayerHistory,
  clearPlayerHistory,
  getOnlineCount,
  getUnmatchedEvents,
  clearUnmatchedEvents,
}
