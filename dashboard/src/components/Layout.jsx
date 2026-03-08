import {
  Activity,
  LayoutDashboard,
  ScrollText,
  Settings,
  Sparkles,
  Zap
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/providers', icon: Sparkles, label: 'AI Providers' },
  { to: '/logs', icon: ScrollText, label: 'Logs' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Layout() {
  return (
    <div className="flex h-screen bg-[#1e1e1e]">
      <aside className="w-56 bg-[#252526] border-r border-[#3c3c3c] flex flex-col">
        <div className="h-14 flex items-center gap-3 px-4 border-b border-[#3c3c3c]">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#0078d4] to-[#00bcf2] flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-[#cccccc]">JARVIS</h1>
            <p className="text-[10px] text-[#858585]">Control Center</p>
          </div>
        </div>

        <div className="mx-3 mt-3 rounded border border-[#3c3c3c] bg-[#2d2d2d] px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#6e6e6e]">Scope</p>
          <p className="mt-1 text-xs text-[#cccccc]">API-backed operational views only.</p>
        </div>

        <nav className="flex-1 py-4 px-2 space-y-1">
          {navItems.map((item) => {
            const NavIcon = item.icon;

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                    isActive
                      ? 'bg-[#094771] text-white'
                      : 'text-[#cccccc] hover:bg-[#3c3c3c]'
                  }`
                }
              >
                <NavIcon className="w-4 h-4" />
                <span className="flex-1">{item.label}</span>
                {item.badge ? (
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-[#0078d4] text-white">
                    {item.badge}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[#3c3c3c]">
          <div className="flex items-center gap-2 text-xs text-[#858585]">
            <Activity className="w-3 h-3" />
            <span>Live views only</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
