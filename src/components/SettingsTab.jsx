import { getToday, getCurrentMonth } from '../utils/constants';

export default function SettingsTab({
  theme,
  setTheme,
  salary,
  setSalary,
  currencyMode,
  setCurrencyMode,
  currency,
  setCurrency,
  exportScope,
  setExportScope,
  exportMonth,
  setExportMonth,
  exportDate,
  setExportDate,
  handleExportCSV
}) {
  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="w-full bg-white dark:bg-zinc-900 p-8 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Account Preferences</h2>

        <div className="space-y-6">
          <div className="flex items-center justify-between pb-6 border-b border-gray-200 dark:border-zinc-800">
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200">Theme Preference</h3>
              <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">Switch between Light and Dark mode UI.</p>
            </div>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="px-4 py-2 bg-gray-100 dark:bg-zinc-800 rounded-md border border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 shadow-sm font-medium transition-all hover:bg-gray-200 dark:hover:bg-zinc-700"
            >
              {theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
            </button>
          </div>

          <div className="pb-6 border-b border-gray-200 dark:border-zinc-800 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">Monthly Net Salary</h3>
              <p className="text-xs text-gray-500 dark:text-zinc-500 mb-3">This baseline is used to calculate all budget percentages.</p>
              <input
                type="number"
                min="0"
                step="0.01"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                onWheel={(e) => e.target.blur()}
                className="w-full md:w-1/2 px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>

          <div className="pb-2 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">Global Currency Display</h3>
              <p className="text-xs text-gray-500 dark:text-zinc-500 mb-3">Set your preferred symbol for the dashboard.</p>
              <div className="flex gap-4">
                <select
                  value={currencyMode}
                  onChange={(e) => {
                    const m = e.target.value;
                    setCurrencyMode(m);
                    setCurrency(m === 'none' ? '' : m === 'custom' ? currency : m);
                  }}
                  className="px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-300 text-sm focus:outline-none focus:border-indigo-500 w-40"
                >
                  <option value="$">$ (USD)</option>
                  <option value="€">€ (Euro)</option>
                  <option value="£">£ (GBP)</option>
                  <option value="MAD">MAD</option>
                  <option value="none">None</option>
                  <option value="custom">Custom...</option>
                </select>

                {currencyMode === 'custom' && (
                  <input
                    type="text"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    placeholder="Sym"
                    maxLength="5"
                    className="w-24 px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 text-center text-sm"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-gray-200 dark:border-zinc-800 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">Data Portability & Custom Audit Export</h3>
              <p className="text-xs text-gray-500 dark:text-zinc-500 mb-4">
                Export a comprehensive financial statement for any past or current month, or drill down into a single day.
              </p>

              <div className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 space-y-4 mb-4">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setExportScope('month')}
                    className={`flex-1 py-2 rounded-md text-xs font-bold transition-all ${exportScope === 'month'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-500'
                      }`}
                  >
                    📅 Whole Month Report
                  </button>
                  <button
                    type="button"
                    onClick={() => setExportScope('day')}
                    className={`flex-1 py-2 rounded-md text-xs font-bold transition-all ${exportScope === 'day'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-500'
                      }`}
                  >
                    📌 Specific Day Report
                  </button>
                </div>

                {exportScope === 'month' ? (
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">
                      Select Month (Up to {getCurrentMonth()})
                    </label>
                    <input
                      type="month"
                      max={getCurrentMonth()}
                      value={exportMonth}
                      onChange={(e) => setExportMonth(e.target.value)}
                      className="w-full sm:w-64 px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-indigo-500 cursor-pointer"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-gray-400 mb-1">
                      Select Exact Date (Up to {getToday()})
                    </label>
                    <input
                      type="date"
                      max={getToday()}
                      value={exportDate}
                      onChange={(e) => setExportDate(e.target.value)}
                      className="w-full sm:w-64 px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-indigo-500 cursor-pointer"
                    />
                  </div>
                )}
              </div>

              <button
                onClick={handleExportCSV}
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-bold transition-all shadow-md flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Export {exportScope === 'month' ? `Month (${exportMonth})` : `Date (${exportDate})`} to CSV
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}