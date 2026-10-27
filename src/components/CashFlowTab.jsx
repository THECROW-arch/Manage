import { PieChart, Pie, Tooltip, ResponsiveContainer } from 'recharts';
import { hexColorMap } from '../utils/constants';
import { useTranslation } from 'react-i18next';
/**
 * Renders the primary Cash Flow dashboard, handling category allocations and daily transaction logging.
 */
export default function CashFlowTab({
    isPastMonth,
    closedMonths,
    selectedMonth,
    handleCloseMonth,
    setSelectedMonth,
    isReadOnly,
    totalRemaining,
    parsedSalary,
    globalPercentUsed,
    totalSpent,
    totalAutomatedAssets,
    chartData,
    theme,
    formatCurrency,
    handleUnlockAll,
    lockedCategories,
    handleSmartLockAll,
    categories,
    monthlyExpenses,
    dragState,
    setDragState,
    handleSliderChange,
    toggleIndividualLock,
    setEditingCategory,
    handleDeleteCategory,
    editingCategory,
    handleUpdateCategory,
    setIsCategoryModalOpen,
    isCategoryModalOpen,
    newCategoryType,
    setNewCategoryType,
    newCategoryName,
    setNewCategoryName,
    newCategoryGoal,
    setNewCategoryGoal,
    handleAddCategory,
    setActiveTab,
    setPlannerSubTab,
    handleAddExpense,
    expenseName,
    setExpenseName,
    expenseCost,
    setExpenseCost,
    expenseCategoryId,
    setExpenseCategoryId,
    expenseDate,
    setExpenseDate,
    isRecurring,
    setIsRecurring,
    isBatched,
    setIsBatched,
    searchQuery,
    setSearchQuery,
    filterCategory,
    setFilterCategory,
    filteredExpenses,
    expandedTransactionId,
    setExpandedTransactionId,
    bundles,
    handleDeleteExpense,
    groupedExpenses
}) {
    const { t } = useTranslation();
    const [year, month] = selectedMonth.split('-').map(Number);
    const transactionMonth = selectedMonth
        ? new Date(year, month - 1, 1).toLocaleString('default', { month: 'short' })
        : '—';

    // --- Financial Conscience Engine ---
    const generateSmartInsights = () => {
        if (!categories || categories.length === 0) return null;

        let needsPct = 0;
        let wantsPct = 0;
        let savingsPct = 0;

        categories.forEach(cat => {
            const name = cat.name.toLowerCase();
            if (name.includes('need') || name.includes('besoin') || name.includes('necesidad') || name.includes('احتياج')) needsPct += cat.percentage || 0;
            else if (name.includes('want') || name.includes('envie') || name.includes('deseo') || name.includes('رغب')) wantsPct += cat.percentage || 0;
            else if (name.includes('saving') || name.includes('épargne') || name.includes('ahorro') || name.includes('ادخار') || name.includes('invest') || cat.type === 'asset') savingsPct += cat.percentage || 0;
        });

        const alerts = [];
        if (wantsPct > 30) {
            alerts.push({ type: 'warning', text: t('advice_wants_high', { percent: wantsPct.toFixed(0) }) });
        }
        if (needsPct > 50) {
            alerts.push({ type: 'notice', text: t('advice_needs_high', { percent: needsPct.toFixed(0) }) });
        }
        if (savingsPct > 0 && savingsPct < 20) {
            alerts.push({ type: 'tip', text: t('advice_savings_low', { percent: savingsPct.toFixed(0) }) });
        }

        if (alerts.length === 0 && (needsPct > 0 || wantsPct > 0 || savingsPct > 0)) {
            alerts.push({ type: 'success', text: t('advice_balanced') });
        }

        return alerts;
    };

    const smartInsights = generateSmartInsights();
    return (
        <>
            {isPastMonth && !closedMonths.includes(selectedMonth) && (
                <div className="w-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-6 mb-8 text-center">
                    <h2 className="text-xl font-bold text-amber-700 dark:text-amber-400 mb-2">Month-End Action Required</h2>
                    <p className="text-amber-600 dark:text-amber-200/80 mb-6 max-w-2xl mx-auto text-sm">
                        Finalize the <strong>{selectedMonth}</strong> ledger to lock your history and transfer wealth.
                    </p>
                    <button
                        onClick={handleCloseMonth}
                        className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-white dark:text-zinc-950 font-bold rounded-md transition-all text-sm shadow-md"
                    >
                        Close {selectedMonth} & Transfer Wealth
                    </button>
                </div>
            )}

            <div className="mb-6 flex items-center justify-between">
                <div className={`bg-white dark:bg-zinc-900 p-4 rounded-lg border ${isReadOnly ? 'border-amber-300 dark:border-amber-500/30' : 'border-gray-200 dark:border-zinc-800'} w-full md:w-64`}>
                    <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-500 mb-2 uppercase tracking-wider">{t('budget_month')}</h2>
                    <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="w-full px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-900 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-all text-sm cursor-pointer"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-5 space-y-6">

                    <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 relative overflow-hidden">
                        <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">{t('total_avail_cash')}</h2>
                        <div className="flex items-baseline gap-2 mb-4">
                            <span className="text-4xl font-bold text-gray-900 dark:text-white tracking-tight">{formatCurrency(totalRemaining)}</span>
                            <span className="text-xs font-medium text-gray-500 dark:text-zinc-500">{t('left_of')} {formatCurrency(parsedSalary)}</span>
                        </div>
                        <div className="w-full bg-gray-100 dark:bg-zinc-950 rounded-full h-1.5 mb-3 overflow-hidden border border-gray-200 dark:border-zinc-800">
                            <div
                                className={`h-1.5 rounded-full transition-all duration-1000 ease-out ${globalPercentUsed > 85 ? 'bg-rose-500' : 'bg-indigo-500 dark:bg-zinc-400'}`}
                                style={{ width: `${globalPercentUsed}%` }}
                            ></div>
                        </div>
                        <div className="flex justify-between items-center text-xs font-medium text-gray-500 dark:text-zinc-500">
                            <span>{formatCurrency(totalSpent)} {t('spent')} / {formatCurrency(totalAutomatedAssets)} {t('saved')}</span>
                            <span className="flex items-baseline gap-1">
                                <span>{Math.round(globalPercentUsed)}%</span>
                                {Math.abs(globalPercentUsed - Math.round(globalPercentUsed)) >= 0.05 && (
                                    <span className="text-[10px] font-mono text-gray-400 dark:text-zinc-600">
                                        ({globalPercentUsed.toFixed(2)}%)
                                    </span>
                                )}
                                <span>{t('consumed')}</span>
                            </span>
                        </div>
                    </div>
                    {/* Financial Conscience Banner */}
                    {smartInsights && smartInsights.length > 0 && (
                        <div className="col-span-1 lg:col-span-12 bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-500/20 rounded-lg p-4 mb-2 animate-fade-in">
                            <h3 className="text-xs font-bold text-indigo-800 dark:text-indigo-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-indigo-600 dark:text-indigo-400">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                                </svg>
                                {t('smart_insights')}
                            </h3>
                            <div className="flex flex-col gap-2">
                                {smartInsights.map((insight, idx) => (
                                    <div
                                        key={idx}
                                        className={`text-sm font-medium px-3 py-2 rounded-md border-l-4 ${insight.type === 'warning' ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-500 text-rose-700 dark:text-rose-300' :
                                            insight.type === 'notice' ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-500 text-amber-700 dark:text-amber-300' :
                                                insight.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-300' :
                                                    'bg-blue-50 dark:bg-blue-500/10 border-blue-500 text-blue-700 dark:text-blue-300'
                                            }`}
                                    >
                                        {insight.text}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {chartData.length > 0 && (
                        <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 flex flex-col items-center">
                            <h2 className="text-sm font-semibold text-gray-700 dark:text-zinc-300 mb-4 w-full text-left">{t('budget_breakdown')}</h2>
                            <ResponsiveContainer width="100%" height={200}>
                                <PieChart>
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: theme === 'dark' ? '#18181b' : '#ffffff',
                                            borderColor: theme === 'dark' ? '#27272a' : '#e5e7eb',
                                            borderRadius: '0.5rem',
                                            color: theme === 'dark' ? '#e4e4e7' : '#111827',
                                            fontSize: '12px'
                                        }}
                                        itemStyle={{ fontWeight: 'bold' }}
                                        formatter={(value) => formatCurrency(value)}
                                    />
                                    <Pie
                                        data={chartData}
                                        dataKey="value"
                                        nameKey="name"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={2}
                                        stroke="none"
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    <div className="space-y-4 mb-2 relative">
                        {!isReadOnly && (
                            <div className="flex justify-between items-center bg-gray-50 dark:bg-zinc-900 p-2 rounded-lg border border-gray-200 dark:border-zinc-800">
                                <button
                                    onClick={handleUnlockAll}
                                    disabled={lockedCategories.length === 0}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 border ${lockedCategories.length === 0
                                        ? 'border-transparent text-gray-400 dark:text-zinc-600 cursor-not-allowed'
                                        : 'border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 hover:text-gray-900 dark:hover:text-white shadow-sm'
                                        }`}
                                >
                                    {t('unlock_all')}
                                </button>
                                <button
                                    onClick={handleSmartLockAll}
                                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-bold transition-all flex items-center gap-2 shadow-md"
                                >
                                    {t('smart_lock_board')}
                                </button>
                            </div>
                        )}

                        <div className="space-y-4 max-h-[550px] overflow-y-auto pr-2 custom-scrollbar pb-2">
                            {categories.map((cat) => {
                                const categoryBase = parsedSalary * (cat.percentage / 100);
                                const isAsset = cat.type === 'asset';
                                const spent = monthlyExpenses.filter(e => e.category_id === cat.id).reduce((sum, e) => sum + parseFloat(e.cost), 0);
                                const remaining = Math.max(0, categoryBase - spent);
                                const percentUsed = (isAsset && spent === 0) ? 100 : (categoryBase > 0 ? Math.min(100, (spent / categoryBase) * 100) : 0);

                                let healthColor = isAsset ? "bg-emerald-500" : "bg-indigo-500";
                                if (!isAsset && percentUsed > 75) healthColor = "bg-amber-500";
                                if (!isAsset && percentUsed >= 90) healthColor = "bg-rose-500";

                                const isDragging = dragState.id === cat.id;
                                const currentPercent = isDragging ? dragState.val : cat.percentage;
                                const isCatLocked = lockedCategories.includes(cat.id) || isReadOnly;
                                const catHex = hexColorMap[cat.color] || '#52525b';

                                return (
                                    <div
                                        key={cat.id}
                                        style={{ borderTopWidth: '3px', borderTopColor: catHex }}
                                        className={`p-5 rounded-lg border-x border-b border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 relative transition-opacity ${isCatLocked && !isReadOnly ? 'opacity-60' : 'opacity-100'}`}
                                    >
                                        {!isReadOnly && (
                                            <div className="absolute top-3 right-4 flex gap-2">
                                                <button
                                                    onClick={() => setEditingCategory({ id: cat.id, name: cat.name, target_goal: cat.target_goal || 0 })}
                                                    className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 font-bold transition-colors text-xs"
                                                >
                                                    ✎
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteCategory(cat.id, cat.percentage)}
                                                    className="text-gray-400 dark:text-zinc-500 hover:text-rose-500 dark:hover:text-rose-400 font-bold transition-colors text-xs"
                                                >

                                                </button>
                                            </div>
                                        )}

                                        {editingCategory?.id === cat.id ? (
                                            <div className="flex flex-col gap-2 mb-3 pr-10">
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={editingCategory.name}
                                                    onChange={e => setEditingCategory({ ...editingCategory, name: e.target.value })}
                                                    className="px-3 py-1 bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 rounded-md w-full text-xs focus:outline-none"
                                                />
                                                <button
                                                    onClick={() => handleUpdateCategory(cat.id, editingCategory.name, editingCategory.target_goal)}
                                                    className="bg-gray-800 dark:bg-zinc-800 text-white px-3 py-1 rounded-md font-bold w-10 self-end text-xs"
                                                >
                                                    ✓
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 mb-1">
                                                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{cat.name}</h2>
                                                {isAsset && (
                                                    <span className="text-[9px] uppercase bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 px-1.5 py-0.5 rounded font-bold tracking-wider">
                                                        Asset
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        <div className="flex items-baseline gap-2 mb-4">
                                            <p className="text-2xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">{formatCurrency(remaining)}</p>
                                            <span className="text-xs font-medium text-gray-500 dark:text-zinc-500">{isAsset && spent === 0 ? t('auto_saved').toLowerCase() : t('remaining').toLowerCase()}</span>                                        </div>

                                        {(!isAsset || spent > 0) && (
                                            <>
                                                <div className="w-full bg-gray-100 dark:bg-zinc-950 rounded-full h-1.5 mb-2 overflow-hidden border border-gray-200 dark:border-zinc-800">
                                                    <div
                                                        className={`h-1.5 rounded-full ${healthColor} transition-all duration-700 ease-out`}
                                                        style={{ width: `${percentUsed}%` }}
                                                    ></div>
                                                </div>
                                                <div className="flex justify-between items-center text-xs text-gray-500 dark:text-zinc-500 font-medium mb-5">
                                                    <span>{formatCurrency(spent)} {t('spent').toLowerCase()}</span>
                                                    <span className="flex items-baseline gap-1">
                                                        <span>{Math.round(percentUsed)}%</span>
                                                        {Math.abs(percentUsed - Math.round(percentUsed)) >= 0.05 && (
                                                            <span className="text-[10px] font-mono text-gray-400 dark:text-zinc-600">
                                                                ({percentUsed.toFixed(2)}%)
                                                            </span>
                                                        )}
                                                        <span>{t('used')}</span>
                                                    </span>
                                                </div>
                                            </>
                                        )}

                                        <div className="pt-4 border-t border-gray-100 dark:border-zinc-800/60">
                                            <div className="flex justify-between items-center mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-zinc-500 font-semibold">{t('allocation_label')}</span>
                                                    {!isReadOnly && (
                                                        <button
                                                            onClick={() => toggleIndividualLock(cat.id)}
                                                            className={`p-1 rounded transition-all ${isCatLocked
                                                                ? 'text-indigo-600 bg-indigo-50 dark:text-zinc-100 dark:bg-zinc-800'
                                                                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-zinc-600 dark:hover:text-zinc-300 dark:hover:bg-zinc-800'
                                                                }`}
                                                        >
                                                            {isCatLocked ? '🔒' : '🔓'}
                                                        </button>
                                                    )}
                                                </div>
                                                <span className="text-xs font-bold text-gray-700 dark:text-zinc-300 flex items-baseline gap-1">
                                                    <span>{Math.round(currentPercent)}%</span>
                                                    {Math.abs(currentPercent - Math.round(currentPercent)) >= 0.05 && (
                                                        <span className="text-[10px] font-mono font-normal text-gray-400 dark:text-zinc-500">
                                                            ({Number(currentPercent).toFixed(2)}%)
                                                        </span>
                                                    )}
                                                    <span className="text-gray-500 dark:text-zinc-500 font-normal ml-0.5">
                                                        ({formatCurrency(categoryBase)})
                                                    </span>
                                                </span>
                                            </div>

                                            <input
                                                type="range"
                                                min="0"
                                                max="100"
                                                value={currentPercent}
                                                disabled={isCatLocked}
                                                onChange={(e) => {
                                                    if (!isReadOnly && !isCatLocked) {
                                                        setDragState(prev => ({ ...prev, val: Number(e.target.value) }));
                                                    }
                                                }}
                                                onPointerDown={() => {
                                                    if (!isReadOnly && !isCatLocked) {
                                                        setDragState({ id: cat.id, val: cat.percentage });
                                                    }
                                                }}
                                                onPointerUp={() => {
                                                    if (!isReadOnly && dragState.id === cat.id && !isCatLocked) {
                                                        handleSliderChange(cat.id, dragState.val);
                                                        setDragState({ id: null, val: 0 });
                                                    }
                                                }}
                                                onKeyUp={(e) => {
                                                    if (!isReadOnly && !isCatLocked && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                                                        handleSliderChange(cat.id, Number(e.target.value));
                                                        setDragState({ id: null, val: 0 });
                                                    }
                                                }}
                                                className={`w-full accent-indigo-600 dark:accent-zinc-400 ${isCatLocked ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* NEW CATEGORY BUTTON & MODAL */}
                        {!isReadOnly && (
                            <>
                                <button
                                    onClick={() => setIsCategoryModalOpen(true)}
                                    className="w-full py-3 mt-4 rounded-lg border-2 border-dashed border-gray-300 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:border-indigo-500 hover:text-indigo-600 dark:hover:border-indigo-500 dark:hover:text-indigo-400 font-semibold transition-all flex items-center justify-center gap-2"
                                >
                                    + {t('create_new_category')}
                                </button>

                                {isCategoryModalOpen && (
                                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                                        <div className="w-full max-w-md bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-2xl">
                                            <div className="flex justify-between items-center mb-5">
                                                <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">{t('create_new_category')}</h3>
                                                <button onClick={() => setIsCategoryModalOpen(false)} className="text-gray-400 hover:text-rose-500 text-lg font-bold"></button>
                                            </div>

                                            <div className="flex gap-2 mb-4">
                                                <button
                                                    onClick={() => setNewCategoryType('expense')}
                                                    className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${newCategoryType === 'expense'
                                                        ? 'bg-gray-800 dark:bg-zinc-700 text-white shadow'
                                                        : 'bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-500'
                                                        }`}
                                                >
                                                    {t('modal_expense')}
                                                </button>
                                                <button
                                                    onClick={() => setNewCategoryType('asset')}
                                                    className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${newCategoryType === 'asset'
                                                        ? 'bg-gray-800 dark:bg-zinc-700 text-white shadow'
                                                        : 'bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-500'
                                                        }`}
                                                >
                                                    {t('modal_wealth_asset')}
                                                </button>
                                            </div>

                                            <div className="space-y-3">
                                                <input
                                                    type="text"
                                                    value={newCategoryName}
                                                    onChange={(e) => setNewCategoryName(e.target.value)}
                                                    placeholder={t('modal_name_placeholder')}
                                                    className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                                                />
                                                {newCategoryType === 'asset' && (
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        value={newCategoryGoal}
                                                        onChange={(e) => setNewCategoryGoal(e.target.value)}
                                                        placeholder={t('modal_goal_placeholder')}
                                                        className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                                                    />
                                                )}
                                                <button
                                                    onClick={handleAddCategory}
                                                    className="w-full py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-md transition-all mt-2"
                                                >
                                                    {t('add_category')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div className="lg:col-span-7 space-y-6">
                    <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-semibold text-gray-800 dark:text-zinc-200">{t('quick_log_expense')}</h2>
                            <button
                                type="button"
                                onClick={() => { setActiveTab('occasions'); setPlannerSubTab('occasions'); }}
                                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                                {t('logging_special_occasion')}
                            </button>
                        </div>
                        {isReadOnly ? (
                            <div className="p-4 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-center">
                                <p className="text-gray-500 dark:text-zinc-400 text-sm">This month's ledger is locked and cannot be edited.</p>
                            </div>
                        ) : (
                            <form onSubmit={handleAddExpense} className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <input
                                        type="text"
                                        value={expenseName}
                                        onChange={(e) => setExpenseName(e.target.value)}
                                        placeholder={t('what_did_you_buy')}
                                        className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                                        required
                                    />
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={expenseCost}
                                        onChange={(e) => setExpenseCost(e.target.value)}
                                        placeholder={t('cost_placeholder')}
                                        className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                                        required
                                    />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <select
                                        value={expenseCategoryId}
                                        onChange={(e) => setExpenseCategoryId(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                                    >
                                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name} {cat.type === 'asset' ? '(Asset)' : ''}</option>)}
                                    </select>
                                    <input
                                        type="date"
                                        value={expenseDate}
                                        onChange={(e) => setExpenseDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                                        required
                                    />
                                </div>
                                <div className="flex items-center gap-6 pt-1 pb-2">
                                    <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-zinc-400 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={isRecurring}
                                            onChange={(e) => setIsRecurring(e.target.checked)}
                                            className="rounded border-gray-300 dark:border-zinc-700 text-indigo-600 focus:ring-indigo-500 bg-transparent cursor-pointer"
                                        />
                                        {t('recurring_monthly')}
                                    </label>
                                    <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-zinc-400 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={isBatched}
                                            onChange={(e) => setIsBatched(e.target.checked)}
                                            className="rounded border-gray-300 dark:border-zinc-700 text-indigo-600 focus:ring-indigo-500 bg-transparent cursor-pointer"
                                        />
                                        {t('batch_month_end')}
                                    </label>
                                </div>
                                <button
                                    type="submit"
                                    className="w-full py-2.5 px-4 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all text-sm shadow-md"
                                >
                                    {t('save_expense')}
                                </button>
                            </form>
                        )}
                    </div>

                    <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 min-h-[400px]">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-5 gap-4">
                            <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200">
                                {t('transactions')} {selectedMonth ? `(${new Date(selectedMonth.split('-')[0], selectedMonth.split('-')[1] - 1).toLocaleString('default', { month: 'short' })})` : '—'}
                            </h3>
                            {monthlyExpenses.length > 0 && (
                                <div className="flex gap-2 w-full sm:w-auto">
                                    <input
                                        type="text"
                                        placeholder={t('search_placeholder')}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full sm:w-40 px-3 py-1.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs focus:outline-none focus:border-indigo-500"
                                    />
                                    <select
                                        value={filterCategory}
                                        onChange={(e) => setFilterCategory(e.target.value)}
                                        className="w-full sm:w-40 px-3 py-1.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs focus:outline-none focus:border-indigo-500"
                                    >
                                        <option value="All">{t('all_categories')}</option>
                                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>

                        {filteredExpenses.length === 0 ? (
                            <div className="h-48 flex items-center justify-center border border-gray-200 dark:border-zinc-800/50 border-dashed rounded-md">
                                <p className="text-gray-500 dark:text-zinc-500 text-sm text-center py-6">{t('no_expenses_match')}</p>
                            </div>
                        ) : (
                            <ul className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                                {groupedExpenses.map((exp) => {
                                    const isExpanded = expandedTransactionId === exp.bundle_id;
                                    const bundleDetails = exp.bundle_id ? bundles.find(b => b.id === exp.bundle_id) : null;
                                    const bundleItems = bundleDetails?.items || [];

                                    return (
                                        <li
                                            key={exp.id}
                                            onClick={() => {
                                                if (exp.bundle_id) {
                                                    setExpandedTransactionId(isExpanded ? null : exp.bundle_id);
                                                }
                                            }}
                                            className={`p-3 rounded-md border flex flex-col group transition-all ${exp.bundle_id
                                                ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-500/30 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-500/50'
                                                : 'bg-gray-50 dark:bg-zinc-950 border-gray-100 dark:border-zinc-800'
                                                }`}
                                        >
                                            <div className="flex justify-between items-center w-full">
                                                <div className="flex flex-col">
                                                    <div className="text-gray-900 dark:text-zinc-200 font-medium text-sm flex items-center gap-2">
                                                        <span>{exp.name}</span>
                                                        {exp.bundle_id && <span className="text-[9px] uppercase font-bold text-purple-600 bg-purple-100 dark:text-purple-300 dark:bg-purple-500/20 px-1.5 py-0.5 rounded tracking-wider">Occasion Bundle</span>}
                                                        {exp.is_recurring && <span className="text-[9px] uppercase font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-500/20 px-1.5 py-0.5 rounded tracking-wider">Recurring</span>}
                                                        {exp.is_batched && <span className="text-[9px] uppercase font-bold text-amber-600 bg-amber-50 dark:bg-amber-500/20 px-1.5 py-0.5 rounded tracking-wider">Batched</span>}
                                                    </div>
                                                    <span className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                                                        {formatCurrency(exp.cost)} <span className="ml-2">• {exp.expense_date}</span>
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-[10px] uppercase px-2 py-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded text-gray-500 dark:text-zinc-400">
                                                        {exp.category}
                                                    </span>

                                                    {!isReadOnly && !exp.bundle_id && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleDeleteExpense(exp.id); }}
                                                            className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-rose-500 dark:text-zinc-500 dark:hover:text-rose-400 p-1 font-bold"
                                                        >

                                                        </button>
                                                    )}

                                                    {exp.bundle_id && (
                                                        <span className="text-indigo-400 dark:text-indigo-500 font-bold text-xs ml-1 transition-transform">
                                                            {isExpanded ? '▲' : '▼'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {isExpanded && bundleItems.length > 0 && (
                                                <div className="mt-3 pt-3 border-t border-indigo-200/50 dark:border-indigo-500/30 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                                                    <p className="text-[10px] uppercase font-bold text-indigo-500 dark:text-indigo-400 mb-2">Itemized Receipts</p>
                                                    <ul className="space-y-1.5">
                                                        {bundleItems.map((item, idx) => (
                                                            <li key={idx} className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 text-xs px-3 py-2 rounded bg-white dark:bg-zinc-900/80 border border-indigo-50 dark:border-zinc-800">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="text-gray-800 dark:text-zinc-200 font-semibold">{item.name}</span>
                                                                    {item.allocations && Object.entries(item.allocations).map(([cId, amt]) => (
                                                                        <span key={cId} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-zinc-800 text-indigo-600 dark:text-zinc-400 font-medium">
                                                                            {categories.find(c => c.id === cId)?.name || 'Category'}: {formatCurrency(amt)}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                                <span className="font-mono font-bold text-gray-700 dark:text-zinc-300">{formatCurrency(item.cost)}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
