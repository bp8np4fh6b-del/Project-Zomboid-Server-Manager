export interface ServerStatus {
  status: 'offline' | 'starting' | 'online' | 'stopping'
  pid: number | null
  uptime: number
  port: number
  installPath: string
}

export interface ServerLog {
  timestamp: string
  level: 'info' | 'error' | 'warn' | 'success'
  line: string
}

export interface InstallStatus {
  steamcmd: boolean
  pzServer: boolean
  steamCmdPath: string
  serverPath: string
}

export interface PzSettings {
  PublicName?: string
  PublicDescription?: string
  MaxPlayers?: string
  Public?: string
  PVP?: string
  Password?: string
  DefaultPort?: string
  UPnP?: string
  SaveWorldEveryMinutes?: string
  PauseEmpty?: string
  GlobalChat?: string
  Open?: string
  ServerPlayerID?: string
  SteamVAC?: string
  SteamScoreboard?: string
  VoiceEnable?: string
  VoiceMinDistance?: string
  VoiceMaxDistance?: string
  Voice3D?: string
  WorkshopItems?: string
  Mods?: string
  [key: string]: string | undefined
}

export interface ModItem {
  id: string
  workshopId: string
  name: string
  enabled: boolean
  modIds: string[]
  mapNames: string[]
}

export interface ModsProgressEvent {
  phase: 'starting' | 'downloading' | 'scanning' | 'done' | 'error'
  workshopId?: string
  message: string
}

export interface BackupItem {
  name: string
  size: number
  date: string
}

export interface WorkshopItemInfo {
  id: string
  title?: string
  description?: string
  appId?: number
  fileSize?: number
  timeCreated?: number
  timeUpdated?: number
  visibility?: number
  banned?: number
  subscriptions?: number
  previewUrl?: string
  result?: number
  isForPZ?: boolean
  previousTimeUpdated?: number
  updateAvailable?: boolean
}

export interface WipeScopeInput {
  world?: boolean
  players?: boolean
  logs?: boolean
  history?: boolean
  config?: boolean
  backup?: boolean
  serverName?: string
}

export interface PlayerSession {
  start: string
  end?: string
  durationMs?: number
  ip?: string
  steamId?: string
}

export interface PlayerRecord {
  username: string
  firstSeen: string
  lastSeen: string
  totalSessions: number
  totalPlayMs: number
  currentlyOnline: boolean
  steamId?: string
  lastIp?: string
  sessions: PlayerSession[]
}

declare global {
  interface Window {
    electronAPI: {
      startServer: (opts?: any) => Promise<any>
      stopServer: () => Promise<any>
      restartServer: () => Promise<any>
      getServerStatus: () => Promise<ServerStatus>
      onServerStatus: (cb: (status: string) => void) => () => void
      getServerLogs: () => Promise<ServerLog[]>
      onServerLog: (cb: (log: ServerLog) => void) => () => void
      installSteamCmd: () => Promise<any>
      installPzServer: () => Promise<any>
      getInstallStatus: () => Promise<InstallStatus>
      getSettings: () => Promise<PzSettings>
      saveSettings: (s: PzSettings) => Promise<any>
      getServerIni: () => Promise<{ success: boolean; content?: string; error?: string }>
      saveServerIni: (content: string) => Promise<any>
      getSandbox: () => Promise<{ success: boolean; vars: Record<string, string>; raw: string; error?: string }>
      saveSandbox: (vars: Record<string, string>) => Promise<any>
      saveSandboxRaw: (content: string) => Promise<any>
      getMods: () => Promise<{ success: boolean; mods: ModItem[]; needsRedetect?: boolean; error?: string }>
      addMod: (mod: { workshopId: string }) => Promise<{ success: boolean; error?: string; entry?: { workshopId: string; title: string; modIds: string[]; mapNames: string[] } }>
      removeMod: (id: string) => Promise<any>
      toggleMod: (id: string) => Promise<any>
      redetectMod: (id: string) => Promise<{ success: boolean; error?: string; entry?: { workshopId: string; title: string; modIds: string[]; mapNames: string[] } }>
      redetectAllMissing: () => Promise<{ success: boolean; redetected?: number; total?: number; errors?: string[]; error?: string }>
      onModsProgress: (cb: (data: ModsProgressEvent) => void) => () => void
      getBackups: () => Promise<{ success: boolean; backups: BackupItem[]; error?: string }>
      createBackup: () => Promise<any>
      restoreBackup: (name: string) => Promise<any>
      deleteBackup: (name: string) => Promise<any>
      workshopLookup: (input: string) => Promise<{ success: boolean; item?: WorkshopItemInfo; error?: string }>
      checkModUpdates: () => Promise<{ success: boolean; items: WorkshopItemInfo[]; error?: string; message?: string }>
      wipeServer: (scope: WipeScopeInput) => Promise<{ success: boolean; removed: string[]; failed: string[]; message?: string; error?: string }>
      getPlayerHistory: () => Promise<{ success: boolean; players: PlayerRecord[]; count: number }>
      clearPlayerHistory: () => Promise<any>
      selectFolder: () => Promise<string | null>
      openExternal: (url: string) => Promise<any>
      getPaths: () => Promise<{ userData: string; home: string; documents: string }>
      getManagerPaths: () => Promise<{ success: boolean; paths: { basePath: string; serverPath: string; zomboidPath: string }; defaults: { basePath: string; serverPath: string; zomboidPath: string }; configFile: string }>
      setManagerPaths: (partial: { basePath?: string; serverPath?: string; zomboidPath?: string }) => Promise<{ success: boolean; error?: string; paths?: { basePath: string; serverPath: string; zomboidPath: string } }>
      detectExistingServer: (folder: string) => Promise<{ success: boolean; folder?: string; launchers?: string[]; error?: string }>
      scanForExistingPzServer: () => Promise<{ success: boolean; candidates: Array<{ path: string; source: string; launchers: string[] }> }>
      getAppVersion: () => Promise<string>
      getServerMetrics: () => Promise<{ success: boolean; running: boolean; cpuPercent: number; memoryBytes: number; uptime: number; onlineCount: number; history: Array<{ t: number; cpuPercent: number; memoryBytes: number; onlineCount: number }>; error?: string }>
      getOnlineCount: () => Promise<{ success: boolean; count: number }>
      getUnmatchedEvents: () => Promise<{ success: boolean; events: Array<{ line: string; at: string }> }>
      clearUnmatchedEvents: () => Promise<{ success: boolean }>
      consoleStatus: () => Promise<{ success: boolean; connected: boolean; error?: string | null }>
      consolePlayers: () => Promise<{ success: boolean; players: Array<{ name: string }>; updatedAt?: number; error?: string }>
      consoleBroadcast: (message: string) => Promise<{ success: boolean; error?: string }>
      consoleSend: (cmd: string) => Promise<{ success: boolean; error?: string }>
      adminRconStatus: () => Promise<{ success: boolean; connected: boolean; port: number; hasPassword: boolean; serverOnline: boolean; error?: string | null }>
      adminKick: (name: string, reason?: string) => Promise<{ success: boolean; response?: string; error?: string }>
      adminBan: (name: string, reason?: string) => Promise<{ success: boolean; response?: string; error?: string }>
      adminCommand: (cmd: string) => Promise<{ success: boolean; response?: string; error?: string }>
      getChatLog: () => Promise<{ success: boolean; messages: Array<{ at: string; username: string; text: string }> }>
      clearChatLog: () => Promise<{ success: boolean }>
      listSchedules: () => Promise<{ success: boolean; schedules: Array<{ id: string; time: string; enabled: boolean; warningMinutes?: number[]; nextFireAt: number | null }> }>
      saveSchedules: (schedules: Array<{ id?: string; time: string; enabled?: boolean; warningMinutes?: number[] }>) => Promise<{ success: boolean; schedules: Array<{ id: string; time: string; enabled: boolean; warningMinutes?: number[]; nextFireAt: number | null }> }>
      deleteSchedule: (id: string) => Promise<{ success: boolean; error?: string }>
      getLocalIp: () => Promise<{ success: boolean; ip: string | null; iface: string | null }>
      scheduleRestart: (delayMinutes: number, warnings?: number[]) => Promise<{ success: boolean; scheduledFor?: number; warnings?: number[]; error?: string }>
      cancelRestart: () => Promise<{ success: boolean; error?: string }>
      getScheduledRestart: () => Promise<{ success: boolean; scheduled: { scheduledFor: number; msRemaining: number; warnings: number[] } | null }>
      getActivity: () => Promise<{ success: boolean; events: Array<{ at: string; kind: string; message: string }> }>
      checkForUpdate: () => Promise<{ success: boolean; info?: { version?: string; releaseDate?: string; releaseNotes?: string } | null; error?: string }>
      installUpdateNow: () => Promise<{ success: boolean }>
      onUpdateEvent: (cb: (kind: string, data: any) => void) => () => void
      platform: string
    }
  }
}
