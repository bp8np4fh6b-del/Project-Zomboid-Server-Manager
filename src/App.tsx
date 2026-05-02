import { useState, useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Installer from './pages/Installer'
import Settings from './pages/Settings'
import Mods from './pages/Mods'
import Players from './pages/Players'
import Monitoring from './pages/Monitoring'
import Sandbox from './pages/Sandbox'
import Wipe from './pages/Wipe'

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen text-center gap-4 p-8">
      <h2 className="text-xl font-bold text-red-500">App Error</h2>
      <p className="text-red-400 font-mono text-sm">{error.message}</p>
      <pre className="text-xs text-[#666] text-left overflow-auto max-w-full">{error.stack}</pre>
      <button onClick={() => window.location.reload()} className="btn-primary">Reload</button>
    </div>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="install" element={<Installer />} />
        <Route path="settings" element={<Settings />} />
        <Route path="sandbox" element={<Sandbox />} />
        <Route path="mods" element={<Mods />} />
        <Route path="players" element={<Players />} />
        <Route path="monitoring" element={<Monitoring />} />
        <Route path="wipe" element={<Wipe />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const errHandler = (e: ErrorEvent) => {
      console.error('Global error:', e.error)
      setError(e.error)
    }
    const rejHandler = (e: PromiseRejectionEvent) => {
      console.error('Unhandled rejection:', e.reason)
      setError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)))
    }
    window.addEventListener('error', errHandler)
    window.addEventListener('unhandledrejection', rejHandler)
    return () => {
      window.removeEventListener('error', errHandler)
      window.removeEventListener('unhandledrejection', rejHandler)
    }
  }, [])

  if (error) return <ErrorFallback error={error} />

  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  )
}
