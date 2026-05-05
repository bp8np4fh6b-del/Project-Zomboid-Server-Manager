const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // Server control
  startServer: (opts: any) => ipcRenderer.invoke('server:start', opts),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  restartServer: () => ipcRenderer.invoke('server:restart'),
  getServerStatus: () => ipcRenderer.invoke('server:getStatus'),
  onServerStatus: (cb: (status: string) => void) => {
    const handler = (_e: any, status: string) => cb(status)
    ipcRenderer.on('server:statusUpdate', handler)
    return () => ipcRenderer.removeListener('server:statusUpdate', handler)
  },

  // Logs
  getServerLogs: () => ipcRenderer.invoke('server:getLogs'),
  onServerLog: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('server:log', handler)
    return () => ipcRenderer.removeListener('server:log', handler)
  },

  // Installation
  installSteamCmd: () => ipcRenderer.invoke('install:steamcmd'),
  installPzServer: () => ipcRenderer.invoke('install:pzserver'),
  getInstallStatus: () => ipcRenderer.invoke('install:getStatus'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  getServerIni: () => ipcRenderer.invoke('settings:getIni'),
  saveServerIni: (content: string) => ipcRenderer.invoke('settings:saveIni', content),

  // Sandbox (gameplay)
  getSandbox: () => ipcRenderer.invoke('sandbox:get'),
  saveSandbox: (vars: any) => ipcRenderer.invoke('sandbox:save', vars),
  saveSandboxRaw: (content: string) => ipcRenderer.invoke('sandbox:saveRaw', content),

  // Mods
  getMods: () => ipcRenderer.invoke('mods:get'),
  addMod: (mod: any) => ipcRenderer.invoke('mods:add', mod),
  removeMod: (id: string) => ipcRenderer.invoke('mods:remove', id),
  toggleMod: (id: string) => ipcRenderer.invoke('mods:toggle', id),
  redetectMod: (id: string) => ipcRenderer.invoke('mods:redetect', id),
  redetectAllMissing: () => ipcRenderer.invoke('mods:redetectAllMissing'),
  onModsProgress: (cb: (data: any) => void) => {
    const handler = (_e: any, data: any) => cb(data)
    ipcRenderer.on('mods:progress', handler)
    return () => ipcRenderer.removeListener('mods:progress', handler)
  },

  // Backup
  getBackups: () => ipcRenderer.invoke('backup:list'),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  restoreBackup: (name: string) => ipcRenderer.invoke('backup:restore', name),
  deleteBackup: (name: string) => ipcRenderer.invoke('backup:delete', name),

  // Workshop
  workshopLookup: (input: string) => ipcRenderer.invoke('workshop:lookup', input),
  checkModUpdates: () => ipcRenderer.invoke('workshop:checkUpdates'),

  // Wipe
  wipeServer: (scope: any) => ipcRenderer.invoke('wipe:server', scope),

  // Player history
  getPlayerHistory: () => ipcRenderer.invoke('players:history'),
  clearPlayerHistory: () => ipcRenderer.invoke('players:clearHistory'),

  // Misc
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  getPaths: () => ipcRenderer.invoke('app:getPaths'),

  // Manager-paths config (basePath / serverPath / zomboidPath)
  getManagerPaths: () => ipcRenderer.invoke('paths:get'),
  setManagerPaths: (partial: any) => ipcRenderer.invoke('paths:set', partial),
  detectExistingServer: (folder: string) => ipcRenderer.invoke('paths:detectExistingServer', folder),
  scanForExistingPzServer: () => ipcRenderer.invoke('install:scanForExisting'),

  // App version
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Server metrics
  getServerMetrics: () => ipcRenderer.invoke('server:metrics'),
  getOnlineCount: () => ipcRenderer.invoke('server:getOnlineCount'),

  // Player diagnostics
  getUnmatchedEvents: () => ipcRenderer.invoke('players:unmatched'),
  clearUnmatchedEvents: () => ipcRenderer.invoke('players:clearUnmatched'),

  // Live server console (stdin-based)
  consoleStatus: () => ipcRenderer.invoke('console:status'),
  consolePlayers: () => ipcRenderer.invoke('console:players'),
  consoleBroadcast: (message: string) => ipcRenderer.invoke('console:broadcast', message),
  consoleSend: (cmd: string) => ipcRenderer.invoke('console:send', cmd),

  // RCON admin actions
  adminRconStatus: () => ipcRenderer.invoke('admin:rconStatus'),
  adminKick: (name: string, reason?: string) => ipcRenderer.invoke('admin:kick', name, reason),
  adminBan: (name: string, reason?: string) => ipcRenderer.invoke('admin:ban', name, reason),
  adminCommand: (cmd: string) => ipcRenderer.invoke('admin:command', cmd),

  // In-game chat feed
  getChatLog: () => ipcRenderer.invoke('chat:get'),
  clearChatLog: () => ipcRenderer.invoke('chat:clear'),

  // Daily schedules
  listSchedules: () => ipcRenderer.invoke('schedules:list'),
  saveSchedules: (schedules: any[]) => ipcRenderer.invoke('schedules:save', schedules),
  deleteSchedule: (id: string) => ipcRenderer.invoke('schedules:delete', id),

  // Misc helpers
  getLocalIp: () => ipcRenderer.invoke('app:getLocalIp'),

  // Restart scheduling
  scheduleRestart: (delayMinutes: number, warnings?: number[]) =>
    ipcRenderer.invoke('restart:schedule', { delayMinutes, warnings }),
  cancelRestart: () => ipcRenderer.invoke('restart:cancel'),
  getScheduledRestart: () => ipcRenderer.invoke('restart:get'),

  // Activity feed
  getActivity: () => ipcRenderer.invoke('activity:get'),

  // Auto-update
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdateNow: () => ipcRenderer.invoke('update:installNow'),
  onUpdateEvent: (cb: (kind: string, data: any) => void) => {
    const channels = ['update:checking', 'update:available', 'update:not-available', 'update:download-progress', 'update:downloaded', 'update:error']
    const handlers: Array<{ channel: string; handler: (e: any, d: any) => void }> = []
    for (const ch of channels) {
      const handler = (_e: any, d: any) => cb(ch, d)
      ipcRenderer.on(ch, handler)
      handlers.push({ channel: ch, handler })
    }
    return () => {
      for (const { channel, handler } of handlers) ipcRenderer.removeListener(channel, handler)
    }
  },

  platform: process.platform,
})
