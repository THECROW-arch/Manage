import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { hexColorMap } from '../utils/constants';
import { useTranslation } from 'react-i18next';

/**
 * Displays total net wealth trajectory, asset distribution, and manual market adjustments.
 */
export default function PortfolioTab({
  assetCategories,
  handleAddAdjustment,
  adjCatId,
  setAdjCatId,
  adjAmount,
  setAdjAmount,
  adjNote,
  setAdjNote,
  adjDate,
  setAdjDate,
  assetAdjustments,
  categories,
  formatCurrency,
  wealthHistoryData,
  theme,
  currency,
  parsedSalary,
  monthlyExpenses,
  selectedMonth,
  todayMonth,
  closedMonths
}) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-fade-in">
      <div className="lg:col-span-5 space-y-6">
        <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-zinc-300 uppercase tracking-wider mb-2">
            {t('total_net_wealth_tracker')}
          </h2>
          <p className="text-gray-500 dark:text-zinc-500 text-xs mb-5">
            {t('portfolio_desc')}
          </p>

          {assetCategories.length === 0 ? (
            <p className="text-amber-600 bg-amber-50 dark:bg-amber-500/10 text-sm font-medium p-3 rounded-md border border-amber-200 dark:border-amber-500/20">
              {t('create_asset_prompt')}
            </p>
          ) : (
            <form onSubmit={handleAddAdjustment} className="space-y-4 bg-gray-50 dark:bg-zinc-950 p-4 rounded-md border border-gray-200 dark:border-zinc-800">
              <h3 className="text-gray-800 dark:text-zinc-300 text-sm font-medium mb-1">
                {t('log_market_fluctuation')}
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={adjCatId}
                  onChange={(e) => setAdjCatId(e.target.value)}
                  className="px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500"
                >
                  {assetCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
                <input
                  type="number"
                  step="0.01"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  placeholder={t('amount_plus_minus')}
                  className="px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={adjNote}
                  onChange={(e) => setAdjNote(e.target.value)}
                  placeholder={t('note_placeholder')}
                  className="px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="date"
                  value={adjDate}
                  onChange={(e) => setAdjDate(e.target.value)}
                  className="px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 px-4 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-all text-sm shadow-md"
              >
                {t('save_adjustment')}
              </button>
            </form>
          )}
        </div>

        <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 min-h-[300px]">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-300 tracking-tight mb-4">
            {t('adjustment_history')}
          </h3>
          {assetAdjustments.length === 0 ? (
            <p className="text-gray-500 dark:text-zinc-600 text-sm">{t('no_adjustments_yet')}</p>
          ) : (
            <ul className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {assetAdjustments.map((adj) => {
                const catName = categories.find(c => c.id === adj.category_id)?.name || t('unknown_cat');
                return (
                  <li key={adj.id} className="p-3 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 flex justify-between items-center group">
                    <div className="flex flex-col">
                      <span className="text-gray-800 dark:text-zinc-200 font-medium text-sm">{adj.note || t('manual_note')}</span>
                      <span className="text-xs text-gray-500 dark:text-zinc-500 mt-0.5">{catName} • {adj.adjustment_date}</span>
                    </div>
                    <span className={`font-mono text-sm font-bold ${adj.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {adj.amount > 0 ? '+' : ''}{formatCurrency(Math.abs(adj.amount))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="lg:col-span-7 max-h-[750px] overflow-y-auto pr-2 custom-scrollbar pb-2 space-y-6">
        <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-300 tracking-tight mb-4">
            {t('net_wealth_trajectory')}
          </h3>
          {wealthHistoryData.length < 2 ? (
            <div className="h-48 flex items-center justify-center border border-gray-200 dark:border-zinc-800/50 border-dashed rounded-md">
              <p className="text-gray-400 dark:text-zinc-500 text-sm">{t('wealth_chart_empty')}</p>
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={wealthHistoryData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme === 'dark' ? '#27272a' : '#e5e7eb'} vertical={false} />
                  <XAxis dataKey="month" stroke={theme === 'dark' ? '#71717a' : '#9ca3af'} fontSize={12} tickLine={false} axisLine={false} dy={10} />
                  <YAxis
                    stroke={theme === 'dark' ? '#71717a' : '#9ca3af'}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${currency}${value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value}`}
                    width={65}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: theme === 'dark' ? '#18181b' : '#ffffff', borderColor: theme === 'dark' ? '#27272a' : '#e5e7eb', borderRadius: '0.5rem', color: theme === 'dark' ? '#e4e4e7' : '#111827', fontSize: '12px' }}
                    formatter={(value) => [formatCurrency(value), t('total_wealth_tooltip')]}
                    labelStyle={{ color: theme === 'dark' ? '#a1a1aa' : '#6b7280', marginBottom: '4px' }}
                  />
                  <Line type="monotone" dataKey="wealth" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: theme === 'dark' ? '#18181b' : '#ffffff' }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {assetCategories.map(cat => {
            const currentMonthAllocation = parsedSalary * (cat.percentage / 100);
            const manualAdjTotal = assetAdjustments.filter(a => a.category_id === cat.id).reduce((sum, a) => sum + parseFloat(a.amount), 0);
            const spentFromAssetThisMonth = monthlyExpenses.filter(e => e.category_id === cat.id).reduce((sum, e) => sum + parseFloat(e.cost), 0);
            const isTodayClosed = closedMonths.some(c => (typeof c === 'string' ? c : c.month) === todayMonth);
            const previewDeposit = (selectedMonth === todayMonth && !isTodayClosed)
              ? Math.max(0, currentMonthAllocation - spentFromAssetThisMonth)
              : 0;
            const totalWealth = parseFloat((manualAdjTotal + previewDeposit).toFixed(2));
            const progressPercentage = cat.target_goal > 0 ? Math.min(100, (totalWealth / cat.target_goal) * 100) : 0;

            return (
              <div
                key={cat.id}
                style={{ borderTopWidth: '3px', borderTopColor: hexColorMap[cat.color] || '#52525b' }}
                className="p-6 rounded-lg border-x border-b border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 relative"
              >
                <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{cat.name}</h2>
                <p className="text-gray-500 dark:text-zinc-500 text-xs mb-4">{t('total_accumulated_value')}</p>
                <p className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white mb-6">
                  {formatCurrency(totalWealth)}
                </p>

                {cat.target_goal > 0 && (
                  <div className="mb-6">
                    <div className="flex justify-between items-baseline text-[10px] font-medium text-gray-500 dark:text-zinc-400 mb-1.5 uppercase tracking-wider">
                      <span>{t('goal_progress')}</span>
                      <span className="flex items-baseline gap-1">
                        <span>{Math.round(progressPercentage)}%</span>
                        {Math.abs(progressPercentage - Math.round(progressPercentage)) >= 0.05 && (
                          <span className="text-[9px] font-mono lowercase text-gray-400 dark:text-zinc-500">
                            ({progressPercentage.toFixed(2)}%)
                          </span>
                        )}
                        <span>{t('of_goal')} {formatCurrency(cat.target_goal)}</span>
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-zinc-950 rounded-full h-1.5 overflow-hidden border border-gray-200 dark:border-zinc-800">
                      <div
                        className="h-1.5 rounded-full bg-emerald-500 dark:bg-zinc-400 transition-all duration-1000 ease-out"
                        style={{ width: `${progressPercentage}%` }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}