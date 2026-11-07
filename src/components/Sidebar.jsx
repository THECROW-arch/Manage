import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const NAV_TABS = [
  { id: 'cashflow', tKey: 'cash_flow', icon: 'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'occasions', tKey: 'occasions_sandbox', icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z' },
  { id: 'portfolio', tKey: 'portfolio', icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z' },
  { id: 'taxes', tKey: 'tax_center', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
  { id: 'history', tKey: 'history_logs', icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z' },
  { id: 'settings', tKey: 'settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { id: 'support', tKey: 'support_hub_title', icon: 'M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z' },
  { id: 'dev_dashboard', tKey: 'dev_dashboard', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' },
  { id: 'owner_dashboard', tKey: 'owner_dashboard', fallbackLabel: 'Owner Cmd', icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z' }
];
/** ... */
export function BrandEmblem({ className = "w-12 h-12" }) {
  return (
    <div className={`${className} relative flex items-center justify-center shrink-0 overflow-hidden rounded-xl border border-gray-200 dark:border-zinc-700 bg-white shadow-sm`}>
      <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
        <defs>
          <filter id="managed-dark-adapt" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0.2 -1.2  0   1  0
                     -1.0  0    0   1  0
                     -0.4 -0.6  0   1  0
                      0    0    0   1  0"
            />
          </filter>
        </defs>
      </svg>
      <img
        src="/favicon.png"
        alt="MANAGED Emblem"
        className="w-full h-full object-contain scale-[2.2] dark:[filter:url(#managed-dark-adapt)] transition-all duration-300"
      />
    </div>
  );
}
/** ... */
export function BrandWordmark({ size = "md" }) {
  const dimensions = {
    sm: "text-base",
    md: "text-lg",
    lg: "text-2xl"
  }[size] || "text-lg";

  return (
    <div className="flex flex-col justify-center leading-none">
      <span className={`${dimensions} font-black tracking-tight text-gray-900 dark:text-white`}>
        MANAG<span className="text-emerald-500">ED</span>
      </span>
      <span className="text-[8.5px] font-bold tracking-[0.2em] text-gray-400 dark:text-zinc-400 uppercase mt-1">
        Financial Allocator
      </span>
    </div>
  );
}
/** ... */
export default function Sidebar({ activeTab, setActiveTab, setAlertMsg, currentStreak, longestStreak, handleLogout, username, userRole }) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebarCollapsed') === 'true'; }
    catch { return false; }
  });
  const { t } = useTranslation();

  useEffect(() => {
    try { localStorage.setItem('sidebarCollapsed', isCollapsed); }
    catch (e) { console.warn('Failed to save sidebar state:', e); }
  }, [isCollapsed]);

  const getTabLabel = (tab) => t(tab.tKey, tab.fallbackLabel || tab.tKey);

  return (
    <aside className={`bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800 flex flex-col justify-between shrink-0 hidden md:flex transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-64'}`}>
      <div>
        <div className={`px-3.5 border-b border-gray-200 dark:border-zinc-800 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} h-[92px]`}>
          {!isCollapsed ? (
            <div className="flex items-center gap-2.5 min-w-0">
              <BrandEmblem className="w-11 h-11" />
              <BrandWordmark size="md" />
            </div>
          ) : (
            <BrandEmblem className="w-11 h-11" />
          )}
        </div>

        <nav className="flex-1 px-3 space-y-2 mt-6">
          {NAV_TABS.filter(tab =>
            (tab.id !== 'dev_dashboard' || userRole === 'dev' || userRole === 'owner') &&
            (tab.id !== 'owner_dashboard' || userRole === 'owner')
          ).map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setAlertMsg('');
              }}
              className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3 px-3'} py-2.5 rounded-md text-sm font-bold transition-all ${activeTab === tab.id
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 dark:shadow-[inset_2px_0_0_0_#10B981]'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800/50 font-medium'
                }`}
              title={isCollapsed ? getTabLabel(tab) : undefined}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={activeTab === tab.id ? 2 : 1.5} stroke="currentColor" className="w-6 h-6 min-w-[24px] min-h-[24px] shrink-0 block">
                <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
              </svg>
              {!isCollapsed && (
                <span className="truncate min-w-0 flex-1 text-left leading-tight">
                  {getTabLabel(tab)}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="p-4 border-t border-gray-200 dark:border-zinc-800 flex flex-col gap-4">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3 px-3'} py-2 rounded-md text-sm font-medium text-gray-400 dark:text-zinc-500 hover:text-gray-900 dark:hover:text-white transition-all`}
          title={isCollapsed ? t('expand_menu') : t('collapse_menu')}
        >
          {isCollapsed ? (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 min-w-[20px] shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 min-w-[20px] shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              <span className="whitespace-nowrap">{t('collapse_menu')}</span>
            </>
          )}
        </button>

        {!isCollapsed && username && (
          <div className="px-3 py-2.5 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold text-sm shrink-0">
                {username.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-xs font-bold text-gray-900 dark:text-white truncate" dir="ltr">@{username}</span>
                <span className="text-[10px] font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{userRole}</span>
              </div>
            </div>
            {currentStreak > 0 && (
              <div
                title={t('streak_active_best_title', {
                  current: currentStreak,
                  longest: longestStreak,
                  defaultValue: `Active Perfect-Month Streak: ${currentStreak} (Best: ${longestStreak})`
                })}
                className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-md text-[11px] font-bold border border-emerald-200 dark:border-emerald-500/20 shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400">
                  <path fillRule="evenodd" d="M13.5 4.938a7 7 0 11-9.006 1.737c.202-.257.59-.218.793.039.278.352.594.672.943.954.332.269.786-.049.773-.476a5.977 5.977 0 01.572-2.759 6.026 6.026 0 012.486-2.665c.247-.14.55-.016.677.238A6.967 6.967 0 0013.5 4.938zM14 12a4 4 0 01-4 4c-1.913 0-3.52-1.398-3.91-3.182-.093-.429.44-.643.814-.413a4.043 4.043 0 001.601.564c.303.038.531-.24.51-.544a5.975 5.975 0 011.315-4.192.447.447 0 01.431-.16A4.001 4.001 0 0114 12z" clipRule="evenodd" />
                </svg>
                <span>{currentStreak}</span>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleLogout}
          title={isCollapsed ? t('sign_out') : undefined}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'gap-3 px-3'} py-2 rounded-md text-sm font-medium text-gray-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-zinc-800/50 transition-all`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 min-w-[24px] min-h-[24px] shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
          </svg>
          {!isCollapsed && <span className="whitespace-nowrap">{t('sign_out')}</span>}
        </button>
      </div>
    </aside>
  );
}
/** ... */
export function MobileHeader({
  activeTab,
  setActiveTab,
  setAlertMsg,
  currentStreak,
  longestStreak,
  userRole,
  username,
  handleLogout
}) {
  const { t } = useTranslation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const menuContainerRef = useRef(null);
  const menuTriggerRef = useRef(null);

  const visibleTabs = NAV_TABS.filter(tab =>
    (tab.id !== 'dev_dashboard' || userRole === 'dev' || userRole === 'owner') &&
    (tab.id !== 'owner_dashboard' || userRole === 'owner')
  );

  const currentTabObj = visibleTabs.find(tab => tab.id === activeTab) || visibleTabs[0];
  const getTabLabel = (tab) => (tab ? t(tab.tKey, tab.fallbackLabel || tab.tKey) : '');

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const handleClickOutside = (e) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target)) {
        setIsMobileMenuOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (menuContainerRef.current?.contains(document.activeElement)) {
          menuTriggerRef.current?.focus();
        }
        setIsMobileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMobileMenuOpen]);

  return (
    <header
      ref={menuContainerRef}
      className="md:hidden relative flex flex-col gap-3 mb-6 pb-4 border-b border-gray-200 dark:border-zinc-800"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandEmblem className="w-10 h-10" />
          <BrandWordmark size="sm" />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {currentStreak > 0 && (
            <div
              title={
                longestStreak
                  ? t('longest_streak_title', {
                    longest: longestStreak,
                    defaultValue: `Longest Streak: ${longestStreak}`
                  })
                  : undefined
              }
              className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1.5 rounded-lg text-xs font-bold border border-emerald-200 dark:border-emerald-500/20"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400">
                <path fillRule="evenodd" d="M13.5 4.938a7 7 0 11-9.006 1.737c.202-.257.59-.218.793.039.278.352.594.672.943.954.332.269.786-.049.773-.476a5.977 5.977 0 01.572-2.759 6.026 6.026 0 012.486-2.665c.247-.14.55-.016.677.238A6.967 6.967 0 0013.5 4.938zM14 12a4 4 0 01-4 4c-1.913 0-3.52-1.398-3.91-3.182-.093-.429.44-.643.814-.413a4.043 4.043 0 001.601.564c.303.038.531-.24.51-.544a5.975 5.975 0 011.315-4.192.447.447 0 01.431-.16A4.001 4.001 0 0114 12z" clipRule="evenodd" />
              </svg>
              <span>{currentStreak}</span>
            </div>
          )}

          <button
            ref={menuTriggerRef}
            type="button"
            onClick={() => setIsMobileMenuOpen(prev => !prev)}
            aria-expanded={isMobileMenuOpen}
            aria-label={t('toggle_navigation', 'Toggle navigation menu')}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-800 dark:text-zinc-100 text-xs font-bold shadow-sm hover:border-emerald-500 dark:hover:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 transition-all"
          >
            {currentTabObj && (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d={currentTabObj.icon} />
              </svg>
            )}
            <span className="max-w-[115px] truncate">{getTabLabel(currentTabObj)}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className={`w-4 h-4 text-gray-400 dark:text-zinc-400 transition-transform duration-200 ${isMobileMenuOpen ? 'rotate-180' : ''}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div
          className="absolute top-full left-0 right-0 mt-1 z-50 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl shadow-2xl p-2 space-y-1 animate-fade-in"
        >
          <div className="grid grid-cols-1 gap-1">
            {visibleTabs.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setAlertMsg('');
                    setActiveTab(tab.id);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-bold transition-all ${isActive
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 dark:shadow-[inset_2px_0_0_0_#10B981]'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800/60 font-medium'
                    }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={isActive ? 2 : 1.5} stroke="currentColor" className="w-5 h-5 shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                  </svg>
                  <span className="truncate flex-1 text-left">{getTabLabel(tab)}</span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>

          {(username || handleLogout) && (
            <div className="pt-2 mt-2 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-between gap-2 px-1">
              {username && (
                <div className="flex items-center gap-2.5 min-w-0 px-2 py-1">
                  <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold text-xs shrink-0">
                    {username.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold text-gray-900 dark:text-white truncate" dir="ltr">@{username}</span>
                    <span className="text-[9px] font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{userRole}</span>
                  </div>
                </div>
              )}

              {handleLogout && (
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    handleLogout();
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50/70 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors shrink-0"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                  </svg>
                  <span>{t('sign_out', 'Sign Out')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  );
}