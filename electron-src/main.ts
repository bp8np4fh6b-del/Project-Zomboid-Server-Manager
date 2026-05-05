const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron')
const { join } = require('path')
const { autoUpdater } = require('electron-updater')
const backend = require('./backend')

const isDev = process.argv.includes('--dev')

// Hide the legacy File / Edit / View / Window / Help menu globally — none of
// those entries do anything for this app. The renderer ships its own UI chrome.
Menu.setApplicationMenu(null)

let mainWindow: any = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'PZ Server Manager',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
    show: true,
    backgroundColor: '#0f0f0f',
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, 'renderer/index.html'))
  }
  mainWindow.on('closed', () => { mainWindow = null })

  // Mirror renderer console output to the main process console for easy debugging
  mainWindow.webContents.on('console-message', (_event: any, level: number, message: string) => {
    const labels = ['DEBUG', 'LOG', 'WARN', 'ERROR']
    console.log(`[RENDERER ${labels[level] || 'LOG'}] ${message}`)
  })

  // Surface load failures so we don't silently end up on a blank window
  mainWindow.webContents.on('did-fail-load', (_e: any, code: number, desc: string, url: string) => {
    console.error(`[MAIN] did-fail-load: ${code} ${desc} ${url}`)
  })

  // Open external links in the user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  try { backend.cleanup() } catch {}
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try { backend.cleanup() } catch {}
})

// Broadcast helpers
function broadcast(channel: string, data: any) {
  BrowserWindow.getAllWindows().forEach((win: any) => {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  })
}

// Wire up backend events to broadcast (uses backend's setter — see backend.ts)
backend.onStatus = (status: string) => broadcast('server:statusUpdate', status)
backend.onLog = (data: any) => broadcast('server:log', data)
backend.onModsProgress = (data: any) => broadcast('mods:progress', data)

// ═══════════════════════════════════════════════════════════════
// AUTO-UPDATE — electron-updater + GitHub Releases
//
// On launch the installed app reaches out to the configured GitHub repo,
// reads `latest.yml`, and if a newer version is available downloads the
// installer in the background. The renderer is notified via `update:*`
// events so the UI can show progress; when the download completes the user
// is prompted to restart and apply.
// ═══════════════════════════════════════════════════════════════

// Don't auto-quit when the download completes — we prompt the user instead.
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.autoDownload = true

autoUpdater.on('checking-for-update', () => broadcast('update:checking', null))
autoUpdater.on('update-available', (info: any) => broadcast('update:available', { version: info.version, releaseDate: info.releaseDate, releaseNotes: info.releaseNotes }))
autoUpdater.on('update-not-available', () => broadcast('update:not-available', null))
autoUpdater.on('error', (err: any) => broadcast('update:error', { message: err?.message || String(err) }))
autoUpdater.on('download-progress', (p: any) => broadcast('update:download-progress', { percent: p.percent, bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total }))
autoUpdater.on('update-downloaded', async (info: any) => {
  broadcast('update:downloaded', { version: info.version })
  // Prompt the user. They can restart now or defer; deferral still applies on next quit.
  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update ready',
    message: `Version ${info.version} has been downloaded.`,
    detail: 'Restart now to install, or it will be applied automatically the next time you quit.',
  })
  if (choice.response === 0) {
    autoUpdater.quitAndInstall()
  }
})

// Manual triggers from the renderer.
ipcMain.handle('update:check', async () => {
  if (isDev) return { success: false, error: 'Auto-update is disabled in dev mode.' }
  try {
    const r = await autoUpdater.checkForUpdates()
    return { success: true, info: r?.updateInfo || null }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
})
ipcMain.handle('update:installNow', async () => {
  try { autoUpdater.quitAndInstall() } catch {}
  return { success: true }
})

// Kick the first check shortly after the window is ready. We delay so that
// the renderer has time to subscribe to the events; otherwise a very fast
// check can fire before any listener exists.
app.whenReady().then(() => {
  if (isDev) return
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err: any) => {
      console.error('[AUTO-UPDATE] initial check failed:', err?.message || err)
    })
  }, 4000)
})

// ═══════════════════════════════════════════════════════════════
// IPC HANDLERS
// ═══════════════════════════════════════════════════════════════

// Server control
ipcMain.handle('server:start', async (_e: any, opts: any) => backend.startServer(opts))
ipcMain.handle('server:stop', async () => backend.stopServer())
ipcMain.handle('server:restart', async () => backend.restartServer())
ipcMain.handle('server:getStatus', async () => backend.getServerStatus())
ipcMain.handle('server:getLogs', async () => backend.getRecentLogs())

// Installation
ipcMain.handle('install:steamcmd', async () => backend.installSteamCmd())
ipcMain.handle('install:pzserver', async () => backend.installPzServer())
ipcMain.handle('install:getStatus', async () => backend.getInstallStatus())

// Settings
ipcMain.handle('settings:get', async () => backend.getSettings())
ipcMain.handle('settings:save', async (_e: any, settings: any) => backend.saveSettings(settings))
ipcMain.handle('settings:getIni', async () => backend.getServerIni())
ipcMain.handle('settings:saveIni', async (_e: any, content: string) => backend.saveServerIni(content))

// Sandbox (gameplay)
ipcMain.handle('sandbox:get', async () => backend.getSandbox())
ipcMain.handle('sandbox:save', async (_e: any, vars: any) => backend.saveSandbox(vars))
ipcMain.handle('sandbox:saveRaw', async (_e: any, content: string) => backend.saveSandboxRaw(content))

// Paths config
ipcMain.handle('paths:get', async () => backend.getPaths())
ipcMain.handle('paths:set', async (_e: any, partial: any) => {
  const r = backend.setPaths(partial)
  if (r?.success) {
    // Schedule a relaunch so the new paths take effect cleanly. Wait briefly
    // so the renderer's await resolves before the app exits.
    setTimeout(() => {
      try { app.relaunch() } catch {}
      try { app.exit(0) } catch {}
    }, 250)
  }
  return r
})
ipcMain.handle('paths:detectExistingServer', async (_e: any, folder: string) => backend.detectExistingServer(folder))
ipcMain.handle('install:scanForExisting', async () => backend.scanForExistingPzServer())

// App info
ipcMain.handle('app:getVersion', async () => app.getVersion())

// Server metrics (CPU/RAM/online via pidusage)
ipcMain.handle('server:metrics', async () => backend.getServerMetrics())
ipcMain.handle('server:getOnlineCount', async () => backend.getOnlineCount())

// Live server console (stdin-based, no RCON)
ipcMain.handle('console:status', async () => backend.consoleStatus())
ipcMain.handle('console:players', async () => backend.consoleGetPlayers())
ipcMain.handle('console:broadcast', async (_e: any, message: string) => backend.consoleBroadcast(message))
ipcMain.handle('console:send', async (_e: any, cmd: string) => backend.consoleSendCommand(cmd))

// RCON admin actions (kick/ban/command/status)
ipcMain.handle('admin:rconStatus', async () => backend.adminRconStatus())
ipcMain.handle('admin:kick', async (_e: any, name: string, reason?: string) => backend.adminKick(name, reason))
ipcMain.handle('admin:ban', async (_e: any, name: string, reason?: string) => backend.adminBan(name, reason))
ipcMain.handle('admin:command', async (_e: any, cmd: string) => backend.adminCommand(cmd))

// In-game chat feed
ipcMain.handle('chat:get', async () => backend.getChatLog())
ipcMain.handle('chat:clear', async () => backend.clearChatLog())

// Daily schedules
ipcMain.handle('schedules:list', async () => backend.listSchedules())
ipcMain.handle('schedules:save', async (_e: any, schedules: any[]) => backend.saveSchedulesList(schedules || []))
ipcMain.handle('schedules:delete', async (_e: any, id: string) => backend.deleteSchedule(id))

// Misc app helpers
ipcMain.handle('app:getLocalIp', async () => backend.getLocalIp())

// Restart scheduling
ipcMain.handle('restart:schedule', async (_e: any, payload: any) => backend.scheduleRestart(payload?.delayMinutes, payload?.warnings, payload?.opts))
ipcMain.handle('restart:cancel', async () => backend.cancelRestart())
ipcMain.handle('restart:get', async () => backend.getScheduledRestart())

// Activity feed
ipcMain.handle('activity:get', async () => backend.getActivity())

// Player diagnostics
ipcMain.handle('players:unmatched', async () => backend.getUnmatchedEvents())
ipcMain.handle('players:clearUnmatched', async () => backend.clearUnmatchedEvents())

// Mods
ipcMain.handle('mods:get', async () => backend.getMods())
ipcMain.handle('mods:add', async (_e: any, mod: any) => backend.addMod(mod))
ipcMain.handle('mods:remove', async (_e: any, id: string) => backend.removeMod(id))
ipcMain.handle('mods:toggle', async (_e: any, id: string) => backend.toggleMod(id))
ipcMain.handle('mods:redetect', async (_e: any, id: string) => backend.redetectMod(id))
ipcMain.handle('mods:redetectAllMissing', async () => backend.redetectAllMissing())

// Backup
ipcMain.handle('backup:list', async () => backend.listBackups())
ipcMain.handle('backup:create', async () => backend.createBackup())
ipcMain.handle('backup:restore', async (_e: any, name: string) => backend.restoreBackup(name))
ipcMain.handle('backup:delete', async (_e: any, name: string) => backend.deleteBackup(name))

// Workshop
ipcMain.handle('workshop:lookup', async (_e: any, input: string) => backend.getWorkshopInfo(input))
ipcMain.handle('workshop:checkUpdates', async () => backend.checkAllModUpdates())

// Wipe
ipcMain.handle('wipe:server', async (_e: any, scope: any) => backend.wipeServer(scope))

// Player history
ipcMain.handle('players:history', async () => backend.getPlayerHistory())
ipcMain.handle('players:clearHistory', async () => backend.clearPlayerHistory())

// Dialogs
ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('shell:openExternal', async (_e: any, url: string) => shell.openExternal(url))
ipcMain.handle('app:getPaths', async () => ({
  userData: app.getPath('userData'),
  home: app.getPath('home'),
  documents: app.getPath('documents'),
}))
