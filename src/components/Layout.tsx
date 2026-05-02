import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/install': 'Installer',
  '/settings': 'Server Settings',
  '/sandbox': 'Sandbox / Gameplay',
  '/mods': 'Mod Manager',
  '/players': 'Players',
  '/monitoring': 'Monitoring',
  '/wipe': 'Wipe Server',
}

export default function Layout() {
  const location = useLocation()
  return (
    <div className="flex h-screen bg-[#0f0f0f] text-[#e0e0e0] overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar title={pageTitles[location.pathname] || 'Dashboard'} />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
