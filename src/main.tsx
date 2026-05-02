import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// Debug: log that main.tsx is running
console.log('[RENDERER] main.tsx loaded')
console.log('[RENDERER] electronAPI exists:', !!window.electronAPI)

const root = document.getElementById('root')
if (!root) {
  console.error('[RENDERER] Root element not found!')
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
  console.log('[RENDERER] React mounted')
}
