// Dev mode launcher - runs Vite and Electron concurrently
const { spawn } = require('child_process')
const path = require('path')

const projectRoot = path.join(__dirname, '..')

// CRITICAL: Must DELETE ELECTRON_RUN_AS_NODE completely
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// Start Vite dev server
const vite = spawn('cmd', ['/c', 'npx', 'vite', '--config', 'vite.renderer.config.ts', '--host'], {
  env,
  stdio: 'inherit',
  cwd: projectRoot,
})

// Wait a bit for Vite to start, then start Electron
setTimeout(() => {
  const electronPath = path.join(projectRoot, 'node_modules', '.bin', 'electron.cmd')
  const electron = spawn('cmd', ['/c', electronPath, '.', '--dev'], {
    env,
    stdio: 'inherit',
    cwd: projectRoot,
    windowsHide: true,
  })

  electron.on('exit', () => {
    vite.kill()
    process.exit(0)
  })
}, 3000)
