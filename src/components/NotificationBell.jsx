import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getToday } from '../utils/constants';

/**
 * Renders the top-bar Notification Bell with live budget burn alerts,
 * unclosed month reminders, and pending Daily/Monthly/Yearly recurring expense confirmations.
 */
export default function NotificationBell({
    userId,
    selectedMonth,
    isPastMonth,
    closedMonths = [],
    isReadOnly,
    parsedSalary = 0,
    categories = [],
    monthlyExpenses = [],
    expenseMetaMap = {},
    updateExpenseMeta,
    isExpenseSkippedForCurrentPeriod,
    formatCurrency,
    setActiveTab
}) {
    const { t, i18n } = useTranslation();
    const activeLang = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2).toLowerCase();
    const isRtl = activeLang === 'ar';

    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    const readStorageKey = userId ? `managed_notif_ack_${userId}` : null;
    const [ackedSignature, setAckedSignature] = useState(() => {
        if (!readStorageKey) return '';
        try {
            return localStorage.getItem(readStorageKey) || '';
        } catch {
            return '';
        }
    });

    // Close popover on outside click or Escape key
    useEffect(() => {
        if (!isOpen) return;
        const handlePointerDown = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    const todayDateStr = getToday();

    const getPeriodKeyForFreq = (freq) =>
        freq === 'daily'
            ? todayDateStr
            : freq === 'yearly'
                ? selectedMonth.slice(0, 4)
                : selectedMonth;

    /**
     * Explicitly records the user's decision ('confirm' or 'skip') for the active period,
     * removing the recurring bill from the pending notification queue either way.
     */
    const handleRecurringDecision = (exp, decision) => {
        if (!updateExpenseMeta || isReadOnly) return;
        const meta = expenseMetaMap[exp.id] || {};
        const freq = meta.recurrenceType || 'monthly';
        const periodKey = getPeriodKeyForFreq(freq);

        const currentSkipped = Array.isArray(meta.skippedPeriods) ? meta.skippedPeriods : [];
        const currentConfirmed = Array.isArray(meta.confirmedPeriods) ? meta.confirmedPeriods : [];

        const nextSkipped =
            decision === 'skip'
                ? Array.from(new Set([...currentSkipped, periodKey]))
                : currentSkipped.filter((k) => k !== periodKey);

        const nextConfirmed =
            decision === 'confirm'
                ? Array.from(new Set([...currentConfirmed, periodKey]))
                : currentConfirmed.filter((k) => k !== periodKey);

        updateExpenseMeta(exp.id, {
            recurrenceType: freq,
            skippedPeriods: nextSkipped,
            confirmedPeriods: nextConfirmed
        });
    };

    // 1. Unclosed past month alert
    const alerts = [];
    const isMonthClosed = closedMonths.some(
        (c) => (typeof c === 'string' ? c : c.month) === selectedMonth
    );
    if (isPastMonth && !isMonthClosed) {
        alerts.push({
            id: `unclosed_${selectedMonth}`,
            severity: 'warning',
            title: t('notif_unclosed_month_title', { month: selectedMonth }),
            desc: t('notif_unclosed_month_desc', { month: selectedMonth })
        });
    }

    // 2. High-burn category alerts (>= 85% used)
    if (parsedSalary > 0) {
        categories
            .filter((c) => c.type !== 'asset')
            .forEach((cat) => {
                const budget = parsedSalary * ((Number(cat.percentage) || 0) / 100);
                if (budget <= 0) return;
                const spent = monthlyExpenses
                    .filter(
                        (e) =>
                            e.category_id === cat.id &&
                            !(isExpenseSkippedForCurrentPeriod && isExpenseSkippedForCurrentPeriod(e))
                    )
                    .reduce((s, e) => s + (parseFloat(e.cost) || 0), 0);
                const pct = Math.round((spent / budget) * 100);
                if (pct >= 85) {
                    alerts.push({
                        id: `burn_${cat.id}_${selectedMonth}_${pct}`,
                        severity: pct >= 95 ? 'danger' : 'warning',
                        title: t('notif_high_burn_title', { name: cat.name, pct }),
                        desc: t('notif_high_burn_desc', {
                            spent: formatCurrency(spent),
                            budget: formatCurrency(budget),
                            left: formatCurrency(Math.max(0, budget - spent))
                        })
                    });
                }
            });
    }

    // 3. Unallocated income notice
    const totalPct = categories.reduce((s, c) => s + (Number(c.percentage) || 0), 0);
    if (categories.length > 0 && Math.abs(100 - totalPct) >= 1) {
        alerts.push({
            id: `alloc_${selectedMonth}_${Math.round(totalPct)}`,
            severity: 'info',
            title: t('notif_unallocated_title', { diff: Math.round(Math.abs(100 - totalPct)) }),
            desc: t('notif_unallocated_desc')
        });
    }

    // 4. Only include recurring expenses that have NOT been answered (neither confirmed nor skipped) for this period
    const pendingRecurringList = monthlyExpenses
        .filter((e) => e.is_recurring)
        .map((e) => {
            const meta = expenseMetaMap[e.id] || {};
            const freq = meta.recurrenceType || 'monthly';
            const periodKey = getPeriodKeyForFreq(freq);
            const isSkipped = Array.isArray(meta.skippedPeriods) && meta.skippedPeriods.includes(periodKey);
            const isConfirmed = Array.isArray(meta.confirmedPeriods) && meta.confirmedPeriods.includes(periodKey);
            return {
                ...e,
                freq,
                isAnswered: isSkipped || isConfirmed
            };
        })
        .filter((e) => !e.isAnswered);

    const sigParts = [
        ...alerts.map((a) => a.id),
        ...pendingRecurringList.map((r) => `${r.id}_${r.freq}_${getPeriodKeyForFreq(r.freq)}_pending`)
    ];
    const signature = `${selectedMonth}::${sigParts.join('|')}`;

    const totalItemsCount = alerts.length + pendingRecurringList.length;
    const hasUnread = totalItemsCount > 0 && ackedSignature !== signature;

    const handleMarkAllRead = () => {
        setAckedSignature(signature);
        if (readStorageKey) {
            try {
                localStorage.setItem(readStorageKey, signature);
            } catch {
                // Ignore storage quota errors
            }
        }
    };

    return (
        <div ref={containerRef} className="relative flex justify-end mb-4" dir={isRtl ? 'rtl' : 'ltr'}>
            <button
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                aria-label={t('notif_bell_label')}
                aria-expanded={isOpen}
                className="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 hover:border-emerald-500 dark:hover:border-emerald-500/50 text-gray-700 dark:text-zinc-200 text-xs font-bold shadow-sm transition-all"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4 text-emerald-600 dark:text-emerald-400">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                <span>{t('notif_bell_label')}</span>
                {totalItemsCount > 0 && (
                    <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${hasUnread
                            ? 'bg-rose-600 text-white animate-pulse'
                            : 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400'
                            }`}
                    >
                        {totalItemsCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div
                    role="dialog"
                    aria-label={t('notif_title')}
                    className={`absolute top-10 ${isRtl ? 'left-0' : 'right-0'} z-50 w-[90vw] sm:w-96 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-fade-in`}
                >
                    <div className="px-4 py-3 bg-gray-50 dark:bg-zinc-950 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            <h3 className="text-xs font-black uppercase tracking-wider text-gray-900 dark:text-white">
                                {t('notif_title')}
                            </h3>
                        </div>
                        {hasUnread && (
                            <button
                                type="button"
                                onClick={handleMarkAllRead}
                                className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline"
                            >
                                {t('notif_mark_all_read')}
                            </button>
                        )}
                    </div>

                    <div className="max-h-96 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                        {alerts.length === 0 && pendingRecurringList.length === 0 ? (
                            <p className="text-xs text-gray-500 dark:text-zinc-500 text-center py-8">
                                {t('notif_all_caught_up', { month: selectedMonth })}
                            </p>
                        ) : (
                            <>
                                {alerts.map((al) => (
                                    <div
                                        key={al.id}
                                        className={`p-3 rounded-xl border text-xs ${al.severity === 'danger'
                                            ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200'
                                            : al.severity === 'warning'
                                                ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-200'
                                                : 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
                                            }`}
                                    >
                                        <p className="font-bold">{al.title}</p>
                                        <p className="text-[11px] opacity-90 mt-0.5">{al.desc}</p>
                                    </div>
                                ))}

                                {pendingRecurringList.length > 0 && (
                                    <div className="space-y-2 pt-1">
                                        <div className="flex items-center justify-between px-1">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                                                {t('notif_recurring_section', { count: pendingRecurringList.length })}
                                            </span>
                                            {setActiveTab && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveTab('cashflow');
                                                        setIsOpen(false);
                                                    }}
                                                    className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline"
                                                >
                                                    {t('notif_go_to_cashflow')}
                                                </button>
                                            )}
                                        </div>

                                        {pendingRecurringList.map((rec) => (
                                            <div
                                                key={rec.id}
                                                className="p-2.5 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 flex items-center justify-between gap-2"
                                            >
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-xs font-bold truncate text-gray-900 dark:text-white">
                                                            {rec.name}
                                                        </span>
                                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
                                                            {t(`freq_${rec.freq}`, rec.freq)}
                                                        </span>
                                                    </div>
                                                    <p className="text-[11px] text-gray-500 dark:text-zinc-400">
                                                        {formatCurrency(rec.cost)} • {rec.category}
                                                    </p>
                                                </div>

                                                {!isReadOnly && (
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRecurringDecision(rec, 'confirm')}
                                                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-700 hover:bg-emerald-800 text-white transition-colors"
                                                        >
                                                            {t('notif_confirm_period_btn')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRecurringDecision(rec, 'skip')}
                                                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 hover:border-amber-500 transition-colors"
                                                        >
                                                            {t('notif_skip_period_btn')}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}