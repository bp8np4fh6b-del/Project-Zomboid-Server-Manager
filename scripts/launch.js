// Launch script for production mode
const { spawn } = require('child_process')
const path = require('path')

// CRITICAL: Must DELETE ELECTRON_RUN_AS_NODE completely, not just set to empty
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronPath = path.join(__dirname, '..', 'node_modules', '.bin', 'electron.cmd')

// On Windows with Node 24+, we need shell: true for .cmd files
const electron = spawn('cmd', ['/c', electronPath, '.'], {
  env,
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  windowsHide: true,
})

electron.on('exit', (code) => process.exit(code || 0))
