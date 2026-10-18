import { useState, useEffect } from 'react';

const NAV_TABS = [
  { id: 'cashflow', name: 'Cash Flow', icon: 'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'occasions', name: 'Occasions & Sandbox', icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z' },
  { id: 'portfolio', name: 'Portfolio', icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z' },
  { id: 'taxes', name: 'Tax Center', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
  { id: 'history', name: 'History Logs', icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'settings', name: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
];

/**
 * Renders the primary desktop sidebar navigation with a collapsible state toggle.
 */
export default function Sidebar({ activeTab, setActiveTab, setAlertMsg, currentStreak, longestStreak, handleLogout }) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebarCollapsed') === 'true'; }
    catch { return false; }
  });

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', isCollapsed);
  }, [isCollapsed]);

  return (
    <aside className={`bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800 flex flex-col justify-between shrink-0 hidden md:flex transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-64'}`}>
      <div>
        <div className={`p-6 border-b border-gray-200 dark:border-zinc-800 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} h-[77px]`}>
          {!isCollapsed ? (
            <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight whitespace-nowrap overflow-hidden">Salary Allocator</h1>
          ) : (
            <h1 className="text-xl font-black text-indigo-600 dark:text-indigo-500 tracking-tighter">SA</h1>
          )}
          {!isCollapsed && currentStreak > 0 && (
            <div title={`Longest Streak: ${longestStreak}`} className="flex items-center gap-1 text-orange-500 bg-orange-50 dark:bg-orange-500/10 px-2 py-1 rounded-md text-xs font-bold border border-orange-200 dark:border-orange-500/20 shrink-0">
              <span>🔥</span> {currentStreak}
            </div>
          )}
        </div>
        
        <nav className="flex-1 px-3 space-y-2 mt-6">
          {NAV_TABS.map(tab => (
            <button
              key={tab.id}
              title={isCollapsed ? tab.name : undefined}
              onClick={() => { setActiveTab(tab.id); setAlertMsg(''); }}
              className={`w-full flex items-center ${isCollapsed ? 'justify-center px-0' : 'gap-3 px-3'} py-2.5 rounded-md text-sm font-medium transition-all ${activeTab === tab.id
                ? 'bg-indigo-50 dark:bg-zinc-800 text-indigo-600 dark:text-white'
                : 'text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800/50'
                }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
              </svg>
              {!isCollapsed && <span className="whitespace-nowrap">{tab.name}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="p-4 border-t border-gray-200 dark:border-zinc-800 flex flex-col gap-2">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3 px-3'} py-2 rounded-md text-sm font-medium text-gray-400 dark:text-zinc-500 hover:text-gray-900 dark:hover:text-white transition-all`}
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isCollapsed ? (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              <span className="whitespace-nowrap">Collapse Menu</span>
            </>
          )}
        </button>

        <button
          onClick={handleLogout}
          title={isCollapsed ? "Sign Out" : undefined}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3 px-3'} py-2 rounded-md text-sm font-medium text-gray-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-zinc-800/50 transition-all`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
          </svg>
          {!isCollapsed && <span className="whitespace-nowrap">Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}

/**
 * Renders the mobile header navigation dropdown.
 */
export function MobileHeader({ activeTab, setActiveTab, currentStreak }) {
  return (
    <header className="md:hidden flex flex-col gap-4 mb-6 pb-4 border-b border-gray-200 dark:border-zinc-800">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Salary Allocator</h1>
        {currentStreak > 0 && (
          <div className="flex items-center gap-1 text-orange-500 bg-orange-50 dark:bg-orange-500/10 px-2 py-1 rounded-md text-xs font-bold border border-orange-200 dark:border-orange-500/20">
            <span>🔥</span> {currentStreak}
          </div>
        )}
      </div>
      <select
        value={activeTab}
        onChange={(e) => setActiveTab(e.target.value)}
        className="w-full p-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm"
      >
        {NAV_TABS.map(tab => (
          <option key={tab.id} value={tab.id}>{tab.name}</option>
        ))}
      </select>
    </header>
  );
}