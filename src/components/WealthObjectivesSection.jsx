import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getToday } from '../utils/constants';

/**
 * Sums only completed, recorded contributions for a wealth objective.
 * Configured auto-pull rules do not count as funded until they are executed and charged.
 * @param {object} obj - Wealth objective item.
 * @returns {number} Total funded amount.
 */
function getObjectiveFundedTotal(obj) {
    if (!obj) return 0;
    if (Array.isArray(obj.history) && obj.history.length > 0) {
        return Number(
            obj.history.reduce((sum, entry) => sum + (parseFloat(entry.amount) || 0), 0).toFixed(2)
        );
    }
    return Number((parseFloat(obj.manualSaved) || 0).toFixed(2));
}

/**
 * Renders the Wealth Objectives manager inside the Portfolio tab.
 * Supports multi-category automated monthly pulls plus manual contributions from any category.
 * @param {object} props - Component props.
 */
export default function WealthObjectivesSection({
    wealthObjectives = [],
    setWealthObjectives,
    categories = [],
    parsedSalary = 0,
    selectedMonth,
    isReadOnly = false,
    hasProAccess = false,
    onRequireProUpgrade,
    formatCurrency,
    getCategoryAvailablePool,
    onManualContributeToObjective
}) {
    const { t } = useTranslation();
    const [objName, setObjName] = useState('');
    const [objTarget, setObjTarget] = useState('');
    const [autoPulls, setAutoPulls] = useState({});
    const [tempAutoCatId, setTempAutoCatId] = useState('');
    const [tempAutoAmount, setTempAutoAmount] = useState('');

    // Manual top-up inputs keyed by objective ID
    const [manualInputs, setManualInputs] = useState({});
    const [statusMsg, setStatusMsg] = useState('');

    // In-flight guard per objective ID to prevent duplicate concurrent submissions
    const [fundingObjectiveIds, setFundingObjectiveIds] = useState(() => new Set());
    const fundingIdsRef = useRef(new Set());

    const activeMonthKey = selectedMonth || getToday().slice(0, 7);

    /**
     * Updates the in-flight request lock for a specific wealth objective.
     * @param {string} objId - Target objective ID.
     * @param {boolean} inFlight - Whether a contribution request is currently running.
     */
    const markObjectiveInFlight = (objId, inFlight) => {
        if (inFlight) {
            fundingIdsRef.current.add(objId);
        } else {
            fundingIdsRef.current.delete(objId);
        }
        setFundingObjectiveIds(new Set(fundingIdsRef.current));
    };

    /**
     * Adds or increments a monthly category auto-pull rule on the new objective form.
     */
    const handleAddAutoPullRule = () => {
        const catId = tempAutoCatId || categories[0]?.id;
        const amt = parseFloat(tempAutoAmount);
        if (!catId || isNaN(amt) || amt <= 0) return;
        setAutoPulls(prev => ({
            ...prev,
            [catId]: Number(((prev[catId] || 0) + amt).toFixed(2))
        }));
        setTempAutoAmount('');
    };

    /**
     * Creates a new wealth objective with optional multi-category monthly auto-pull rules.
     * Enforces the 1-objective limit for Free Tier users.
     * @param {Event} e - Form submit event.
     */
    const handleCreateObjective = (e) => {
        e.preventDefault();
        if (isReadOnly) return;

        if (!hasProAccess && wealthObjectives.length >= 1) {
            if (onRequireProUpgrade) {
                onRequireProUpgrade('Multi-Goal Wealth Objectives');
            }
            return;
        }

        const targetNum = parseFloat(objTarget);
        if (!objName.trim() || isNaN(targetNum) || targetNum <= 0) return;

        const finalAutoPulls = { ...autoPulls };
        const pendingCatId = tempAutoCatId || categories[0]?.id;
        if (pendingCatId && parseFloat(tempAutoAmount) > 0) {
            finalAutoPulls[pendingCatId] = Number(
                ((finalAutoPulls[pendingCatId] || 0) + parseFloat(tempAutoAmount)).toFixed(2)
            );
        }

        const newObjective = {
            id: crypto.randomUUID(),
            name: objName.trim(),
            targetAmount: targetNum,
            manualSaved: 0,
            autoPulls: finalAutoPulls,
            appliedMonths: [],
            history: [],
            createdAt: getToday()
        };

        setWealthObjectives(prev => [newObjective, ...prev]);
        setObjName('');
        setObjTarget('');
        setAutoPulls({});
        setTempAutoAmount('');
        setStatusMsg(`Created objective "${newObjective.name}" (${formatCurrency(targetNum)}).`);
    };

    /**
     * Processes a one-off manual contribution from any selected category into an objective.
     * Guards against concurrent duplicate clicks.
     * @param {object} obj - Target wealth objective.
     */
    const handleManualDeposit = async (obj) => {
        if (isReadOnly || fundingIdsRef.current.has(obj.id)) return;

        const input = manualInputs[obj.id] || {};
        const catId = input.catId || categories[0]?.id;
        const amt = parseFloat(input.amount);
        if (!catId || isNaN(amt) || amt <= 0) return;

        const catObj = categories.find(c => c.id === catId);
        if (!catObj) return;

        if (getCategoryAvailablePool) {
            const avail = getCategoryAvailablePool(catId);
            if (amt > avail) {
                setStatusMsg(`Cannot pull ${formatCurrency(amt)} from ${catObj.name} (only ${formatCurrency(avail)} available).`);
                return;
            }
        }

        markObjectiveInFlight(obj.id, true);
        try {
            if (onManualContributeToObjective) {
                const ok = await onManualContributeToObjective({
                    objectiveName: obj.name,
                    categoryId: catId,
                    amount: amt
                });
                if (!ok) return;
            }

            const stamp = getToday();
            setWealthObjectives(prev =>
                prev.map(item => {
                    if (item.id !== obj.id) return item;
                    const nextHistory = [
                        {
                            id: crypto.randomUUID(),
                            date: stamp,
                            categoryId: catId,
                            categoryName: catObj.name,
                            amount: amt,
                            type: 'manual',
                            month: activeMonthKey
                        },
                        ...(item.history || [])
                    ];
                    const nextTotal = nextHistory.reduce((s, h) => s + (parseFloat(h.amount) || 0), 0);
                    return {
                        ...item,
                        manualSaved: Number(nextTotal.toFixed(2)),
                        history: nextHistory
                    };
                })
            );

            setManualInputs(prev => ({ ...prev, [obj.id]: { ...input, amount: '' } }));
            setStatusMsg(`Added ${formatCurrency(amt)} from ${catObj.name} to "${obj.name}"!`);
        } finally {
            markObjectiveInFlight(obj.id, false);
        }
    };

    /**
     * Applies uncharged monthly auto-pulls for the active month without double-charging
     * categories that already succeeded in an earlier partial attempt.
     * @param {object} obj - Target wealth objective.
     */
    const handleApplyMonthlyAutoPulls = async (obj) => {
        if (isReadOnly || fundingIdsRef.current.has(obj.id)) return;
        const allEntries = Object.entries(obj.autoPulls || {}).filter(([, amt]) => parseFloat(amt) > 0);
        if (allEntries.length === 0) return;

        const alreadyChargedCatIds = new Set(
            (obj.history || [])
                .filter(h => h.type === 'auto' && h.month === activeMonthKey && h.categoryId)
                .map(h => h.categoryId)
        );

        const pendingEntries = allEntries.filter(([catId]) => !alreadyChargedCatIds.has(catId));
        const alreadyApplied =
            (Array.isArray(obj.appliedMonths) && obj.appliedMonths.includes(activeMonthKey)) ||
            pendingEntries.length === 0;

        if (alreadyApplied) {
            setStatusMsg(`Auto-pulls for "${obj.name}" have already been applied for ${activeMonthKey}.`);
            return;
        }

        for (const [catId, rawAmt] of pendingEntries) {
            const amt = parseFloat(rawAmt);
            const catObj = categories.find(c => c.id === catId);
            if (!catObj) {
                setStatusMsg(`Configured category for "${obj.name}" no longer exists.`);
                return;
            }
            if (getCategoryAvailablePool) {
                const avail = getCategoryAvailablePool(catId);
                if (amt > avail) {
                    setStatusMsg(`Cannot auto-pull ${formatCurrency(amt)} from ${catObj.name} (only ${formatCurrency(avail)} available).`);
                    return;
                }
            }
        }

        markObjectiveInFlight(obj.id, true);
        try {
            const completedEntries = [];
            const stamp = getToday();

            for (const [catId, rawAmt] of pendingEntries) {
                const amt = parseFloat(rawAmt);
                const catObj = categories.find(c => c.id === catId);
                if (!catObj) continue;

                if (onManualContributeToObjective) {
                    const ok = await onManualContributeToObjective({
                        objectiveName: `${obj.name} (Auto-Pull)`,
                        categoryId: catId,
                        amount: amt
                    });
                    if (!ok) break;
                }

                completedEntries.push({
                    id: crypto.randomUUID(),
                    date: stamp,
                    categoryId: catId,
                    categoryName: catObj.name,
                    amount: amt,
                    type: 'auto',
                    month: activeMonthKey
                });
            }

            if (completedEntries.length > 0) {
                const addedSum = completedEntries.reduce((s, e) => s + e.amount, 0);
                const allCompletedNow = completedEntries.length === pendingEntries.length;
                setWealthObjectives(prev =>
                    prev.map(item => {
                        if (item.id !== obj.id) return item;
                        const nextHistory = [...completedEntries, ...(item.history || [])];
                        const nextTotal = nextHistory.reduce((s, h) => s + (parseFloat(h.amount) || 0), 0);
                        const nextApplied = allCompletedNow
                            ? Array.from(new Set([...(item.appliedMonths || []), activeMonthKey]))
                            : (item.appliedMonths || []);
                        return {
                            ...item,
                            manualSaved: Number(nextTotal.toFixed(2)),
                            appliedMonths: nextApplied,
                            history: nextHistory
                        };
                    })
                );
                setStatusMsg(`Applied ${formatCurrency(addedSum)} in ${activeMonthKey} auto-pulls to "${obj.name}"!`);
            }
        } finally {
            markObjectiveInFlight(obj.id, false);
        }
    };

    /**
     * Deletes a wealth objective by ID when the month is writable and not in flight.
     * @param {string} id - Objective UUID to delete.
     */
    const handleDeleteObjective = (id) => {
        if (isReadOnly || fundingIdsRef.current.has(id)) return;
        setWealthObjectives(prev => prev.filter(o => o.id !== id));
    };

    return (
        <section className="mt-8 bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
                <div>
                    <h2 className="text-base font-bold text-gray-900 dark:text-white">
                        {t('wealth_objectives_title', 'Wealth Objectives & Target Goals')}
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-zinc-400">
                        {t('wealth_objectives_subtitle', 'Build dedicated targets (e.g., Car Chevy • 240,000) with automated monthly category pulls and manual top-ups.')}
                    </p>
                </div>
            </div>

            {statusMsg && (
                <div className="mb-4 px-3 py-2 rounded-md bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                    <span>{statusMsg}</span>
                    <button type="button" onClick={() => setStatusMsg('')} className="font-bold ml-2">✕</button>
                </div>
            )}

            {/* Create New Objective Form */}
            <form onSubmit={handleCreateObjective} className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 mb-6 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-400">
                    {t('new_wealth_objective', 'New Wealth Objective')}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                        type="text"
                        value={objName}
                        onChange={(e) => setObjName(e.target.value)}
                        placeholder={t('objective_name_placeholder', 'Objective Name (e.g. Car Chevy)')}
                        className="px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        required
                    />
                    <input
                        type="number"
                        step="0.01"
                        min="1"
                        value={objTarget}
                        onChange={(e) => setObjTarget(e.target.value)}
                        placeholder={t('target_cost_placeholder', 'Target Cost (e.g. 240000)')}
                        className="px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        required
                    />
                </div>

                {/* Automated Monthly Category Pull Builder */}
                <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600 dark:text-zinc-400">
                        {t('auto_pulls_label', 'Automated Monthly Category Pulls (Optional — choose 1 or multiple categories)')}
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <select
                            value={tempAutoCatId || categories[0]?.id || ''}
                            onChange={(e) => setTempAutoCatId(e.target.value)}
                            className="sm:w-1/2 px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white"
                        >
                            {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>
                                    {cat.name} ({formatCurrency(parsedSalary * ((cat.percentage || 0) / 100))}/mo)
                                </option>
                            ))}
                        </select>
                        <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={tempAutoAmount}
                            onChange={(e) => setTempAutoAmount(e.target.value)}
                            placeholder={t('monthly_autopull_placeholder', 'Monthly auto-pull amount (e.g. 2000)')}
                            className="flex-1 px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white"
                        />
                        <button
                            type="button"
                            onClick={handleAddAutoPullRule}
                            className="px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold shrink-0"
                        >
                            {t('add_autopull_btn', '+ Add Auto-Pull')}
                        </button>
                    </div>

                    {Object.keys(autoPulls).length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                            {Object.entries(autoPulls).map(([cId, amt]) => {
                                const cName = categories.find(c => c.id === cId)?.name || 'Category';
                                return (
                                    <span key={cId} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30">
                                        Auto: {cName} ({formatCurrency(amt)}/mo)
                                        <button
                                            type="button"
                                            onClick={() => setAutoPulls(prev => {
                                                const copy = { ...prev };
                                                delete copy[cId];
                                                return copy;
                                            })}
                                            className="hover:text-rose-500 font-black"
                                        >
                                            ✕
                                        </button>
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </div>

                <button
                    type="submit"
                    disabled={isReadOnly}
                    className="w-full py-2.5 rounded-md bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-xs shadow-sm transition-colors"
                >
                    {t('create_objective_btn', 'Create Wealth Objective')}
                </button>
            </form>

            {/* Objectives List */}
            {wealthObjectives.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-gray-200 dark:border-zinc-800 rounded-lg text-xs text-gray-500 dark:text-zinc-500">
                    {t('no_objectives_empty', 'No wealth objectives created yet. Add one above or ask Sterling: "Create a wealth objective named Car Chevy for 240000".')}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {wealthObjectives.map((obj) => {
                        const totalAccumulated = getObjectiveFundedTotal(obj);
                        const progressPct = obj.targetAmount > 0 ? Math.min(100, (totalAccumulated / obj.targetAmount) * 100) : 0;
                        const remainingNeeded = Math.max(0, obj.targetAmount - totalAccumulated);

                        const allAutoEntries = Object.entries(obj.autoPulls || {}).filter(([, amt]) => parseFloat(amt) > 0);
                        const chargedIdsThisMonth = new Set(
                            (obj.history || [])
                                .filter(h => h.type === 'auto' && h.month === activeMonthKey && h.categoryId)
                                .map(h => h.categoryId)
                        );
                        const pendingAutoAmount = allAutoEntries
                            .filter(([cId]) => !chargedIdsThisMonth.has(cId))
                            .reduce((s, [, v]) => s + (parseFloat(v) || 0), 0);
                        const configuredMonthlyAuto = allAutoEntries.reduce((s, [, v]) => s + (parseFloat(v) || 0), 0);
                        const isAutoAppliedThisMonth =
                            (Array.isArray(obj.appliedMonths) && obj.appliedMonths.includes(activeMonthKey)) ||
                            (configuredMonthlyAuto > 0 && pendingAutoAmount === 0);

                        const isFundingThis = fundingObjectiveIds.has(obj.id);
                        const mInput = manualInputs[obj.id] || { catId: categories[0]?.id || '', amount: '' };

                        return (
                            <div key={obj.id} className="p-5 rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-950/60 flex flex-col justify-between space-y-4">
                                <div>
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div>
                                            <h4 className="text-sm font-bold text-gray-900 dark:text-white">{obj.name}</h4>
                                            <p className="text-xs text-gray-500 dark:text-zinc-400">
                                                {t('target_label', 'Target:')} <strong className="text-gray-800 dark:text-zinc-200">{formatCurrency(obj.targetAmount)}</strong>
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={isReadOnly || isFundingThis}
                                            onClick={() => handleDeleteObjective(obj.id)}
                                            aria-label={`Delete ${obj.name}`}
                                            className="text-gray-400 hover:text-rose-500 disabled:opacity-40 text-xs font-bold p-1"
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    <div className="flex items-baseline justify-between text-xs mb-1.5">
                                        <span className="font-bold text-emerald-700 dark:text-emerald-400">
                                            {formatCurrency(totalAccumulated)} {t('funded_label', 'funded')} ({progressPct.toFixed(1)}%)
                                        </span>
                                        <span className="text-gray-500 dark:text-zinc-500">
                                            {formatCurrency(remainingNeeded)} {t('remaining_label', 'remaining')}
                                        </span>
                                    </div>
                                    <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-zinc-800 overflow-hidden mb-3">
                                        <div
                                            className="h-2 rounded-full bg-emerald-600 transition-all duration-500"
                                            style={{ width: `${progressPct}%` }}
                                        />
                                    </div>

                                    {configuredMonthlyAuto > 0 && (
                                        <div className="space-y-2 mb-3">
                                            <div className="flex flex-wrap gap-1.5">
                                                {Object.entries(obj.autoPulls).map(([cId, amt]) => {
                                                    const cName = categories.find(c => c.id === cId)?.name || 'Category';
                                                    return (
                                                        <span key={cId} className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 font-semibold">
                                                            {t('auto_rule_label', 'Auto Rule:')} {cName} ({formatCurrency(amt)}/mo)
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                            {!isReadOnly && (
                                                <button
                                                    type="button"
                                                    disabled={isFundingThis || isAutoAppliedThisMonth}
                                                    onClick={() => handleApplyMonthlyAutoPulls(obj)}
                                                    className="w-full py-1.5 px-3 rounded bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 text-[11px] font-bold disabled:opacity-50 transition-colors"
                                                >
                                                    {isFundingThis
                                                        ? 'Processing...'
                                                        : isAutoAppliedThisMonth
                                                        ? `✓ ${activeMonthKey} Auto-Pull Applied (${formatCurrency(configuredMonthlyAuto)})`
                                                        : `Apply ${activeMonthKey} Auto-Pull (${formatCurrency(pendingAutoAmount)})`}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Manual Contribution Box (From ANY Category) */}
                                <div className="pt-3 border-t border-gray-200 dark:border-zinc-800 space-y-2">
                                    <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                                        {t('add_manual_funds_label', 'Add Manual Funds (From Any Category)')}
                                    </span>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <select
                                            value={mInput.catId || categories[0]?.id || ''}
                                            onChange={(e) => setManualInputs(prev => ({
                                                ...prev,
                                                [obj.id]: { ...mInput, catId: e.target.value }
                                            }))}
                                            disabled={isReadOnly || isFundingThis}
                                            className="sm:w-2/5 px-2.5 py-1.5 rounded bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white disabled:opacity-50"
                                        >
                                            {categories.map(cat => (
                                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                                            ))}
                                        </select>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="1"
                                            value={mInput.amount || ''}
                                            onChange={(e) => setManualInputs(prev => ({
                                                ...prev,
                                                [obj.id]: { ...mInput, amount: e.target.value }
                                            }))}
                                            disabled={isReadOnly || isFundingThis}
                                            placeholder={t('amount_placeholder', 'Amount (e.g. 1500)')}
                                            className="flex-1 px-2.5 py-1.5 rounded bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white disabled:opacity-50"
                                        />
                                        <button
                                            type="button"
                                            disabled={isReadOnly || isFundingThis}
                                            onClick={() => handleManualDeposit(obj)}
                                            className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold shrink-0"
                                        >
                                            {isFundingThis ? t('funding_btn', 'Funding...') : t('fund_btn', '+ Fund')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}